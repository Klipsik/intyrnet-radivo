use crate::models::{RadioSource, RadioStation};
use crate::sources::{AmgSource, RadioSourceTrait, Ru101Source};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Сервис управления станциями из всех источников
pub struct StationService {
    amg_source: AmgSource,
    ru101_source: Ru101Source,
    /// Кэш станций по источникам
    cache: Arc<RwLock<HashMap<RadioSource, Vec<RadioStation>>>>,
}

impl StationService {
    pub fn new() -> Self {
        Self {
            amg_source: AmgSource::new(),
            ru101_source: Ru101Source::new(),
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Загрузить станции из указанного источника
    pub async fn fetch_stations(&self, source: RadioSource) -> Result<Vec<RadioStation>, Box<dyn std::error::Error + Send + Sync>> {
        let stations = match source {
            RadioSource::Amg => self.amg_source.fetch_stations().await?,
            RadioSource::Ru101 => self.ru101_source.fetch_stations().await?,
        };
        
        // Кэшируем результат
        {
            let mut cache = self.cache.write().await;
            cache.insert(source, stations.clone());
        }
        
        Ok(stations)
    }
    
    /// Получить станции из кэша
    #[allow(dead_code)]
    pub async fn get_cached_stations(&self, source: &RadioSource) -> Option<Vec<RadioStation>> {
        let cache = self.cache.read().await;
        cache.get(source).cloned()
    }
    
    /// Загрузить кэш из сохранённых данных
    pub async fn load_cache(&self, source: RadioSource, stations: Vec<RadioStation>) {
        let mut cache = self.cache.write().await;
        cache.insert(source, stations);
    }
    
    /// Получить все станции из всех источников
    #[allow(dead_code)]
    pub async fn get_all_stations(&self) -> Vec<RadioStation> {
        let cache = self.cache.read().await;
        cache.values().flatten().cloned().collect()
    }
    
    /// Получить URL потока для станции (обновляет токен если нужно)
    pub async fn get_stream_url(&self, station: &RadioStation) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        match station.source {
            RadioSource::Amg => self.amg_source.get_stream_url(station).await,
            RadioSource::Ru101 => self.ru101_source.get_stream_url(station).await,
        }
    }
    
    /// Обновить метаданные станции
    pub async fn update_metadata(&self, station: &mut RadioStation) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match station.source {
            RadioSource::Amg => self.amg_source.update_metadata(station).await,
            RadioSource::Ru101 => self.ru101_source.update_metadata(station).await,
        }
    }
    
    /// Найти станцию по ID
    pub async fn find_station_by_id(&self, id: &str) -> Option<RadioStation> {
        let cache = self.cache.read().await;
        for stations in cache.values() {
            if let Some(station) = stations.iter().find(|s| s.id == id) {
                return Some(station.clone());
            }
        }
        None
    }
}

impl Default for StationService {
    fn default() -> Self {
        Self::new()
    }
}
