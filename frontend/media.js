export const assetUrl = (category, name) => `/assets/${category}/${name}`;

export const sprites = new Map();
export function sprite(category, name) {
  return sprites.get(`${category}/${name}.png`);
}

export const costume = name => sprites.get(`10_costumes/${name}.webp`) || sprite('01_characters', name);
export const avatarUrl = name => costume(name)?.src || assetUrl('01_characters', name + '.png');
export const scenery = name => sprites.get(`11_scenery/${name}.webp`);
export const runCostume = (name, direction) => sprites.get(`12_motion/${name}-${direction}.webp`);
const LOBBY_MUSIC = 'bubble_plaza';
const QUIET_MAPS = new Set(['winter', 'lagoon', 'moon', 'castle']);
const matchTrack = map => QUIET_MAPS.has(map) ? 'frost_hop' : 'village_dash';
const RUN_POSES = ['north', 'north-other', 'north-settle', 'side', 'side-other', 'side-pass', 'south', 'south-other'];

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

export function loadIllustrations(avatars) {
  return loadWebp({
    '10_costumes': avatars,
    '11_scenery': ['lantern_house', 'topiary', 'toadstool', 'blue_house', 'snow_pine', 'palm'],
  });
}

export function loadMotion(avatars, selected) {
  const files = [selected, ...avatars.filter(name => name !== selected)]
    .flatMap(name => RUN_POSES.map(pose => `${name}-${pose}`));
  return loadWebp({ '12_motion': files }, 'low');
}

function loadWebp(images, priority = 'auto') {
  return Promise.all(Object.entries(images).flatMap(([category, files]) => files.map(async name => {
    const image = new Image();
    image.fetchPriority = priority;
    image.src = assetUrl(category, name + '.webp');
    try {
      await image.decode();
      sprites.set(`${category}/${name}.webp`, image);
    } catch {
      // The renderer keeps the standing and directional fallback sprites available.
    }
  })));
}

export class ArcadeAudio {
  constructor(preferences, onStatus) {
    this.preferences = preferences;
    this.onStatus = onStatus;
    this.buffers = new Map();
    this.musicName = LOBBY_MUSIC;
    this.musicLoads = new Map();
    this.lastSounds = new Map();
  }

  prepare(originals, additions = [], music = []) {
    this.files = { originals, additions };
    this.musicFiles = new Set(music);
    const sources = [
      ...originals.map(file => ['08_audio', file]),
      ...additions.map(name => ['13_audio', name + '.wav']),
    ];
    this.downloads = sources.map(async ([category, file]) => {
      const name = file.replace('.wav', '');
      if (this.buffers.has(name)) return null;
      const priority = [this.musicName, 'prize', 'pickup'].includes(name) ? 'auto' : 'low';
      const response = await fetch(assetUrl(category, file), { priority });
      if (!response.ok) throw new Error(file);
      return [name, await response.arrayBuffer()];
    }).map(download => download.catch(() => null));
    this.decode();
    this.loadTrack(this.musicName);
  }

  loadTrack(name, retry = false) {
    const context = this.context;
    if (!context || !this.preferences.music || !this.preferences.musicVolume ||
        !this.musicFiles?.has(name) || this.buffers.has(name)) return;
    const previous = this.musicLoads.get(name);
    if (previous === 'loading' || (previous === 'failed' && !retry)) return;
    this.musicLoads.set(name, 'loading');
    fetch(assetUrl('13_audio', name + '.flac'))
      .then(response => {
        if (!response.ok) throw new Error(name);
        return response.arrayBuffer();
      })
      .then(bytes => context.decodeAudioData(bytes))
      .then(buffer => {
        if (context !== this.context) return;
        this.musicLoads.delete(name);
        this.buffers.set(name, buffer);
        this.update();
      }, () => {
        if (context !== this.context) return;
        this.musicLoads.set(name, 'failed');
        this.update();
      });
  }

