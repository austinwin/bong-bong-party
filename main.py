"""Bong Bong Party: original real-time water-bomb arcade game.

One process owns the authoritative rooms. Multiple workers or Render instances
require a shared session store and pub/sub before horizontal scaling.
"""
from __future__ import annotations

import asyncio
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
ROUND_SECONDS = 150
GUEST_COOKIE = "bb_guest"
STARTS = [(1, 1), (13, 11), (13, 1), (1, 11), (7, 1), (7, 11), (1, 6), (13, 6)]
PALETTE = ["coral", "aqua", "lilac", "lemon", "mint", "rose", "sky", "peach"]
ROOMS: dict[str, "Room"] = {}
LAST_ROOM_CREATE: dict[str, float] = {}
GUEST_PATTERN = re.compile(r"^[0-9a-f]{32}$")
CODE_PATTERN = re.compile(r"^[A-Z2-9]{6}$")


def clean_name(value: Any) -> str:
    name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(value or "")).strip()
    return name[:16] or "Khách nhỏ"


def new_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(25):
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if code not in ROOMS:
            return code
    raise RuntimeError("Could not allocate room")


def guest_for_request(request: Request, response: Response) -> str:
    ident = request.cookies.get(GUEST_COOKIE, "")
    if not GUEST_PATTERN.fullmatch(ident):
        ident = secrets.token_hex(16)
        is_tls = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        response.set_cookie(GUEST_COOKIE, ident, max_age=365 * 86400,
                            httponly=True, secure=is_tls, samesite="lax", path="/")
    return ident


@dataclass
class Player:
    id: str
    name: str
    color: str
    x: float = 1.5
    y: float = 1.5
    team: int = 0
    dx: float = 0
    dy: float = 0
    speed: float = 3.05
    power: int = 2
    capacity: int = 1
    alive: bool = True
    trapped_until: float = 0
    score: int = 0
    last_input: float = 0
    last_bomb: float = 0
    last_chat: float = 0
    socket: WebSocket | None = field(default=None, repr=False)

    def snapshot(self, now: float) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "color": self.color,
                "x": round(self.x, 3), "y": round(self.y, 3), "team": self.team,
                "alive": self.alive, "trapped": self.trapped_until > now,
                "speed": round(self.speed, 2), "power": self.power,
                "capacity": self.capacity, "score": self.score}


