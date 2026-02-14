use super::RadioSourceTrait;
use crate::models::RadioStation;
use async_trait::async_trait;

/// Источник AMG Radio (volna.top)
pub struct AmgSource {
    client: reqwest::Client,
}

impl AmgSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self { client }
    }

    /// Нормализация ключа метаданных
    fn normalize_meta_key(value: &str) -> String {
        value
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect::<String>()
            .to_lowercase()
    }

    /// Извлечь slug из HLS URL
    fn slug_from_hls_url(hls_url: &str) -> Option<String> {
        let without_query = hls_url.split('?').next().unwrap_or(hls_url);
        let without_fragment = without_query.split('#').next().unwrap_or(without_query);
        let segment = without_fragment
            .rsplit('/')
            .next()
            .unwrap_or(without_fragment);
        if segment.is_empty() {
            return None;
        }
        let without_ext = segment.trim_end_matches(".m3u8");
        if without_ext.is_empty() {
            return None;
        }
        Some(Self::normalize_meta_key(without_ext))
    }

    /// Извлечь slug из stream URL
    fn slug_from_stream_url(stream_url: &str) -> Option<String> {
        let without_query = stream_url.split('?').next().unwrap_or(stream_url);
        let without_fragment = without_query.split('#').next().unwrap_or(without_query);
        let segment = without_fragment
            .rsplit('/')
            .next()
            .unwrap_or(without_fragment);
        if segment.is_empty() {
            return None;
        }
        Some(Self::normalize_meta_key(segment))
    }

    /// Получить известные станции AMG (fallback)
    pub fn get_known_stations() -> Vec<RadioStation> {
        let known_stations_data = vec![
            (
                "ruwave",
                "Русская Волна",
                "https://ruwave.amgradio.ru/ruwave",
                "https://volna.top/logoradio/ruwave.svg",
            ),
            (
                "hypefm",
                "ХАЙП FM",
                "https://hfm.amgradio.ru/HypeFM",
                "https://volna.top/logoradio/hypefm.svg",
            ),
            (
                "remixfm",
                "Remix FM",
                "https://remix.amgradio.ru/Remix",
                "https://volna.top/logoradio/remixfm.svg",
            ),
            (
                "escapefm",
                "Escape FM",
                "https://escape.amgradio.ru/Escape",
                "https://volna.top/logoradio/escapefm.svg",
            ),
            (
                "rusrock",
                "Русский Рок",
                "https://rock.amgradio.ru/RusRock",
                "https://volna.top/logoradio/rusrock.svg",
            ),
            (
                "jazzfm",
                "Jazz FM",
                "https://jazz.amgradio.ru/Jazz",
                "https://volna.top/logoradio/jazzfm.svg",
            ),
            (
                "classicfm",
                "Classic FM",
                "https://classic.amgradio.ru/Classic",
                "https://volna.top/logoradio/classicfm.svg",
            ),
            (
                "popfm",
                "Pop FM",
                "https://pop.amgradio.ru/Pop",
                "https://volna.top/logoradio/popfm.svg",
            ),
        ];

        known_stations_data
            .into_iter()
            .map(|(slug, name, stream_url, logo)| {
                let mut station = RadioStation::new_amg(slug, name, stream_url);
                station.logo = Some(logo.to_string());
                station.artwork_url = Some(logo.to_string());
                station
            })
            .collect()
    }
}

