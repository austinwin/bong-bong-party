# Bong Bong Party

Independent, free-to-play multiplayer water-balloon browser arcade, inspired by the feel of Vietnam's 2007 internet-café era. **Not affiliated with VNG, Nexon, or Boom Online.** The included art and audio come from the original *Bubble Arena 2007 Design Reference Kit* supplied for this project; no proprietary Boom Online client assets are included.

## Play

1. Open the app, choose one of the eight animated pixel characters, and enter a nickname.
2. Choose **Chơi nhanh** to find a public room, **Tạo phòng** for a private room, or enter a shared six-character room code.
3. Players can mark ready; the host selects one of eight maps and teams or free-for-all, then starts a round.
4. Use **WASD / arrow keys** to move, **Space** to place a water balloon, **R** to throw when holding a glove, and **E** to detonate remote balloons. On mobile use the dedicated D-pad and balloon/action buttons.
5. Explosions travel in four grid directions; solid walls block them and crates are destroyed. Pickups can increase speed, range and capacity or unlock kicking, throwing, remote detonation, shields and temporary invulnerability. Trapped teammates are rescued by touch; opponents can eliminate them.
6. The server declares the winner. The host can choose rematch, or people can return to the public lobby.

## Features

- **Real multiplayer:** authoritative FastAPI/WebSockets server with up to eight players, predictable 30 Hz simulation, ~12 Hz state broadcast, room codes, lobby/ready states, host controls, team or free-for-all results and chat.
- **Anonymous identity:** random guest cookie with an independently HMAC-signed, HttpOnly reconnect token. Nickname/avatar and audio settings stored on the browser; no IP address or browser fingerprinting as identity.
- **Reconnection:** 38-second disconnect grace, replacement socket for an already-known guest, 38-second slot retention, no state-changing trust of client-supplied coordinates or wins. Messages are size- and rate-limited, movement is validated and server cooldowns apply.
- **Visuals:** kit-based pixel sprites and real original UI button assets, 8 maps using all 8 floor tiles and 10 obstacle assets, animated 4-frame balloons and 6-frame water-burst effects, fullscreen Canvas board with mobile following camera.
- **Audio:** all 11 WAV files used, original lobby-loop music, event-driven sound effects, separate music/SFX volume and mute switches; playback starts only after user interaction.
- **Renderer:** no client-side framework dependency, Canvas2D with nearest-neighbor sprites and `requestAnimationFrame` (target 60 FPS). Pixel rendering does not affect server tile collision rules.

## Technical layout

```text
main.py                     FastAPI QPyServe game logic, validation, WebSocket server
frontend/index.html         PC-style lobby, room and game UI
frontend/style.css          Desktop / iPhone-first responsive styling
frontend/game.js            Canvas renderer, sprite registry, lobby, input, audio
frontend/assets/            ALL 60 supplied individually usable PNG/WAV files
frontend/assets/asset_manifest.json   Asset registry source
reference/                  5 design reference boards + 2 preview sheets (not game textures)
docs/ASSET_KIT_README.md    Original reference kit README
reference/ASSET_AUDIT.md    Inventory and normalization notes
render.yaml                 Render blueprint configuration
tests/                      Server, transport and sprite-asset tests
```

## Run locally

Python 3.12+:

```bash
python -m pip install -r requirements.txt
python main.py
```

Open http://127.0.0.1:10000. On Render, the command is `python main.py --prod` and port is the `PORT` environment variable. QPyServe serves frontend and backend from the same origin and supports WebSocket routes. **Single worker and single instance** are intentional: room state is held in process memory.

Tests:

```bash
python -m pip install pytest httpx
python -m pytest -q
node --check frontend/game.js
```

## Hosting constraints

The `render.yaml` is configured for free-tier testing on Render (Ohio region). Free instances can sleep and restart; rooms and scores are **volatile** and reset on instance restart. Reconnection only works while a room survives on the same server process. Stable identity across Render process restarts requires `BB_AUTH_SECRET` (a secure secret you configure in Render), plus a persistent player store if you need historical scores/nicknames in the cloud. A browser local ID is kept within its own browser profile and is lost if cookies are deleted.

For production-scale competitive play, add PostgreSQL or Redis for room state and presence, multi-instance routing, telemetry, abuse reporting, matchmaking fairness, anti-lag measurements and load tests. The default implementation is suitable for a small friend group on one service, not a large esports-scale release.

## Historical reference and rights

2007 version and remote controls: https://thanhnien.vn/boom-online-ra-mat-phien-ban-moi-nhat-103-185191079.htm

2007 launch and gameplay overview: https://dantri.com.vn/cong-nghe/boom-online-gia-nhap-lang-game-viet-nam-1174700775.htm

The historical reference screens included in the supplied kit are targets for proportions and atmosphere, not redistributable game assets. This is an independent arcade game with original provided art/music, not a verified pixel-perfect reproduction of an unauthorized client.
