const AMG_TRACK_API_BASE = 'https://info.volna.top/tag';

function formatTrackTime(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  if (typeof value === 'string') return value.trim();
  return '';
}

function parseDurationToMs(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return ((h * 3600) + (m * 60) + s) * 1000;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return ((m * 60) + s) * 1000;
  }
  return null;
}

function parseMskDateTimeToMs(value) {
  if (!value || typeof value !== 'string') return null;
  const iso = value.replace(' ', 'T');
  const withOffset = `${iso}+03:00`;
  const parsed = Date.parse(withOffset);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function extractNextTrack(data) {
  const next = data?.next || data?.next_track || data?.nextTrack || data?.nextSong || null;
  const nextTitle = next?.title || data?.next_title || data?.nextTitle || '';
  const nextArtist = next?.artist || data?.next_artist || data?.nextArtist || '';
  return {
    title: nextTitle || '',
    artist: nextArtist || ''
  };
}

function buildTrackUrl(slug, paramName = 'l') {
  return `${AMG_TRACK_API_BASE}/${slug}.json?${paramName}=${Date.now()}`;
}

export async function fetchAmgTrackMetadata(station, requestType = 'l') {
  if (!station?.station_slug) return null;

  const url = buildTrackUrl(station.station_slug, requestType);

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data || Object.keys(data).length === 0) return null;
  const listeners = data.now_listener ?? data.now_listeners ?? data.listeners ?? null;
  const durationMs = parseDurationToMs(data.duration_now);
  const startAtMs = parseMskDateTimeToMs(data.start_now);
  const stopAtMs = parseMskDateTimeToMs(data.stop_now);

  // Попытка получить "далее" из плейлиста конкретной станции
  const playlistNext = data[`${station.station_slug}_pls_dalee`];
  let nextTitle = '';
  let nextArtist = '';
  if (playlistNext && typeof playlistNext === 'object') {
    nextTitle = playlistNext.title || '';
    nextArtist = playlistNext.artist || '';
  } else {
    const nextTrack = extractNextTrack(data);
    nextTitle = nextTrack.title;
    nextArtist = nextTrack.artist;
  }

    const previousTitle = data.pre_title || '';
    const previousArtist = data.pre_artist || '';

    return {
      title: data.title || 'Неизвестная композиция',
      artist: data.artist || 'Неизвестный исполнитель',
      cover: data.cover_url || data.cover_url350 || station.logo,
      artworkUrl: data.artwork_url || '',
      videoNow: data.video_now || '',
      videoUrl: data.video_now_url || '',
      listeners,
      durationMs,
      startAtMs,
      stopAtMs,
      nextTitle,
      nextArtist,
      previousTitle,
      previousArtist,
      song: data.song || ''
    };
  } catch (error) {
    return null;
  }
}
