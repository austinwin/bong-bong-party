export const assetUrl = (category, name) => `/assets/${category}/${name}`;

export const sprites = new Map();
export function sprite(category, name) {
  return sprites.get(`${category}/${name}.png`);
}

export async function readManifest() {
  const response = await fetch('/assets/asset_manifest.json');
  if (!response.ok) throw new Error(`Asset manifest HTTP ${response.status}`);
  return response.json();
}

export async function loadImages(manifest) {
  await Promise.all(Object.entries(manifest.categories)
    .filter(([category]) => /^0[1-7]_/.test(category))
    .flatMap(([category, names]) => names.map(async name => {
      const image = new Image();
      image.src = assetUrl(category, name);
      try {
        await image.decode();
      } catch {
        throw new Error(`Could not decode ${category}/${name}`);
      }
      sprites.set(`${category}/${name}`, image);
    })));
}

export class ArcadeAudio {
  constructor(preferences, onStatus) {
    this.preferences = preferences;
    this.onStatus = onStatus;
    this.buffers = new Map();
  }

  prepare(files) {
    this.files = files;
    this.downloads = files.map(async file => {
      const response = await fetch(assetUrl('08_audio', file));
      if (!response.ok) throw new Error(file);
      return [file.replace('.wav', ''), await response.arrayBuffer()];
    }).map(download => download.catch(() => null));
    this.decode();
  }

  unlock({ testSound = false, retry = false } = {}) {
    if (!this.enabled || document.hidden) return;
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
      try { navigator.audioSession.type = 'playback'; } catch {}
    }
    // Create and resume synchronously inside the tap, even if assets are still loading.
    if (!this.context || this.context.state === 'closed') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.onStatus('unavailable');
        return;
      }
      try {
        this.context = new AudioContext();
      } catch {
        this.onStatus('unavailable');
        return;
      }
      this.track = this.decoding = null;
      this.decoded = false;
      this.buffers.clear();
      this.music = this.context.createGain();
      this.effects = this.context.createGain();
      this.music.connect(this.context.destination);
      this.effects.connect(this.context.destination);
      this.context.addEventListener('statechange', () => this.update());
      this.decode();
    }
    if (retry && this.decoded && this.buffers.size < this.files.length) {
      this.decoded = false;
      this.decoding = null;
      this.prepare(this.files);
    }
    this.testPending ||= testSound;
    this.resume();
  }

  get enabled() {
    return (this.preferences.music && this.preferences.musicVolume > 0) ||
      (this.preferences.sfx && this.preferences.sfxVolume > 0);
  }

  resume() {
    if (!this.context || !this.enabled || document.hidden) return;
    if (this.context.state !== 'running') {
      this.context.resume().then(() => this.update(), () => this.update());
    }
    this.update();
  }

  foregroundChanged() {
    if (!this.context) return;
    if (document.hidden) {
      if (this.context.state === 'running') this.context.suspend().catch(() => {});
      return;
    }
    this.resume();
  }

  decode() {
    if (!this.context || !this.downloads || this.decoding) return;
    const context = this.context;
    this.decoding = Promise.all(this.downloads.map(async download => {
      const result = await download;
      if (!result) return;
      const [name, bytes] = result;
      if (this.buffers.has(name)) return;
      try {
        const buffer = await context.decodeAudioData(bytes.slice(0));
        if (context === this.context) {
          this.buffers.set(name, buffer);
          this.update();
        }
      } catch (error) {
        console.warn(`Failed to decode ${name}`, error);
      }
    })).then(() => {
      if (context === this.context) {
        this.decoded = true;
        this.update();
      }
    });
  }

  update() {
    const { music, sfx, musicVolume, sfxVolume } = this.preferences;
    if (this.context) {
      this.music.gain.value = music ? musicVolume * .78 : 0;
      this.effects.gain.value = sfx ? sfxVolume : 0;
    }
    if ((!music || !musicVolume) && this.track) {
      this.track.stop();
      this.track = null;
    }
    if (!this.track && music && musicVolume) {
      this.track = this.play('original_retro_lobby_loop', true);
    }
    if (this.testPending && !document.hidden) {
      if (!sfx || !sfxVolume || this.play('pickup') || this.decoded && !this.buffers.has('pickup')) this.testPending = false;
    }
    const ready = (!music || !musicVolume || this.buffers.has('original_retro_lobby_loop')) &&
      (!sfx || !sfxVolume || this.buffers.has('pickup'));
    const status = !this.enabled ? 'muted' : this.context?.state !== 'running' ? 'locked' :
      ready ? 'on' : this.decoded ? 'unavailable' : 'loading';
    this.onStatus(status);
  }

  play(name, loop = false) {
    const buffer = this.buffers.get(name);
    if (!buffer || document.hidden || this.context.state !== 'running' ||
      (!loop && (!this.preferences.sfx || !this.preferences.sfxVolume))) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(loop ? this.music : this.effects);
    source.onended = () => source.disconnect();
    source.start();
    return source;
  }
}
