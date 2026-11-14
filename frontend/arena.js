import { costume, runCostume, scenery, sprite } from './media.js';
import { LocalMovement, movementTerrain } from './movement.js';

const W = 15, H = 13, TILE = 64, WIDTH = W * TILE, HEIGHT = H * TILE;
const PULSE_MS = [180, 180, 150, 150];
const SPLASH_MS = [70, 70, 85, 95, 85, 85];
const WATER = '06_water_blasts';
const TRIM = { wood: 'cobble', grass: 'sand', pink: 'cobble', ice: 'stone', cobble: 'stone',
  sand: 'cobble', stone: 'cobble', water: 'wood' };
const STAGES = {
  wood: { field: '#529b65', edge: '#346942', wall: '#f5c595', props: ['lantern_house', 'topiary', 'toadstool'] },
  grass: { field: '#579b55', edge: '#2c653b', wall: '#b6e296', props: ['toadstool', 'topiary', 'lantern_house'] },
  pink: { field: '#d284ad', edge: '#923f71', wall: '#faddbe', props: ['toadstool', 'lantern_house', 'topiary'] },
  ice: { field: '#89c9e7', edge: '#437fa6', wall: '#c1efff', props: ['blue_house', 'snow_pine', 'snow_pine'] },
  cobble: { field: '#7f9d8f', edge: '#485c67', wall: '#cedddb', props: ['blue_house', 'topiary', 'lantern_house'] },
  sand: { field: '#e2b86b', edge: '#ac7748', wall: '#fbd28a', props: ['palm', 'lantern_house', 'palm'] },
  stone: { field: '#8781c7', edge: '#575293', wall: '#d7cbfb', props: ['blue_house', 'topiary', 'blue_house'] },
  water: { field: '#50adbc', edge: '#21697d', wall: '#baf5ee', props: ['palm', 'blue_house', 'palm'] },
};
const BORDER_X = 24, BORDER_Y = 112;
const SCENE_W = WIDTH + BORDER_X * 2, SCENE_H = HEIGHT + BORDER_Y * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function followOffset(coordinate, view, extent) {
  const margin = 5;
  if (view >= extent + 2 * margin) return (extent - view) / 2;
  return clamp(coordinate * TILE - view / 2, -margin, extent + margin - view);
}

function frameAt(elapsed, durations) {
  let index = 0;
  while (index < durations.length - 1 && elapsed >= durations[index]) {
    elapsed -= durations[index++];
  }
  return String(index).padStart(2, '0');
}

function draw(ctx, category, name, x, y, size = TILE) {
  const image = sprite(category, name);
  if (image) ctx.drawImage(image, Math.round(x), Math.round(y), size, size);
}

function drawFloor(ctx, theme) {
  const floor = sprite('02_floor_tiles', theme.floor);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rim = x === 0 || x === W - 1 || y === 0 || y === H - 1;
      const left = x * TILE, top = y * TILE;
      if (rim) draw(ctx, '02_floor_tiles', TRIM[theme.floor], left, top);
      else if (floor) ctx.drawImage(floor, left, top, TILE, TILE);
      if (!rim && theme.floor === 'wood') {
        ctx.fillStyle = (x + y) % 2 ? '#ffedc974' : '#f9dfa050';
        ctx.fillRect(left, top, TILE, TILE);
      }
      ctx.fillStyle = (x + y) % 2 === 0 ? '#1024350f' : '#fff5d20a';
      ctx.fillRect(left, top, TILE, TILE);
      ctx.strokeStyle = '#2036433d';
      ctx.strokeRect(left + .5, top + .5, TILE - 1, TILE - 1);
    }
  }
}

function drawObstacles(ctx, theme, world) {
  const stage = STAGES[theme.floor];
  for (const [x, y] of world.walls) {
    const left = x * TILE, top = y * TILE;
    if (x === 0 || x === W - 1 || y === 0 || y === H - 1) {
      ctx.fillStyle = stage.edge;
      ctx.fillRect(left, top, TILE, TILE);
      ctx.fillStyle = stage.wall;
      ctx.globalAlpha = .52;
      ctx.fillRect(left + 2, top + 2, TILE - 4, TILE - 4);
      ctx.globalAlpha = 1;
    }
    draw(ctx, '03_obstacles', theme.solid, left + 1, top - 2, TILE - 2);
  }
  for (const [x, y, type] of world.crates) draw(ctx, '03_obstacles', type, x * TILE, y * TILE - 3);
}