@dataclass
class Bomb:
    x: int
    y: int
    owner: str
    explode_at: float
    power: int
    owner_exited: bool = False


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
    mode: str = "teams"
    state: str = "waiting"
    players: dict[str, Player] = field(default_factory=dict)
    walls: set[tuple[int, int]] = field(default_factory=set)
    crates: set[tuple[int, int]] = field(default_factory=set)
    bombs: dict[tuple[int, int], Bomb] = field(default_factory=dict)
    blasts: list[Blast] = field(default_factory=list)
    pickups: dict[tuple[int, int], str] = field(default_factory=dict)
    round_end: float = 0
    started_with: int = 0
    winner: str = ""
    updated: float = field(default_factory=time.monotonic)
    last_broadcast: float = 0
    rng: random.Random = field(default_factory=random.Random, repr=False)
    events: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.reset_map()

    def reset_map(self) -> None:
        self.walls = {(x, y) for x in range(W) for y in range(H)
                      if x in (0, W - 1) or y in (0, H - 1)
                      or (x % 2 == 0 and y % 2 == 0)}
        safe: set[tuple[int, int]] = set()
        for sx, sy in STARTS:
            safe.update({(sx, sy), (sx + 1, sy), (sx - 1, sy),
                         (sx, sy + 1), (sx, sy - 1)})
        self.crates = {(x, y) for x in range(1, W - 1)
                       for y in range(1, H - 1)
                       if (x, y) not in self.walls and (x, y) not in safe
                       and self.rng.random() < 0.71}
        self.bombs.clear()
        self.blasts.clear()
        self.pickups.clear()

    def join(self, guest: str, name: str, socket: WebSocket) -> Player:
        if guest in self.players:
            old = self.players[guest]
            old.socket = socket
            old.name = clean_name(name)
            self.updated = time.monotonic()
            return old
        if self.state == "playing":
            raise ValueError("Trận đang diễn ra. Hãy chờ vòng sau!")
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("Phòng đã đầy!")
        n = len(self.players)
        # A room-scoped public ID is different from the private browser cookie.
        p = Player(secrets.token_hex(6), clean_name(name), PALETTE[n % len(PALETTE)], team=n % 2)
        self.players[guest] = p
        p.socket = socket
        if self.host not in self.players:
            self.host = guest
        self.updated = time.monotonic()
        return p

    def start(self, guest: str, now: float) -> bool:
        if guest != self.host or self.state == "playing":
            return False
        self.reset_map()
        self.state = "playing"
        self.winner = ""
        self.round_end = now + ROUND_SECONDS
        self.started_with = len(self.players)
        for i, p in enumerate(self.players.values()):
            sx, sy = STARTS[i]
            p.x, p.y = sx + 0.5, sy + 0.5
            p.dx = p.dy = 0
            p.speed, p.power, p.capacity = 3.05, 2, 1
            p.alive, p.trapped_until = True, 0
            p.team = i % 2
        self.events.append({"type": "start"})
        return True

    def collision(self, x: float, y: float, player: Player) -> bool:
        radius = 0.28
        for xx in (math.floor(x - radius), math.floor(x + radius)):
            for yy in (math.floor(y - radius), math.floor(y + radius)):
                if (xx, yy) in self.walls or (xx, yy) in self.crates:
                    return True
                bomb = self.bombs.get((xx, yy))
                if bomb and not (bomb.owner == player.id and not bomb.owner_exited):
                    return True
        return False

    def place_bomb(self, player: Player, now: float) -> bool:
        if self.state != "playing" or not player.alive or player.trapped_until > now:
            return False
        if now - player.last_bomb < 0.18:
            return False
        player.last_bomb = now
        tile = (math.floor(player.x), math.floor(player.y))
        active = sum(b.owner == player.id for b in self.bombs.values())
        if tile in self.bombs or active >= player.capacity or tile in self.walls:
            return False
        self.bombs[tile] = Bomb(*tile, player.id, now + 2.05, player.power)
        self.events.append({"type": "bomb", "x": tile[0], "y": tile[1]})
        return True

    def explode(self, tile: tuple[int, int], now: float) -> None:
        bomb = self.bombs.pop(tile, None)
        if bomb is None:
            return
        cells = [tile]
        destroyed: set[tuple[int, int]] = set()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            for step in range(1, bomb.power + 1):
                cell = (bomb.x + dx * step, bomb.y + dy * step)
                if cell in self.walls:
                    break
                cells.append(cell)
                if cell in self.crates:
                    destroyed.add(cell)
                    break
        for cell in destroyed:
            self.crates.remove(cell)
            if self.rng.random() < 0.31:
                self.pickups[cell] = self.rng.choice(["range", "speed", "capacity"])
        for cell in cells:
            self.blasts.append(Blast(cell[0], cell[1], now + 0.52, bomb.owner))
        self.events.append({"type": "splash", "x": bomb.x, "y": bomb.y})
        for cell in cells:
            if cell in self.bombs:
                self.explode(cell, now)

    def update(self, dt: float, now: float) -> None:
        if self.state != "playing":
            return
        dt = min(dt, 0.1)
        for player in self.players.values():
            if not player.alive or player.trapped_until > now:
                continue
            distance = dt * player.speed
            if player.dx:
                xx = player.x + distance * player.dx
                if not self.collision(xx, player.y, player):
                    player.x = xx
                # Magnetize to the middle of corridor while moving.
                target = math.floor(player.y) + 0.5
                drift = max(-dt * 2.3, min(dt * 2.3, target - player.y))
                if not self.collision(player.x, player.y + drift, player):
                    player.y += drift
            elif player.dy:
                yy = player.y + distance * player.dy
                if not self.collision(player.x, yy, player):
                    player.y = yy
                target = math.floor(player.x) + 0.5
                drift = max(-dt * 2.3, min(dt * 2.3, target - player.x))
                if not self.collision(player.x + drift, player.y, player):
                    player.x += drift
            for bomb in self.bombs.values():
                if bomb.owner == player.id and not bomb.owner_exited:
                    if (player.x - bomb.x - 0.5) ** 2 + (player.y - bomb.y - 0.5) ** 2 > 0.8 ** 2:
                        bomb.owner_exited = True
            tile = (math.floor(player.x), math.floor(player.y))
            powerup = self.pickups.pop(tile, None)
            if powerup:
                if powerup == "range":
                    player.power = min(6, player.power + 1)
                elif powerup == "capacity":
                    player.capacity = min(5, player.capacity + 1)
                elif powerup == "speed":
                    player.speed = min(4.8, player.speed + 0.33)
                self.events.append({"type": "pickup", "x": tile[0], "y": tile[1], "who": player.id})
        for tile, bomb in list(self.bombs.items()):
            if bomb.explode_at <= now:
                self.explode(tile, now)
        self.blasts = [blast for blast in self.blasts if blast.until > now]
        blast_cells = {(blast.x, blast.y) for blast in self.blasts}
        for player in self.players.values():
            if not player.alive:
                continue
            if not player.trapped_until and (math.floor(player.x), math.floor(player.y)) in blast_cells:
                player.trapped_until = now + 5.3
                player.dx = player.dy = 0
                self.events.append({"type": "trap", "who": player.id})
            if player.trapped_until and now >= player.trapped_until:
                player.alive = False
                player.trapped_until = 0
                self.events.append({"type": "out", "who": player.id})
        # Teammates rescue trapped friends; rivals can finish them off.
        for trapped in self.players.values():
            if not trapped.alive or trapped.trapped_until <= now:
                continue
            for rescuer in self.players.values():
                if rescuer.id == trapped.id or not rescuer.alive or rescuer.trapped_until > now:
                    continue
                if math.hypot(trapped.x - rescuer.x, trapped.y - rescuer.y) > 0.62:
                    continue
                same_team = self.mode == "teams" and trapped.team == rescuer.team
                if same_team:
                    trapped.trapped_until = 0
                    self.events.append({"type": "rescue", "who": trapped.id})
                else:
                    trapped.alive = False
                    trapped.trapped_until = 0
                    rescuer.score += 1
                    self.events.append({"type": "out", "who": trapped.id})
                break
        if self.started_with >= 2:
            remaining = [p for p in self.players.values() if p.alive]
            if self.mode == "teams":
                distinct = {p.team for p in remaining}
                # For an odd/solo match allow practice without instant win.
                if len(distinct) <= 1:
                    self.finish(str(next(iter(distinct))) if distinct else "draw")
            elif len(remaining) <= 1:
                self.finish(remaining[0].id if remaining else "draw")
        if self.state == "playing" and now >= self.round_end:
            self.finish("draw")

    def finish(self, winner: str) -> None:
        if self.state != "playing":
            return
        self.state = "finished"
        self.winner = winner
        if winner != "draw":
            for p in self.players.values():
                if (self.mode == "teams" and str(p.team) == winner) or p.id == winner:
                    p.score += 3
        self.events.append({"type": "finish", "winner": winner})

    def snapshot(self, now: float, *, with_map: bool = True) -> dict[str, Any]:
        data: dict[str, Any] = {"type": "state", "room": self.id, "state": self.state,
                               "mode": self.mode,
                               "host": self.players[self.host].id if self.host in self.players else "",
                               "winner": self.winner,
                               "time": max(0, math.ceil(self.round_end - now)) if self.state == "playing" else (ROUND_SECONDS if self.state == "waiting" else 0),
                               "players": [p.snapshot(now) for p in self.players.values()],
                               "bombs": [{"x": b.x, "y": b.y, "fuse": max(0, b.explode_at - now)}
                                         for b in self.bombs.values()],
                               "blasts": [[b.x, b.y] for b in self.blasts],
                               "pickups": [[x, y, kind] for (x, y), kind in self.pickups.items()],
                               "crates": [[x, y] for x, y in self.crates],
                               "events": self.events[:40]}
        if with_map:
            data["walls"] = [[x, y] for x, y in self.walls]
        return data


