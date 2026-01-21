import { AmgSource } from './AmgSource.js';
import { Ru101Source } from './Ru101Source.js';

/**
 * Реестр источников радиостанций
 *
 * Для добавления нового источника:
 * 1. Создайте класс в sources/YourSource.js
 * 2. Добавьте его в SOURCES ниже
 * 3. Добавьте вкладку в index.html
 * 4. Добавьте Rust-реализацию в src-tauri/src/sources/
 */

// Зарегистрированные источники
const SOURCES = {
  amg: AmgSource,
  ru101: Ru101Source,
  // Пример добавления нового источника:
  // myradio: MyRadioSource,
};

// Кэш инстансов
const instances = new Map();

/**
 * Фабрика источников радиостанций
 */
export const RadioSourceFactory = {
  /**
   * Получить экземпляр источника по ID
   * @param {string} sourceId - 'amg', 'ru101', etc.
   * @returns {RadioSource}
   */
  getSource(sourceId) {
    if (!instances.has(sourceId)) {
      const SourceClass = SOURCES[sourceId];
      if (!SourceClass) {
        throw new Error(`Неизвестный источник: ${sourceId}`);
      }
      instances.set(sourceId, new SourceClass());
    }
    return instances.get(sourceId);
  },

  /**
   * Получить все доступные источники
   * @returns {string[]}
   */
  getAvailableSources() {
    return Object.keys(SOURCES);
  },

  /**
   * Найти источник для станции
   * @param {Object} station
   * @returns {RadioSource|null}
   */
  findSourceForStation(station) {
    for (const sourceId of Object.keys(SOURCES)) {
      const source = this.getSource(sourceId);
      if (source.ownsStation(station)) {
        return source;
      }
    }
    return null;
  },

  /**
   * Зарегистрировать новый источник
   * @param {string} id
   * @param {typeof RadioSource} SourceClass
   */
  register(id, SourceClass) {
    SOURCES[id] = SourceClass;
    instances.delete(id); // Сбросить кэш
  }
};

export { RadioSource } from './RadioSource.js';
export { AmgSource } from './AmgSource.js';
export { Ru101Source } from './Ru101Source.js';

export default RadioSourceFactory;
