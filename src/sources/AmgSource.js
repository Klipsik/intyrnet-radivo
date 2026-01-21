import { invoke } from '@tauri-apps/api/core';
import { RadioSource } from './RadioSource.js';
import { fetchAmgTrackMetadata } from '../services/amgService.js';

/**
 * Источник AMG Radio (volna.top)
 */
export class AmgSource extends RadioSource {
  constructor() {
    super({
      id: 'amg',
      name: 'AMG Radio',
      apiUrl: 'https://ru.volna.top/wp-json/wp/v2/station',
      displayConfig: {
        logoSize: 60,
        showTrack: true,
        showBitrate: false
      }
    });
  }

  async parseStations() {
    return await invoke('parse_amg_stations');
  }

  async getStreamUrl(station) {
    return station.stream_url || station.streamUrl || '';
  }

  async getTrackMetadata(station) {
    if (!station.station_slug) return null;
    return await fetchAmgTrackMetadata(station, 'l');
  }

  ownsStation(station) {
    return station.source === 'amg' ||
           station.id?.startsWith('amg_') ||
           !!station.station_slug;
  }
}

export default AmgSource;
