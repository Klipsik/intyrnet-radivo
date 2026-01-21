// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod services;
mod sources;

use models::{RadioSource, RadioStation};
use services::StationService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppSettings {
    volume: u8,
    last_station_id: Option<String>,
    last_station_stream_url: Option<String>,
    last_station_slug: Option<String>,
    last_station_name: Option<String>,
    last_track_title: Option<String>,
    last_track_artist: Option<String>,
    last_track_cover: Option<String>,
    last_track_video_url: Option<String>,
    streaming_mode: String,
    window_width: Option<f64>,
    window_height: Option<f64>,
    #[serde(default = "default_true")]
    show_notifications: bool,
    #[serde(default = "default_true")]
    show_station_notifications: bool,
    /// Избранные станции (полная информация для разных источников)
    favorite_stations: Vec<RadioStation>,
    /// Кэш станций по источникам (ключ: "amg" или "ru101")
    cached_stations: HashMap<String, Vec<RadioStation>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            volume: 50,
            last_station_id: None,
            last_station_stream_url: None,
            last_station_slug: None,
            last_station_name: None,
            last_track_title: None,
            last_track_artist: None,
            last_track_cover: None,
            last_track_video_url: None,
            streaming_mode: "mp3".to_string(),
            window_width: None,
            window_height: None,
            show_notifications: true,
            show_station_notifications: true,
            favorite_stations: Vec::new(),
            cached_stations: HashMap::new(),
        }
    }
}

impl AppSettings {
    fn load() -> Self {
        if let Some(path) = get_settings_path() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                    return settings;
                }
            }
        }
        AppSettings::default()
    }

    fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(path) = get_settings_path() {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let content = serde_json::to_string_pretty(self)?;
            fs::write(&path, content)?;
        }
        Ok(())
    }

    fn get_cached_stations(&self, source: &str) -> Option<&Vec<RadioStation>> {
        self.cached_stations.get(source)
    }

    fn set_cached_stations(&mut self, source: String, stations: Vec<RadioStation>) {
        self.cached_stations.insert(source, stations);
    }

    fn add_favorite_station(&mut self, station: RadioStation) {
        if !self.favorite_stations.iter().any(|s| s.id == station.id) {
            self.favorite_stations.push(station);
        }
    }

    fn remove_favorite_station(&mut self, station_id: &str) {
        self.favorite_stations.retain(|s| s.id != station_id);
    }

    fn is_favorite(&self, station_id: &str) -> bool {
        self.favorite_stations.iter().any(|s| s.id == station_id)
    }
}

fn get_settings_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join("radio-app").join("settings.json"))
    }

    #[cfg(target_os = "linux")]
    {
        std::env::var("HOME")
            .ok()
            .map(|p| {
                PathBuf::from(p)
                    .join(".config")
                    .join("radio-app")
                    .join("settings.json")
            })
    }

    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|p| {
                PathBuf::from(p)
                    .join("Library")
                    .join("Application Support")
                    .join("radio-app")
                    .join("settings.json")
            })
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

struct AppState {
    station_service: Arc<StationService>,
    settings: Arc<RwLock<AppSettings>>,
    #[cfg(desktop)]
    tray_icon: Arc<tokio::sync::Mutex<Option<tauri::tray::TrayIcon<tauri::Wry>>>>,
}

// ==================== КОМАНДЫ ====================

