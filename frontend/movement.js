const COLUMNS = 15;
const ROWS = 13;
const RADIUS = .27;
const CORNER_REACH = .36;
const MAX_PREDICTION = 155;
const STOP = [0, 0];
export const PACES = [0, .38, .68, 1];

export function stickIntent(x, y, previous, pace) {
  const horizontal = Math.abs(x), vertical = Math.abs(y);
  const reach = Math.max(horizontal, vertical);
  if (reach < (previous ? .085 : .14)) return { direction: '', pace: 0 };
  // Keep an axis only inside a narrow diagonal band. Straight reversals take effect at once.
  const margin = previous === 'left' || previous === 'right' ? .89 : previous ? 1.12 : 1;
  const direction = horizontal > vertical * margin ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
  const full = pace === 3 ? .57 : .66;
  const medium = pace >= 2 ? .27 : .36;
  return { direction, pace: reach >= full ? 3 : reach >= medium ? 2 : 1 };
}

export function movementTerrain(world) {
  const blocks = new Set([...world.walls, ...world.crates].map(([x, y]) => y * COLUMNS + x));
  const bombs = new Map(world.bombs.map(bomb => [bomb.y * COLUMNS + bomb.x, bomb.pass]));
  return { blocks, bombs };
}

function blocked({ x, y }, terrain, id) {
  const left = Math.floor(x - RADIUS), right = Math.floor(x + RADIUS);
  const top = Math.floor(y - RADIUS), bottom = Math.floor(y + RADIUS);
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const tile = COLUMNS * row + col;
      if (col < 1 || col >= COLUMNS - 1 || row < 1 || row >= ROWS - 1 || terrain.blocks.has(tile) ||
          (terrain.bombs.has(tile) && terrain.bombs.get(tile) !== id)) return true;
    }
  }
  return false;
}

export function advancePlayer(position, [dx, dy], remaining, terrain, id) {
  while (remaining > 1e-8) {
    const distance = Math.min(remaining, .06);
    remaining -= distance;
    const { x, y } = position;
    const forward = { x: x + dx * distance, y: y + dy * distance };
    if (!blocked(forward, terrain, id)) {
      position = forward;
      continue;
    }
    const cx = dx ? x : Math.floor(x) + .5;
    const cy = dy ? y : Math.floor(y) + .5;
    const offset = Math.abs(cx - x) + Math.abs(cy - y);
    if (!offset || offset > CORNER_REACH || blocked({ x: cx + dx * .08, y: cy + dy * .08 }, terrain, id)) break;
    const share = Math.min(1, distance / offset);
    const aligned = { x: x + (cx - x) * share, y: y + (cy - y) * share };
    if (blocked(aligned, terrain, id)) break;
    position = aligned;
  }
  return position;
}

export class LocalMovement {
  reset() {
    this.player = null;
    this.position = null;
    this.correction = { x: 0, y: 0 };
    this.direction = STOP;
    this.pace = 0;
    this.facing = null;
    this.sequence = -1;
    this.changedAt = -Infinity;
    this.lastFrame = null;
  }

  input(dx, dy, pace, sequence, time) {
    if (this.direction[0] === dx && this.direction[1] === dy && this.pace === pace) return;
    this.direction = [dx, dy];
    this.pace = pace;
    this.sequence = sequence;
    this.changedAt = time;
    this.correction = { x: 0, y: 0 };
    if (dx || dy) this.facing = this.direction;
  }

  receive(player, terrain, time) {
    const previous = this.player;
    this.player = player;
    this.terrain = terrain;
    if (!player) return;
    const actual = { x: player.x, y: player.y };
    const position = this.position;
    if (!position || !previous?.connected || player.trapped || !player.alive ||
        Math.hypot(position.x - actual.x, position.y - actual.y) > .77 ||
        blocked(position, terrain, player.id)) {
      this.position = actual;
      this.correction = { x: 0, y: 0 };
      return;
    }
    // A snapshot sent before a reversal or release cannot restore the previous input.
    if ((player.inputAck ?? this.sequence) < this.sequence && time - this.changedAt < MAX_PREDICTION) return;
    const [dx, dy] = this.direction;
    const forward = (position.x - actual.x) * dx + (position.y - actual.y) * dy;
    const lead = Math.max(0, Math.min(.30, forward));
    const target = lead ? advancePlayer(actual, this.direction, lead, terrain, player.id) : actual;
    this.correction = { x: target.x - position.x, y: target.y - position.y };
  }

  sample(time, active) {
    const player = this.player;
    if (!player || !this.position) return null;
    const since = Math.max(this.lastFrame ?? time, this.changedAt);
    const dt = Math.min(.042, Math.max(0, (time - since) / 1000));
    this.lastFrame = time;
    if (!active || !player.alive || !player.connected || player.trapped || player.spectator) {
      this.position = { x: player.x, y: player.y };
      return this.position;
    }
    const speed = player.speed * PACES[this.pace];
    const position = this.position;
    const goal = this.pace ? advancePlayer(position, this.direction, speed * dt, this.terrain, player.id) : position;
    const allowed = Math.max(.12, Math.min(.52, speed * MAX_PREDICTION / 1000));
    const offset = point => Math.hypot(point.x - player.x, point.y - player.y);
    this.position = offset(goal) <= allowed || offset(goal) < offset(position) ? goal : position;

    const correction = this.correction;
    const length = Math.hypot(correction.x, correction.y);
    if (length > 0 && dt) {
      // Reconcile in small increments without letting a stale correction reverse a held direction.
      const maxSpeed = this.pace ? speed * .44 : 1.65;
      const scale = Math.min(1, maxSpeed * dt / length);
      const aligned = { x: this.position.x + correction.x * scale, y: this.position.y + correction.y * scale };
      if (!blocked(aligned, this.terrain, player.id)) {
        this.position = aligned;
        this.correction = { x: correction.x * (1 - scale), y: correction.y * (1 - scale) };
      }
    }
    return this.position;
  }
}
