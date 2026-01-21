import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { fetchAmgTrackMetadata } from './services/amgService.js';

let currentStation = null;
let audio = null;
let hlsPlayer = null; // Экземпляр HLS.js плеера для HLS потоков
let lastNotifiedTrack = null; // Последний трек, о котором было отправлено уведомление
let stationChangedAt = 0; // Время последней смены станции (для блокировки уведомлений о песне)
// Источники радиостанций
class RadioSource {
  constructor(name, apiUrl, displayConfig = {}) {
    this.name = name;
    this.apiUrl = apiUrl;
    this.displayConfig = {
      logoSize: 60,
      showTrack: true,
      showBitrate: false,
      customStyling: false,
      ...displayConfig
    };
  }

  async parseStations() {
    throw new Error('Метод parseStations должен быть реализован в подклассе');
  }

  getDisplayTemplate(station, realIndex, isActive, isFavorite) {
    const logoUrl = station.logo || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ccc%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2230%22 y=%2230%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E🎵%3C/text%3E%3C/svg%3E';
    const trackText = station.current_track || 'Прямой эфир';
    const favoriteClass = isFavorite ? 'favorited' : '';

    return `
    <div class="station-item ${isActive}"
         data-station-id="${station.id}"
         data-index="${realIndex}"
         onclick="if(!event.target.closest('.favorite-button')) playStation(${realIndex})"
         onmousedown="handleDragStart(event, '${station.id}')">
      <button class="favorite-button ${favoriteClass}"
              onclick="event.stopPropagation(); toggleFavorite('${station.id}')"
              title="${isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}">
        ${isFavorite ? '❤️' : '🤍'}
      </button>
      <img src="${logoUrl}" alt="${station.name}" class="station-logo" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ccc%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2230%22 y=%2230%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E🎵%3C/text%3E%3C/svg%3E'">
      <div class="station-info">
        <div class="station-name">${station.name}</div>
        <div class="station-track">${trackText}</div>
      </div>
    </div>
    `;
  }
}

// AMG Radio источник
class AMGSource extends RadioSource {
  constructor() {
    super('AMG Radio', 'https://ru.volna.top/wp-json/wp/v2/station?per_page=100', {
      logoSize: 60,
      showTrack: true,
      showBitrate: false
    });
  }

  async parseStations() {
    try {
      return await invoke('parse_amg_stations');
    } catch (error) {
      console.error('❌ Ошибка парсинга AMG:', error);
      throw error;
    }
  }
}

// 101.ru источник
class Ru101Source extends RadioSource {
  constructor() {
    super('101.ru', 'https://101.ru/api/v2', {
      logoSize: 50,
      showTrack: true,
      showBitrate: true,
      customStyling: true
    });
  }

  async parseStations() {
    try {
      return await invoke('parse_ru101_stations');
    } catch (error) {
      console.error('❌ Ошибка парсинга 101.ru:', error);
      throw error;
    }
  }

  getDisplayTemplate(station, realIndex, isActive, isFavorite) {
    // Кастомный шаблон для 101.ru с битрейтом
    const logoUrl = station.logo || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22%3E%3Crect fill=%22%23ccc%22 width=%2250%22 height=%2250%22/%3E%3Ctext x=%2225%22 y=%2225%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E🎵%3C/text%3E%3C/svg%3E';
    const trackText = station.current_track || 'Прямой эфир';
    const bitrateText = station.bitrate ? `${station.bitrate}kbps` : '';
    const favoriteClass = isFavorite ? 'favorited' : '';

    return `
    <div class="station-item ru101-style ${isActive}"
         data-station-id="${station.id}"
         data-index="${realIndex}"
         onclick="if(!event.target.closest('.favorite-button')) playStation(${realIndex})"
         onmousedown="handleDragStart(event, '${station.id}')">
      <button class="favorite-button ${favoriteClass}"
              onclick="event.stopPropagation(); toggleFavorite('${station.id}')"
              title="${isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}">
        ${isFavorite ? '❤️' : '🤍'}
      </button>
      <img src="${logoUrl}" alt="${station.name}" class="station-logo ru101-logo" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22%3E%3Crect fill=%22%23ccc%22 width=%2250%22 height=%2250%22/%3E%3Ctext x=%2225%22 y=%2225%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3E🎵%3C/text%3E%3C/svg%3E'">
      <div class="station-info">
        <div class="station-name">${station.name}</div>
        <div class="station-track">${trackText}</div>
        ${bitrateText ? `<div class="station-bitrate">${bitrateText}</div>` : ''}
      </div>
    </div>
    `;
  }
}

// Фабрика источников
class RadioSourceFactory {
  static createSource(type) {
    switch(type) {
      case 'amg':
        return new AMGSource();
      case 'ru101':
        return new Ru101Source();
      default:
        throw new Error(`Неизвестный тип источника: ${type}`);
    }
  }

  static getAvailableSources() {
    return ['amg', 'ru101'];
  }
}

let stations = [];
let currentTab = 'favorites'; // 'favorites', 'amg', 'ru101'
let currentSource = null;
let favoriteStations = []; // Массив ID избранных станций в порядке отображения
window.favoriteStationsData = []; // Полная информация о станциях в избранном
const stationById = new Map();

function normalizeMetaKey(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[^a-z0-9_]/gi, '').toLowerCase();
}

function getStationKey(station) {
  if (!station) return '';
  if (station.stream_url) return station.stream_url;
  const slug = normalizeMetaKey(station.station_slug || station.meta_key || '');
  if (slug) return `slug:${slug}`;
  const name = (station.name || '').toLowerCase();
  return name ? `name:${name}` : '';
}

