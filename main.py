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
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect

W, H = 15, 13
MAX_PLAYERS = 8
TICK = 1 / 30
ROUND_SECONDS = 165
DISCONNECT_GRACE = 38
GUEST_COOKIE = 'bb_guest'
TOKEN_COOKIE = 'bb_reconnect'
AUTH_KEY = (os.environ.get('BB_AUTH_SECRET') or secrets.token_urlsafe(48)).encode()
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
    value = re.sub(r'[\x00-\x1f\x7f<>]', '', str(value or '')).strip()
    return value[:16] or 'Khách nhỏ'


def clean_avatar(value: Any) -> str:
    return str(value) if str(value) in AVATARS else AVATARS[0]


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
    if len(parts) != 3 or parts[0] != guest:
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
    shield: int = 0
    invulnerable_until: float = 0
    disconnected_at: float = 0
    last_input: float = 0
    last_seq: int = -1
    last_bomb: float = 0
    last_action: float = 0
    last_chat: float = 0
    socket: WebSocket | None = field(default=None, repr=False)

    def snapshot(self, now: float) -> dict[str, Any]:
        return {'id': self.id, 'name': self.name, 'color': self.color,
                'avatar': self.avatar, 'x': round(self.x, 3), 'y': round(self.y, 3),
                'team': self.team, 'alive': self.alive, 'ready': self.ready,
                'spectator': self.spectator, 'connected': self.socket is not None,
                'trapped': self.trapped_until > now, 'speed': round(self.speed, 2),
                'power': self.power, 'capacity': self.capacity, 'score': self.score,
                'kick': self.kicks, 'glove': self.throws, 'remote': self.remote,
                'shield': self.shield, 'star': self.invulnerable_until > now,
                'dir': [self.dx, self.dy]}


@dataclass
class Bomb:
    x: int
    y: int
    owner: str
    explode_at: float
    power: int
    owner_exited: bool = False
    remote: bool = False
    # Distance travel is resolved in server update, never by the client.


@dataclass
class Blast:
    x: int
    y: int
    until: float
    owner: str
    started: float = 0


