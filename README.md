# Bong Bong Party 🎈

An **original** browser water-bomb party game, inspired by the *genre* of mid-2000s arcade games. No VNG/Nexon artwork, characters, logos, sounds or source code are included.

## Features
- Real-time multiplayer via server-authoritative FastAPI WebSockets: 2–8 people per room; solo sandbox for testing.
- Shareable six-character **private rooms** (hidden from the public room list), public quick-match rooms, teams or free-for-all, chat and replay.
- Classic grid movement, bomb timers, chain reactions, blocked blasts, breakable crates, upgrades, temporary water traps, teammate rescue, rival elimination, scoring and rounds.
- Original Canvas-rendered, pastel cartoon characters and arenas; synthesized sound effects and optional original chiptune-style music. **No third-party assets or external audio downloads**.
- Keyboard and touch controls; responsive desktop and mobile layouts. Mobile view follows your character with a tactical minimap; tap the map icon to view the whole arena.
- No login. Anonymous random 128-bit guest ID stored in a one-year, HttpOnly, SameSite cookie. Nickname and sound preferences live in browser local storage. **IP addresses and browser fingerprinting are not used to identify people**.
- One-origin deployment with QPyServe 0.6.0 and Render; health check at `/api/health`.

## Local setup

```bash
python -m pip install -r requirements.txt
python main.py
```

Then open http://localhost:10000. Open another browser profile to test multiplayer (each profile gets its own guest cookie). Run `python -m pip install pytest httpx && pytest -q` for server tests. `python main.py --prod` runs the production, single-port build.

## Deploy on Render

1. Create a **new** repository for this folder, separate from any other project, and push the files.
2. On Render, deploy a **Python web service** from that repository (or use `render.yaml` as a Blueprint). Python 3.12, build `pip install -r requirements.txt`, start `python main.py --prod`, health `/api/health`. Use one worker/instance.
3. Share the `https://<service>.onrender.com` address. A friend can join using the lobby or a room link.

### Deployment limitations

Free Render web services sleep after idle periods and have **ephemeral** storage. Room state, match scores and names on the server are intentionally in memory; they reset on restart/redeploy or spin-down. Browser cookies remain, so the same browser can be recognized on next visit. Active WebSockets generally keep the service awake while traffic is flowing, but you should not expect uninterrupted 24/7 access or permanent matchmaking on free hosting.

This design supports a **single Python worker**. Multiple instances need Redis/pub-sub or equivalent for cross-instance rooms, plus an external database for persistent profiles/scores. For a serious public release, add anti-abuse moderation, observability, accessible settings and load tests.

## Websocket protocol

1. `GET /api/session` issues a random HttpOnly cookie.
2. `POST /api/rooms?private=true` creates a private room, `POST /api/rooms` creates a public room, and `GET /api/rooms` lists public rooms with players.
3. Connect `/ws/{room_id}?name=...`; receive `{type:"welcome",id,room}` and periodic `{type:"state",...}` snapshots.
4. Send `{type:"input",dx,dy}`, `{type:"bomb"}`, `{type:"start"}`, `{type:"mode",value:"teams"|"solo"}`, `{type:"name",value}`, or `{type:"chat",value}`.

The server owns positions, collisions, bombs, explosion propagation, powerups, traps, eliminations and scoring. Clients send *intent*, not trusted game state. WebSocket origin is checked against Host; names/chat are sanitized and rendered as text, not HTML. The app does not use behavioral device fingerprinting or silent cross-site tracking.

## Attribution

Bong Bong Party is independent, unaffiliated with the publishers of Boom Online / Crazy Arcade. Genre gameplay inspiration does not confer rights to copy any game artwork or audio.