function dedupeStations(list) {
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

function deriveStationSlug(station) {
  if (!station) return '';
  const existing = normalizeMetaKey(station.station_slug || station.meta_key || '');
  if (existing) return existing;
  const streamUrl = station.stream_url || station.streamUrl || '';
  if (!streamUrl) return '';
  const segment = streamUrl.split('?')[0].split('#')[0].split('/').pop() || '';
  return normalizeMetaKey(segment);
}

function ensureStationSlug(station) {
  if (!station) return;
  const streamUrl = station.stream_url || station.streamUrl || '';
  const derivedFromStream = streamUrl ? deriveStationSlug({ stream_url: streamUrl }) : '';
  const existing = normalizeMetaKey(station.station_slug || station.meta_key || '');
  const name = (station.name || '').toLowerCase();
  const manualMap = {
    'chilla fm': 'chilla',
    'classic fm': 'classic',
    'deep fm': 'deep',
    'remix fm - белорецк': 'remixfm_beloreck',
    'murka fm': 'murka',
    'мурка fm': 'murka',
    'мурка': 'murka',
    'родные песни': 'rodnyepesni'
  };
  const manual = manualMap[name] || '';
  const normalized = manual || derivedFromStream || existing;
  if (normalized && normalized !== existing) {
    station.station_slug = normalized;
    station.meta_key = normalized;
  } else if (normalized && !station.station_slug) {
    station.station_slug = normalized;
    station.meta_key = normalized;
  }

  // Дополнительная проверка для Мурка
  if ((name.includes('murka') || name.includes('мурка')) && !station.station_slug) {
    station.station_slug = 'murka';
    station.meta_key = 'murka';
  }
}

function indexStations(list) {
  if (!Array.isArray(list)) return;
  list.forEach(station => {
    if (station?.id) {
      ensureStationSlug(station);
      // Важно: сохраняем ссылку на оригинальный объект, но проверяем уникальность
      const existing = stationById.get(station.id);
      if (existing && existing !== station) {
        // Если объект уже существует и это другой объект, обновляем его поля, но сохраняем ссылку
        // Это предотвращает проблемы с мутацией при обновлении списка
        Object.assign(existing, station);
        // Восстанавливаем важные поля, которые могут быть перезаписаны
        if (station.station_slug) {
          existing.station_slug = station.station_slug;
          existing.meta_key = station.station_slug;
        }
      } else {
        stationById.set(station.id, station);
      }
    }
  });
}

function rehydrateFavorites() {
  if (!Array.isArray(favoriteStations)) return;
  const previous = Array.isArray(window.favoriteStationsData)
    ? window.favoriteStationsData
    : [];
  const previousById = new Map(previous.map(station => [station.id, station]));
  window.favoriteStationsData = favoriteStations
    .map(id => stationById.get(id) || previousById.get(id))
    .filter(Boolean);
  window.favoriteStationsData.forEach(station => ensureStationSlug(station));
}

function isAmgCacheValid(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const hasRusrock = list.some(station => {
    const slug = normalizeMetaKey(station.station_slug || station.meta_key || '');
    const name = (station.name || '').toLowerCase();
    return slug === 'rusrock' || name.includes('русский рок');
  });
  const hasRockfm = list.some(station => {
    const slug = normalizeMetaKey(station.station_slug || station.meta_key || '');
    const name = (station.name || '').toLowerCase();
    return slug === 'rockfm' || name.includes('rock fm');
  });
  return hasRusrock && !hasRockfm;
}

function migrateFavorites(settings) {
  const saved = Array.isArray(settings.favorite_stations)
    ? settings.favorite_stations
    : [];
  if (saved.length === 0) return false;
  const stationsByStream = new Map();
  const stationsByName = new Map();
  stationById.forEach(station => {
    if (station.stream_url) stationsByStream.set(station.stream_url, station);
    if (station.name) stationsByName.set(station.name.toLowerCase(), station);
  });

  const migrated = [];
  let changed = false;

  for (const station of saved) {
    const byStream = station.stream_url && stationsByStream.get(station.stream_url);
    const byName = station.name && stationsByName.get(station.name.toLowerCase());
    const resolved = byStream || byName || station;
    if (resolved.id !== station.id) {
      changed = true;
    }
    ensureStationSlug(resolved);
    migrated.push(resolved);
  }

  const deduped = dedupeStations(migrated);
  if (changed || deduped.length !== migrated.length) {
    settings.favorite_stations = deduped;
    return true;
  }
  return false;
}

// AMG Current Track Display
let currentTrackInfo = {
  title: '',
  artist: '',
  cover: '',
  station: null,
  isPlaying: false,
  listeners: null,
  timeText: '',
  nextTitle: '',
  nextArtist: '',
  stopAtMs: null,
  videoNow: '',
  videoUrl: ''
};

let metadataPollTimeout = null;
let trackCountdownTimer = null;
let hasAutoPlayedLastStation = false;
const appWindow = getCurrentWindow();
let initOverlayVisible = true;
const stationRefreshState = new Map();
let streamingMode = 'mp3'; // 'mp3' или 'hls'

function updateWindowTitle(stationName) {
  const title = stationName || 'Интырнэт Радиво';
  appWindow.setTitle(title).catch(() => {});
  document.title = title;
}

function scheduleStationsRefresh(sourceType, sourceInstance) {
  const state = stationRefreshState.get(sourceType) || { running: false, pending: false, instance: null };
  state.pending = true;
  state.instance = sourceInstance || state.instance;
  if (state.running) {
    stationRefreshState.set(sourceType, state);
    return;
  }
  state.running = true;
  state.pending = false;
  stationRefreshState.set(sourceType, state);

  setTimeout(async () => {
    try {
      await updateStationsInBackground(sourceType, state.instance);
    } finally {
      const nextState = stationRefreshState.get(sourceType) || { running: false, pending: false, instance: null };
      nextState.running = false;
      if (nextState.pending) {
        scheduleStationsRefresh(sourceType, nextState.instance);
      } else {
        stationRefreshState.set(sourceType, nextState);
      }
    }
  }, 0);
}

function resetAudio() {
  // Останавливаем и очищаем HLS плеер
  if (hlsPlayer) {
    try {
      hlsPlayer.destroy();
    } catch (e) {
      console.error('Ошибка при уничтожении HLS плеера:', e);
    }
    hlsPlayer = null;
  }

  if (!audio) return;
  try {
    audio.pause();
    audio.src = '';
    audio.load();
  } catch (e) {
    // ignore
  }
  audio.onplay = null;
  audio.onpause = null;
  audio.onended = null;
  audio.onerror = null;
  audio = null;
}

function showInitOverlay() {
  const overlay = document.getElementById('initOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    initOverlayVisible = true;
  }
}

function hideInitOverlay() {
  const overlay = document.getElementById('initOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    initOverlayVisible = false;
  }
}

async function persistLastStation(station, metadata) {
  if (!station) return;
  try {
    await invoke('set_last_station', {
      stationId: station.id,
      stationStreamUrl: station.stream_url || station.streamUrl || null,
      stationSlug: station.station_slug || station.meta_key || null,
      stationName: station.name || null,
      trackTitle: metadata?.title || null,
      trackArtist: metadata?.artist || null,
      trackCover: metadata?.cover || null,
      trackVideoUrl: metadata?.videoUrl || null
    });
  } catch (e) {
    console.error('Ошибка сохранения последней станции:', e);
  }
}

function findLastStationIndex(settings) {
  if (!settings || !Array.isArray(stations) || stations.length === 0) return -1;
  if (settings.last_station_id) {
    const byId = stations.findIndex(s => s.id === settings.last_station_id);
    if (byId !== -1) return byId;
  }
  if (settings.last_station_stream_url) {
    const byStream = stations.findIndex(s => s.stream_url === settings.last_station_stream_url);
    if (byStream !== -1) return byStream;
  }
  if (settings.last_station_slug) {
    const slug = normalizeMetaKey(settings.last_station_slug);
    const bySlug = stations.findIndex(s => normalizeMetaKey(s.station_slug || s.meta_key || '') === slug);
    if (bySlug !== -1) return bySlug;
  }
  if (settings.last_station_name) {
    const name = settings.last_station_name.toLowerCase();
    const byName = stations.findIndex(s => (s.name || '').toLowerCase() === name);
    if (byName !== -1) return byName;
  }
  return -1;
}

function formatCountdown(ms) {
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

function updateTimeLeftDisplay() {
  const timeEl = document.getElementById('currentTime');
  const metaSepEl = document.getElementById('currentMetaSep');
  const listenersText = currentTrackInfo.listeners ? `👥 ${currentTrackInfo.listeners}` : '';
  const timeText = currentTrackInfo.timeText || '';
  if (timeEl) timeEl.textContent = timeText ? `⏱ ${timeText}` : '';
  if (metaSepEl) {
    metaSepEl.style.display = listenersText && timeText ? 'inline' : 'none';
  }
}

function startTrackCountdown(stopAtMs) {
  if (trackCountdownTimer) {
    clearInterval(trackCountdownTimer);
    trackCountdownTimer = null;
  }
  if (!stopAtMs) {
    currentTrackInfo.timeText = '';
    updateTimeLeftDisplay();
    return;
  }
  const tick = () => {
    const timeLeft = stopAtMs - Date.now();
    if (timeLeft <= 0) {
      currentTrackInfo.timeText = '00:00';
      updateTimeLeftDisplay();
      clearInterval(trackCountdownTimer);
      trackCountdownTimer = null;
      return;
    }
    currentTrackInfo.timeText = formatCountdown(timeLeft);
    updateTimeLeftDisplay();
  };
  tick();
  trackCountdownTimer = setInterval(tick, 1000);
}

function scheduleMetadataPoll(stopAtMs) {
  if (metadataPollTimeout) {
    clearTimeout(metadataPollTimeout);
    metadataPollTimeout = null;
  }
  const now = Date.now();
  const extraDelayMs = 12000;
  let delayMs = 10000;
  if (stopAtMs && stopAtMs > now) {
    delayMs = Math.max(1000, stopAtMs - now + extraDelayMs);
  }
  metadataPollTimeout = setTimeout(() => {
    fetchCurrentTrackFromAMG();
  }, delayMs);
}

// Drag and Drop состояние
let dragState = {
  element: null,           // Исходный элемент
  clone: null,            // Визуальный клон для drag
  insertIndicator: null,  // Индикатор вставки (тонкая линия)
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
  isActive: false,
  startTimer: null,
  // Hysteresis для предотвращения дрожания
  lastTargetElement: null,  // Последний элемент, над которым был курсор
  lastInsertAbove: null,    // Последняя позиция вставки (выше/ниже)
  hysteresisThreshold: 10   // Минимальное расстояние для смены позиции (в пикселях)
};

// Загрузка радиостанций
async function loadStations() {
  try {
    showInitOverlay();
    stations = await Promise.race([
      invoke('get_stations'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]).catch(() => []);
    indexStations(stations);

    if (stations && stations.length > 0) {
      await loadSettings();
      renderStations();
      if (initOverlayVisible) hideInitOverlay();
    } else {
      setTimeout(async () => {
        try {
          stations = await invoke('get_stations');
          indexStations(stations);
          if (stations && stations.length > 0) {
            await loadSettings();
            renderStations();
            if (initOverlayVisible) hideInitOverlay();
          } else {
            if (initOverlayVisible) hideInitOverlay();
          }
        } catch (e) {
          console.error('❌ Ошибка обновления:', e);
          if (initOverlayVisible) hideInitOverlay();
        }
      }, 3000);
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки станций:', error);
    const list = document.getElementById('stationsList');
    if (list) {
      list.innerHTML = '<div class="loading">Ошибка загрузки станций</div>';
    }
    if (initOverlayVisible) hideInitOverlay();
  }
}

// Обновление станций
window.refreshStations = async function() {
  try {
    const list = document.getElementById('stationsList');
    if (list) {
      list.innerHTML = '<div class="loading">Загрузка радиостанций...</div>';
    }

    stations = await invoke('refresh_stations');
    indexStations(stations);
    await loadSettings();
    renderStations();
  } catch (error) {
    console.error('❌ Ошибка обновления станций:', error);
    const list = document.getElementById('stationsList');
    if (list) {
      list.innerHTML = '<div class="loading">Ошибка обновления станций</div>';
    }
  }
};

// Генерация fallback SVG с названием станции (стиль AMG Radio)
window.createFallbackSvg = function(name) {
  // Обрезаем название если слишком длинное
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

  // Генерируем цвет на основе названия (для разнообразия)
  let hash = 0;
  for (let i = 0; i < name?.length || 0; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  const color = `hsl(${hue}, 50%, 40%)`;

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
};

// Отрисовка станций
function renderStations() {
  const list = document.getElementById('stationsList');
  if (!list) return;

  let stationsToRender = [];

  if (currentTab === 'favorites') {
    // Показываем избранные станции в порядке favoriteStations
    // Используем сохраненные полные данные вместо поиска по ID
    stationsToRender = favoriteStations
      .map(id => window.favoriteStationsData?.find(s => s.id === id))
      .filter(s => s !== undefined);
  } else {
    // Показываем станции из текущего источника
    stationsToRender = stations;

    // Для 101.ru сохраняем в кэш если есть станции
    if (currentTab === 'ru101' && stations.length > 0) {
      ru101StationsCache = [...stations];
      ru101LastUpdate = Date.now();
    }
  }

  // Фильтрация по поисковому запросу (для 101.ru)
  // Используем кэш если основной массив пуст
  if (currentTab === 'ru101' && stationsToRender.length === 0 && ru101StationsCache.length > 0) {
    stationsToRender = ru101StationsCache;
  }

  // Для 101.ru используем кэш как источник для подсчёта
  const totalStations = currentTab === 'ru101' && ru101StationsCache.length > 0
    ? ru101StationsCache.length
    : stationsToRender.length;

  if (searchQuery && currentTab === 'ru101') {
    const query = searchQuery.toLowerCase().trim();
    // Фильтруем по кэшу для стабильности
    const sourceForFilter = ru101StationsCache.length > 0 ? ru101StationsCache : stationsToRender;
    stationsToRender = sourceForFilter.filter(s =>
      s.name?.toLowerCase().includes(query)
    );
  }

  // Обновляем счётчик станций
  const searchCount = document.getElementById('searchCount');
  if (searchCount && currentTab === 'ru101') {
    if (searchQuery) {
      searchCount.textContent = `Найдено: ${stationsToRender.length} из ${totalStations}`;
    } else {
      searchCount.textContent = `Всего: ${totalStations} станций`;
    }
  }

  if (stationsToRender.length === 0) {
    if (searchQuery && currentTab === 'ru101') {
      list.innerHTML = '<div class="loading">Станции не найдены</div>';
    } else {
      if (currentTab === 'favorites') {
        list.innerHTML = `<div class="empty-favorites">
          <div class="empty-icon">❤️</div>
          <div class="empty-text">Список пуст</div>
          <div class="empty-hint">Нажмите 🤍 на любой станции,<br>чтобы добавить в любимые</div>
          <button class="empty-action" onclick="switchTab('amg')">Открыть AMG Radio</button>
        </div>`;
      } else {
        list.innerHTML = '<div class="loading">Загрузка радиостанций...</div>';
      }
    }
    return;
  }

  const html = stationsToRender.map((station, index) => {
    const isActive = currentStation?.id === station.id ? 'active' : '';
    const isFavorite = currentTab === 'favorites' || favoriteStations.includes(station.id);
    const favoriteClass = isFavorite ? 'favorited' : '';

    return `
    <div class="station-icon ${isActive}"
         data-station-id="${station.id}"
         onclick="if(!event.target.closest('.favorite-button-icon')) playStationById('${station.id}')"
         ${currentTab === 'favorites' ? `onmousedown="handleDragStart(event, '${station.id}')"` : ''}
         title="${station.name}">
      <button class="favorite-button-icon ${favoriteClass}"
              data-station-id="${station.id}"
              onclick="event.stopPropagation(); console.log('❤️ Клик на сердечке:', '${station.id}'); toggleFavorite('${station.id}')"
              title="${isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}">
        ${isFavorite ? '❤️' : '🤍'}
      </button>
      <img src="${station.logo && station.logo.length > 5 ? station.logo : createFallbackSvg(station.name)}" alt="${station.name}" class="station-icon-logo" onerror="this.onerror=null; this.src=createFallbackSvg(this.alt)">
    </div>
    `;
  }).join('');

  list.innerHTML = html;
}


// Debounce для анимации смены трека
let trackDisplayAnimationTimeout = null;
let lastTrackKey = '';

// Управление отображением текущей композиции AMG
function updateCurrentTrackDisplay(trackInfo, withAnimation = false) {
  // Предотвращаем множественные анимации для одного и того же трека
  const newTrackKey = `${trackInfo?.station?.id || ''}_${trackInfo?.title || ''}_${trackInfo?.artist || ''}`;
  if (newTrackKey === lastTrackKey && withAnimation) {
    withAnimation = false; // Не анимируем повторно тот же трек
  }
  lastTrackKey = newTrackKey;

  // Показываем уведомление о новой песне
  if (trackInfo?.title && trackInfo?.artist) {
    const trackKey = `${trackInfo.station?.id || ''}_${trackInfo.title}_${trackInfo.artist}`;
    if (trackKey !== lastNotifiedTrack) {
      lastNotifiedTrack = trackKey;
      // Используем ту же обложку, что показывается в плеере
      const coverUrl = trackInfo.cover || 'http://localhost:1420/logo.png';
      showTrackNotification(trackInfo.title, trackInfo.artist, trackInfo.station?.name, coverUrl);
    }
  }

  // Отменяем предыдущий таймаут анимации
  if (trackDisplayAnimationTimeout) {
    clearTimeout(trackDisplayAnimationTimeout);
    trackDisplayAnimationTimeout = null;
  }
  const container = document.getElementById('currentTrackContainer');
  const square = container?.querySelector('.current-track-square');
  const titleEl = document.getElementById('currentTitle');
  const artistEl = document.getElementById('currentArtist');
  const coverEl = document.getElementById('currentimgonline');
  const videoEl = document.getElementById('currentVideo');
  const equaliser = document.getElementById('equaliser');
  const listenersEl = document.getElementById('currentListeners');
  const timeEl = document.getElementById('currentTime');
  const metaSepEl = document.getElementById('currentMetaSep');
  const nextTrackEl = document.getElementById('nextTrack');
  const nextTitleEl = document.getElementById('nextTitle');
  const nextArtistEl = document.getElementById('nextArtist');

  if (!container || !trackInfo) return;

  if (trackInfo.title) {
    // Показываем контейнер
    container.style.display = 'block';

    // Предзагружаем картинку перед анимацией
    const coverUrl = trackInfo.cover || 'http://localhost:1420/logo.png';
    if (withAnimation && coverEl) {
      const preloadImg = new Image();
      preloadImg.src = coverUrl;
    }

    // Анимация смены станции
    if (withAnimation && square) {
      // Убираем старые классы анимации
      square.classList.remove('bounce-in', 'bounce-out', 'track-change');

      // Запускаем bounceOut
      square.classList.add('bounce-out');

      // После bounceOut - обновляем контент и bounceIn
      setTimeout(() => {
        square.classList.remove('bounce-out');

        // Обновляем обложку
        if (coverEl) {
          coverEl.src = coverUrl;
        }

        // Запускаем bounceIn
        square.classList.add('bounce-in');
        square.classList.add('track-change');
      }, 250); // Длительность bounceOut
    }

    // Обновляем информацию
    titleEl.textContent = trackInfo.title;
    titleEl.title = trackInfo.title;
    artistEl.textContent = trackInfo.artist;

    // Обновляем обложку или видео
    const hasVideo = trackInfo.videoNow === 'yes' && trackInfo.videoUrl;
    if (videoEl) {
      // Очищаем обработчики
      videoEl.oncanplaythrough = null;
      videoEl.onerror = null;

      if (hasVideo) {
        // Проверяем, не загружено ли уже это видео
        const currentBlobUrl = videoEl.dataset.originalUrl;
        const isNewVideo = currentBlobUrl !== trackInfo.videoUrl;

        if (isNewVideo) {
          // Показываем обложку пока видео загружается
          if (coverEl) {
            coverEl.style.display = 'block';
            coverEl.src = trackInfo.cover || 'http://localhost:1420/logo.png';
            coverEl.alt = trackInfo.artist && trackInfo.title ? `${trackInfo.artist} - ${trackInfo.title}` : 'Обложка';
          }
          videoEl.style.display = 'none';
          videoEl.pause();

          // Освобождаем предыдущий Blob URL
          if (videoEl.src && videoEl.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoEl.src);
          }

          // Сохраняем URL для сравнения
          const videoUrl = trackInfo.videoUrl;
          videoEl.dataset.originalUrl = videoUrl;

          // Предзагрузка видео полностью через fetch
          fetch(videoUrl)
            .then(response => {
              if (!response.ok) throw new Error('Network error');
              return response.blob();
            })
            .then(blob => {
              // Проверяем, что трек не сменился пока загружали
              if (videoEl.dataset.originalUrl !== videoUrl) {
                return; // Трек сменился, не показываем старое видео
              }

              // Создаём Blob URL
              const blobUrl = URL.createObjectURL(blob);

              // Устанавливаем видео
              videoEl.src = blobUrl;
              videoEl.loop = true;
              videoEl.muted = true; // Без звука (звук из аудио потока)
              videoEl.playsInline = true;

              // Когда видео готово к воспроизведению
              videoEl.oncanplaythrough = () => {
                // Ещё раз проверяем актуальность
                if (videoEl.dataset.originalUrl !== videoUrl) return;

                // Плавно переключаем: скрываем обложку, показываем видео
                if (coverEl) coverEl.style.display = 'none';
                videoEl.style.display = 'block';
                videoEl.play().catch(() => {
                  // Если не удалось воспроизвести, показываем обложку
                  if (coverEl) coverEl.style.display = 'block';
                  videoEl.style.display = 'none';
                });
              };

              videoEl.onerror = () => {
                videoEl.style.display = 'none';
                if (coverEl) {
                  coverEl.style.display = 'block';
                  coverEl.src = trackInfo.cover || 'http://localhost:1420/logo.png';
                }
              };

              videoEl.load();
            })
            .catch(() => {
              // Ошибка загрузки - показываем обложку
              videoEl.style.display = 'none';
              if (coverEl) {
                coverEl.style.display = 'block';
                coverEl.src = trackInfo.cover || 'http://localhost:1420/logo.png';
              }
            });
        } else {
          // Видео уже загружено, просто показываем его
          if (coverEl) coverEl.style.display = 'none';
          videoEl.style.display = 'block';
          if (videoEl.paused) {
            videoEl.play().catch(() => {});
          }
        }
      } else {
        // Нет видео, показываем обложку
        videoEl.pause();
        if (videoEl.src && videoEl.src.startsWith('blob:')) {
          URL.revokeObjectURL(videoEl.src);
        }
        videoEl.removeAttribute('src');
        videoEl.dataset.originalUrl = '';
        videoEl.style.display = 'none';
        if (coverEl) {
          coverEl.style.display = 'block';
          coverEl.src = trackInfo.cover || 'http://localhost:1420/logo.png';
          coverEl.alt = trackInfo.artist && trackInfo.title ? `${trackInfo.artist} - ${trackInfo.title}` : 'Обложка';
        }
      }
    } else {
      // Если videoEl не существует, просто показываем обложку
      if (coverEl) {
        coverEl.style.display = 'block';
        coverEl.src = trackInfo.cover || 'http://localhost:1420/logo.png';
        coverEl.alt = trackInfo.artist && trackInfo.title ? `${trackInfo.artist} - ${trackInfo.title}` : 'Обложка';
      }
    }

    // Обновляем мета-информацию
    const listenersText = trackInfo.listeners ? `👥 ${trackInfo.listeners}` : '';
    const timeText = trackInfo.timeText || '';
    if (listenersEl) listenersEl.textContent = listenersText;
    if (timeEl) timeEl.textContent = timeText ? `⏱ ${timeText}` : '';
    if (metaSepEl) {
      metaSepEl.style.display = listenersText && timeText ? 'inline' : 'none';
    }

    // Обновляем следующий трек
    const hasNext = Boolean(trackInfo.nextTitle || trackInfo.nextArtist);
    if (nextTrackEl) nextTrackEl.style.display = hasNext ? 'block' : 'none';
    if (nextTitleEl) nextTitleEl.textContent = trackInfo.nextTitle || '';
    if (nextArtistEl) nextArtistEl.textContent = trackInfo.nextArtist || '';

    // Обновляем статус воспроизведения
    if (equaliser) {
      if (trackInfo.isPlaying) {
        equaliser.style.display = 'flex';
      } else {
        equaliser.style.display = 'none';
      }
    }

    currentTrackInfo = trackInfo;
  } else {
    // Скрываем контейнер если нет информации
    container.style.display = 'none';
  }
}

// Переключение воспроизведения через кнопку текущей композиции
window.toggleCurrentTrackPlay = function() {
  if (audio && currentStation) {
    // Переключаем воспроизведение текущей станции
    if (audio.paused) {
      audio.play().catch(err => {
        console.error('❌ Ошибка воспроизведения:', err);
      });
    } else {
      audio.pause();
    }
  } else if (currentTrackInfo.station) {
    // Если есть станция в информации о треке, запускаем её
    const realIndex = stations.findIndex(s => s.id === currentTrackInfo.station.id);
    if (realIndex >= 0) {
      playStation(realIndex);
    }
  }
};

// Получение текущей композиции (AMG или 101.ru)
async function fetchCurrentTrackFromAMG() {
  if (!currentStation) return;

  // Получаем станцию из кэша
  const station = stationById.get(currentStation.id) || stations.find(s => s.id === currentStation.id) || currentStation;

  // Критическая проверка: убеждаемся, что это правильная станция
  if (!station || station.id !== currentStation.id) {
    return;
  }

  // === Обработка 101.ru станций ===
  if (station.source === 'ru101' || station.id?.startsWith('ru101_')) {
    try {
      // Вызываем Rust функцию для получения метаданных
      const updatedStation = await invoke('update_station_metadata', { station });

      // Проверяем, что станция не изменилась
      if (currentStation.id !== station.id) {
        return;
      }

      // stop_at_ms приходит как Unix timestamp в миллисекундах
      const stopAtMs = updatedStation.stop_at_ms || null;

      const trackInfo = {
        title: updatedStation.current_track || station.name,
        artist: updatedStation.current_artist || 'Прямой эфир',
        cover: (updatedStation.artwork_url && updatedStation.artwork_url.length > 5 ? updatedStation.artwork_url : null)
               || (updatedStation.logo && updatedStation.logo.length > 5 ? updatedStation.logo : null)
               || 'http://localhost:1420/logo.png',
        station: station,
        isPlaying: audio && !audio.paused,
        listeners: updatedStation.listeners || null,
        timeText: '',
        nextTitle: '',
        nextArtist: '',
        stopAtMs: stopAtMs,
        videoNow: '',
        videoUrl: ''
      };

      const newTrackKey = `${trackInfo.artist} - ${trackInfo.title}`.trim();
      const oldTrackKey = `${currentTrackInfo.artist} - ${currentTrackInfo.title}`.trim();
      const withAnimation = newTrackKey && newTrackKey !== oldTrackKey;
      updateCurrentTrackDisplay(trackInfo, withAnimation);
      startTrackCountdown(stopAtMs);
      // Используем время окончания трека для следующего опроса, или 15 секунд
      scheduleMetadataPoll(stopAtMs);
      await persistLastStation(station, { title: trackInfo.title, artist: trackInfo.artist, cover: trackInfo.cover });
      return;
    } catch (error) {
      // Игнорируем ошибки получения метаданных
    }
  }

  // === Обработка AMG станций ===
  if (station && station.station_slug) {
    try {
      const requestType = !currentTrackInfo?.title || currentTrackInfo.station?.id !== station.id
        ? 'startplay'
        : 'l';
      const metadata = await fetchAmgTrackMetadata(station, requestType);
      if (metadata) {
        // Дополнительная проверка перед обновлением: убеждаемся, что это всё ещё та же станция
        const currentStationCheck = stationById.get(currentStation.id) || stations.find(s => s.id === currentStation.id);
        if (!currentStationCheck || currentStationCheck.id !== station.id || currentStationCheck.station_slug !== station.station_slug) {
          return;
        }

        if (metadata.artworkUrl) {
          // Обновляем только если это всё ещё правильная станция
          if (currentStationCheck.id === station.id && currentStationCheck.station_slug === station.station_slug) {
            currentStationCheck.logo = metadata.artworkUrl;
            currentStationCheck.artwork_url = metadata.artworkUrl;
          }
        }
        // Используем проверенную станцию для trackInfo
        const verifiedStation = currentStationCheck || station;
        const trackInfo = {
          title: metadata.title,
          artist: metadata.artist,
          cover: metadata.cover,
          station: verifiedStation, // Используем проверенную станцию
          isPlaying: audio && !audio.paused,
          listeners: metadata.listeners,
          timeText: '',
          nextTitle: metadata.nextTitle,
          nextArtist: metadata.nextArtist,
          stopAtMs: metadata.stopAtMs,
          videoNow: metadata.videoNow,
          videoUrl: metadata.videoUrl
        };

        const newTrackKey = `${trackInfo.artist} - ${trackInfo.title}`.trim();
        const oldTrackKey = `${currentTrackInfo.artist} - ${currentTrackInfo.title}`.trim();
        const withAnimation = newTrackKey && newTrackKey !== oldTrackKey;
        updateCurrentTrackDisplay(trackInfo, withAnimation);
        startTrackCountdown(metadata.stopAtMs);
        scheduleMetadataPoll(metadata.stopAtMs);
        await persistLastStation(verifiedStation, metadata);
        return;
      }
    } catch (error) {
      // Игнорируем ошибки получения метаданных AMG
    }
  }

  const trackInfo = {
    title: currentStation ? currentStation.name : '',
    artist: currentStation ? 'Прямой эфир' : '',
    cover: (currentStation?.logo && currentStation.logo.length > 5 ? currentStation.logo : null) || 'http://localhost:1420/logo.png',
    station: currentStation,
    isPlaying: audio && !audio.paused,
    listeners: null,
    timeText: '',
    nextTitle: '',
    nextArtist: '',
    stopAtMs: null,
    videoNow: '',
    videoUrl: ''
  };

  updateCurrentTrackDisplay(trackInfo, !currentTrackInfo.title || currentTrackInfo.title === 'Выберите станцию');
  startTrackCountdown(null);
  scheduleMetadataPoll(null);
  updateWindowTitle(currentStation ? currentStation.name : '');
}

// Воспроизведение станции по ID (ищет во всех источниках)
window.playStationById = async function(stationId) {
  // Ищем станцию в разных источниках
  let station = stations.find(s => s.id === stationId)
    || window.favoriteStationsData?.find(s => s.id === stationId)
    || stationById.get(stationId)
    || ru101StationsCache.find(s => s.id === stationId);

  if (!station) return;

  // Находим индекс в stations для совместимости
  const index = stations.findIndex(s => s.id === stationId);

  // Если станции нет в текущем списке stations, добавляем её временно
  if (index === -1) {
    stations.push(station);
  }

  const actualIndex = index === -1 ? stations.length - 1 : index;
  await playStation(actualIndex);
};

// Воспроизведение станции по индексу
window.playStation = async function(index) {
  if (index < 0 || index >= stations.length) return;

  const station = stations[index];
  updateWindowTitle(station.name);

  // Останавливаем предыдущую станцию
  resetAudio();
  if (metadataPollTimeout) {
    clearTimeout(metadataPollTimeout);
    metadataPollTimeout = null;
  }
  if (trackCountdownTimer) {
    clearInterval(trackCountdownTimer);
    trackCountdownTimer = null;
  }

  // Создаем новый аудио элемент
  audio = new Audio();
  audio.volume = volumeSlider ? volumeSlider.value / 100 : 0.5;

  // Устанавливаем источник в зависимости от режима стриминга
  let streamUrl = null;
  const isHlsMode = streamingMode === 'hls' && (station.stream_hls || station.streamHls);

  if (isHlsMode) {
    streamUrl = station.stream_hls || station.streamHls;
  } else {
    streamUrl = station.stream_url || station.streamUrl;
  }

  // Если URL потока пустой (например, для 101.ru), получаем его через API
  if (!streamUrl && station.source === 'ru101') {
    try {
      streamUrl = await invoke('get_stream_url', { station });
      station.stream_url = streamUrl;
    } catch (error) {
      console.error('❌ Ошибка получения URL потока:', error);
      return;
    }
  }

  if (!streamUrl) return;

  currentStation = station;

  // Обработка HLS потоков через hls.js
  if (isHlsMode && streamUrl.endsWith('.m3u8')) {
    if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      audio.src = streamUrl;
    } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (hlsPlayer) {
        try {
          hlsPlayer.destroy();
        } catch (e) {
          // Игнорируем
        }
      }

      hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90
      });

      hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        audio.play().catch(err => {
          console.error('❌ Ошибка воспроизведения HLS:', err);
        });
      });

      hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsPlayer.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsPlayer.recoverMediaError();
              break;
            default:
              hlsPlayer.destroy();
              hlsPlayer = null;
              break;
          }
        }
      });

      hlsPlayer.loadSource(streamUrl);
      hlsPlayer.attachMedia(audio);
    } else {
      if (station.stream_url || station.streamUrl) {
        audio.src = station.stream_url || station.streamUrl;
      } else {
        return;
      }
    }
  } else {
    audio.src = streamUrl;
  }

  // Обновляем информацию о текущей композиции
  fetchCurrentTrackFromAMG();

  // Добавляем обработчики событий аудио
  audio.addEventListener('play', () => {
    if (currentTrackInfo.station) {
      currentTrackInfo.isPlaying = true;
      updateCurrentTrackDisplay(currentTrackInfo);
    }
  });

  audio.addEventListener('pause', () => {
    if (currentTrackInfo.station) {
      currentTrackInfo.isPlaying = false;
      updateCurrentTrackDisplay(currentTrackInfo);
    }
  });

  // Обновляем UI
  renderStations();
  updateStreamingModeUI(); // Обновляем видимость кнопки режима стриминга

  // Запоминаем время смены станции (чтобы не показывать уведомление о песне сразу после)
  stationChangedAt = Date.now();

  // Показываем уведомление о смене станции
  showStationNotification(station);

  // Воспроизводим (для не-HLS потоков или нативных HLS)
  if (!isHlsMode || (isHlsMode && audio.canPlayType('application/vnd.apple.mpegurl'))) {
    audio.play().catch(err => {
      console.error('❌ Ошибка воспроизведения:', err);
    });
  }

  // Обновляем отображение текущей композиции с анимацией
  if (currentTrackInfo.station) {
    currentTrackInfo.isPlaying = true;
    updateCurrentTrackDisplay(currentTrackInfo, true);
  }

  // Обновляем текущий трек
  updateCurrentTrack();

  // Сохраняем последнюю станцию
  persistLastStation(station, null);
}