@dataclass
class Room:
    id: str
    host: str
    private: bool = False
    mode: str = 'teams'
    map_id: str = 'village'
    state: str = 'waiting'
    players: dict[str, Player] = field(default_factory=dict)
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
    updated: float = field(default_factory=time.monotonic)
    last_broadcast: float = 0
    rng: random.Random = field(default_factory=random.Random, repr=False)
    events: list[dict[str, Any]] = field(default_factory=list)
    event_id: int = 0

    def __post_init__(self) -> None:
        self.reset_map()

    def event(self, event_type: str, **fields: Any) -> None:
        self.event_id += 1
        self.events.append({'id': self.event_id, 'type': event_type, **fields})
        self.events = self.events[-60:]

    def reset_map(self) -> None:
        self.walls = {(x, y) for x in range(W) for y in range(H)
                      if x in (0, W-1) or y in (0, H-1) or (x%2 == 0 and y%2 == 0)}
        safe = set()
        for sx, sy in STARTS:
            safe.update({(sx, sy), (sx + 1, sy), (sx - 1, sy), (sx, sy + 1), (sx, sy - 1)})
        self.crates = {(x, y) for x in range(1, W-1) for y in range(1, H-1)
                       if (x, y) not in self.walls and (x, y) not in safe
                       and self.rng.random() < .72}
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
            self.event('rejoin', who=old.id)
            return old
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError('Phòng đầy')
        n = len(self.players)
        player = Player(secrets.token_hex(6), clean_name(name), avatar=clean_avatar(avatar),
                        team=n%2, spectator=self.state == 'playing')
        player.socket = socket
        if player.spectator:
            player.alive = False
        self.players[guest] = player
        if self.host not in self.players:
            self.host = guest
        self.updated = time.monotonic()
        self.event('join', who=player.id)
        return player

    def start(self, guest: str, now: float) -> bool:
        if guest != self.host or self.state == 'playing':
            return False
        participants = [p for p in self.players.values() if p.socket] or list(self.players.values())
        if len(participants) > 1 and any(not p.ready for p in participants if p != self.players.get(guest)):
            return False
        self.reset_map()
        self.state = 'playing'
        self.winner = ''
        self.round_end = now + ROUND_SECONDS
        self.countdown_end = now + 2.8
        self.started_with = len(participants)
        for i, p in enumerate(participants):
            sx, sy = STARTS[i]
            p.x, p.y = sx+.5, sy+.5
            p.dx = p.dy = 0
            p.speed, p.power, p.capacity = 3.0, 2, 1
            p.alive, p.trapped_until, p.spectator = True, 0, False
            p.team = i%2
            p.kicks = p.throws = p.remote = False
            p.shield, p.invulnerable_until = 0, 0
            p.last_seq = -1
        for p in self.players.values():
            if p not in participants:
                p.spectator = True
                p.alive = False
        self.event('start', map=self.map_id)
        return True

    def collision(self, x: float, y: float, player: Player, now: float | None = None, direction: tuple[int,int] = (0,0)) -> bool:
        radius = .27
        for xx in (math.floor(x-radius), math.floor(x+radius)):
            for yy in (math.floor(y-radius), math.floor(y+radius)):
                tile = (xx, yy)
                if tile in self.walls or tile in self.crates:
                    return True
                bomb = self.bombs.get(tile)
                if bomb and not (bomb.owner == player.id and not bomb.owner_exited):
                    if player.kicks and direction != (0,0):
                        dest = (xx+direction[0], yy+direction[1])
                        if self.passable(dest) and dest not in self.bombs:
                            del self.bombs[tile]
                            bomb.x, bomb.y = dest
                            bomb.owner_exited = True
                            self.bombs[dest] = bomb
                            self.event('kick', x=xx, y=yy, tx=dest[0], ty=dest[1])
                            continue
                    return True
        return False

    def passable(self, pos: tuple[int,int]) -> bool:
        return 0 < pos[0] < W-1 and 0 < pos[1] < H-1 and pos not in self.walls and pos not in self.crates

    def place_bomb(self, player: Player, now: float, thrown: bool = False) -> bool:
        if self.state != 'playing' or not player.alive or player.trapped_until > now:
            return False
        if now - player.last_bomb < .18:
            return False
        active = sum(b.owner == player.id for b in self.bombs.values())
        if active >= player.capacity:
            return False
        tile = math.floor(player.x), math.floor(player.y)
        if thrown:
            if not player.throws:
                return False
            dx, dy = (player.dx, player.dy) if player.dx or player.dy else (0, 1)
            for distance in range(1, 4):
                next_tile = (tile[0]+dx*distance, tile[1]+dy*distance)
                if not self.passable(next_tile) or next_tile in self.bombs:
                    break
                tile = next_tile
        if not self.passable(tile) or tile in self.bombs:
            return False
        player.last_bomb = now
        self.bombs[tile] = Bomb(*tile, player.id, now+2.15, player.power, remote=player.remote)
        self.event('bomb', x=tile[0], y=tile[1], who=player.id)
        self.event('inflate', x=tile[0], y=tile[1])
        return True

    def remote_detonate(self, player: Player, now: float) -> bool:
        if not player.remote or self.state != 'playing' or now-player.last_action < .35:
            return False
        player.last_action = now
        targets = [pos for pos,b in self.bombs.items() if b.owner == player.id and b.remote]
        for pos in targets:
            self.explode(pos, now)
        return bool(targets)

    def explode(self, tile: tuple[int,int], now: float) -> None:
        bomb = self.bombs.pop(tile, None)
        if bomb is None:
            return
        cells = [tile]
        destroyed = set()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            for step in range(1, bomb.power+1):
                cell = bomb.x+dx*step, bomb.y+dy*step
                if cell in self.walls:
                    break
                cells.append(cell)
                if cell in self.crates:
                    destroyed.add(cell)
                    break
        # Expire existing ground items first; newly revealed pickups survive the blast.
        for cell in cells:
            self.pickups.pop(cell, None)
        for cell in destroyed:
            self.crates.remove(cell)
            self.crate_types.pop(cell, None)
            if self.rng.random() < .43:
                self.pickups[cell] = self.rng.choices(ITEMS, weights=ITEM_WEIGHTS)[0]
        for cell in cells:
            self.blasts.append(Blast(*cell, now+.49, bomb.owner, now))
        self.event('splash', x=bomb.x, y=bomb.y)
        # Nonrecursive chain avoids deeply nested explosions.
        chained = [cell for cell in cells if cell in self.bombs]
        for cell in chained:
            self.explode(cell, now)

    def award(self, player: Player, kind: str, now: float) -> None:
        if kind == 'speed':
            player.speed = min(5.15, player.speed+.36)
        elif kind == 'skates':
            player.speed = min(5.4, player.speed+.65)
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
        if self.state != 'playing':
            return
        dt = max(0, min(dt, .1))
        for p in self.players.values():
            if not p.alive or p.trapped_until > now or p.socket is None:
                continue
            if now-p.last_input > .45:
                p.dx = p.dy = 0
            distance = dt*p.speed
            if p.dx:
                xx = p.x+distance*p.dx
                if not self.collision(xx, p.y, p, now, (p.dx,0)):
                    p.x=xx
                target = math.floor(p.y)+.5
                drift = max(-dt*2.7, min(dt*2.7, target-p.y))
                if not self.collision(p.x, p.y+drift, p):
                    p.y+=drift
            elif p.dy:
                yy = p.y+distance*p.dy
                if not self.collision(p.x, yy, p, now, (0,p.dy)):
                    p.y=yy
                target = math.floor(p.x)+.5
                drift = max(-dt*2.7, min(dt*2.7, target-p.x))
                if not self.collision(p.x+drift, p.y, p):
                    p.x+=drift
            for bomb in self.bombs.values():
                if bomb.owner == p.id and not bomb.owner_exited:
                    if (p.x-bomb.x-.5)**2+(p.y-bomb.y-.5)**2 > .78**2:
                        bomb.owner_exited=True
            tile = (math.floor(p.x), math.floor(p.y))
            powerup = self.pickups.pop(tile, None)
            if powerup:
                self.award(p, powerup, now)
        for tile,bomb in list(self.bombs.items()):
            if bomb.explode_at <= now:
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
                self.event('out', who=p.id)
        for trapped in self.players.values():
            if not trapped.alive or trapped.trapped_until <= now:
                continue
            for rescuer in self.players.values():
                if (rescuer.id == trapped.id or not rescuer.alive or
                    rescuer.trapped_until > now or rescuer.spectator):
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
                    self.event('out', who=trapped.id)
                break
        if self.started_with>=2:
            living=[p for p in self.players.values() if p.alive and not p.spectator]
            if self.mode=='teams':
                teams={p.team for p in living}
                if len(teams)<=1:
                    self.finish(str(next(iter(teams))) if teams else 'draw')
            elif len(living)<=1:
                self.finish(living[0].id if living else 'draw')
        if self.state=='playing' and now>=self.round_end:
            self.finish('draw')

    def finish(self, winner: str) -> None:
        if self.state != 'playing':
            return
        self.state='finished'
        self.winner=winner
        if winner!='draw':
            for p in self.players.values():
                if (self.mode=='teams' and str(p.team)==winner) or p.id==winner:
                    p.score+=3
        for p in self.players.values():
            p.ready=True
        self.event('finish', winner=winner)

    def snapshot(self, now: float, *, with_map: bool=True) -> dict[str,Any]:
        data={
            'type':'state','room':self.id,'state':self.state,'mode':self.mode,
            'map':self.map_id,'maps':list(MAPS),'host':self.players[self.host].id if self.host in self.players else '',
            'winner':self.winner,
            'time':max(0,math.ceil(self.round_end-now)) if self.state=='playing' else ROUND_SECONDS if self.state=='waiting' else 0,
            'countdown': max(0,math.ceil(self.countdown_end-now)) if self.state=='playing' else 0,
            'players':[p.snapshot(now) for p in self.players.values()],
            'bombs':[{'x':b.x,'y':b.y,'fuse':round(max(0,b.explode_at-now),2),'remote':b.remote} for b in self.bombs.values()],
            'blasts':[[b.x,b.y,max(0,round(b.until-now,2))] for b in self.blasts],
            'pickups':[[x,y,kind] for (x,y),kind in self.pickups.items()],
            'crates':[[x,y,self.crate_types.get((x,y),'wood_crate')] for x,y in self.crates],
            'events':self.events[:60],
        }
        if with_map:
            data['walls']=[[x,y] for x,y in self.walls]
        return data


