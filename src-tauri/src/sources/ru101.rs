use async_trait::async_trait;
use crate::models::RadioStation;
use super::RadioSourceTrait;
use scraper::{Html, Selector};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Ответ API 101.ru для потоков
#[derive(Debug, serde::Deserialize)]
struct Ru101StreamResponse {
    status: i32,
    result: Vec<Ru101StreamServer>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ru101StreamServer {
    #[allow(dead_code)]
    title_channel: String,
    url_stream: String,
    #[allow(dead_code)]
    format: String,
    quality: u32,
    protocols: String,
}

/// Источник 101.ru
pub struct Ru101Source {
    client: reqwest::Client,
    /// Cookie для авторизации потоков
    cookie: Arc<RwLock<Option<String>>>,
}

impl Ru101Source {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .cookie_store(true)
            .build()
            .unwrap_or_default();
        
        Self { 
            client,
            cookie: Arc::new(RwLock::new(None)),
        }
    }
    
    /// Инициализировать сессию и получить cookie
    async fn init_session(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let response = self.client
            .get("https://101.ru/")
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Referer", "https://101.ru/")
            .send()
            .await?;
        
        // Извлекаем cookie srvr101 из заголовков
        if let Some(cookie_header) = response.headers().get("set-cookie") {
            if let Ok(cookie_str) = cookie_header.to_str() {
                if cookie_str.contains("srvr101=") {
                    let mut cookie_guard = self.cookie.write().await;
                    *cookie_guard = Some(cookie_str.to_string());
                }
            }
        }
        
        Ok(())
    }
    
    /// Парсинг HTML страницы для получения списка станций
    async fn parse_stations_from_html(&self, html: &str) -> Vec<RadioStation> {
        let document = Html::parse_document(html);
        let mut stations = Vec::new();
        
        // Селектор для контейнеров станций (Schema.org микроформаты)
        let item_selector = Selector::parse(".grid__item").unwrap();
        let link_selector = Selector::parse("a[href*='/radio/channel/']").unwrap();
        // Несколько вариантов для логотипа (разные страницы используют разные структуры)
        let logo_selector = Selector::parse("link[itemprop='image logo']").unwrap();
        let logo_img_selector = Selector::parse("img.grid__cover-avatar").unwrap();
        let logo_source_selector = Selector::parse("source[data-srcset]").unwrap();
        // Используем broadcastDisplayName - это реальное название станции, а не бренд "101.ru"
        let name_selector = Selector::parse("[itemprop='name broadcastDisplayName']").unwrap();
        let title_selector = Selector::parse(".grid__title").unwrap();
        let img_alt_selector = Selector::parse("img[alt]").unwrap();
        
        let mut seen_ids = std::collections::HashSet::new();
        
        for item in document.select(&item_selector) {
            // Получаем ссылку на канал
            let link = match item.select(&link_selector).next() {
                Some(l) => l,
                None => continue,
            };
            
            let href = match link.value().attr("href") {
                Some(h) => h,
                None => continue,
            };
            
            // Извлекаем ID канала из URL
            let channel_id: u32 = match href
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .and_then(|s| s.parse().ok())
            {
                Some(id) => id,
                None => continue,
            };
            
            // Пропускаем дубликаты
            if !seen_ids.insert(channel_id) {
                continue;
            }
            
            // Получаем название из itemprop="name broadcastDisplayName", class="grid__title" или alt изображения
            let name = item
                .select(&name_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty() && s != "101.ru")
                .or_else(|| {
                    item.select(&title_selector)
                        .next()
                        .map(|el| el.text().collect::<String>().trim().to_string())
                        .filter(|s| !s.is_empty() && s != "101.ru")
                })
                .or_else(|| {
                    // Fallback: берём alt из изображения
                    item.select(&img_alt_selector)
                        .next()
                        .and_then(|el| el.value().attr("alt"))
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty() && s != "101.ru")
                })
                .unwrap_or_default();
            
            if name.is_empty() || name.len() < 2 {
                continue;
            }
            
            // Получаем URL логотипа из разных источников
            let logo = item
                .select(&logo_selector)
                .next()
                .and_then(|el| el.value().attr("href"))
                .map(|s| s.to_string())
                // Fallback: img с data-src (lazy loading)
                .or_else(|| {
                    item.select(&logo_img_selector)
                        .next()
                        .and_then(|el| el.value().attr("data-src").or(el.value().attr("src")))
                        .map(|s| s.to_string())
                })
                // Fallback: source с data-srcset
                .or_else(|| {
                    item.select(&logo_source_selector)
                        .next()
                        .and_then(|el| el.value().attr("data-srcset"))
                        .map(|s| s.to_string())
                });
            
            let mut station = RadioStation::new_ru101(channel_id, &name, "");
            station.logo = logo;
            
            stations.push(station);
        }
        
        // Если grid__item не сработал, пробуем старый способ через ссылки
        if stations.is_empty() {
            let fallback_link_selector = Selector::parse("a[href*='/radio/channel/']").unwrap();
            
            for link in document.select(&fallback_link_selector) {
                let href = match link.value().attr("href") {
                    Some(h) => h,
                    None => continue,
                };
                
                let channel_id: u32 = match href
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .and_then(|s| s.parse().ok())
                {
                    Some(id) => id,
                    None => continue,
                };
                
                if !seen_ids.insert(channel_id) {
                    continue;
                }
                
                let name = link.text().collect::<String>().trim().to_string();
                if name.is_empty() || name.len() < 2 {
                    continue;
                }
                
                let station = RadioStation::new_ru101(channel_id, &name, "");
                stations.push(station);
            }
        }
        