// Обновление текущего трека из ICY метаданных
function updateCurrentTrack() {
  if (!audio || !currentStation) return;

  // Для 101.ru метаданные получаются через Rust API, пропускаем ICY
  if (currentStation.source === 'ru101' || currentStation.id?.startsWith('ru101_')) {
    return;
  }

  // Пытаемся получить ICY метаданные
  fetch(currentStation.stream_url || currentStation.streamUrl, {
    method: 'HEAD',
    headers: {
      'Icy-MetaData': '1'
    }
  }).catch(() => {});

  // Периодически обновляем трек (каждые 5 секунд)
  const trackInterval = setInterval(() => {
    if (!audio || !currentStation || audio.paused) {
      clearInterval(trackInterval);
      return;
    }

    // Для 101.ru пропускаем ICY
    if (currentStation.source === 'ru101' || currentStation.id?.startsWith('ru101_')) {
      clearInterval(trackInterval);
      return;
    }

    // Пытаемся получить метаданные через fetch
    fetch(currentStation.stream_url || currentStation.streamUrl, {
      method: 'GET',
      headers: {
        'Icy-MetaData': '1',
        'Range': 'bytes=0-8192'
      }
    }).then(response => {
      if (response.headers.get('icy-metaint')) {
        // Метаданные доступны, но для полного парсинга нужен более сложный код
        // Пока просто обновляем статус
        const stationItem = document.querySelector(`[data-station-id="${currentStation.id}"]`);
        if (stationItem) {
          const trackElement = stationItem.querySelector('.station-track');
          if (trackElement) {
            trackElement.textContent = 'Прямой эфир';
          }
        }
      }
    }).catch(() => {
      // Игнорируем ошибки
    });
  }, 5000);
}