async def broadcast(room: Room, now: float) -> None:
    if not room.players:
        return
    state = room.snapshot(now)
    room.events.clear()
    sockets = [p.socket for p in room.players.values() if p.socket is not None]
    async def send(ws: WebSocket) -> None:
        with suppress(Exception):
            await asyncio.wait_for(ws.send_json(state), timeout=0.25)
    await asyncio.gather(*(send(ws) for ws in sockets))


async def ticker() -> None:
    last = time.monotonic()
    while True:
        await asyncio.sleep(TICK)
        now = time.monotonic()
        dt = min(0.1, now - last)
        last = now
        for code, room in list(ROOMS.items()):
            room.update(dt, now)
            if now - room.last_broadcast >= 0.085:
                room.last_broadcast = now
                await broadcast(room, now)
            if not room.players and now - room.updated > 900:
                ROOMS.pop(code, None)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(ticker())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="Bong Bong Party", version="0.1.0", lifespan=lifespan,
              docs_url=None, redoc_url=None)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "rooms": len(ROOMS), "online": sum(len(r.players) for r in ROOMS.values())}


@app.get("/api/session")
def session(request: Request, response: Response) -> dict[str, str]:
    ident = guest_for_request(request, response)
    return {"id": ident, "suggestedName": "Khách " + ident[:4].upper()}