def cleanup(room: Room, now: float) -> None:
    for guest,p in list(room.players.items()):
        if p.socket is None and p.disconnected_at and now-p.disconnected_at>DISCONNECT_GRACE:
            room.players.pop(guest, None)
    if room.host not in room.players and room.players:
        room.host = next(iter(room.players))


async def broadcast(room: Room, now: float) -> None:
    payload = room.snapshot(now)
    room.events.clear()
    async def send(ws: WebSocket) -> None:
        with suppress(Exception):
            await asyncio.wait_for(ws.send_json(payload), timeout=.24)
    await asyncio.gather(*(send(p.socket) for p in room.players.values() if p.socket is not None))


async def ticker() -> None:
    last=time.monotonic()
    while True:
        await asyncio.sleep(TICK)
        now=time.monotonic()
        dt=min(.1, now-last)
        last=now
        for code,room in list(ROOMS.items()):
            room.update(dt,now)
            cleanup(room,now)
            if now-room.last_broadcast>=.083:
                room.last_broadcast=now
                await broadcast(room,now)
            if not room.players and now-room.updated>60:
                ROOMS.pop(code,None)


@asynccontextmanager
async def lifespan(_:FastAPI):
    task=asyncio.create_task(ticker())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app=FastAPI(title='Bong Bong Party',version='1.0.0',lifespan=lifespan,docs_url=None,redoc_url=None)


@app.get('/api/health')
def health() -> dict[str,Any]:
    return {'ok':True,'rooms':len(ROOMS),'online':sum(sum(bool(p.socket) for p in r.players.values()) for r in ROOMS.values())}


