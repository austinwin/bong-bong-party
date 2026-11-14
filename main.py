"""Bong Bong Party — server-authoritative QPyServe water-balloon arena.

All physics, cooldowns, item effects, and outcomes are computed on a single server
process. Browser messages are inputs, never authoritative positions or scores.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import math
import os
import random
import re
import secrets
import sys
import time
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

W, H = 15, 13
MAX_PLAYERS = 8
TICK = 1 / 30
ROUND_SECONDS = 165
COUNTDOWN_SECONDS = 3
FUSE_SECONDS = 2.15
BLAST_SECONDS = .49
DISCONNECT_GRACE = 38
JOIN_RESERVATION = 15
GUEST_COOKIE = 'bb_guest'
TOKEN_COOKIE = 'bb_reconnect'
AUTH_KEY = (os.environ.get('BB_AUTH_SECRET') or secrets.token_urlsafe(48)).encode()
REVISION = os.getenv('RENDER_GIT_COMMIT', 'local')
ASSET_ROOT = Path(__file__).resolve().parent / 'frontend' / 'assets'
AUDIO_ASSETS = frozenset(json.loads((ASSET_ROOT / 'asset_manifest.json').read_text())['categories']['08_audio'])
ARCADE_AUDIO = frozenset(('lobby_parade', 'balloon_rally', 'place', 'throw', 'splash',
                          'prize', 'bubble', 'rescue', 'pop', 'go', 'step'))
STARTS = [(1, 1), (13, 11), (13, 1), (1, 11), (7, 1), (7, 11), (1, 6), (13, 6)]
AVATARS = ('berry_pixie', 'cloud_tech', 'duckling', 'fox_scout', 'frog_kid', 'little_bat', 'night_wizard', 'turtle_scholar')
MAPS = {
    'village': {'name': 'Làng Gỗ', 'floor': 'wood', 'solid': 'stone_pillar', 'blocks': ('wood_crate', 'barrel', 'brick_block')},
    'garden': {'name': 'Vườn Nấm', 'floor': 'grass', 'solid': 'stone_pillar', 'blocks': ('bush', 'mushroom', 'wood_crate')},
    'candy': {'name': 'Đảo Kẹo', 'floor': 'pink', 'solid': 'gold_block', 'blocks': ('candy_block', 'wood_crate', 'barrel')},
    'winter': {'name': 'Làng Tuyết', 'floor': 'ice', 'solid': 'stone_pillar', 'blocks': ('ice_crate', 'snowman', 'wood_crate')},
    'castle': {'name': 'Thành Cổ', 'floor': 'cobble', 'solid': 'stone_pillar', 'blocks': ('brick_block', 'wood_crate', 'barrel')},
    'desert': {'name': 'Ốc Đảo', 'floor': 'sand', 'solid': 'gold_block', 'blocks': ('barrel', 'bush', 'mushroom')},
    'moon': {'name': 'Quảng Trường', 'floor': 'stone', 'solid': 'gold_block', 'blocks': ('brick_block', 'wood_crate', 'candy_block')},
    'lagoon': {'name': 'Biển Xanh', 'floor': 'water', 'solid': 'stone_pillar', 'blocks': ('barrel', 'wood_crate', 'ice_crate')},
}
ITEMS = ('speed', 'water_range', 'extra_balloon', 'kick', 'glove', 'skates', 'shield', 'remote', 'star')
ITEM_WEIGHTS = (19, 20, 19, 8, 6, 9, 9, 5, 5)
ROOMS: dict[str, 'Room'] = {}
LAST_ROOM_CREATE: dict[str, float] = {}
GUEST_PATTERN = re.compile(r'^[0-9a-f]{32}$')
CODE_PATTERN = re.compile(r'^[A-Z2-9]{6}$')


def clean_name(value: Any) -> str:
    value = re.sub(r'[\x00-\x1f\x7f<>]', '', value if isinstance(value, str) else '').strip()
    return value[:16] or 'Khách nhỏ'


def clean_avatar(value: Any) -> str:
    return value if isinstance(value, str) and value in AVATARS else AVATARS[0]


def new_code() -> str:
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for _ in range(30):
        code = ''.join(secrets.choice(alphabet) for _ in range(6))
        if code not in ROOMS:
            return code
    raise RuntimeError('Room allocation failed')


def sign_guest(guest: str, expires: int | None = None) -> str:
    exp = expires or int(time.time() + 365 * 86400)
    message = f'{guest}.{exp}'
    mac = hmac.new(AUTH_KEY, message.encode(), hashlib.sha256).hexdigest()
    return f'{message}.{mac}'


def verify_guest_token(token: str, guest: str) -> bool:
    parts = token.split('.')
    if len(parts) != 3 or parts[0] != guest or not re.fullmatch(r'[0-9a-f]{64}', parts[2]):
        return False
    try:
        exp = int(parts[1])
    except ValueError:
        return False
    if exp < time.time() or exp > time.time() + 366 * 86400:
        return False
    actual = hmac.new(AUTH_KEY, f'{guest}.{exp}'.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(actual, parts[2])


def guest_for_request(request: Request, response: Response) -> str:
    ident = request.cookies.get(GUEST_COOKIE, '')
    token = request.cookies.get(TOKEN_COOKIE, '')
    if not GUEST_PATTERN.fullmatch(ident) or not verify_guest_token(token, ident):
        ident = secrets.token_hex(16)
        token = sign_guest(ident)
        tls = request.url.scheme == 'https' or request.headers.get('x-forwarded-proto') == 'https'
        for key, value in ((GUEST_COOKIE, ident), (TOKEN_COOKIE, token)):
            response.set_cookie(key, value, max_age=365 * 86400, httponly=True,
                                secure=tls, samesite='lax', path='/')
    return ident


@dataclass
class Player:
    id: str
    name: str
    color: str = 'coral'
    x: float = 1.5
    y: float = 1.5
    team: int = 0
    dx: int = 0
    dy: int = 0
    speed: float = 3.0
    power: int = 2
    capacity: int = 1
    alive: bool = True
    trapped_until: float = 0
    score: int = 0
    ready: bool = True
    avatar: str = 'berry_pixie'
    spectator: bool = False
    kicks: bool = False
    throws: bool = False
    remote: bool = False
    skates: bool = False
    shield: int = 0
    invulnerable_until: float = 0
    disconnected_at: float = 0
    last_input: float = 0
    last_seq: int = -1
    last_action_seq: int = -1
    facing: tuple[int, int] = (0, 1)
    last_bomb: float = 0
    last_action: float = 0
    last_chat: float = 0
    last_cheer: float = 0
    socket: WebSocket | None = field(default=None, repr=False)
    outgoing: asyncio.Queue | None = field(default=None, repr=False, compare=False)

    def snapshot(self, now: float) -> dict[str, Any]:
        return {'id': self.id, 'name': self.name, 'color': self.color,
                'avatar': self.avatar, 'x': round(self.x, 3), 'y': round(self.y, 3),
                'team': self.team, 'alive': self.alive, 'ready': self.ready,
                'spectator': self.spectator, 'connected': self.socket is not None,
                'trapped': self.trapped_until > now, 'speed': round(self.speed, 2),
                'power': self.power, 'capacity': self.capacity, 'score': self.score,
                'kick': self.kicks, 'glove': self.throws, 'remote': self.remote, 'skates': self.skates,
                'shield': self.shield, 'star': self.invulnerable_until > now,
                'facing': self.facing}


@dataclass
class Bomb:
    x: int
    y: int
    owner: str
    explode_at: float
    power: int
    owner_exited: bool = False
    remote: bool = False
    placed_at: float = 0
    launched_from: tuple[int, int] | None = None
    slide: tuple[int, int] = (0, 0)
    move_at: float = 0
    inflate_pending: bool = True


@dataclass
class Blast:
    x: int
    y: int
    until: float
    owner: str


@dataclass
class Room:
    id: str
    host: str
    private: bool = False
    practice: bool = False
    mode: str = 'teams'
    map_id: str = 'village'
    state: str = 'waiting'
    players: dict[str, Player] = field(default_factory=dict)
    reservations: dict[str, float] = field(default_factory=dict)
    walls: set[tuple[int, int]] = field(default_factory=set)
    crates: set[tuple[int, int]] = field(default_factory=set)
    crate_types: dict[tuple[int, int], str] = field(default_factory=dict)
    bombs: dict[tuple[int, int], Bomb] = field(default_factory=dict)
    blasts: list[Blast] = field(default_factory=list)
    pickups: dict[tuple[int, int], str] = field(default_factory=dict)
    round_end: float = 0
    countdown_end: float = 0
    started_with: int = 0
    winner: str = ''
    round_id: int = 0
    updated: float = field(default_factory=time.monotonic)
    last_broadcast: float = 0
    rng: random.Random = field(default_factory=random.Random, repr=False)
    events: list[dict[str, Any]] = field(default_factory=list)
    event_id: int = 0
    revision: int = 0

    def __post_init__(self) -> None:
        self.reset_map()

    def event(self, event_type: str, **fields: Any) -> None:
        self.event_id += 1
        self.events.append({'id': self.event_id, 'type': event_type, **fields})
        self.events = self.events[-40:]

    def reset_map(self) -> None:
        self.walls = {(x, y) for x in range(W) for y in range(H)
                      if x in (0, W-1) or y in (0, H-1) or (x%2 == 0 and y%2 == 0)}
        safe = set()
        for sx, sy in STARTS:
            safe.update({(sx, sy), (sx + 1, sy), (sx - 1, sy), (sx, sy + 1), (sx, sy - 1)})
        corridors = {
            'village': lambda x, y: x == 7,
            'garden': lambda x, y: y == 5 and 4 <= x <= 10,
            'candy': lambda x, y: x in (5, 9) and 4 <= y <= 8,
            'winter': lambda x, y: y in (3, 9) and 4 <= x <= 10,
            'castle': lambda x, y: x in (3, 11) and 3 <= y <= 9,
            'desert': lambda x, y: x == 7 or y == 6,
            'moon': lambda x, y: 5 <= x <= 9 and 4 <= y <= 8,
            'lagoon': lambda x, y: y in (5, 7),
        }
        corridor = corridors[self.map_id]
        self.crates.clear()
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                cell, opposite = (x, y), (W - 1 - x, H - 1 - y)
                if cell > opposite or cell in self.walls or cell in safe:
                    continue
                if not any(corridor(*pos) for pos in (cell, opposite)) and self.rng.random() < .76:
                    self.crates.update((cell, opposite))
        kinds = MAPS[self.map_id]['blocks']
        self.crate_types = {pos: kinds[self.rng.randrange(len(kinds))] for pos in self.crates}
        self.bombs.clear()
        self.blasts.clear()
        self.pickups.clear()

    def join(self, guest: str, name: str, socket: WebSocket, avatar: str = 'berry_pixie') -> Player:
        old = self.players.get(guest)
        if old:
            old.socket = socket
            old.disconnected_at = 0
            old.name = clean_name(name)
            old.avatar = clean_avatar(avatar)
            old.dx = old.dy = 0
            old.last_seq = old.last_action_seq = -1
            old.last_input = 0
            self.event('rejoin', who=old.id)
            return old
        if not self.open_seats() and guest not in self.reservations:
            raise ValueError('Phòng đầy')
        n = len(self.players)
        player = Player(secrets.token_hex(6), clean_name(name), avatar=clean_avatar(avatar),
                        team=n%2, spectator=self.state == 'playing', ready=guest == self.host)
        player.socket = socket
        if player.spectator:
            player.alive = False
        self.players[guest] = player
        self.reservations.pop(guest, None)
        if self.host not in self.players and self.host not in self.reservations:
            self.host = guest
            player.ready = True
        self.updated = time.monotonic()
        self.event('join', who=player.id)
        return player

    def open_seats(self) -> int:
        return (1 if self.practice else MAX_PLAYERS) - len(self.players) - len(self.reservations)

    def start(self, guest: str, now: float) -> bool:
        if guest != self.host or self.state == 'playing':
            return False
        participants = [p for p in self.players.values() if p.socket]
        if len(participants) < (1 if self.practice else 2):
            return False
        if any(not p.ready for p in participants if p != self.players.get(guest)):
            return False
        self.reset_map()
        self.state = 'playing'
        self.winner = ''
        self.round_id += 1
        self.countdown_end = now + COUNTDOWN_SECONDS
        self.round_end = self.countdown_end + ROUND_SECONDS
        self.started_with = len(participants)
        for i, p in enumerate(participants):
            sx, sy = STARTS[i]
            p.x, p.y = sx+.5, sy+.5
            p.dx = p.dy = 0
            p.facing = (0, 1)
            p.speed, p.power, p.capacity = 3.0, 2, 1
            p.alive, p.trapped_until, p.spectator = True, 0, False
            p.team = i%2
            p.kicks = p.throws = p.remote = p.skates = False
            p.shield, p.invulnerable_until = 0, 0
            p.last_bomb = p.last_action = 0
        for p in self.players.values():
            if p not in participants:
                p.spectator = True
                p.alive = False
        self.event('start', map=self.map_id)
        return True

    def collision(self, x: float, y: float, player: Player, now: float | None = None, direction: tuple[int,int] = (0,0)) -> bool:
        radius = .27
        blocking_bombs = set()
        for xx in (math.floor(x-radius), math.floor(x+radius)):
            for yy in (math.floor(y-radius), math.floor(y+radius)):
                tile = (xx, yy)
                if not self.passable(tile):
                    return True
                bomb = self.bombs.get(tile)
                if bomb and not (bomb.owner == player.id and not bomb.owner_exited):
                    blocking_bombs.add(tile)
        if not blocking_bombs:
            return False
        if len(blocking_bombs) != 1 or not player.kicks or direction == (0, 0):
            return True
        tile = blocking_bombs.pop()
        bomb = self.bombs[tile]
        if bomb.slide != (0, 0) or not self.move_bomb(tile, direction):
            return True
        bomb.slide = direction
        bomb.move_at = (now if now is not None else time.monotonic()) + .11
        self.event('kick', x=tile[0], y=tile[1])
        return False

    def move_bomb(self, tile: tuple[int, int], direction: tuple[int, int]) -> bool:
        destination = (tile[0] + direction[0], tile[1] + direction[1])
        if not self.passable(destination) or destination in self.bombs:
            return False
        if any(p.alive and (math.floor(p.x), math.floor(p.y)) == destination
               for p in self.players.values()):
            return False
        bomb = self.bombs.pop(tile)
        bomb.x, bomb.y = destination
        bomb.owner_exited = True
        self.bombs[destination] = bomb
        return True

    def passable(self, pos: tuple[int,int]) -> bool:
        return 0 < pos[0] < W-1 and 0 < pos[1] < H-1 and pos not in self.walls and pos not in self.crates

    def place_bomb(self, player: Player, now: float, thrown: bool = False) -> bool:
        if not self.can_act(player, now):
            return False
        if now - player.last_bomb < .18:
            return False
        active = sum(b.owner == player.id for b in self.bombs.values())
        if active >= player.capacity:
            return False
        origin = math.floor(player.x), math.floor(player.y)
        tile = origin
        if thrown:
            if not player.throws:
                return False
            dx, dy = player.facing
            for distance in range(1, 4):
                next_tile = (origin[0]+dx*distance, origin[1]+dy*distance)
                if next_tile in self.walls:
                    break
                if self.passable(next_tile) and next_tile not in self.bombs and not any(
                    p.alive and (math.floor(p.x), math.floor(p.y)) == next_tile
                    for p in self.players.values()
                ):
                    tile = next_tile
            if tile == origin:
                return False
        if not self.passable(tile) or tile in self.bombs:
            return False
        player.last_bomb = now
        self.bombs[tile] = Bomb(*tile, player.id, now + (8 if player.remote else FUSE_SECONDS),
                                player.power, owner_exited=thrown, remote=player.remote, placed_at=now,
                                launched_from=origin if thrown else None)
        self.event('bomb', x=tile[0], y=tile[1], who=player.id, thrown=thrown)
        if any((b.x, b.y) == tile and b.until > now for b in self.blasts):
            self.explode(tile, now)
        return True

    def can_act(self, player: Player, now: float) -> bool:
        return (self.state == 'playing' and self.countdown_end <= now < self.round_end
                and player.alive and not player.spectator and not player.trapped_until)

    def remote_detonate(self, player: Player, now: float) -> bool:
        if not player.remote or not self.can_act(player, now) or now-player.last_action < .35:
            return False
        player.last_action = now
        targets = [pos for pos,b in self.bombs.items() if b.owner == player.id and b.remote]
        for pos in targets:
            self.explode(pos, now)
        return bool(targets)

    def explode(self, tile: tuple[int,int], now: float) -> None:
        pending = [tile]
        destroyed = set()
        while pending:
            origin = pending.pop()
            bomb = self.bombs.pop(origin, None)
            if bomb is None:
                continue
            cells = [origin]
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                for step in range(1, bomb.power + 1):
                    cell = bomb.x + dx * step, bomb.y + dy * step
                    if cell in self.walls:
                        break
                    cells.append(cell)
                    if cell in self.crates:
                        destroyed.add(cell)
                        break
            for cell in cells:
                self.pickups.pop(cell, None)
                self.blasts.append(Blast(*cell, now + BLAST_SECONDS, bomb.owner))
                if cell in self.bombs:
                    pending.append(cell)
            self.event('splash', x=bomb.x, y=bomb.y)
        # Destruction resolves after the whole chain, so shared crates block every ray.
        for cell in destroyed:
            self.crates.remove(cell)
            self.crate_types.pop(cell, None)
            if self.rng.random() < .43:
                self.pickups[cell] = self.rng.choices(ITEMS, weights=ITEM_WEIGHTS)[0]

    def award(self, player: Player, kind: str, now: float) -> None:
        if kind == 'speed':
            player.speed = min(5.15, player.speed+.36)
        elif kind == 'skates':
            player.speed = min(5.4, player.speed+.65)
            player.skates = True
        elif kind == 'water_range':
            player.power = min(8, player.power+1)
        elif kind == 'extra_balloon':
            player.capacity = min(7, player.capacity+1)
        elif kind == 'kick':
            player.kicks = True
        elif kind == 'glove':
            player.throws = True
        elif kind == 'shield':
            player.shield = min(2, player.shield+1)
        elif kind == 'remote':
            player.remote = True
        elif kind == 'star':
            player.invulnerable_until = now+8
        self.event('pickup', who=player.id, kind=kind)
        if kind in ('speed', 'skates'):
            self.event('speed_boost', who=player.id)

    def update(self, dt: float, now: float) -> None:
        if self.state != 'playing' or now < self.countdown_end:
            return
        dt = max(0, min(dt, .1))
        for p in self.players.values():
            if not p.alive or p.trapped_until > now or p.socket is None:
                continue
            if now-p.last_input > .45:
                p.dx = p.dy = 0
            self.move_player(p, dt, now)
            for bomb in self.bombs.values():
                if bomb.owner == p.id and not bomb.owner_exited:
                    if (p.x-bomb.x-.5)**2+(p.y-bomb.y-.5)**2 > .78**2:
                        bomb.owner_exited=True
            tile = (math.floor(p.x), math.floor(p.y))
            powerup = self.pickups.pop(tile, None)
            if powerup:
                self.award(p, powerup, now)
        for tile, bomb in list(self.bombs.items()):
            if self.bombs.get(tile) is not bomb:
                continue
            if bomb.slide != (0, 0) and now >= bomb.move_at:
                if self.move_bomb(tile, bomb.slide):
                    bomb.move_at = now + .11
                    tile = bomb.x, bomb.y
                else:
                    bomb.slide = (0, 0)
            if bomb.inflate_pending and bomb.placed_at and now >= bomb.placed_at + .4:
                bomb.inflate_pending = False
                self.event('inflate', x=bomb.x, y=bomb.y)
            if bomb.explode_at <= now or any((b.x, b.y) == tile and b.until > now for b in self.blasts):
                self.explode(tile, now)
        self.blasts = [b for b in self.blasts if b.until > now]
        dangerous = {(b.x,b.y) for b in self.blasts}
        for p in self.players.values():
            if not p.alive:
                continue
            if not p.trapped_until and (math.floor(p.x),math.floor(p.y)) in dangerous:
                if p.invulnerable_until > now:
                    continue
                if p.shield:
                    p.shield-=1
                    p.invulnerable_until=now+1.4
                    self.event('shield', who=p.id)
                else:
                    p.trapped_until=now+5.2
                    p.dx=p.dy=0
                    self.event('trap', who=p.id)
            if p.trapped_until and now >= p.trapped_until:
                p.alive=False
                p.trapped_until=0
                self.event('out', who=p.id, x=p.x, y=p.y)
        for trapped in self.players.values():
            if not trapped.alive or trapped.trapped_until <= now:
                continue
            for rescuer in self.players.values():
                if (rescuer.id == trapped.id or not rescuer.alive or
                    rescuer.trapped_until > now or rescuer.spectator or rescuer.disconnected_at):
                    continue
                if math.hypot(trapped.x-rescuer.x, trapped.y-rescuer.y)>.63:
                    continue
                if self.mode=='teams' and trapped.team==rescuer.team:
                    trapped.trapped_until=0
                    trapped.invulnerable_until=now+1.1
                    self.event('rescue', who=trapped.id)
                else:
                    trapped.alive=False
                    trapped.trapped_until=0
                    rescuer.score+=1
                    self.event('out', who=trapped.id, x=trapped.x, y=trapped.y)
                break
        if self.practice and self.players and not any(p.alive for p in self.players.values()):
            self.finish('draw')
        elif self.started_with>=2:
            living=[p for p in self.players.values() if p.alive and not p.spectator]
            if self.mode=='teams':
                teams={p.team for p in living}
                if len(teams)<=1:
                    self.finish(str(next(iter(teams))) if teams else 'draw')
            elif len(living)<=1:
                self.finish(living[0].id if living else 'draw')
        if self.state=='playing' and now>=self.round_end:
            self.finish('draw')

    def move_player(self, p: Player, dt: float, now: float) -> None:
        if not (p.dx or p.dy):
            return
        nx, ny = p.x + dt * p.speed * p.dx, p.y + dt * p.speed * p.dy
        blocked = self.collision(nx, ny, p, now, (p.dx, p.dy))
        if not blocked:
            p.x, p.y = nx, ny
        centered_x = p.x if p.dx else math.floor(p.x) + .5
        centered_y = p.y if p.dy else math.floor(p.y) + .5
        # Near a junction, help the player line up with the open lane they are turning into.
        turning = blocked and not self.collision(centered_x + dt * p.speed * p.dx,
                                                  centered_y + dt * p.speed * p.dy, p)
        limit = dt * (6 if turning else 2.7)
        sx = p.x + max(-limit, min(limit, centered_x - p.x))
        sy = p.y + max(-limit, min(limit, centered_y - p.y))
        if not self.collision(sx, sy, p):
            p.x, p.y = sx, sy

    def finish(self, winner: str) -> None:
        if self.state != 'playing':
            return
        self.state='finished'
        self.winner=winner
        if winner!='draw':
            for p in self.players.values():
                if not p.spectator and ((self.mode=='teams' and str(p.team)==winner) or p.id==winner):
                    p.score+=3
        for guest, p in self.players.items():
            p.ready = guest == self.host
        self.event('finish', winner=winner)

    def snapshot(self, now: float, *, with_map: bool=True) -> dict[str,Any]:
        data={
            'type':'state','room':self.id,'state':self.state,'mode':self.mode,
            'map':self.map_id,'maps':list(MAPS),'host':self.players[self.host].id if self.host in self.players else '',
            'winner': self.winner, 'practice': self.practice, 'round': self.round_id, 'revision': self.revision,
            'time': max(0, math.ceil(self.round_end - max(now, self.countdown_end))) if self.state=='playing' else ROUND_SECONDS if self.state=='waiting' else 0,
            'countdown': max(0,math.ceil(self.countdown_end-now)) if self.state=='playing' else 0,
            'players':[p.snapshot(now) for p in self.players.values()],
            'bombs': [{'x': b.x, 'y': b.y, 'age': round(now - b.placed_at, 2), 'remote': b.remote,
                       'from': b.launched_from, 'owner': b.owner,
                       'pass': None if b.owner_exited else b.owner} for b in self.bombs.values()],
            'blasts':[[b.x,b.y,max(0,round(b.until-now,2))] for b in self.blasts],
            'pickups':[[x,y,kind] for (x,y),kind in self.pickups.items()],
            'crates':[[x,y,self.crate_types.get((x,y),'wood_crate')] for x,y in self.crates],
            'events': self.events,
        }
        if with_map:
            data['walls']=[[x,y] for x,y in self.walls]
        return data


def cleanup(room: Room, now: float) -> bool:
    changed = False
    for guest, expires in list(room.reservations.items()):
        if expires <= now:
            del room.reservations[guest]
    for guest,p in list(room.players.items()):
        if p.socket is None and p.disconnected_at and now-p.disconnected_at>DISCONNECT_GRACE:
            room.players.pop(guest, None)
            changed = True
    if room.host not in room.players and room.host not in room.reservations and room.players:
        room.host = next(iter(room.players))
        room.players[room.host].ready = True
        changed = True
    return changed


def broadcast(room: Room, now: float) -> None:
    room.revision += 1
    payload = room.snapshot(now)
    for player in room.players.values():
        queue = player.outgoing
        if queue is not None:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(payload)


async def write_states(ws: WebSocket, queue: asyncio.Queue) -> None:
    try:
        while True:
            await asyncio.wait_for(ws.send_json(await queue.get()), timeout=2)
    except (TimeoutError, RuntimeError, WebSocketDisconnect):
        with suppress(Exception):
            await asyncio.wait_for(ws.close(code=1013), timeout=1)


async def ticker() -> None:
    next_tick = time.monotonic() + TICK
    next_sweep = next_tick
    while True:
        await asyncio.sleep(max(0, next_tick - time.monotonic()))
        now = time.monotonic()
        next_tick = max(next_tick + TICK, now - 2 * TICK)
        if now >= next_sweep:
            next_sweep = now + 60
            for guest, created in list(LAST_ROOM_CREATE.items()):
                if now - created > 60:
                    LAST_ROOM_CREATE.pop(guest, None)
        for code,room in list(ROOMS.items()):
            changed = cleanup(room, now)
            active = room.state == 'playing'
            room.update(TICK, now)
            if changed or (active and (room.state != 'playing' or now-room.last_broadcast >= .065)):
                room.last_broadcast = now
                broadcast(room, now)
            if not room.players and now-room.updated>60:
                ROOMS.pop(code,None)


@asynccontextmanager
async def lifespan(_:FastAPI):
    task=asyncio.create_task(ticker())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app=FastAPI(title='Bong Bong Party',version='1.1.0',lifespan=lifespan,docs_url=None,redoc_url=None)


@app.get('/api/health')
async def health() -> dict[str,Any]:
    return {'ok': True, 'revision': REVISION, 'rooms': len(ROOMS),
            'online': sum(sum(bool(p.socket) for p in r.players.values()) for r in ROOMS.values())}


@app.get('/api/session')
def session(request:Request,response:Response) -> dict[str,str]:
    ident=guest_for_request(request,response)
    return {'id':ident[:8], 'suggestedName':'Khách '+ident[:4].upper()}


@app.get('/api/assets')
def assets() -> dict[str,Any]:
    return {'avatars':list(AVATARS),'maps':MAPS,'items':list(ITEMS),'arcadeAudio':sorted(ARCADE_AUDIO)}


@app.get('/assets/08_audio/{name}')
def original_audio_asset(name: str) -> FileResponse:
    # QPyServe's plain-HTML file set does not include WAV.
    if name not in AUDIO_ASSETS:
        raise HTTPException(404)
    return FileResponse(ASSET_ROOT / '08_audio' / name, media_type='audio/wav',
                        headers={'Cache-Control': 'public, max-age=86400'})


@app.get('/assets/13_audio/{name}')
def arcade_audio_asset(name: str) -> FileResponse:
    if not name.endswith('.wav') or name.removesuffix('.wav') not in ARCADE_AUDIO:
        raise HTTPException(404)
    return FileResponse(ASSET_ROOT / '13_audio' / name, media_type='audio/wav',
                        headers={'Cache-Control': 'public, max-age=86400'})


@app.get('/api/rooms')
async def list_rooms() -> list[dict[str,Any]]:
    return [{'id':r.id,'players':sum(bool(p.socket) for p in r.players.values()),'capacity':MAX_PLAYERS,
             'open': r.open_seats(), 'mode':r.mode,'map':r.map_id,'state':r.state}
            for r in ROOMS.values() if any(p.socket for p in r.players.values()) and not r.private]


@app.post('/api/rooms')
async def create_room(request:Request,response:Response,private:bool=False,practice:bool=False) -> dict[str,str]:
    guest=guest_for_request(request,response)
    return {'id': allocate_room(guest, time.monotonic(), private, practice).id}


def allocate_room(guest: str, now: float, private: bool = False, practice: bool = False) -> Room:
    if now-LAST_ROOM_CREATE.get(guest,-1e9)<2.5:
        raise HTTPException(429,'Vui lòng chờ chút trước khi tạo phòng mới')
    LAST_ROOM_CREATE[guest]=now
    if len(ROOMS)>=90:
        raise HTTPException(503,'Máy chủ đang đầy')
    code=new_code()
    room = Room(code, guest, private=private or practice, practice=practice)
    room.reservations[guest] = now + JOIN_RESERVATION
    ROOMS[code] = room
    return room


@app.post('/api/match')
async def match_room(request: Request, response: Response) -> dict[str, str]:
    guest = guest_for_request(request, response)
    now = time.monotonic()
    waiting = [room for room in ROOMS.values()
               if room.state == 'waiting' and not room.private and (room.players or room.reservations)]
    existing = next((room for room in waiting if guest in room.players or guest in room.reservations), None)
    if existing:
        return {'id': existing.id}
    room = next((room for room in waiting if room.open_seats() > 0), None)
    if room is None:
        room = allocate_room(guest, now)
    else:
        room.reservations[guest] = now + JOIN_RESERVATION
    return {'id': room.id}


@app.websocket('/ws/{code}')
async def room_socket(ws:WebSocket,code:str) -> None:
    code=code.upper()
    origin=ws.headers.get('origin')
    try:
        origin_ok = not origin or (urlparse(origin).netloc.lower() == ws.headers.get('host', '').lower())
    except ValueError:
        origin_ok = False
    if not origin_ok:
        await ws.accept()
        await ws.close(code=4403)
        return
    await ws.accept()
    guest=ws.cookies.get(GUEST_COOKIE,'')
    auth=ws.cookies.get(TOKEN_COOKIE,'')
    if not GUEST_PATTERN.fullmatch(guest) or not verify_guest_token(auth,guest):
        await ws.close(code=4401)
        return
    room=ROOMS.get(code)
    if room is None or not CODE_PATTERN.fullmatch(code):
        await ws.close(code=4404)
        return
    nick=clean_name(ws.query_params.get('name'))
    avatar=clean_avatar(ws.query_params.get('avatar'))
    old_socket = room.players[guest].socket if guest in room.players else None
    try:
        player=room.join(guest,nick,ws,avatar)
    except ValueError:
        await ws.close(code=4409)
        return
    queue = asyncio.Queue(maxsize=1)
    player.outgoing = queue
    writer = None
    left = False
    window_start=time.monotonic()
    message_count=0
    try:
        await ws.send_json({'type': 'welcome', 'id': player.id, 'room': room.id})
        writer = asyncio.create_task(write_states(ws, queue))
        broadcast(room, time.monotonic())
        if old_socket is not None:
            with suppress(Exception):
                await asyncio.wait_for(old_socket.close(code=4000), timeout=.2)
        while True:
            raw=await ws.receive_text()
            if len(raw)>600:
                await ws.close(code=1009)
                break
            try:
                payload=json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload,dict):
                continue
            now=time.monotonic()
            if now-window_start>=1:
                window_start,message_count=now,0
            message_count+=1
            if message_count>95:
                await ws.close(code=4429)
                break
            if player.socket is not ws:
                await ws.close(code=4000)
                break
            room.updated=now
            kind=payload.get('type')
            if kind=='input':
                seq, dx, dy = (payload.get(key) for key in ('seq', 'dx', 'dy'))
                if (type(seq) is not int or not player.last_seq < seq <= 1_000_000_000
                    or type(dx) is not int or type(dy) is not int or abs(dx) + abs(dy) > 1):
                    continue
                player.last_seq, player.last_input = seq, now
                if room.can_act(player, now):
                    player.dx, player.dy = dx, dy
                    if dx or dy:
                        player.facing = (dx, dy)
            elif kind in ('bomb', 'throw', 'detonate'):
                seq = payload.get('seq')
                if (type(seq) is not int or not player.last_action_seq < seq <= 1_000_000_000
                    or payload.get('round') != room.round_id):
                    continue
                player.last_action_seq = seq
                if kind == 'detonate':
                    room.remote_detonate(player, now)
                else:
                    room.place_bomb(player, now, thrown=kind == 'throw')
            elif kind == 'cheer' and room.can_act(player, now) and now - player.last_cheer >= 2:
                player.last_cheer = now
                room.event('cheer', who=player.id)
            elif kind == 'leave':
                left = True
                break
            elif kind=='start':
                if room.start(guest, now):
                    broadcast(room, now)
            elif kind=='ready' and room.state!='playing':
                value = payload.get('value')
                if type(value) is bool and value != player.ready:
                    player.ready = value
                    broadcast(room, now)
            elif kind=='mode' and guest==room.host and room.state!='playing':
                room.mode='solo' if payload.get('value')=='solo' else 'teams'
                broadcast(room, now)
            elif kind=='map' and guest==room.host and room.state!='playing':
                candidate=str(payload.get('value',''))
                if candidate in MAPS and candidate != room.map_id:
                    room.map_id=candidate
                    room.reset_map()
                    broadcast(room, now)
            elif kind=='avatar':
                player.avatar=clean_avatar(payload.get('value'))
                broadcast(room, now)
            elif kind=='name':
                player.name=clean_name(payload.get('value'))
                broadcast(room, now)
            elif kind=='chat' and now-player.last_chat>=.85:
                message=re.sub(r'[\x00-\x1f\x7f<>]','',str(payload.get('value','')))[:110].strip()
                if message:
                    player.last_chat=now
                    room.event('chat', who=player.id, name=player.name, text=message)
                    broadcast(room, now)
    except (WebSocketDisconnect,RuntimeError,ValueError):
        pass
    finally:
        if writer is not None:
            writer.cancel()
            with suppress(asyncio.CancelledError):
                await writer
        if player.socket is ws:
            player.socket=None
            player.outgoing = None
            player.disconnected_at=time.monotonic()
            player.dx=player.dy=0
            if left:
                room.players.pop(guest, None)
            if room.host==guest:
                connected=[k for k,p in room.players.items() if p.socket is not None]
                if connected:room.host=connected[0]
            room.event('leave' if left else 'disconnect', who=player.id)
            broadcast(room, time.monotonic())
        if left:
            with suppress(RuntimeError, WebSocketDisconnect):
                await ws.close(code=1000)


if __name__=='__main__':
    from qpyserve import run
    production='--prod' in sys.argv[1:] or os.getenv('QPYSERVE_MODE')=='production'
    run(app,frontend='frontend',host='0.0.0.0' if production else '127.0.0.1',
        port=int(os.getenv('PORT','10000')),workers=1,api_paths=['/ws', '/assets/08_audio', '/assets/13_audio'])
