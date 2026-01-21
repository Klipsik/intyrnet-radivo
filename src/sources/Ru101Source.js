import { invoke } from '@tauri-apps/api/core';
import { RadioSource } from './RadioSource.js';

/**
 * Источник 101.ru
 */
export class Ru101Source extends RadioSource {
  constructor() {
    super({
      id: 'ru101',
      name: '101.ru',
      apiUrl: 'https://101.ru/api/v2',
      displayConfig: {
        logoSize: 50,
        showTrack: true,
        showBitrate: true
      }
    });
  }

  async parseStations() {
    return await invoke('parse_ru101_stations');
  }

  async getStreamUrl(station) {
    // Для 101.ru URL может требовать обновления токена
    if (!station.stream_url) {
      return await invoke('get_stream_url', { station });
    }
    return station.stream_url;
  }

  async getTrackMetadata(station) {
    try {
      const updated = await invoke('update_station_metadata', { station });
      return {
        title: updated.current_track || station.name,
        artist: updated.current_artist || 'Прямой эфир',
        cover: updated.artwork_url || updated.logo || null,
        listeners: updated.listeners || null,
        stopAtMs: updated.stop_at_ms || null
      };
    } catch {
      return null;
    }
  }

  ownsStation(station) {
    return station.source === 'ru101' || station.id?.startsWith('ru101_');
  }

  // Кастомный шаблон с битрейтом
  getDisplayTemplate(station, options = {}) {
    const { isActive, isFavorite } = options;
    const logoUrl = station.logo || this.createFallbackLogo(station.name);
    const favoriteClass = isFavorite ? 'favorited' : '';

    return `
    <div class="station-icon ru101-style ${isActive ? 'active' : ''}"
         data-station-id="${station.id}"
         data-source="${this.id}"
         title="${station.name}${station.bitrate ? ` (${station.bitrate}kbps)` : ''}">
      <button class="favorite-button-icon ${favoriteClass}"
              data-station-id="${station.id}"
              title="${isFavorite ? 'Удалить из любимых' : 'Добавить в любимые'}">
        ${isFavorite ? '❤️' : '🤍'}
      </button>
      <img src="${logoUrl}"
           alt="${station.name}"
           class="station-icon-logo ru101-logo"
           onerror="this.onerror=null; this.src=window.createFallbackSvg('${station.name.replace(/'/g, "\\'")}')">
    </div>
    `;
  }
}

export default Ru101Source;