function drawScenicBoard(ctx, theme, world) {
  const stage = STAGES[theme.floor];
  const surround = ctx.createLinearGradient(0, 0, 0, HEIGHT + BORDER_Y * 2);
  surround.addColorStop(0, stage.field);
  surround.addColorStop(1, stage.edge);
  ctx.fillStyle = surround;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  for (let i = 0; i < 87; i++) {
    const x = (i * 151 + 23) % SCENE_W;
    const y = i % 2 ? (i * 37) % 100 : HEIGHT + BORDER_Y + (i * 37) % 104;
    ctx.globalAlpha = .13;
    ctx.fillStyle = i % 3 ? stage.wall : stage.edge;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + i % 6, 2 + i % 3, -.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(BORDER_X, BORDER_Y);
  ctx.fillStyle = '#143c4160';
  ctx.fillRect(-9, -6, WIDTH + 18, HEIGHT + 20);
  ctx.fillStyle = '#ffe2b2';
  ctx.fillRect(-7, -7, WIDTH + 14, HEIGHT + 14);
  drawFloor(ctx, theme);
  drawObstacles(ctx, theme, world);
  for (const [index, x, y, size] of [
    [1, 7, -83, 90], [0, 103, -119, 128], [2, 345, -88, 94], [1, 555, -79, 86],
    [0, 692, -112, 119], [2, 869, -95, 104],
    [2, 9, HEIGHT + 5, 78], [1, 142, HEIGHT + 17, 68], [0, 280, HEIGHT + 0, 107],
    [1, 518, HEIGHT + 7, 81], [2, 668, HEIGHT + 16, 70], [1, 847, HEIGHT + 4, 86],
  ]) {
    const image = scenery(stage.props[index]);
    if (image) ctx.drawImage(image, x, y, size, size);
  }
  ctx.restore();
}

export function drawPreview(canvas, theme, world) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  drawFloor(ctx, theme);
  drawObstacles(ctx, theme, world);
}

export class Arena {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.base = document.createElement('canvas');
    this.base.width = SCENE_W;
    this.base.height = SCENE_H;
    this.baseContext = this.base.getContext('2d', { alpha: false });
    this.positions = new Map();
    this.local = new LocalMovement();
    this.local.reset();
    this.poses = new Map();
    this.particles = [];
    this.steps = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.observer = new ResizeObserver(([entry]) => {
      this.viewport = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    this.observer.observe(canvas);
  }

  reset() {
    this.world = null;
    this.positions.clear();
    this.terrain = '';
    this.round = null;
    this.camera = null;
    this.local.reset();
    this.poses.clear();
    this.particles = [];
    this.steps = 0;
  }

  receive(world, theme, localId) {
    const time = performance.now();
    this.interval = Math.max(35, Math.min(100, time - (this.received || time - 67)));
    this.received = time;
    this.localId = localId;
    this.world = world;
    this.theme = theme;
    if (this.round !== world.round) {
      this.positions.clear();
      this.round = world.round;
      this.camera = null;
      this.local.reset();
      this.poses.clear();
      this.particles = [];
      this.steps = 0;
    }
    for (const player of world.players) {
      const previous = this.positions.get(player.id);
      this.positions.set(player.id, { from: previous?.drawn || player, drawn: previous?.drawn, player,
        stride: previous?.stride ?? 0, moving: previous?.moving ?? 0 });
    }
    for (const id of this.positions.keys()) {
      if (!world.players.some(player => player.id === id)) this.positions.delete(id);
    }
    const key = world.map + JSON.stringify(world.crates);
    if (key !== this.terrain) {
      drawScenicBoard(this.baseContext, theme, world);
      this.terrain = key;
    }
    this.local.receive(world.players.find(player => player.id === localId), movementTerrain(world));
  }

  move(dx, dy) {
    this.local.input(dx, dy);
  }

  cue(type) {
    if (this.reducedMotion.matches) return;
    this.poses.set(this.localId, { type, time: performance.now() });
  }

  react(event) {
    if (this.reducedMotion.matches) return;
    const time = performance.now();
    const player = this.positions.get(event.who);
    if (event.who && ['bomb', 'trap', 'rescue', 'pickup', 'shield', 'out', 'cheer'].includes(event.type)) {
      const type = event.thrown ? 'throw' : event.type;
      const previous = this.poses.get(event.who);
      if (!previous || previous.type !== type || time - previous.time > 230) {
        this.poses.set(event.who, { type, time });
      }
    }
    if (event.type === 'splash') this.burst(event.x + .5, event.y + .5, time, '#a5efff', 11);
    if (event.type === 'out' && Number.isFinite(event.x)) this.burst(event.x, event.y, time, '#b3eeff', 12);
    if (player && ['pickup', 'rescue', 'shield', 'trap', 'cheer'].includes(event.type)) {
      const from = player.drawn || player.player;
      this.burst(from.x, from.y, time, ['trap', 'rescue'].includes(event.type) ? '#91eaff' : '#ffdf7a', 7);
    }
  }

  burst(x, y, time, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count + i * .12;
      this.particles.push({ x: x * TILE, y: y * TILE, time, color, angle, distance: 24 + i % 5 * 10 });
    }
    if (this.particles.length > 140) this.particles.splice(0, this.particles.length - 140);
  }

