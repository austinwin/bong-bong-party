const RADIUS = .27;
const MAX_LEAD = .16;
const STOP = [0, 0];

export function movementTerrain(world) {
  const blocks = new Set([...world.walls, ...world.crates].map(([x, y]) => y * 15 + x));
  const bombs = new Map(world.bombs.map(bomb => [bomb.y * 15 + bomb.x, bomb.pass]));
  return { blocks, bombs };
}

export function advancePlayer(position, direction, distance, dt, terrain, id) {
  const [dx, dy] = direction;
  if (!dx && !dy) return position;
  const blocked = (x, y) => {
    const left = Math.floor(x - RADIUS), right = Math.floor(x + RADIUS);
    const top = Math.floor(y - RADIUS), bottom = Math.floor(y + RADIUS);
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const tile = 15 * row + col;
        if (col < 1 || col > 13 || row < 1 || row > 11 || terrain.blocks.has(tile) ||
          (terrain.bombs.has(tile) && terrain.bombs.get(tile) !== id)) return true;
      }
    }
    return false;
  };
  let { x, y } = position;
  const nx = x + dx * distance, ny = y + dy * distance;
  const hitsWall = blocked(nx, ny);
  if (!hitsWall) { x = nx; y = ny; }
  const laneX = dx ? x : Math.floor(x) + .5;
  const laneY = dy ? y : Math.floor(y) + .5;
  const turning = hitsWall && !blocked(laneX + dx * distance, laneY + dy * distance);
  const limit = dt * (turning ? 6 : 2.7);
  const drift = delta => Math.max(-limit, Math.min(limit, delta));
  const sx = x + drift(laneX - x), sy = y + drift(laneY - y);
  return blocked(sx, sy) ? { x, y } : { x: sx, y: sy };
}

export class LocalMovement {
  reset() {
    this.player = null;
    this.drawn = null;
    this.position = null;
    this.direction = STOP;
    this.facing = null;
    this.lastFrame = null;
  }

  input(dx, dy) {
    if (this.direction[0] === dx && this.direction[1] === dy) return;
    this.direction = [dx, dy];
    if (dx || dy) this.facing = this.direction;
  }

  receive(player, terrain) {
    const previous = this.player;
    this.player = player;
    this.terrain = terrain;
    if (!player) return;
    const distance = this.position && Math.hypot(this.position.x - player.x, this.position.y - player.y);
    if (!this.position || !previous?.connected || player.trapped || !player.alive || distance > .92) {
      this.position = this.drawn = { x: player.x, y: player.y };
      return;
    }
    // Preserve the short, already-rendered lead along the held axis. The snapshot
    // pulls back any disagreement across lanes and bounds drift during WAN jitter.
    const [dx, dy] = this.direction || STOP;
    const leadX = dx * Math.max(0, Math.min(MAX_LEAD * player.speed, (this.position.x - player.x) * dx));
    const leadY = dy * Math.max(0, Math.min(MAX_LEAD * player.speed, (this.position.y - player.y) * dy));
    const drift = Math.hypot(leadX, leadY);
    let position = { x: player.x, y: player.y };
    for (let traveled = 0; traveled < drift;) {
      const step = Math.min(.045, drift - traveled);
      position = advancePlayer(position, [dx, dy], step, 0, terrain, player.id);
      traveled += step;
    }
    this.position = position;
  }

  sample(time, active) {
    const player = this.player;
    if (!player || !this.position) return null;
    const dt = this.lastFrame === null ? 0 : Math.min(.036, Math.max(0, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    if (!active || !player.alive || !player.connected || player.trapped || player.spectator) {
      this.position = this.drawn = { x: player.x, y: player.y };
      return this.drawn;
    }
    const direction = this.direction || STOP;
    const goal = advancePlayer(this.position, direction, player.speed * dt, dt, this.terrain, player.id);
    const lead = Math.hypot(goal.x - player.x, goal.y - player.y);
    if (lead <= player.speed * MAX_LEAD + .035 ||
        lead < Math.hypot(this.position.x - player.x, this.position.y - player.y)) this.position = goal;
    const correction = Math.hypot(this.position.x - this.drawn.x, this.position.y - this.drawn.y);
    if (correction > .7 || correction < .008) this.drawn = this.position;
    else {
      const mix = 1 - Math.exp(-dt * ((direction[0] || direction[1]) ? 47 : 25));
      this.drawn = {
        x: this.drawn.x + (this.position.x - this.drawn.x) * mix,
        y: this.drawn.y + (this.position.y - this.drawn.y) * mix,
      };
    }
    return this.drawn;
  }
}
