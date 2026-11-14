import { sprite } from './media.js';

const W = 15, H = 13, TILE = 64, WIDTH = W * TILE, HEIGHT = H * TILE;
const PULSE_MS = [180, 180, 150, 150];
const SPLASH_MS = [70, 70, 85, 95, 85, 85];
const WATER = '06_water_blasts';
const mobile = matchMedia('(pointer: coarse), (max-width: 700px)');
const TRIM = { wood: 'cobble', grass: 'sand', pink: 'cobble', ice: 'stone', cobble: 'stone',
  sand: 'cobble', stone: 'cobble', water: 'wood' };

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
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const primary = y > 1 && y < H - 2 && (theme.floor !== 'wood' || x > 1 && x < W - 2);
      draw(ctx, '02_floor_tiles', primary ? theme.floor : TRIM[theme.floor], x * TILE, y * TILE);
    }
  }
}

function drawObstacles(ctx, theme, world) {
  for (const [x, y] of world.walls) draw(ctx, '03_obstacles', theme.solid, x * TILE, y * TILE);
  for (const [x, y, type] of world.crates) draw(ctx, '03_obstacles', type, x * TILE, y * TILE);
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
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.base = document.createElement('canvas');
    this.base.width = WIDTH;
    this.base.height = HEIGHT;
    this.baseContext = this.base.getContext('2d', { alpha: false });
    this.positions = new Map();
  }

  reset() {
    this.world = null;
    this.positions.clear();
    this.terrain = '';
    this.round = null;
  }

  receive(world, theme, localId) {
    const time = performance.now();
    this.interval = Math.max(35, Math.min(100, time - (this.received || time - 67)));
    this.received = time;
    this.localId = localId;
    this.world = world;
    if (this.round !== world.round) {
      this.positions.clear();
      this.round = world.round;
    }
    for (const player of world.players) {
      const previous = this.positions.get(player.id);
      this.positions.set(player.id, { from: previous?.drawn || player, drawn: previous?.drawn, player });
    }
    for (const id of this.positions.keys()) {
      if (!world.players.some(player => player.id === id)) this.positions.delete(id);
    }
    const key = world.map + JSON.stringify(world.crates);
    if (key !== this.terrain) {
      drawFloor(this.baseContext, theme);
      drawObstacles(this.baseContext, theme, world);
      this.terrain = key;
    }
  }

  render(time, overview) {
    const world = this.world;
    if (world?.state !== 'playing') return;
    const ctx = this.ctx;
    const elapsed = time - this.received;
    const progress = Math.max(0, Math.min(1, elapsed / this.interval));
    for (const position of this.positions.values()) {
      const { from, player } = position;
      position.drawn = {
        x: from.x + (player.x - from.x) * progress,
        y: from.y + (player.y - from.y) * progress,
      };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const local = this.positions.get(this.localId);
    if (mobile.matches && !overview && local?.player.alive && !world.countdown) {
      const scale = W / 10.5;
      const viewW = WIDTH / scale, viewH = HEIGHT / scale;
      const x = Math.max(0, Math.min(WIDTH - viewW, local.drawn.x * TILE - viewW / 2));
      const y = Math.max(0, Math.min(HEIGHT - viewH, local.drawn.y * TILE - viewH / 2));
      ctx.setTransform(scale, 0, 0, scale, -Math.round(x * scale), -Math.round(y * scale));
    }
    ctx.drawImage(this.base, 0, 0);
    for (const [x, y, kind] of world.pickups) {
      draw(ctx, '04_powerups', kind, x * TILE + 6, y * TILE + 6 + Math.sin(time / 240 + x) * 3, 52);
    }
    for (const balloon of world.bombs) this.drawBalloon(balloon, elapsed);
    this.drawWater(world.blasts, elapsed);
    for (const position of [...this.positions.values()].sort((a, b) => a.drawn.y - b.drawn.y)) {
      this.drawPlayer(position, time);
    }
    if (world.countdown > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#07356ca3';
      ctx.fillRect(0, HEIGHT * .4, WIDTH, HEIGHT * .2);
      ctx.font = 'bold 105px Verdana';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe774';
      ctx.strokeStyle = '#07346d';
      ctx.lineWidth = 9;
      ctx.strokeText(world.countdown, WIDTH / 2, HEIGHT * .54);
      ctx.fillText(world.countdown, WIDTH / 2, HEIGHT * .54);
    }
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

  drawPlayer({ from, player, drawn }, time) {
    if (!player.alive) return;
    const ctx = this.ctx, x = drawn.x * TILE, y = drawn.y * TILE;
    const walking = Math.hypot(player.x - from.x, player.y - from.y) > .025 && !player.trapped;
    const phase = walking ? time / 47 : time / 400;
    const bob = Math.sin(phase) * (walking ? 3 : 1);
    ctx.save();
    ctx.globalAlpha = player.connected ? 1 : .55;
    ctx.fillStyle = player.id === this.localId ? '#ffed5a' : player.team ? '#f47e93' : '#44bfff';
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(Math.round(x), Math.round(y - 7 + bob));
    ctx.rotate(walking ? Math.sin(phase) * .055 : 0);
    ctx.scale(player.facing?.[0] === -1 ? -1 : 1, 1);
    draw(ctx, '01_characters', player.avatar, -32, -34);
    ctx.restore();
    if (player.trapped || player.shield) {
      const radius = player.trapped ? 28 + Math.sin(time / 120) * 2 : 30;
      const bubble = ctx.createRadialGradient(x - 9, y - 18, 1, x, y - 4, radius);
      bubble.addColorStop(0, '#bafcff8a');
      bubble.addColorStop(.66, '#45c9ff29');
      bubble.addColorStop(1, '#1996ebbd');
      ctx.beginPath();
      ctx.arc(x, y - 4, radius, 0, Math.PI * 2);
      ctx.fillStyle = bubble;
      ctx.fill();
      ctx.strokeStyle = player.trapped ? '#d2fcff' : '#ffeb83';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (player.star) draw(ctx, '04_powerups', 'star', x + 10, y - 36, 25);
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px Verdana';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#123e68';
    ctx.fillStyle = '#fff';
    ctx.strokeText(player.name, x, y - 39, 103);
    ctx.fillText(player.name, x, y - 39, 103);
  }
}
