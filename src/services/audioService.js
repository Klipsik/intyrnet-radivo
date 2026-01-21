/**
 * Сервис управления аудио воспроизведением
 * Поддерживает MP3 и HLS потоки
 */

class AudioService {
  constructor() {
    this.audio = null;
    this.hlsPlayer = null;
    this.currentStation = null;
    this.streamingMode = 'mp3'; // 'mp3' | 'hls'
    this.onPlayCallback = null;
    this.onPauseCallback = null;
    this.onErrorCallback = null;
  }

  /**
   * Инициализация нового аудио элемента
   * @param {number} volume - Громкость 0-100
   */
  init(volume = 50) {
    this.reset();
    this.audio = new Audio();
    this.audio.volume = volume / 100;
    this._setupEventListeners();
  }

  /**
   * Воспроизвести станцию
   * @param {Object} station
   * @param {string} streamUrl
   */
  async play(station, streamUrl) {
    if (!this.audio) this.init();

    this.currentStation = station;
    const isHls = this._isHlsStream(streamUrl);

    if (isHls && this.streamingMode === 'hls') {
      await this._playHls(streamUrl);
    } else {
      this._playDirect(streamUrl);
    }
  }

  /**
   * Остановить воспроизведение
   */
  stop() {
    if (this.audio) {
      this.audio.pause();
    }
  }

  /**
   * Переключить воспроизведение
   */
  toggle() {
    if (!this.audio) return;

    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  }

  /**
   * Установить громкость
   * @param {number} volume - 0-100
   */
  setVolume(volume) {
    if (this.audio) {
      this.audio.volume = volume / 100;
    }
  }

  /**
   * Установить режим стриминга
   * @param {'mp3' | 'hls'} mode
   */
  setStreamingMode(mode) {
    this.streamingMode = mode;
  }

  /**
   * Сбросить состояние
   */
  reset() {
    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch {
        // Игнорируем
      }
      this.hlsPlayer = null;
    }

    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.src = '';
        this.audio.load();
      } catch {
        // Игнорируем
      }
      this.audio = null;
    }

    this.currentStation = null;
  }

  /**
   * Проверить, воспроизводится ли аудио
   * @returns {boolean}
   */
  isPlaying() {
    return this.audio && !this.audio.paused;
  }

  /**
   * Получить текущую станцию
   * @returns {Object|null}
   */
  getCurrentStation() {
    return this.currentStation;
  }

  // === Приватные методы ===

  _setupEventListeners() {
    if (!this.audio) return;

    this.audio.addEventListener('play', () => {
      this.onPlayCallback?.();
    });

    this.audio.addEventListener('pause', () => {
      this.onPauseCallback?.();
    });

    this.audio.addEventListener('error', (e) => {
      this.onErrorCallback?.(e);
    });
  }

  _isHlsStream(url) {
    return url?.endsWith('.m3u8');
  }

  _playDirect(streamUrl) {
    this.audio.src = streamUrl;
    this.audio.play().catch(err => {
      this.onErrorCallback?.(err);
    });
  }

  async _playHls(streamUrl) {
    // Нативная поддержка HLS (Safari)
    if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      this.audio.src = streamUrl;
      this.audio.play().catch(() => {});
      return;
    }

    // Используем hls.js
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (this.hlsPlayer) {
        this.hlsPlayer.destroy();
      }

      this.hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90
      });

      this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        this.audio.play().catch(() => {});
      });

      this.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.hlsPlayer.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.hlsPlayer.recoverMediaError();
              break;
            default:
              this.hlsPlayer.destroy();
              this.hlsPlayer = null;
              break;
          }
        }
      });

      this.hlsPlayer.loadSource(streamUrl);
      this.hlsPlayer.attachMedia(this.audio);
    } else {
      // Fallback на MP3
      const mp3Url = this.currentStation?.stream_url || this.currentStation?.streamUrl;
      if (mp3Url) {
        this._playDirect(mp3Url);
      }
    }
  }

  // === Коллбэки ===

  onPlay(callback) {
    this.onPlayCallback = callback;
  }

  onPause(callback) {
    this.onPauseCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }
}

// Синглтон
export const audioService = new AudioService();
export default audioService;