        stations
    }
    
    /// Получить URL потока для конкретного канала
    async fn fetch_stream_for_channel(&self, channel_id: u32) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("https://101.ru/api/channel/getListServersChannel/{}", channel_id);
        
        let response = self.client
            .get(&url)
            .header("Referer", "https://101.ru/")
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(format!("Ошибка API 101.ru: {}", response.status()).into());
        }
        
        let data: Ru101StreamResponse = response.json().await?;
        
        if data.status != 1 || data.result.is_empty() {
            return Err("Нет доступных потоков".into());
        }
        
        // Выбираем HTTPS поток с наилучшим качеством
        let best_stream = data.result
            .iter()
            .filter(|s| s.protocols == "https")
            .max_by_key(|s| s.quality)
            .or_else(|| data.result.first());
        
        match best_stream {
            Some(stream) => Ok(stream.url_stream.clone()),
            None => Err("Нет подходящего потока".into()),
        }
    }
}

impl Default for Ru101Source {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl RadioSourceTrait for Ru101Source {
    async fn fetch_stations(&self) -> Result<Vec<RadioStation>, Box<dyn std::error::Error + Send + Sync>> {
        // Инициализируем сессию для получения cookie
        self.init_session().await?;
        
        let mut all_stations = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        
        // Загружаем все группы (1-38, некоторые могут не существовать)
        eprintln!("📻 101.ru: загрузка всех групп (1-38)...");
        
        // Загружаем группы параллельно по 5 штук для экономии ресурсов
        let group_ids: Vec<u32> = (1..=38).collect();
        
        for chunk in group_ids.chunks(5) {
            let mut handles = Vec::new();
            
            for &group_id in chunk {
                let client = self.client.clone();
                handles.push(tokio::spawn(async move {
                    let url = format!("https://101.ru/radio-top/group/{}", group_id);
                    let response = client
                        .get(&url)
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                        .header("Referer", "https://101.ru/")
                        .send()
                        .await;
                    
                    match response {
                        Ok(resp) if resp.status().is_success() => {
                            resp.text().await.ok()
                        }
                        _ => None
                    }
                }));
            }
            
            // Собираем результаты
            for handle in handles {
                if let Ok(Some(html)) = handle.await {
                    let page_stations = self.parse_stations_from_html(&html).await;
                    
                    for mut station in page_stations {
                        if let Some(id) = station.channel_id {
                            if seen_ids.insert(id) {
                                // Добавляем полный URL для логотипа если он относительный
                                if let Some(ref logo) = station.logo {
                                    if logo.starts_with('/') {
                                        station.logo = Some(format!("https://101.ru{}", logo));
                                    }
                                }
                                all_stations.push(station);
                            }
                        }
                    }
                }
            }
        }
        
        // Сортируем по названию
        all_stations.sort_by(|a, b| a.name.cmp(&b.name));
        
        eprintln!("📻 101.ru: всего загружено {} уникальных станций", all_stations.len());
        
        Ok(all_stations)
    }
    
    async fn get_stream_url(&self, station: &RadioStation) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let channel_id = station.channel_id
            .ok_or("Нет channel_id для станции 101.ru")?;
        
        // Инициализируем сессию если нужно
        {
            let cookie_guard = self.cookie.read().await;
            if cookie_guard.is_none() {
                drop(cookie_guard);
                self.init_session().await?;
            }
        }
        
        self.fetch_stream_for_channel(channel_id).await
    }
    
    async fn update_metadata(&self, station: &mut RadioStation) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let channel_id = station.channel_id
            .ok_or("Нет channel_id для станции 101.ru")?;
        
        let url = format!("https://101.ru/api/channel/getTrackOnAir/{}", channel_id);
        
        let response = self.client
            .get(&url)
            .header("Referer", "https://101.ru/")
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(format!("Ошибка API 101.ru: {}", response.status()).into());
        }
        
        let json: serde_json::Value = response.json().await?;
        
        if json.get("status").and_then(|s| s.as_i64()) != Some(1) {
            return Err("Ошибка получения метаданных".into());
        }
        
        if let Some(result) = json.get("result") {
            if let Some(short) = result.get("short") {
                // Получаем название трека
                if let Some(title) = short.get("titleTrack").and_then(|t| t.as_str()) {
                    station.current_track = Some(title.to_string());
                }
                
                // Получаем исполнителя
                if let Some(artist) = short.get("titleExecutor").and_then(|a| a.as_str()) {
                    station.current_artist = Some(artist.to_string());
                }
                
                // Получаем обложку (максимальное качество: 400 -> 300 -> 200 -> оригинал)
                if let Some(cover) = short.get("cover") {
                    let cover_url = cover.get("cover400")
                        .or_else(|| cover.get("cover300"))
                        .or_else(|| cover.get("cover200"))
                        .or_else(|| cover.get("coverHTTP"))
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string());
                    
                    if let Some(url) = cover_url {
                        station.artwork_url = Some(url);
                    }
                }
            }
            
            // Получаем статистику (время окончания и слушатели)
            if let Some(stat) = result.get("stat") {
                // finishSong - Unix timestamp в секундах, конвертируем в миллисекунды
                if let Some(finish) = stat.get("finishSong").and_then(|f| f.as_i64()) {
                    station.stop_at_ms = Some(finish * 1000);
                }
                
                // Количество слушателей
                if let Some(listeners) = stat.get("listenAllUsers").and_then(|l| l.as_u64()) {
                    station.listeners = Some(listeners as u32);
                }
            }
        }
        
        Ok(())
    }
}