  renderParticles(ctx, time) {
    this.particles = this.particles.filter(p => time - p.time < 520);
    for (const p of this.particles) {
      const t = Math.max(0, (time - p.time) / 520);
      const distance = Math.sin(t * Math.PI / 2) * p.distance;
      const radius = 4.8 - t * 3;
      ctx.globalAlpha = (1 - t) * .94;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(p.x + Math.cos(p.angle) * distance, p.y + Math.sin(p.angle) * distance - Math.sin(t * 3) * 15,
        radius, radius * .72, p.angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  render(time, overview) {
    const world = this.world;
    if (world?.state !== 'playing') return;
    const ctx = this.ctx;
    const { width, height } = this.viewport || {};
    if (!width || !height) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, 2);
    const canvasW = Math.round(width * pixelRatio), canvasH = Math.round(height * pixelRatio);
    if (this.canvas.width !== canvasW || this.canvas.height !== canvasH) {
      this.canvas.width = canvasW;
      this.canvas.height = canvasH;
      this.camera = null;
    }
    const elapsed = time - this.received;
    const progress = Math.max(0, Math.min(1, elapsed / this.interval));
    const localDrawn = this.local.sample(time, !world.countdown);
    for (const position of this.positions.values()) {
      const { from, player } = position;
      const previous = position.drawn || from;
      position.drawn = player.id === this.localId && localDrawn ? localDrawn : {
        x: from.x + (player.x - from.x) * progress,
        y: from.y + (player.y - from.y) * progress,
      };
      const distance = Math.hypot(position.drawn.x - previous.x, position.drawn.y - previous.y);
      const stride = position.stride + Math.min(distance, .15) * 2.35;
      if (player.id === this.localId && player.alive && !player.trapped && !world.countdown &&
          Math.floor(stride * 2) > Math.floor(position.stride * 2)) this.steps++;
      position.stride = stride % 1;
      position.moving = distance > .005 ? time + 65 : position.moving;
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = STAGES[this.theme.floor].edge;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    const local = this.positions.get(this.localId);
    const follow = Boolean(!overview && local?.player.alive && !world.countdown);
    const fit = Math.min(width / SCENE_W, height / SCENE_H);
    const scale = follow ? Math.max(fit * 1.23, clamp(width / 8.6, 36, 54) / TILE) : fit;
    const viewW = width / scale, viewH = height / scale;
    const target = follow ? {
      x: followOffset(local.drawn.x, viewW, WIDTH),
      y: followOffset(local.drawn.y, viewH, HEIGHT),
    } : { x: (WIDTH - viewW) / 2, y: (HEIGHT - viewH) / 2 };
    if (this.camera?.follow === follow) {
      const mix = 1 - Math.exp(-Math.min(100, time - this.camera.time) / 49);
      this.camera.x += (target.x - this.camera.x) * mix;
      this.camera.y += (target.y - this.camera.y) * mix;
    } else this.camera = { ...target, follow };
    this.camera.time = time;
    ctx.scale(scale, scale);
    ctx.translate(-this.camera.x, -this.camera.y);
    ctx.drawImage(this.base, -BORDER_X, -BORDER_Y);
    for (const [x, y, kind] of world.pickups) {
      draw(ctx, '04_powerups', kind, x * TILE + 6, y * TILE + 6 + Math.sin(time / 240 + x) * 3, 52);
    }
    for (const balloon of world.bombs) this.drawBalloon(balloon, elapsed);
    this.drawWater(world.blasts, elapsed);
    for (const position of [...this.positions.values()].sort((a, b) => a.drawn.y - b.drawn.y)) {
      this.drawPlayer(position, time);
    }
    this.renderParticles(ctx, time);
    if (world.countdown > 0) {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const size = clamp(width * .21, 45, 96);
      ctx.fillStyle = '#071b43bd';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, size * .68, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${size}px Trebuchet MS, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe774';
      ctx.strokeStyle = '#07346d';
      ctx.lineWidth = 5;
      ctx.strokeText(world.countdown, width / 2, height / 2);
      ctx.fillText(world.countdown, width / 2, height / 2);
    }
  }

  takeFootstep() {
    if (!this.steps) return false;
    this.steps = 0;
    return true;
  }

  drawBalloon(balloon, elapsed) {
    const age = Math.max(0, balloon.age * 1000 + elapsed);
    const { x, y } = balloon;
    let dx = x, dy = y, lift = 0;
    if (balloon.from && age < 300) {
      const progress = age / 300;
      dx = balloon.from[0] + (x - balloon.from[0]) * progress;
      dy = balloon.from[1] + (y - balloon.from[1]) * progress;
      lift = Math.sin(Math.PI * progress) * TILE;
    }
    const frame = frameAt(age % 660, PULSE_MS);
    draw(this.ctx, '05_water_balloons', 'balloon_' + frame, dx * TILE, dy * TILE - lift);
  }

  drawWater(blasts, elapsed) {
    const ctx = this.ctx, visible = new Map();
    for (const [x, y, ttl] of blasts) {
      const remaining = ttl * 1000 - elapsed;
      if (remaining > 0) {
        const key = y * W + x;
        visible.set(key, Math.max(remaining, visible.get(key) || 0));
      }
    }
    for (const [key, ttl] of visible) {
      const x = key % W, y = Math.floor(key / W);
      const px = x * TILE + 32, py = y * TILE + 32;
      ctx.strokeStyle = '#1eb6efbb';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.min(23, 8 + ttl / 22);
      ctx.beginPath();
      if (x < W - 1 && visible.has(key + 1)) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + TILE, py);
      }
      if (visible.has(key + W)) {
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + TILE);
      }
      ctx.stroke();
    }
    for (const [key, ttl] of visible) {
      const frame = frameAt(Math.max(0, 490 - ttl), SPLASH_MS);
      draw(ctx, WATER, 'water_burst_' + frame, (key % W) * TILE, Math.floor(key / W) * TILE);
    }
  }

