/**
 * Вспомогательные функции
 */

/**
 * Нормализация ключа метаданных
 * @param {string} value
 * @returns {string}
 */
export function normalizeMetaKey(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[^a-z0-9_]/gi, '').toLowerCase();
}

/**
 * Получить уникальный ключ станции
 * @param {Object} station
 * @returns {string}
 */
export function getStationKey(station) {
  if (!station) return '';
  if (station.stream_url) return station.stream_url;
  const slug = normalizeMetaKey(station.station_slug || station.meta_key || '');
  if (slug) return `slug:${slug}`;
  const name = (station.name || '').toLowerCase();
  return name ? `name:${name}` : '';
}

/**
 * Удалить дубликаты станций
 * @param {Array} list
 * @returns {Array}
 */
export function dedupeStations(list) {
  const result = [];
  const seen = new Set();
  (list || []).forEach(station => {
    const key = getStationKey(station);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(station);
  });
  return result;
}

/**
 * Форматировать время обратного отсчёта
 * @param {number} ms - Миллисекунды
 * @returns {string}
 */
export function formatCountdown(ms) {
  if (ms === null || ms === undefined) return '';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Debounce функция
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle функция
 * @param {Function} fn
 * @param {number} limit
 * @returns {Function}
 */
export function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Сгенерировать fallback SVG логотип
 * @param {string} name
 * @returns {string} Data URL
 */
export function createFallbackSvg(name) {
  const maxLen = 14;
  let displayName = name || '🎵';
  if (displayName.length > maxLen) {
    displayName = displayName.substring(0, maxLen - 1) + '…';
  }

  // Экранируем спецсимволы для SVG
  displayName = displayName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Генерируем цвет на основе названия
  let hash = 0;
  for (let i = 0; i < name?.length || 0; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="103" height="103">
    <defs>
      <linearGradient id="grad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:hsl(${hue}, 55%, 50%);stop-opacity:1" />
        <stop offset="100%" style="stop-color:hsl(${(hue + 30) % 360}, 45%, 38%);stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect fill="url(#grad${hash})" width="103" height="103" rx="20"/>
    <text x="51.5" y="48" text-anchor="middle" fill="white" font-size="36">🎵</text>
    <text x="51.5" y="85" text-anchor="middle" fill="rgba(255,255,255,0.95)" font-size="11" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-weight="600">${displayName}</text>
  </svg>`;

  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Экспортируем глобально для использования в HTML
if (typeof window !== 'undefined') {
  window.createFallbackSvg = createFallbackSvg;
}
