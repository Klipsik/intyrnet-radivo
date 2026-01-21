/**
 * Базовый класс для источников радиостанций
 * Для добавления нового источника:
 * 1. Создайте класс, наследующий RadioSource
 * 2. Реализуйте методы parseStations() и getDisplayTemplate()
 * 3. Зарегистрируйте в RadioSourceFactory
 */
export class RadioSource {
  constructor(config) {
    this.id = config.id;           // 'amg', 'ru101', etc.
    this.name = config.name;       // 'AMG Radio', '101.ru'
    this.apiUrl = config.apiUrl;
    this.displayConfig = {
      logoSize: 60,
      showTrack: true,
      showBitrate: false,
      ...config.displayConfig
    };
  }

  /**
   * Получить список станций
   * @returns {Promise<Array>} Массив станций
   */
  async parseStations() {
    throw new Error(`${this.constructor.name}.parseStations() не реализован`);
  }

  /**
   * Получить URL потока для станции
   * @param {Object} station
   * @returns {Promise<string>}
   */
  async getStreamUrl(station) {
    return station.stream_url || station.streamUrl || '';
  }

  /**
   * Получить метаданные текущего трека
   * @param {Object} station
   * @returns {Promise<Object|null>}
   */
  async getTrackMetadata(station) {
    return null;
  }

  /**
   * Проверить, принадлежит ли станция этому источнику
   * @param {Object} station
   * @returns {boolean}
   */
  ownsStation(station) {
    return station.source === this.id || station.id?.startsWith(`${this.id}_`);
  }

  /**
   * Шаблон отображения станции
   * @param {Object} station
   * @param {Object} options
   * @returns {string} HTML
   */
  getDisplayTemplate(station, options = {}) {
    const { isActive, isFavorite, showDragHandle } = options;
    const logoUrl = station.logo || this.createFallbackLogo(station.name);
    const favoriteClass = isFavorite ? 'favorited' : '';

    return `
    <div class="station-icon ${isActive ? 'active' : ''}"
         data-station-id="${station.id}"
         data-source="${this.id}"
         title="${station.name}">
      <button class="favorite-button-icon ${favoriteClass}"
              data-station-id="${station.id}"
              title="${isFavorite ? 'Удалить из любимых' : 'Добавить в любимые'}">
        ${isFavorite ? '❤️' : '🤍'}
      </button>
      <img src="${logoUrl}"
           alt="${station.name}"
           class="station-icon-logo"
           onerror="this.onerror=null; this.src=window.createFallbackSvg('${station.name.replace(/'/g, "\\'")}')">
    </div>
    `;
  }

  /**
   * Создать fallback логотип
   * @param {string} name
   * @returns {string} Data URL
   */
  createFallbackLogo(name) {
    return window.createFallbackSvg?.(name) || '';
  }
}

export default RadioSource;