let volumeSlider = null;
let volumeValue = null;

// Загрузка настроек при старте
async function loadSettings() {
  try {
    const settings = await invoke('get_settings');

    // Загружаем режим стриминга
    if (settings.streaming_mode && (settings.streaming_mode === 'mp3' || settings.streaming_mode === 'hls')) {
      streamingMode = settings.streaming_mode;
      updateStreamingModeUI();
    }

    // Устанавливаем громкость
    if (volumeSlider && volumeValue && settings.volume !== undefined) {
      volumeSlider.value = settings.volume;
      volumeValue.textContent = `${settings.volume}%`;
      if (audio) {
        audio.volume = settings.volume / 100;
      }
    }

    // Загружаем избранные станции (теперь это полные объекты RadioStation)
    if (settings.favorite_stations && Array.isArray(settings.favorite_stations)) {
      const favoritesMigrated = migrateFavorites(settings);
      favoriteStations = settings.favorite_stations.map(station => station.id);
      window.favoriteStationsData = settings.favorite_stations;
      rehydrateFavorites();

      if (favoritesMigrated) {
        try {
          await invoke('save_settings', { settings });
        } catch (error) {
          console.error('❌ Ошибка сохранения миграции избранных:', error);
        }
      }
    } else {
      favoriteStations = [];
      window.favoriteStationsData = [];
    }

    // Определяем начальную вкладку на основе последней станции
    const lastStationId = settings.last_station_id;
    if (lastStationId) {
      const isInFavorites = favoriteStations.includes(lastStationId);

      if (isInFavorites) {
        switchTab('favorites');
      } else if (lastStationId.startsWith('amg_')) {
        switchTab('amg');
      } else if (lastStationId.startsWith('ru101_')) {
        switchTab('ru101');
      }
    } else if (favoriteStations.length === 0) {
      // Первый запуск: нет сохранённой станции и нет избранных — показываем AMG
      switchTab('amg');
    }

    // Восстанавливаем последнюю станцию (автовоспроизведение)
    if (!hasAutoPlayedLastStation && stations.length > 0) {
      const stationIndex = findLastStationIndex(settings);
      if (stationIndex !== -1) {
        hasAutoPlayedLastStation = true;
        playStation(stationIndex);
      }
    }

    if (!hasAutoPlayedLastStation && settings.last_station_name) {
      const stationName = settings.last_station_name;
      const trackInfo = {
        title: settings.last_track_title || 'Загрузка...',
        artist: settings.last_track_artist || '',
        cover: settings.last_track_cover || currentTrackInfo.cover || 'http://localhost:1420/logo.png',
        station: {
          id: settings.last_station_id || 'last_station',
          name: stationName,
          stream_url: settings.last_station_stream_url || ''
        },
        isPlaying: false,
        listeners: null,
        timeText: '',
        nextTitle: '',
        nextArtist: '',
        stopAtMs: null,
        videoNow: settings.last_track_video_url ? 'yes' : '',
        videoUrl: settings.last_track_video_url || ''
      };
      updateCurrentTrackDisplay(trackInfo, false);
      updateWindowTitle(stationName);
    }

    return settings;
  } catch (error) {
    console.error('❌ Ошибка загрузки настроек:', error);
    favoriteStations = []; // Инициализируем пустым массивом при ошибке
    return null;
  }
}

