use serde::{Deserialize, Serialize};

/// Источник радиостанции
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum RadioSource {
    /// AMG Radio (volna.top)
    Amg,
    /// 101.ru
    Ru101,
}

impl Default for RadioSource {
    fn default() -> Self {
        RadioSource::Amg
    }
}

/// Универсальная структура радиостанции
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioStation {
    /// Уникальный ID станции (формат: source_id, например "amg_ruwave" или "ru101_100")
    pub id: String,
    /// Название станции
    pub name: String,
    /// Источник станции
    pub source: RadioSource,
    /// URL потока (MP3/AAC)
    pub stream_url: String,
    /// HLS поток (m3u8) - опционально
    pub stream_hls: Option<String>,
    /// URL логотипа
    pub logo: Option<String>,
    /// Текущий трек
    pub current_track: Option<String>,
    /// Текущий исполнитель
    pub current_artist: Option<String>,
    
    // === AMG-специфичные поля ===
    /// Slug для API запросов AMG (ruwave, hypefm, etc.)
    pub station_slug: Option<String>,
    /// Основной логотип AMG
    pub artwork_url: Option<String>,
    /// Портретный логотип AMG
    pub artwork_url_p: Option<String>,
    /// Широкий логотип AMG
    pub artwork_url_w: Option<String>,
    /// Широкий портретный логотип AMG
    pub artwork_url_w_p: Option<String>,
    /// Сервер метаданных AMG
    pub meta_server: Option<String>,
    /// Ключ для метаданных AMG
    pub meta_key: Option<String>,
    
    // === 101.ru-специфичные поля ===
    /// ID канала на 101.ru
    pub channel_id: Option<u32>,
    /// Категория/жанр на 101.ru
    pub category: Option<String>,
    
    // === Общие поля ===
    /// Количество слушателей
    pub listeners: Option<u32>,
    /// Время окончания трека (Unix timestamp в миллисекундах)
    pub stop_at_ms: Option<i64>,
}

impl RadioStation {
    /// Создать ID станции на основе источника и внутреннего ID
    pub fn make_id(source: &RadioSource, internal_id: &str) -> String {
        match source {
            RadioSource::Amg => format!("amg_{}", internal_id),
            RadioSource::Ru101 => format!("ru101_{}", internal_id),
        }
    }
    
    /// Получить внутренний ID без префикса источника
    #[allow(dead_code)]
    pub fn internal_id(&self) -> &str {
        if self.id.starts_with("amg_") {
            &self.id[4..]
        } else if self.id.starts_with("ru101_") {
            &self.id[6..]
        } else {
            &self.id
        }
    }
    
    /// Создать новую AMG станцию
    pub fn new_amg(slug: &str, name: &str, stream_url: &str) -> Self {
        Self {
            id: Self::make_id(&RadioSource::Amg, slug),
            name: name.to_string(),
            source: RadioSource::Amg,
            stream_url: stream_url.to_string(),
            stream_hls: None,
            logo: None,
            current_track: None,
            current_artist: None,
            station_slug: Some(slug.to_string()),
            artwork_url: None,
            artwork_url_p: None,
            artwork_url_w: None,
            artwork_url_w_p: None,
            meta_server: Some("https://info.volna.top/radio.json".to_string()),
            meta_key: Some(slug.to_string()),
            channel_id: None,
            category: None,
            listeners: None,
            stop_at_ms: None,
        }
    }
    
    /// Создать новую 101.ru станцию
    pub fn new_ru101(channel_id: u32, name: &str, stream_url: &str) -> Self {
        Self {
            id: Self::make_id(&RadioSource::Ru101, &channel_id.to_string()),
            name: name.to_string(),
            source: RadioSource::Ru101,
            stream_url: stream_url.to_string(),
            stream_hls: None,
            logo: None,
            current_track: None,
            current_artist: None,
            station_slug: None,
            artwork_url: None,
            artwork_url_p: None,
            artwork_url_w: None,
            artwork_url_w_p: None,
            meta_server: None,
            meta_key: None,
            channel_id: Some(channel_id),
            category: None,
            listeners: None,
            stop_at_ms: None,
        }
    }
}