  drawPlayer({ player, drawn, stride, moving }, time) {
    const elapsed = time - (this.poses.get(player.id)?.time ?? -Infinity);
    const action = this.poses.get(player.id)?.type;
    if (!player.alive && !(action === 'out' && elapsed < 360)) return;
    const ctx = this.ctx, x = drawn.x * TILE, y = drawn.y * TILE;
    const reduced = this.reducedMotion.matches;
    const trapped = player.trapped;
    const walking = moving > time && !trapped && !reduced;
    const facing = (player.id === this.localId && this.local.facing) || player.facing || [0, 1];
    const [dx, dy] = facing;
    const phase = stride * Math.PI * 2;
    const step = Math.sin(phase);
    const lift = walking ? Math.abs(step) * 5 : trapped ? 7 + Math.sin(time / 126) * 4 : Math.sin(time / 350) * 1.6;
    let squash = 1;
    let bump = 0;
    let lean = walking ? Math.cos(phase) * .075 : 0;
    if (elapsed < 380) {
      const p = elapsed / 380;
      if (action === 'bomb') squash = 1 - .22 * Math.sin(Math.min(1, p * 2) * Math.PI) + .09 * Math.sin(p * Math.PI * 2);
      if (['throw', 'pickup', 'rescue', 'cheer'].includes(action)) bump = (action === 'cheer' ? 24 : 15) * Math.sin(p * Math.PI);
      if (action === 'throw') lean += dx * .23 * Math.sin(p * Math.PI);
      if (action === 'trap') lean += Math.sin(p * 20) * (1 - p) * .2;
      if (action === 'out') squash = 1 - p * .48;
    }
    const bob = reduced ? 0 : lift + bump;
    const size = 81;
    const feet = y + 20;
    ctx.save();
    ctx.globalAlpha = player.alive ? (player.connected ? 1 : .55) : Math.max(0, 1 - elapsed / 360);
    ctx.fillStyle = player.id === this.localId ? '#ffed5a' : player.team ? '#f47e93' : '#44bfff';
    ctx.beginPath();
    ctx.ellipse(x, feet - 2, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(x, feet - bob);
    ctx.rotate(lean);
    const striding = walking && Math.abs(step) > .43;
    const pose = trapped ? null : dy < 0 ? 'north' : dx ? (striding ? 'side' : 'side-pass') : striding ? 'south' : null;
    const image = (pose && runCostume(player.avatar, pose)) || costume(player.avatar);
    const mirror = dx < 0 || (!dx && walking && step < 0) ? -1 : 1;
    const strideStretch = walking ? .055 * Math.abs(step) : pose ? -.033 : 0;
    ctx.scale(mirror * (2 - squash - strideStretch), squash + strideStretch);
    if (image) ctx.drawImage(image, -size / 2, -size, size, size);
    ctx.restore();
    if (!player.alive) return;
    if (player.trapped || player.shield) {
      const radius = player.trapped ? 38 + Math.sin(time / 120) * 2 : 39;
      const bubbleY = y - 18 - bob;
      const bubble = ctx.createRadialGradient(x - 11, bubbleY - 14, 1, x, bubbleY, radius);
      bubble.addColorStop(0, '#bafcff8a');
      bubble.addColorStop(.66, '#45c9ff29');
      bubble.addColorStop(1, '#1996ebbd');
      ctx.beginPath();
      ctx.arc(x, bubbleY, radius, 0, Math.PI * 2);
      ctx.fillStyle = bubble;
      ctx.fill();
      ctx.strokeStyle = player.trapped ? '#d2fcff' : '#ffeb83';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (player.star) draw(ctx, '04_powerups', 'star', x + 18, y - 53, 25);
    if (action === 'cheer' && elapsed < 620) {
      ctx.save();
      ctx.globalAlpha = 1 - elapsed / 620;
      draw(ctx, '04_powerups', 'star', x + 22, y - 75 - elapsed * .04, 36);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px Trebuchet MS, sans-serif';
    const nameWidth = Math.min(ctx.measureText(player.name).width, 139) + 20;
    const nameX = clamp(x, nameWidth / 2 + 3, WIDTH - nameWidth / 2 - 3);
    const nameY = y - 67 - bob * .6;
    const own = player.id === this.localId;
    ctx.fillStyle = own ? '#073968ea' : '#11264be8';
    ctx.strokeStyle = own ? '#ffdd8c' : '#b3eaffba';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(nameX - nameWidth / 2, nameY - 12, nameWidth, 24, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = own ? '#fff1b8' : '#fff';
    ctx.fillText(player.name, nameX, nameY + 1, 139);
  }
}