// Инициализация элементов после загрузки DOM
async function initControls() {
  volumeSlider = document.getElementById('volumeSlider');
  volumeValue = document.getElementById('volumeValue');

  if (volumeSlider) {
    volumeSlider.addEventListener('input', async (e) => {
      const volume = parseInt(e.target.value);
      if (volumeValue) {
        volumeValue.textContent = `${volume}%`;
      }
      if (audio) {
        audio.volume = volume / 100;
      }

      // Сохраняем громкость
      try {
        await invoke('set_volume', { volume });
      } catch (error) {
        console.error('Ошибка сохранения громкости:', error);
      }
    });
  }
}

// Переменная для поиска
let searchQuery = '';
// Кэш станций для поиска (чтобы асинхронные операции не сбивали поиск)
let ru101StationsCache = [];
// Таймстамп последнего обновления 101.ru (для ограничения обновлений)
let ru101LastUpdate = 0;
const RU101_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 минут

// Переключение вкладок и источников
window.switchTab = function(tab) {
  currentTab = tab;

  // Обновляем активную кнопку
  document.querySelectorAll('.tab-button').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Закрываем настройки при переключении вкладок
  const stationsList = document.getElementById('stationsList');
  const settingsPage = document.getElementById('settingsPage');
  const settingsButton = document.getElementById('settingsButton');
  const searchContainer = document.getElementById('searchContainer');
  const searchInput = document.getElementById('searchInput');

  if (stationsList) stationsList.style.display = 'flex';
  if (settingsPage) settingsPage.style.display = 'none';
  if (settingsButton) settingsButton.classList.remove('active');

  // Показываем/скрываем поиск для 101.ru
  if (searchContainer) {
    if (tab === 'ru101') {
      searchContainer.classList.add('visible');
    } else {
      searchContainer.classList.remove('visible');
      // Сбрасываем поиск и кэш при уходе с вкладки
      if (searchInput) searchInput.value = '';
      searchQuery = '';
      ru101StationsCache = [];
    }
  }

  // Если переключаемся на источник, загружаем его станции
  if (tab !== 'favorites') {
    loadSourceStations(tab);
  } else {
    // Перерисовываем станции
    renderStations();

    // Обновляем отображение текущей композиции только если есть активная станция
    if (currentStation) {
      fetchCurrentTrackFromAMG();
    }
  }
}