/// Получить станции из указанного источника
#[tauri::command]
async fn fetch_stations(
    source: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RadioStation>, String> {
    let radio_source = match source.as_str() {
        "amg" => RadioSource::Amg,
        "ru101" => RadioSource::Ru101,
        _ => return Err(format!("Неизвестный источник: {}", source)),
    };

    match state.station_service.fetch_stations(radio_source).await {
        Ok(stations) => {
            let mut settings = state.settings.write().await;
            settings.set_cached_stations(source.clone(), stations.clone());
            let _ = settings.save();
            Ok(stations)
        }
        Err(e) => Err(format!("Ошибка загрузки станций: {}", e)),
    }
}

/// Получить кэшированные станции
#[tauri::command]
async fn get_cached_stations(
    source: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RadioStation>, String> {
    let settings = state.settings.read().await;
    match settings.get_cached_stations(&source) {
        Some(stations) => Ok(stations.clone()),
        None => Ok(Vec::new()),
    }
}

/// Проксировать видео (скачать полностью и вернуть как base64)
#[tauri::command]
async fn proxy_video(video_url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания клиента: {}", e))?;
    
    let response = client
        .get(&video_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки видео: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Сервер вернул ошибку: {}", response.status()));
    }
    
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();
    
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения данных: {}", e))?;
    
    use base64::Engine;
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    
    Ok(format!("data:{};base64,{}", content_type, base64_data))
}

/// Получить URL потока для станции (обновляет токен для 101.ru)
#[tauri::command]
async fn get_stream_url(
    station: RadioStation,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state
        .station_service
        .get_stream_url(&station)
        .await
        .map_err(|e| format!("Ошибка получения потока: {}", e))
}

/// Обновить метаданные станции
#[tauri::command]
async fn update_station_metadata(
    mut station: RadioStation,
    state: tauri::State<'_, AppState>,
) -> Result<RadioStation, String> {
    state
        .station_service
        .update_metadata(&mut station)
        .await
        .map_err(|e| format!("Ошибка обновления метаданных: {}", e))?;
    Ok(station)
}

/// Получить избранные станции
#[tauri::command]
async fn get_favorites(state: tauri::State<'_, AppState>) -> Result<Vec<RadioStation>, String> {
    let settings = state.settings.read().await;
    Ok(settings.favorite_stations.clone())
}

/// Добавить/удалить станцию из избранного
#[tauri::command]
async fn toggle_favorite(
    station: RadioStation,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let mut settings = state.settings.write().await;
    let is_favorite = settings.is_favorite(&station.id);

    if is_favorite {
        settings.remove_favorite_station(&station.id);
    } else {
        settings.add_favorite_station(station.clone());
    }

    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;

    Ok(!is_favorite)
}

/// Проверить, в избранном ли станция
#[tauri::command]
async fn is_favorite(
    station_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let settings = state.settings.read().await;
    Ok(settings.is_favorite(&station_id))
}

/// Получить настройки
#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

/// Сохранить настройки
#[tauri::command]
async fn save_settings(
    new_settings: AppSettings,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    *settings = new_settings;
    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;
    Ok(())
}

/// Установить громкость
#[tauri::command]
async fn set_volume(volume: u8, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.volume = volume;
    let _ = settings.save();
    Ok(())
}

/// Установить режим стриминга
#[tauri::command]
async fn set_streaming_mode(mode: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if mode != "mp3" && mode != "hls" {
        return Err("Неверный режим стриминга. Используйте 'mp3' или 'hls'".to_string());
    }
    let mut settings = state.settings.write().await;
    settings.streaming_mode = mode;
    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;
    Ok(())
}

/// Сохранить размер окна
#[tauri::command]
async fn save_window_size(
    width: f64,
    height: f64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.window_width = Some(width);
    settings.window_height = Some(height);
    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;
    Ok(())
}

/// Сохранить последнюю станцию
#[tauri::command]
async fn set_last_station(
    station_id: String,
    station_stream_url: Option<String>,
    station_slug: Option<String>,
    station_name: Option<String>,
    track_title: Option<String>,
    track_artist: Option<String>,
    track_cover: Option<String>,
    track_video_url: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.last_station_id = Some(station_id);
    settings.last_station_stream_url = station_stream_url;
    settings.last_station_slug = station_slug;
    settings.last_station_name = station_name;
    settings.last_track_title = track_title;
    settings.last_track_artist = track_artist;
    settings.last_track_cover = track_cover;
    settings.last_track_video_url = track_video_url;
    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;
    Ok(())
}

// ==================== КОМАНДЫ СОВМЕСТИМОСТИ (для старого фронтенда) ====================

/// Парсинг AMG станций (совместимость)
#[tauri::command]
async fn parse_amg_stations(state: tauri::State<'_, AppState>) -> Result<Vec<RadioStation>, String> {
    fetch_stations("amg".to_string(), state).await
}

/// Парсинг 101.ru станций (совместимость)
#[tauri::command]
async fn parse_ru101_stations(state: tauri::State<'_, AppState>) -> Result<Vec<RadioStation>, String> {
    fetch_stations("ru101".to_string(), state).await
}

/// Получить станции (совместимость)
#[tauri::command]
async fn get_stations(state: tauri::State<'_, AppState>) -> Result<Vec<RadioStation>, String> {
    // Возвращаем все кэшированные станции
    let settings = state.settings.read().await;
    let mut all_stations = Vec::new();

    for stations in settings.cached_stations.values() {
        all_stations.extend(stations.clone());
    }

    Ok(all_stations)
}

/// Обновить станции (совместимость)
#[tauri::command]
async fn refresh_stations(state: tauri::State<'_, AppState>) -> Result<Vec<RadioStation>, String> {
    // Обновляем AMG станции
    let _ = fetch_stations("amg".to_string(), state.clone()).await;
    get_stations(state).await
}

/// Получить текущий трек (совместимость)
#[tauri::command]
async fn get_current_track(
    station_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    // Ищем станцию в кэше
    if let Some(station) = state.station_service.find_station_by_id(&station_id).await {
        return Ok(station.current_track);
    }
    Ok(None)
}

/// Переключить избранное по ID (совместимость со старым API)
#[tauri::command]
async fn toggle_favorite_station(
    station_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let mut settings = state.settings.write().await;
    let is_favorite = settings.is_favorite(&station_id);

    if is_favorite {
        settings.remove_favorite_station(&station_id);
    } else {
        let station = settings
            .cached_stations
            .values()
            .flatten()
            .find(|s| s.id == station_id)
            .cloned();

        if let Some(station) = station {
            settings.add_favorite_station(station);
        } else {
            return Err(format!("Станция {} не найдена в кэше", station_id));
        }
    }

    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;

    Ok(!is_favorite)
}

/// Показать уведомление о новой песне или станции
#[tauri::command]
async fn show_track_notification(
    title: String,
    body: String,
    image_url: Option<String>,
    station_name: Option<String>,
    label: Option<String>,
    is_station_notification: Option<bool>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let settings = state.settings.read().await;

    // Проверяем соответствующую настройку
    let is_station = is_station_notification.unwrap_or(false);
    if is_station {
        if !settings.show_station_notifications {
            return Ok(());
        }
    } else {
        if !settings.show_notifications {
            return Ok(());
        }
    }

    // Обновляем tooltip иконки трея с информацией о новой песне
    #[cfg(desktop)]
    {
        let tray_icon_state = state.tray_icon.clone();
        let title_clone = title.clone();
        let body_clone = body.clone();

        // Устанавливаем tooltip сразу, без длительного удержания lock
        {
            let tray_guard = tray_icon_state.lock().await;
            if let Some(ref tray) = *tray_guard {
                let tooltip_text = format!("🔔 {} - {}", title_clone, body_clone);
                let _ = tray.set_tooltip(Some(&tooltip_text));
            }
        } // lock освобождается здесь

        // Возвращаем tooltip через 5 секунд в отдельной задаче
        let tray_icon_state_reset = state.tray_icon.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            let tray_guard = tray_icon_state_reset.lock().await;
            if let Some(ref tray) = *tray_guard {
                let _ = tray.set_tooltip(Some("Интырнэт Радиво"));
            }
        });
    }

    // Создаем кастомное окно уведомления
    #[cfg(desktop)]
    {
        use tauri::WebviewWindowBuilder;
        use tauri::WebviewUrl;

        // Закрываем предыдущее окно уведомления, если есть
        if let Some(old_window) = app.get_webview_window("notification") {
            let _ = old_window.close();
        }

        // Формируем URL с параметрами
        let cover = image_url.unwrap_or_default();
        let station = station_name.unwrap_or_default();
        let lbl = label.unwrap_or_else(|| "Сейчас играет".to_string());

        let url = format!(
            "notification.html?title={}&artist={}&cover={}&station={}&label={}",
            urlencoding::encode(&title),
            urlencoding::encode(&body),
            urlencoding::encode(&cover),
            urlencoding::encode(&station),
            urlencoding::encode(&lbl)
        );

        // Размеры окна уведомления (квадратное, как обложка)
        let window_size: i32 = 200;

        // Создаем прозрачное окно уведомления
        if let Ok(notification_window) = WebviewWindowBuilder::new(&app, "notification", WebviewUrl::App(url.into()))
            .title("")
            .inner_size(window_size as f64, window_size as f64)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .resizable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .shadow(false) // Убираем тень окна Windows
            .build()
        {
            // Позиционируем в правом нижнем углу экрана
            if let Ok(monitor) = notification_window.primary_monitor() {
                if let Some(monitor) = monitor {
                    let screen_size = monitor.size();
                    let scale_factor = monitor.scale_factor();

                    let screen_width = (screen_size.width as f64 / scale_factor) as i32;
                    let screen_height = (screen_size.height as f64 / scale_factor) as i32;

                    let x = screen_width - window_size - 20;
                    let y = screen_height - window_size - 60; // Отступ от таскбара

                    let _ = notification_window.set_position(tauri::LogicalPosition::new(x, y));
                }
            }

            // Показываем окно после позиционирования
            let _ = notification_window.show();

            // Автоматически закрываем окно через 5.5 секунд (на случай если JS не сработает)
            let window_clone = notification_window.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(5500)).await;
                let _ = window_clone.close();
            });
        }
    }

    Ok(())
}

