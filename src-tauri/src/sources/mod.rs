mod amg;
mod ru101;

pub use amg::AmgSource;
pub use ru101::Ru101Source;

use crate::models::RadioStation;
use async_trait::async_trait;

/// Trait для источников радиостанций
#[async_trait]
pub trait RadioSourceTrait: Send + Sync {
    /// Получить список всех станций
    async fn fetch_stations(&self) -> Result<Vec<RadioStation>, Box<dyn std::error::Error + Send + Sync>>;
    
    /// Получить URL потока для станции (с обновлением токена если нужно)
    async fn get_stream_url(&self, station: &RadioStation) -> Result<String, Box<dyn std::error::Error + Send + Sync>>;
    
    /// Обновить метаданные станции (текущий трек и т.д.)
    async fn update_metadata(&self, station: &mut RadioStation) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
}