// Загрузка станций из источника
function loadSourceStations(sourceType) {
  const sourceInstance = RadioSourceFactory.createSource(sourceType);
  currentSource = sourceInstance;

  const list = document.getElementById('stationsList');
  if (list) {
    list.innerHTML = '<div class="loading">Загрузка радиостанций...</div>';
  }

  // Кэш подгружаем асинхронно
  invoke('get_cached_stations', { source: sourceType })
    .then((sourceStations) => {
      if (sourceStations && sourceStations.length > 0) {
        if (sourceType === 'amg' && !isAmgCacheValid(sourceStations)) {
          return;
        }
        stations = sourceStations;
        indexStations(stations);
        if (sourceType === 'ru101') {
          ru101StationsCache = [...stations];
        }
        renderStations();
      }
    })
    .catch(() => {});

  // Для 101.ru проверяем интервал обновления (не чаще 5 минут)
  if (sourceType === 'ru101') {
    const now = Date.now();
    if (now - ru101LastUpdate < RU101_UPDATE_INTERVAL && ru101StationsCache.length > 0) {
      stations = ru101StationsCache;
      renderStations();
      return;
    }
  }
  scheduleStationsRefresh(sourceType, sourceInstance);
}

// Фоновая загрузка свежих станций (незаметно для пользователя)
async function updateStationsInBackground(sourceType, sourceInstance) {
  try {
    const freshStations = await (sourceInstance || currentSource).parseStations();

    if (freshStations && freshStations.length > 0) {
      const currentSlugs = new Map();
      stations.forEach(s => {
        if (s.id && s.station_slug) {
          currentSlugs.set(s.id, s.station_slug);
        }
      });

      indexStations(freshStations);

      freshStations.forEach(station => {
        if (station.id && currentSlugs.has(station.id)) {
          const savedSlug = currentSlugs.get(station.id);
          if (station.station_slug !== savedSlug &&
              (savedSlug.includes('_') || savedSlug.length > station.station_slug?.length)) {
            station.station_slug = savedSlug;
            station.meta_key = savedSlug;
            const indexed = stationById.get(station.id);
            if (indexed) {
              indexed.station_slug = savedSlug;
              indexed.meta_key = savedSlug;
            }
          }
        }
      });

      if (currentTab === sourceType) {
        stations = freshStations;
        rehydrateFavorites();
        renderStations();
      }
    }
  } catch (error) {
    // Игнорируем ошибки фонового обновления
  }
}

// Переключение избранного
window.toggleFavorite = async function(stationId) {
  try {
    const isNowFavorite = await invoke('toggle_favorite_station', { stationId });

    let stationData = null;
    if (currentTab === 'favorites') {
      stationData = window.favoriteStationsData?.find(s => s.id === stationId);
    } else {
      stationData = stations.find(s => s.id === stationId);
    }

    if (!stationData) return;

    if (isNowFavorite) {
      const key = getStationKey(stationData);
      if (!window.favoriteStationsData) window.favoriteStationsData = [];
      window.favoriteStationsData = window.favoriteStationsData.filter(s => getStationKey(s) !== key);
      favoriteStations = favoriteStations.filter(id => {
        const station = stationById.get(id) || window.favoriteStationsData.find(s => s.id === id);
        return getStationKey(station) !== key;
      });

      favoriteStations.push(stationId);
      window.favoriteStationsData.push(stationData);
    } else {
      favoriteStations = favoriteStations.filter(id => id !== stationId);
      if (window.favoriteStationsData) {
        window.favoriteStationsData = window.favoriteStationsData.filter(s => s.id !== stationId);
      }
    }

    renderStations();

    if (window.favoriteStationsData) {
      const deduped = dedupeStations(window.favoriteStationsData);
      if (deduped.length !== window.favoriteStationsData.length) {
        window.favoriteStationsData = deduped;
        favoriteStations = deduped.map(s => s.id);
        try {
          const settings = await invoke('get_settings');
          settings.favorite_stations = deduped;
          await invoke('save_settings', { settings });
        } catch (e) {
          console.error('❌ Ошибка сохранения:', e);
        }
      }
    }
  } catch (error) {
    console.error('Ошибка изменения избранного:', error);
  }
};

// 1. При нажатии мыши (mousedown)
window.handleDragStart = function(e, stationId) {
  if (currentTab !== 'favorites') return;
  if (e.target.closest('.favorite-button')) return; // Не начинаем drag при клике на кнопку

  const stationItem = e.target.closest('.station-item');
  if (!stationItem) return;

  // Сохраняем ссылку на исходный элемент (НЕ клонируем!)
  dragState.element = stationItem;

  // Запоминаем начальную позицию мыши
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;

  // Вычисляем смещение относительно элемента
  const rect = stationItem.getBoundingClientRect();
  dragState.offsetX = e.clientX - rect.left;
  dragState.offsetY = e.clientY - rect.top;

  // Добавляем глобальные обработчики
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);

  // Запускаем таймер для задержки перед началом drag
  dragState.startTimer = setTimeout(() => {
    if (dragState.element && !dragState.isActive) {
      startDragging(e);
    }
  }, 500); // 0.5 секунды задержка
};

