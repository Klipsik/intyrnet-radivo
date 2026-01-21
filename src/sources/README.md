# Добавление нового источника радиостанций

## Обзор архитектуры

Приложение использует паттерн **Strategy** для источников радио:
- Каждый источник реализует общий интерфейс `RadioSource`
- Источники регистрируются в `RadioSourceFactory`
- Фронтенд и бэкенд работают независимо

## Шаги для добавления нового источника

### 1. Фронтенд (JavaScript)

Создайте файл `src/sources/YourSource.js`:

```javascript
import { invoke } from '@tauri-apps/api/core';
import { RadioSource } from './RadioSource.js';

export class YourSource extends RadioSource {
  constructor() {
    super({
      id: 'yoursource',           // Уникальный ID
      name: 'Your Radio',         // Отображаемое имя
      apiUrl: 'https://...',      // URL API
      displayConfig: {
        logoSize: 60,
        showTrack: true,
        showBitrate: false
      }
    });
  }

  async parseStations() {
    return await invoke('parse_yoursource_stations');
  }

  async getStreamUrl(station) {
    return station.stream_url;
  }

  async getTrackMetadata(station) {
    // Получить текущий трек
    return { title, artist, cover };
  }

  ownsStation(station) {
    return station.source === 'yoursource';
  }
}
```

Зарегистрируйте в `src/sources/index.js`:

```javascript
import { YourSource } from './YourSource.js';

const SOURCES = {
  amg: AmgSource,
  ru101: Ru101Source,
  yoursource: YourSource,  // Добавьте здесь
};
```

### 2. Бэкенд (Rust)

Создайте файл `src-tauri/src/sources/yoursource.rs`:

```rust
use async_trait::async_trait;
use crate::models::RadioStation;
use super::RadioSourceTrait;

pub struct YourSource {
    client: reqwest::Client,
}

impl YourSource {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new()
        }
    }
}

#[async_trait]
impl RadioSourceTrait for YourSource {
    async fn fetch_stations(&self) -> Result<Vec<RadioStation>, ...> {
        // Парсинг станций
    }

    async fn get_stream_url(&self, station: &RadioStation) -> Result<String, ...> {
        // Получить URL потока
    }

    async fn update_metadata(&self, station: &mut RadioStation) -> Result<(), ...> {
        // Обновить метаданные
    }
}
```

Зарегистрируйте в `src-tauri/src/sources/mod.rs`:

```rust
mod yoursource;
pub use yoursource::YourSource;
```

Добавьте команду в `src-tauri/src/main.rs`:

```rust
#[tauri::command]
async fn parse_yoursource_stations(...) -> Result<Vec<RadioStation>, String> {
    fetch_stations("yoursource".to_string(), state).await
}
```

### 3. UI

Добавьте вкладку в `index.html`:

```html
<button class="tab-button" data-tab="yoursource">Your Radio</button>
```

### 4. Модель RadioSource

Добавьте вариант в `models/station.rs`:

```rust
pub enum RadioSource {
    Amg,
    Ru101,
    YourSource,
}
```

## Структура данных станции

```javascript
{
  id: "yoursource_123",      // Уникальный ID (prefix_id)
  name: "Station Name",
  logo: "https://...",
  stream_url: "https://...", // MP3 поток
  stream_hls: "https://...", // HLS поток (опционально)
  source: "yoursource",
  current_track: "...",      // Текущая песня
  current_artist: "...",
  bitrate: 128,              // Опционально
}
```

## Тестирование

1. `bun run tauri:dev` — запуск в dev-режиме
2. Проверить загрузку станций
3. Проверить воспроизведение
4. Проверить обновление метаданных