@app.get("/api/rooms")
def list_rooms() -> list[dict[str, Any]]:
    return [{"id": r.id, "players": len(r.players), "capacity": MAX_PLAYERS,
             "mode": r.mode, "state": r.state} for r in ROOMS.values() if r.players and not r.private]


@app.post("/api/rooms")
def create_room(request: Request, response: Response, private: bool = False) -> dict[str, str]:
    guest = guest_for_request(request, response)
    now = time.monotonic()
    if now - LAST_ROOM_CREATE.get(guest, -1e9) < 3:
        raise HTTPException(429, "Vui lòng đợi một chút trước khi tạo phòng mới.")
    LAST_ROOM_CREATE[guest] = now
    if len(ROOMS) >= 60:
        raise HTTPException(503, "Máy chủ đang đầy, thử lại sau nhé!")
    code = new_code()
    ROOMS[code] = Room(code, guest, private=private)
    return {"id": code}


@app.websocket("/ws/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    code = code.upper()
    origin = ws.headers.get("origin")
    if origin:
        origin_host = urlparse(origin).netloc.lower()
        request_host = ws.headers.get("host", "").lower()
        if origin_host != request_host:
            await ws.close(code=4403)
            return
    # Accept before closing for ordinary application errors so browsers can
    # actually observe the custom WebSocket close code and show useful feedback.
    await ws.accept()
    guest = ws.cookies.get(GUEST_COOKIE, "")
    if not GUEST_PATTERN.fullmatch(guest):
        await ws.close(code=4401)
        return
    room = ROOMS.get(code)
    if room is None:
        await ws.close(code=4404)
        return
    if not CODE_PATTERN.fullmatch(code):
        await ws.close(code=4404)
        return
    nick = clean_name(ws.query_params.get("name"))
    try:
        player = room.join(guest, nick, ws)
    except ValueError:
        await ws.close(code=4409)
        return
    await ws.send_json({"type": "welcome", "id": player.id, "room": room.id})
    await broadcast(room, time.monotonic())
    window_start = time.monotonic()
    message_count = 0
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 512:
                await ws.close(code=1009)
                break
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            now = time.monotonic()
            if now - window_start >= 1:
                window_start, message_count = now, 0
            message_count += 1
            if message_count > 85:
                await ws.close(code=4429)
                break
            if not isinstance(payload, dict):
                continue
            # The newest tab owns this guest's connection.
            if player.socket is not ws:
                await ws.close(code=4000)
                break
            now = time.monotonic()
            room.updated = now
            kind = payload.get("type")
            if kind == "input":
                if now - player.last_input < 0.016:
                    continue
                player.last_input = now
                dx = payload.get("dx", 0)
                dy = payload.get("dy", 0)
                if type(dx) not in (int, float) or type(dy) not in (int, float):
                    continue
                if not math.isfinite(dx) or not math.isfinite(dy):
                    continue
                player.dx = 1 if dx > 0 else -1 if dx < 0 else 0
                player.dy = 0 if player.dx else (1 if dy > 0 else -1 if dy < 0 else 0)
            elif kind == "bomb":
                room.place_bomb(player, now)
            elif kind == "start":
                room.start(guest, now)
                await broadcast(room, now)
            elif kind == "mode" and guest == room.host and room.state != "playing":
                room.mode = "solo" if payload.get("value") == "solo" else "teams"
                await broadcast(room, now)
            elif kind == "name":
                player.name = clean_name(payload.get("value"))
                await broadcast(room, now)
            elif kind == "chat" and now - player.last_chat >= 0.9:
                message = re.sub(r"[\x00-\x1f\x7f<>]", "", str(payload.get("value", "")))[:90].strip()
                if message:
                    player.last_chat = now
                    peers = [p.socket for p in room.players.values() if p.socket]
                    for peer in peers:
                        with suppress(Exception):
                            await peer.send_json({"type": "chat", "id": player.id, "name": player.name, "text": message})
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        if player.socket is ws:
            room.players.pop(guest, None)
            if room.host == guest and room.players:
                room.host = next(iter(room.players))
            room.updated = time.monotonic()
            if room.state == "playing":
                room.update(0, time.monotonic())
            await broadcast(room, time.monotonic())


if __name__ == "__main__":
    # QPyServe serves the HTML app and FastAPI/WebSockets on one origin.
    from qpyserve import run
    production = "--prod" in sys.argv[1:] or os.getenv("QPYSERVE_MODE") == "production"
    run(app, frontend="frontend", host="0.0.0.0" if production else "127.0.0.1",
        port=int(os.getenv("PORT", "10000")), workers=1, api_paths=["/ws"])