  prepareMatch(map) {
    this.loadTrack(matchTrack(map));
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
      this.musicLoads.clear();
      this.lastSounds.clear();
      this.music = this.context.createGain();
      this.effects = this.context.createGain();
      this.duck = this.context.createGain();
      const output = this.context.createDynamicsCompressor();
      output.threshold.value = -7;
      output.knee.value = 8;
      output.ratio.value = 6;
      this.music.connect(this.duck);
      this.duck.connect(output);
      this.effects.connect(output);
      output.connect(this.context.destination);
      this.context.addEventListener('statechange', () => this.update());
      this.decode();
    }
    if (retry && this.decoded && this.buffers.size < this.files.originals.length + this.files.additions.length) {
      this.decoded = false;
      this.decoding = null;
      this.prepare(this.files.originals, this.files.additions, this.musicFiles);
    }
    this.loadTrack(this.musicName, retry);
    this.testPending ||= testSound;
    this.resume();
  }

  scene(active = false, lastSeconds = false, map) {
    const name = active ? matchTrack(map) : LOBBY_MUSIC;
    const tempo = lastSeconds ? 1.067 : 1;
    if (name === this.musicName && tempo === (this.tempo ?? 1)) return;
    this.musicName = name;
    this.tempo = tempo;
    this.loadTrack(name);
    this.update();
  }

  result(won) {
    if (!this.play(won ? 'win' : 'loss', { fallback: won ? 'victory_jingle' : 'defeat_jingle' })) return;
    const now = this.context.currentTime;
    const gain = this.duck.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(.34, now, .04);
    gain.setTargetAtTime(1, now + 1.16, .19);
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
      const now = this.context.currentTime;
      this.music.gain.setTargetAtTime(music ? musicVolume * .83 : 0, now, .045);
      this.effects.gain.setTargetAtTime(sfx ? sfxVolume : 0, now, .045);
    }
    const nextTrack = this.buffers.has(this.musicName) ? this.musicName : this.track?.name ?? 'original_retro_lobby_loop';
    if ((!music || !musicVolume || this.track?.name !== nextTrack) && this.track) {
      const { source, gain } = this.track;
      const now = this.context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, .05);
      source.stop(now + .24);
      this.track = null;
    }
    if (!this.track && music && musicVolume) {
      const buffer = this.buffers.get(nextTrack);
      if (buffer && this.context.state === 'running' && !document.hidden) {
        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = buffer;
        source.loop = true;
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(this.music);
        gain.gain.setTargetAtTime(1, this.context.currentTime, .08);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        source.start();
        this.track = { name: nextTrack, source, gain };
      }
    }
    if (this.track) this.track.source.playbackRate.setTargetAtTime(this.tempo ?? 1, this.context.currentTime, .28);
    if (this.testPending && !document.hidden) {
      if (!sfx || !sfxVolume || this.play('prize', { fallback: 'pickup' }) ||
          this.decoded && !this.buffers.has('pickup')) this.testPending = false;
    }
    const ready = (!music || !musicVolume || this.buffers.has(nextTrack)) &&
      (!sfx || !sfxVolume || this.buffers.has('pickup'));
    const status = !this.enabled ? 'muted' : this.context?.state !== 'running' ? 'locked' :
      ready ? 'on' : this.decoded ? 'unavailable' : 'loading';
    this.onStatus(status, this.track?.name);
  }

  play(name, { gain = 1, rate = 1, gap = 0, fallback } = {}) {
    const buffer = this.buffers.get(name) || this.buffers.get(fallback);
    if (!buffer || document.hidden || this.context.state !== 'running' ||
      !this.preferences.sfx || !this.preferences.sfxVolume) return;
    const now = this.context.currentTime;
    if (gap && now - (this.lastSounds.get(name) ?? -Infinity) < gap) return;
    this.lastSounds.set(name, now);
    const source = this.context.createBufferSource();
    const level = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    level.gain.value = gain;
    source.connect(level);
    level.connect(this.effects);
    source.onended = () => { source.disconnect(); level.disconnect(); };
    source.start();
    return source;
  }
}
