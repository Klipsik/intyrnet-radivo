import { invoke } from '@tauri-apps/api/core';

/**
 * Глобальное состояние приложения
 * Простой реактивный store без зависимостей
 */

class AppStore {
  constructor() {
    // Состояние
    this.state = {
      // Станции
      stations: [],
      favoriteStations: [],     // ID избранных
      favoriteStationsData: [], // Полные данные избранных
      currentStation: null,

      // UI
      currentTab: 'favorites',  // 'favorites' | 'amg' | 'ru101'
      searchQuery: '',
      isLoading: false,

      // Настройки
      volume: 50,
      streamingMode: 'mp3',
      showNotifications: true,
      showStationNotifications: true,

      // Кэши
      stationById: new Map(),
      ru101StationsCache: [],
    };

    // Подписчики на изменения
    this.listeners = new Set();
  }

  /**
   * Получить текущее состояние
   */
  getState() {
    return this.state;
  }

  /**
   * Обновить состояние
   * @param {Object} updates
   */
  setState(updates) {
    this.state = { ...this.state, ...updates };
    this._notify();
  }

  /**
   * Подписаться на изменения
   * @param {Function} listener
   * @returns {Function} Функция отписки
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    this.listeners.forEach(listener => listener(this.state));
  }

  // === Методы работы со станциями ===

  /**
   * Индексировать станции
   * @param {Array} stations
   */
  indexStations(stations) {
    if (!Array.isArray(stations)) return;

    stations.forEach(station => {
      if (station?.id) {
        this.state.stationById.set(station.id, station);
      }
    });
  }

  /**
   * Найти станцию по ID
   * @param {string} id
   * @returns {Object|undefined}
   */
  findStation(id) {
    return this.state.stationById.get(id) ||
           this.state.stations.find(s => s.id === id) ||
           this.state.favoriteStationsData.find(s => s.id === id);
  }

  /**
   * Добавить/удалить из избранного
   * @param {string} stationId
   */
  async toggleFavorite(stationId) {
    try {
      const isNowFavorite = await invoke('toggle_favorite_station', { stationId });
      const station = this.findStation(stationId);

      if (!station) return isNowFavorite;

      if (isNowFavorite) {
        if (!this.state.favoriteStations.includes(stationId)) {
          this.state.favoriteStations.push(stationId);
          this.state.favoriteStationsData.push(station);
        }
      } else {
        this.state.favoriteStations = this.state.favoriteStations.filter(id => id !== stationId);
        this.state.favoriteStationsData = this.state.favoriteStationsData.filter(s => s.id !== stationId);
      }

      this._notify();
      return isNowFavorite;
    } catch (error) {
      console.error('Ошибка изменения избранного:', error);
      throw error;
    }
  }

  /**
   * Проверить, в избранном ли станция
   * @param {string} stationId
   * @returns {boolean}
   */
  isFavorite(stationId) {
    return this.state.favoriteStations.includes(stationId);
  }

  // === Методы работы с настройками ===

  /**
   * Загрузить настройки
   */
  async loadSettings() {
    try {
      const settings = await invoke('get_settings');

      this.setState({
        volume: settings.volume ?? 50,
        streamingMode: settings.streaming_mode || 'mp3',
        showNotifications: settings.show_notifications !== false,
        showStationNotifications: settings.show_station_notifications !== false,
      });

      // Загружаем избранные
      if (settings.favorite_stations && Array.isArray(settings.favorite_stations)) {
        this.state.favoriteStations = settings.favorite_stations.map(s => s.id);
        this.state.favoriteStationsData = settings.favorite_stations;
        this.indexStations(settings.favorite_stations);
      }

      return settings;
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      return null;
    }
  }

  /**
   * Сохранить громкость
   * @param {number} volume
   */
  async setVolume(volume) {
    this.setState({ volume });
    await invoke('set_volume', { volume });
  }

  /**
   * Сохранить режим стриминга
   * @param {string} mode
   */
  async setStreamingMode(mode) {
    this.setState({ streamingMode: mode });
    await invoke('set_streaming_mode', { mode });
  }
}

// Синглтон
export const appStore = new AppStore();
export default appStore;