// Начало drag после задержки
function startDragging(e) {
  dragState.isActive = true;

  // Создаем визуальный клон для drag
  createDragClone();

  // Только после создания клона скрываем исходный элемент
  dragState.element.style.opacity = '0';
  dragState.element.style.pointerEvents = 'none';

  // Создаем индикатор вставки
  createInsertIndicator();

  // Предотвращаем выделение текста
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';

  // Обновляем позиции
  handleDragMove(e);
}

// Создание визуального клона элемента
function createDragClone() {
  dragState.clone = dragState.element.cloneNode(true);
  dragState.clone.classList.add('drag-clone');
  dragState.clone.classList.remove('dragging', 'active');

  // Устанавливаем фиксированную ширину и высоту
  const rect = dragState.element.getBoundingClientRect();
  dragState.clone.style.width = rect.width + 'px';
  dragState.clone.style.height = rect.height + 'px';
  dragState.clone.style.position = 'fixed';
  dragState.clone.style.pointerEvents = 'none';
  dragState.clone.style.zIndex = '10000';
  dragState.clone.style.opacity = '0.95';
  dragState.clone.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.4)';
  dragState.clone.style.transform = 'scale(1.03)';
  dragState.clone.style.transition = 'none';

  // Позиционируем клон точно на месте исходного элемента
  dragState.clone.style.left = rect.left + 'px';
  dragState.clone.style.top = rect.top + 'px';

  document.body.appendChild(dragState.clone);
}

// Создание placeholder для места вставки
function createInsertIndicator() {
  dragState.insertIndicator = document.createElement('div');
  dragState.insertIndicator.className = 'drag-insert-placeholder';
  dragState.insertIndicator.style.display = 'none';
  document.getElementById('stationsList').appendChild(dragState.insertIndicator);
}

// 2. При движении мыши (mousemove)
function handleDragMove(e) {
  // Если drag еще не активен, проверяем, не сдвинулась ли мышь слишком далеко
  if (!dragState.isActive) {
    if (dragState.startTimer && dragState.element) {
      const deltaX = Math.abs(e.clientX - dragState.startX);
      const deltaY = Math.abs(e.clientY - dragState.startY);

      // Если мышь сдвинулась больше чем на 5px, отменяем drag
      if (deltaX > 5 || deltaY > 5) {
        clearTimeout(dragState.startTimer);
        dragState.startTimer = null;
        cleanupDrag();
        return;
      }
    }
    return; // Не обрабатываем движение до начала drag
  }

  // Если drag активен, но нет клона - выходим
  if (!dragState.clone || !dragState.element) {
    return;
  }

  // Двигаем клон элемента за мышкой
  dragState.clone.style.left = (e.clientX - dragState.offsetX) + 'px';
  dragState.clone.style.top = (e.clientY - dragState.offsetY) + 'px';

  // Проверяем, над каким элементом находится курсор и показываем индикатор
  updateInsertIndicator(e);
}

// Обновление placeholder для места вставки
function updateInsertIndicator(e) {
  if (!dragState.insertIndicator || !dragState.element) return;

  const stationItem = document.elementFromPoint(e.clientX, e.clientY)?.closest('.station-item');

  // Если не над элементом или над самим перетаскиваемым элементом, скрываем placeholder
  if (!stationItem || stationItem === dragState.element) {
    dragState.insertIndicator.style.display = 'none';
    dragState.lastTargetElement = null;
    dragState.lastInsertAbove = null;
    return;
  }

  const rect = stationItem.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const midpoint = rect.height / 2;

  // Добавляем threshold от краев элемента (10% от высоты)
  const edgeThreshold = rect.height * 0.1;
  const isNearTop = y < edgeThreshold;
  const isNearBottom = y > rect.height - edgeThreshold;

  // Определяем, вставляем ли мы выше или ниже элемента
  let insertAbove = y < midpoint;

  // Hysteresis: если мы над тем же элементом, проверяем, не изменилась ли позиция слишком мало
  if (stationItem === dragState.lastTargetElement && dragState.lastInsertAbove !== null) {
    const distanceFromMidpoint = Math.abs(y - midpoint);

    // Если мы близко к центру и позиция не изменилась, сохраняем предыдущее решение
    if (distanceFromMidpoint < dragState.hysteresisThreshold) {
      insertAbove = dragState.lastInsertAbove;
    }
  }

  // Не позволяем вставку слишком близко к краям (если не указано явно)
  if (isNearTop && !isNearBottom) {
    insertAbove = true;  // Принудительно вставляем выше
  } else if (isNearBottom && !isNearTop) {
    insertAbove = false; // Принудительно вставляем ниже
  }

  // Если позиция не изменилась, не обновляем DOM
  if (stationItem === dragState.lastTargetElement && insertAbove === dragState.lastInsertAbove) {
    return;
  }

  // Запоминаем текущую позицию для hysteresis
  dragState.lastTargetElement = stationItem;
  dragState.lastInsertAbove = insertAbove;

  // Показываем placeholder
  dragState.insertIndicator.style.display = 'block';
  dragState.insertIndicator.style.width = stationItem.offsetWidth + 'px';

  // Вставляем placeholder в DOM перед или после целевого элемента
  if (insertAbove) {
    // Вставляем перед целевым элементом
    stationItem.parentNode.insertBefore(dragState.insertIndicator, stationItem);
  } else {
    // Вставляем после целевого элемента
    if (stationItem.nextSibling) {
      stationItem.parentNode.insertBefore(dragState.insertIndicator, stationItem.nextSibling);
    } else {
      stationItem.parentNode.appendChild(dragState.insertIndicator);
    }
  }
}

// 3. При отпускании мыши (mouseup)
function handleDragEnd(e) {
  // Отменяем таймер, если drag еще не начался
  if (dragState.startTimer) {
    clearTimeout(dragState.startTimer);
    dragState.startTimer = null;
  }

  // Если drag не был активен, просто очищаем
  if (!dragState.isActive) {
    cleanupDrag();
    return;
  }

  // Находим финальную позицию в списке на основе placeholder
  let targetStationItem = null;
  let insertIndex = -1;

  // Если placeholder виден, используем его позицию
  if (dragState.insertIndicator && dragState.insertIndicator.style.display === 'block' && dragState.insertIndicator.parentNode) {
    // Находим элемент рядом с placeholder
    const placeholderNext = dragState.insertIndicator.nextElementSibling;
    const placeholderPrev = dragState.insertIndicator.previousElementSibling;

    if (placeholderNext && placeholderNext.classList.contains('station-item')) {
      targetStationItem = placeholderNext;
      const targetId = targetStationItem.dataset.stationId;
      insertIndex = favoriteStations.indexOf(targetId);
    } else if (placeholderPrev && placeholderPrev.classList.contains('station-item')) {
      targetStationItem = placeholderPrev;
      const targetId = targetStationItem.dataset.stationId;
      insertIndex = favoriteStations.indexOf(targetId) + 1;
    }
  }

  // Fallback: используем позицию мыши
  if (!targetStationItem || insertIndex === -1) {
    const stationItem = document.elementFromPoint(e.clientX, e.clientY)?.closest('.station-item');
    if (stationItem && stationItem !== dragState.element) {
      targetStationItem = stationItem;
      const targetId = targetStationItem.dataset.stationId;
      const targetIndex = favoriteStations.indexOf(targetId);

      const rect = targetStationItem.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const midpoint = rect.height / 2;
      insertIndex = y < midpoint ? targetIndex : targetIndex + 1;
    }
  }

  if (targetStationItem && targetStationItem !== dragState.element) {
    const draggedId = dragState.element.dataset.stationId;
    const draggedIndex = favoriteStations.indexOf(draggedId);

    if (draggedIndex !== -1 && insertIndex !== -1 && draggedIndex !== insertIndex) {
      // Корректируем индекс, если перемещаем вниз
      let finalInsertIndex = insertIndex;
      if (draggedIndex < insertIndex) {
        finalInsertIndex = insertIndex - 1;
      }

      // Перемещаем в массиве ID
      favoriteStations.splice(draggedIndex, 1);
      favoriteStations.splice(finalInsertIndex, 0, draggedId);

      // Также переупорядочиваем полные данные
      const draggedDataIndex = window.favoriteStationsData?.findIndex(s => s.id === draggedId);
      if (draggedDataIndex !== undefined && draggedDataIndex >= 0) {
        const draggedData = window.favoriteStationsData.splice(draggedDataIndex, 1)[0];
        window.favoriteStationsData.splice(finalInsertIndex, 0, draggedData);
      }

      // Сохраняем новый порядок полных данных
      (async () => {
        try {
          const settings = await invoke('get_settings');
          settings.favorite_stations = window.favoriteStationsData || [];
          await invoke('save_settings', { settings });
        } catch (error) {
          console.error('❌ Ошибка сохранения порядка:', error);
        }
      })();

      renderStations();
    }
  }

  // Убираем визуальные эффекты
  cleanupDrag();
}