/// Установить настройку показа уведомлений о песне
#[tauri::command]
async fn set_show_notifications(
    show: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.show_notifications = show;
    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;
    Ok(())
}

/// Установить настройку показа уведомлений о станции
#[tauri::command]
async fn set_show_station_notifications(
    show: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.write().await;
    settings.show_station_notifications = show;
    settings
        .save()
        .map_err(|e| format!("Ошибка сохранения: {}", e))?;
    Ok(())
}


// ==================== MAIN ====================

fn main() {
    let settings = AppSettings::load();

    let app_state = AppState {
        station_service: Arc::new(StationService::new()),
        settings: Arc::new(RwLock::new(settings)),
        #[cfg(desktop)]
        tray_icon: Arc::new(tokio::sync::Mutex::new(None)),
    };

    // Загружаем кэш в сервис
    let station_service = app_state.station_service.clone();
    let settings_clone = app_state.settings.clone();

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let settings = settings_clone.read().await;
            for (source_str, stations) in &settings.cached_stations {
                let source = match source_str.as_str() {
                    "amg" => RadioSource::Amg,
                    "ru101" => RadioSource::Ru101,
                    _ => continue,
                };
                station_service.load_cache(source, stations.clone()).await;
            }
        });

    let tray_icon_state_for_setup = app_state.tray_icon.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // При попытке запустить второй экземпляр — показываем окно первого
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();
            let settings = AppSettings::load();

            if let (Some(width), Some(height)) = (settings.window_width, settings.window_height) {
                let _ = window.set_size(tauri::LogicalSize::new(width, height));
            }

            // Создаем системный трей
            let app_handle = app.app_handle();
            let tray_icon_for_tray = tray_icon_state_for_setup.clone();

            #[cfg(desktop)]
            {
                use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
                use tauri::menu::{MenuBuilder, MenuItemBuilder};

                // Проверяем, не создана ли уже иконка трея
                if app.tray_by_id("main-tray").is_none() {
                    let app_handle_clone = app_handle.clone();

                    // Создаем пункты контекстного меню
                    let show_item = MenuItemBuilder::with_id("show", "Показать")
                        .build(app)
                        .unwrap();
                    let about_item = MenuItemBuilder::with_id("about", "О программе")
                        .build(app)
                        .unwrap();
                    let quit_item = MenuItemBuilder::with_id("quit", "Выход")
                        .build(app)
                        .unwrap();

                    // Создаем меню
                    let menu = MenuBuilder::new(app)
                        .item(&show_item)
                        .item(&about_item)
                        .separator()
                        .item(&quit_item)
                        .build()
                        .unwrap();

                    let tray = TrayIconBuilder::with_id("main-tray")
                        .icon(app.default_window_icon().unwrap().clone())
                        .tooltip("Интырнэт Радиво")
                        .menu(&menu)
                        .on_menu_event(move |app, event| {
                            match event.id().as_ref() {
                                "show" => {
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                                "about" => {
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        let _ = window.eval("window.showAboutModal()");
                                    }
                                }
                                "quit" => {
                                    app.exit(0);
                                }
                                _ => {}
                            }
                        })
                        .on_tray_icon_event(move |_tray, event| {
                            // Реагируем только на клик левой кнопкой мыши
                            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                                // Клик по иконке трея - показать/скрыть окно
                                if let Some(window) = app_handle_clone.get_webview_window("main") {
                                    if window.is_visible().unwrap_or(false) {
                                        let _ = window.hide();
                                    } else {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                            }
                        })
                        .build(app)
                        .unwrap();

                    // Сохраняем ссылку на tray
                    let mut tray_guard = tray_icon_for_tray.try_lock().unwrap();
                    *tray_guard = Some(tray);
                }
            }

            // Скрываем окно в трей при закрытии вместо выхода
            let app_handle_for_close = app_handle.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(window) = app_handle_for_close.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            });

            Ok(())
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Новые команды
            fetch_stations,
            get_cached_stations,
            get_stream_url,
            proxy_video,
            update_station_metadata,
            get_favorites,
            toggle_favorite,
            is_favorite,
            get_settings,
            save_settings,
            set_volume,
            set_streaming_mode,
            save_window_size,
            set_last_station,
            show_track_notification,
            set_show_notifications,
            set_show_station_notifications,
            // Команды совместимости
            parse_amg_stations,
            parse_ru101_stations,
            get_stations,
            refresh_stations,
            get_current_track,
            toggle_favorite_station,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