@app.get('/api/session')
def session(request:Request,response:Response) -> dict[str,str]:
    ident=guest_for_request(request,response)
    return {'id':ident[:8], 'suggestedName':'Khách '+ident[:4].upper()}


@app.get('/api/assets')
def assets() -> dict[str,Any]:
    return {'avatars':list(AVATARS),'maps':MAPS,'items':list(ITEMS)}


@app.get('/api/rooms')
def list_rooms() -> list[dict[str,Any]]:
    return [{'id':r.id,'players':sum(bool(p.socket) for p in r.players.values()),'capacity':MAX_PLAYERS,
             'mode':r.mode,'map':r.map_id,'state':r.state} for r in ROOMS.values() if r.players and not r.private]


@app.post('/api/rooms')
def create_room(request:Request,response:Response,private:bool=False) -> dict[str,str]:
    guest=guest_for_request(request,response)
    now=time.monotonic()
    if now-LAST_ROOM_CREATE.get(guest,-1e9)<2.5:
        raise HTTPException(429,'Vui lòng chờ chút trước khi tạo phòng mới')
    LAST_ROOM_CREATE[guest]=now
    if len(ROOMS)>=90:
        raise HTTPException(503,'Máy chủ đang đầy')
    code=new_code()
    ROOMS[code]=Room(code,guest,private=private)
    return {'id':code}


@app.websocket('/ws/{code}')
async def room_socket(ws:WebSocket,code:str) -> None:
    code=code.upper()
    origin=ws.headers.get('origin')
    if origin and urlparse(origin).netloc.lower()!=ws.headers.get('host','').lower():
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
    try:
        player=room.join(guest,nick,ws,avatar)
    except ValueError:
        await ws.close(code=4409)
        return
    await ws.send_json({'type':'welcome','id':player.id,'room':room.id})
    await broadcast(room,time.monotonic())
    window_start=time.monotonic()
    message_count=0
    try:
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
                if now-player.last_input<.014:
                    continue
                seq=payload.get('seq',player.last_seq+1)
                if not isinstance(seq,int) or seq<=player.last_seq or seq>1_000_000_000:
                    continue
                player.last_seq=seq
                player.last_input=now
                dx,dy=payload.get('dx',0),payload.get('dy',0)
                if type(dx) not in (int,float) or type(dy) not in (int,float):
                    continue
                if not math.isfinite(dx) or not math.isfinite(dy):
                    continue
                player.dx=1 if dx>0 else -1 if dx<0 else 0
                player.dy=0 if player.dx else 1 if dy>0 else -1 if dy<0 else 0
            elif kind=='bomb':
                room.place_bomb(player,now)
            elif kind=='throw':
                room.place_bomb(player,now,thrown=True)
            elif kind=='detonate':
                room.remote_detonate(player,now)
            elif kind=='start':
                room.start(guest,now)
                await broadcast(room,now)
            elif kind=='ready' and room.state!='playing':
                player.ready=bool(payload.get('value',not player.ready))
                await broadcast(room,now)
            elif kind=='mode' and guest==room.host and room.state!='playing':
                room.mode='solo' if payload.get('value')=='solo' else 'teams'
                await broadcast(room,now)
            elif kind=='map' and guest==room.host and room.state!='playing':
                candidate=str(payload.get('value',''))
                if candidate in MAPS:
                    room.map_id=candidate
                    room.reset_map()
                    await broadcast(room,now)
            elif kind=='avatar':
                player.avatar=clean_avatar(payload.get('value'))
                await broadcast(room,now)
            elif kind=='name':
                player.name=clean_name(payload.get('value'))
                await broadcast(room,now)
            elif kind=='chat' and now-player.last_chat>=.85:
                message=re.sub(r'[\x00-\x1f\x7f<>]','',str(payload.get('value','')))[:110].strip()
                if message:
                    player.last_chat=now
                    for peer in [p.socket for p in room.players.values() if p.socket]:
                        with suppress(Exception):
                            await peer.send_json({'type':'chat','id':player.id,'name':player.name,'text':message})
    except (WebSocketDisconnect,RuntimeError,ValueError):
        pass
    finally:
        if player.socket is ws:
            player.socket=None
            player.disconnected_at=time.monotonic()
            if room.host==guest:
                connected=[k for k,p in room.players.items() if p.socket is not None]
                if connected:room.host=connected[0]
            player.dx=player.dy=0
            room.event('disconnect',who=player.id)
            if room.state=='playing' and player.alive and not player.spectator:
                # Brief grace period for reconnection; do not let ghosts move.
                pass
            await broadcast(room,time.monotonic())


if __name__=='__main__':
    from qpyserve import run
    production='--prod' in sys.argv[1:] or os.getenv('QPYSERVE_MODE')=='production'
    run(app,frontend='frontend',host='0.0.0.0' if production else '127.0.0.1',
        port=int(os.getenv('PORT','10000')),workers=1,api_paths=['/ws'])