// Очистка состояния drag
function cleanupDrag() {
  // Восстанавливаем видимость исходного элемента
  if (dragState.element) {
    dragState.element.style.opacity = '';
    dragState.element.style.pointerEvents = '';
    dragState.element.classList.remove('dragging');
  }

  // Удаляем клон
  if (dragState.clone) {
    dragState.clone.remove();
    dragState.clone = null;
  }

  // Удаляем placeholder
  if (dragState.insertIndicator && dragState.insertIndicator.parentNode) {
    dragState.insertIndicator.remove();
    dragState.insertIndicator = null;
  }

  // Восстанавливаем стили
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  // Удаляем обработчики
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);

  // Сбрасываем состояние
  dragState.element = null;
  dragState.isActive = false;
  dragState.startTimer = null;
  // Сбрасываем hysteresis
  dragState.lastTargetElement = null;
  dragState.lastInsertAbove = null;
}

// Инициализация - ждем загрузки DOM
function initApp() {
  initControls();

  // Инициализация вкладок
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Инициализация поиска для 101.ru
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderStations();
    });
  }

  // Инициализация кнопки обновления
  const refreshButton = document.getElementById('refreshButton');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      window.refreshStations();
    });
  }

  // Загружаем избранные станции сразу (они должны быть в кэше)
  if (favoriteStations.length > 0) {
    renderStations();
  }

  // Небольшая задержка, чтобы убедиться, что DOM готов
  setTimeout(() => {
    loadStations();
    updateStreamingModeUI(); // Инициализируем кнопку режима стриминга
    // Устанавливаем заголовок по умолчанию, если станция не выбрана
    if (!currentStation) {
      updateWindowTitle('');
    }

    // Восстанавливаем размер окна из настроек
    restoreWindowSize();

    // Добавляем обработчик изменения размера окна
    setupWindowResizeHandler();
    initSettingsHandlers();
  }, 100);
}

// Восстановление размера окна из настроек
async function restoreWindowSize() {
  try {
    const settings = await invoke('get_settings');
    if (settings.window_width && settings.window_height) {
      await appWindow.setSize({
        type: 'Logical',
        width: settings.window_width,
        height: settings.window_height
      });
    }
  } catch (error) {
    console.error('❌ Ошибка восстановления размера окна:', error);
  }
}

// Обработчик изменения размера окна с debounce
let resizeTimeout = null;
function setupWindowResizeHandler() {
  // Используем стандартное событие window resize
  window.addEventListener('resize', () => {
    // Debounce: сохраняем размер только через 500ms после последнего изменения
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
    resizeTimeout = setTimeout(async () => {
      try {
        const size = await appWindow.innerSize();
        await invoke('save_window_size', {
          width: size.width,
          height: size.height
        });
      } catch (error) {
        console.error('❌ Ошибка сохранения размера окна:', error);
      }
    }, 500);
  });
}

// Показать уведомление о смене станции
async function showStationNotification(station) {
  try {
    const coverUrl = station.logo || station.cover || '';
    await invoke('show_track_notification', {
      title: station.name || 'Радиостанция',
      body: station.current_track || 'Прямой эфир',
      imageUrl: coverUrl || null,
      stationName: null,
      label: 'Переключение на',
      isStationNotification: true
    });
  } catch (error) {
    console.error('❌ Ошибка показа уведомления о станции:', error);
  }
}

// Показать уведомление о новой песне
async function showTrackNotification(title, artist, stationName, coverUrl) {
  try {
    // Не показываем уведомление о песне в течение 5 секунд после смены станции
    const timeSinceStationChange = Date.now() - stationChangedAt;
    if (timeSinceStationChange < 5000) return;

    await invoke('show_track_notification', {
      title: title || 'Неизвестный трек',
      body: artist || '',
      imageUrl: coverUrl || null,
      stationName: stationName || null,
      label: 'Далее в эфире',
      isStationNotification: false
    });
  } catch (error) {
    console.error('❌ Ошибка показа уведомления:', error);
  }
}

// Рендеринг страницы настроек
async function renderSettingsPage() {
  try {
    const settings = await invoke('get_settings');
    const toggle = document.getElementById('notificationsToggle');
    if (toggle) {
      toggle.checked = settings.show_notifications !== false;
    }
    const stationToggle = document.getElementById('stationNotificationsToggle');
    if (stationToggle) {
      stationToggle.checked = settings.show_station_notifications !== false;
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки настроек:', error);
  }
}

// Инициализация обработчиков настроек
function initSettingsHandlers() {
  const toggle = document.getElementById('notificationsToggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      try {
        await invoke('set_show_notifications', { show: e.target.checked });
      } catch (error) {
        console.error('❌ Ошибка сохранения настройки:', error);
      }
    });
  }

  const stationToggle = document.getElementById('stationNotificationsToggle');
  if (stationToggle) {
    stationToggle.addEventListener('change', async (e) => {
      try {
        await invoke('set_show_station_notifications', { show: e.target.checked });
      } catch (error) {
        console.error('❌ Ошибка сохранения настройки:', error);
      }
    });
  }

  // Обработчик кнопки настроек
  const settingsButton = document.getElementById('settingsButton');
  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      toggleSettingsPage();
    });
  }
}

// Переключение страницы настроек
function toggleSettingsPage() {
  const stationsList = document.getElementById('stationsList');
  const settingsPage = document.getElementById('settingsPage');
  const settingsButton = document.getElementById('settingsButton');
  const searchContainer = document.getElementById('searchContainer');

  if (!settingsPage || !stationsList) return;

  const isSettingsVisible = settingsPage.style.display !== 'none';

  if (isSettingsVisible) {
    // Закрываем настройки, показываем станции
    settingsPage.style.display = 'none';
    stationsList.style.display = 'flex';
    if (settingsButton) settingsButton.classList.remove('active');
    if (searchContainer && currentTab === 'ru101') {
      searchContainer.classList.add('visible');
    }
  } else {
    // Открываем настройки, скрываем станции
    settingsPage.style.display = 'block';
    stationsList.style.display = 'none';
    if (settingsButton) settingsButton.classList.add('active');
    if (searchContainer) searchContainer.classList.remove('visible');
    renderSettingsPage();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Периодически проверяем обновление станций (если их было мало)
setInterval(async () => {
  if (stations.length <= 3) {
    try {
      const newStations = await invoke('get_stations');
      if (newStations.length > stations.length) {
        stations = newStations;
        renderStations();
      }
    } catch (e) {
      // Игнорируем ошибки при периодической проверке
    }
  }
}, 2000);

// Функции для переключения режима стриминга
function updateStreamingModeUI() {
  const toggleEl = document.getElementById('streamingModeToggle');
  const valueEl = document.getElementById('streamingModeValue');
  if (toggleEl && valueEl) {
    valueEl.textContent = streamingMode.toUpperCase();

    // Показываем кнопку только если текущая станция поддерживает оба режима
    if (currentStation) {
      const hasHls = currentStation.stream_hls || currentStation.streamHls;
      const hasMp3 = currentStation.stream_url || currentStation.streamUrl;
      toggleEl.style.display = (hasHls && hasMp3) ? 'flex' : 'none';
    } else {
      toggleEl.style.display = 'flex'; // Показываем по умолчанию
    }
  }
}

window.toggleStreamingMode = async function() {
  streamingMode = streamingMode === 'mp3' ? 'hls' : 'mp3';
  updateStreamingModeUI();

  try {
    await invoke('set_streaming_mode', { mode: streamingMode });

    if (currentStation && audio && !audio.paused) {
      const currentIndex = stations.findIndex(s => s.id === currentStation.id);
      if (currentIndex !== -1) {
        playStation(currentIndex);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка сохранения режима стриминга:', error);
    streamingMode = streamingMode === 'mp3' ? 'hls' : 'mp3';
    updateStreamingModeUI();
  }
};

// Обработка закрытия окна (скрытие в трей) - будет реализовано позже
// getCurrent().onCloseRequested(async (event) => {
//   event.preventDefault();
//   await getCurrent().hide();
// }).catch(err => console.error('Ошибка обработки закрытия окна:', err));

// ========== About Modal ==========
window.closeAboutModal = function() {
  const modal = document.getElementById('aboutModal');
  if (modal) {
    modal.classList.remove('visible');
  }
};

window.showAboutModal = function() {
  const modal = document.getElementById('aboutModal');
  if (modal) {
    modal.classList.add('visible');
  }
};

// Слушаем событие от Rust для показа окна "О программе"
(async () => {
  try {
    await listen('show-about', () => {
      window.showAboutModal();
    });
  } catch (err) {
    console.error('Ошибка подписки на show-about:', err);
  }
})();

// Закрытие модального окна по Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.closeAboutModal();
  }
});
