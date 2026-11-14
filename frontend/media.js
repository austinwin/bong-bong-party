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
  constructor(preferences) {
    this.preferences = preferences;
    this.buffers = new Map();
  }

  prepare(files) {
    this.downloads = Promise.allSettled(files.map(async file => {
      const response = await fetch(assetUrl('08_audio', file));
      if (!response.ok) throw new Error(file);
      return [file.replace('.wav', ''), await response.arrayBuffer()];
    }));
  }

  unlock() {
    if (!this.downloads) return;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.music = this.context.createGain();
      this.effects = this.context.createGain();
      this.music.connect(this.context.destination);
      this.effects.connect(this.context.destination);
      this.loading = this.decode();
    }
    this.context.resume().then(() => this.update()).catch(console.warn);
  }

  async decode() {
    const results = await this.downloads;
    await Promise.allSettled(results.map(async result => {
      if (result.status === 'rejected') {
        console.warn('Failed to load WAV', result.reason);
        return;
      }
      const [name, bytes] = result.value;
      try {
        this.buffers.set(name, await this.context.decodeAudioData(bytes));
      } catch (error) {
        console.warn(`Failed to decode ${name}`, error);
      }
    }));
    this.update();
  }

  update() {
    if (!this.context) return;
    const { music, sfx, musicVolume, sfxVolume } = this.preferences;
    this.music.gain.value = music ? musicVolume * .65 : 0;
    this.effects.gain.value = sfx ? sfxVolume : 0;
    if (!this.track && music) {
      this.track = this.play('original_retro_lobby_loop', true);
    }
  }

  play(name, loop = false) {
    const buffer = this.buffers.get(name);
    if (!buffer || this.context.state !== 'running' || (!loop && !this.preferences.sfx)) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(loop ? this.music : this.effects);
    source.onended = () => source.disconnect();
    source.start();
    return source;
  }
}