impl Default for AmgSource {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl RadioSourceTrait for AmgSource {
    async fn fetch_stations(
        &self,
    ) -> Result<Vec<RadioStation>, Box<dyn std::error::Error + Send + Sync>> {
        // Пробуем WordPress REST API
        let api_url = "https://ru.volna.top/wp-json/wp/v2/station?per_page=100";

        let response = match self.client.get(api_url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json::<serde_json::Value>().await?,
            _ => {
                eprintln!("⚠️ WordPress API недоступен, используем известные станции");
                return Ok(Self::get_known_stations());
            }
        };

        let mut stations = Vec::new();

        if let Some(stations_array) = response.as_array() {
            for station_json in stations_array {
                if let (Some(title_obj), Some(meta_obj)) = (
                    station_json.get("title").and_then(|t| t.get("rendered")),
                    station_json.get("meta"),
                ) {
                    let name = title_obj
                        .as_str()
                        .unwrap_or("Неизвестная станция")
                        .to_string();
                    let slug = station_json
                        .get("slug")
                        .and_then(|s| s.as_str())
                        .map(String::from);

                    let stream_hls = meta_obj
                        .get("stream_hls")
                        .and_then(|s| s.as_str())
                        .map(String::from);

                    let stream_url = meta_obj
                        .get("stream_url")
                        .and_then(|s| s.as_str())
                        .map(String::from)
                        .or_else(|| stream_hls.clone())
                        .unwrap_or_default();

                    if stream_url.is_empty() {
                        continue;
                    }

                    let mut meta_key = stream_hls.as_ref().and_then(|v| Self::slug_from_hls_url(v));
                    if meta_key.is_none() {
                        meta_key = slug.as_ref().map(|v| Self::normalize_meta_key(v));
                    }
                    if meta_key.is_none() {
                        meta_key = Self::slug_from_stream_url(&stream_url);
                    }

                    let station_slug = meta_key
                        .clone()
                        .unwrap_or_else(|| slug.clone().unwrap_or_default());

                    // Получаем логотип через media API
                    let logo = if let Some(media_id) =
                        station_json.get("featured_media").and_then(|m| m.as_u64())
                    {
                        let media_url =
                            format!("https://ru.volna.top/wp-json/wp/v2/media/{}", media_id);
                        if let Ok(media_resp) = self.client.get(&media_url).send().await {
                            if let Ok(media_json) = media_resp.json::<serde_json::Value>().await {
                                media_json
                                    .get("source_url")
                                    .and_then(|s| s.as_str())
                                    .map(String::from)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let mut station = RadioStation::new_amg(&station_slug, &name, &stream_url);
                    station.stream_hls = stream_hls;
                    station.logo = logo.clone();
                    station.artwork_url = logo;
                    station.meta_key = meta_key;

                    stations.push(station);
                }
            }
        }

        if stations.is_empty() {
            eprintln!("⚠️ API не вернул станции, используем известные");
            return Ok(Self::get_known_stations());
        }

        stations.sort_by(|a, b| a.name.cmp(&b.name));
        eprintln!("📻 AMG: загружено {} станций", stations.len());

        Ok(stations)
    }

    async fn get_stream_url(
        &self,
        station: &RadioStation,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        // AMG потоки не требуют токенов, возвращаем как есть
        Ok(station.stream_url.clone())
    }

    async fn update_metadata(
        &self,
        station: &mut RadioStation,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let slug = station
            .meta_key
            .as_ref()
            .or(station.station_slug.as_ref())
            .ok_or("Нет slug для метаданных")?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis();

        let url = format!("https://info.volna.top/tag/{}.json?l={}", slug, timestamp);

        let response = self.client.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(format!("Ошибка получения метаданных: {}", response.status()).into());
        }

        let json: serde_json::Value = response.json().await?;

        if let Some(title) = json.get("title").and_then(|t| t.as_str()) {
            station.current_track = Some(title.to_string());
        }
        if let Some(artist) = json.get("artist").and_then(|a| a.as_str()) {
            station.current_artist = Some(artist.to_string());
        }
        if let Some(listeners) = json.get("now_listener").and_then(|l| l.as_u64()) {
            station.listeners = Some(listeners as u32);
        }
        if let Some(artwork) = json.get("artwork_url").and_then(|a| a.as_str()) {
            station.artwork_url = Some(artwork.to_string());
            if station.logo.is_none() {
                station.logo = Some(artwork.to_string());
            }
        }

        Ok(())
    }
}
