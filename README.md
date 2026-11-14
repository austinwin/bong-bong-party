# Bong Bong Party

An independent Vietnamese water-balloon arcade inspired by Boom Online. The supplied Bubble Arena kit provides the game's pixel art and synthetic audio. The kit's README documents its provenance.

## Play

1. Pick one of eight characters and edit your nickname. No account is required.
2. Select **Chơi nhanh** to join or create a public queue, **Tạo phòng** to host, or **Vào phòng** with a friend's code. **Tập chơi** opens a one-player practice room.
3. The host selects one of eight arenas and chooses teams or free-for-all. In multiplayer, at least two people must be connected, and everyone besides the host must ready up.
4. Drag the circular joystick to move. Short drags move slowly, and wider drags run. Tap **Đặt bom** with your other thumb, or tap the star to hop and cheer. The status strip shows remaining balloons, water range, and speed. Phones start with the camera following your character. The camera button switches to the full board and remembers your choice. Keyboard shortcuts are **arrow keys** to move, **Space** to place a balloon, **R** to throw with a glove, and **E** to detonate with the remote. The joystick also works with a mouse.
5. Break crates to reveal upgrades. Water traps players in bubbles. Touch a trapped teammate to rescue them or a trapped opponent to eliminate them. The last surviving team or player wins. A round that reaches the time limit is a draw.
6. Check your round totals and choose **Chơi lại** or return to the lobby. **Tập chơi** has an open escape route and a starter crate that always drops a speed pickup. A room with an open slot can admit spectators during a match.

## Run locally

Requires Python 3.12 or newer. Node.js is only used for browser tests.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

Open <http://127.0.0.1:10000>. The production command is `python main.py --prod`.

## Checks

```sh
python -m pip install pytest httpx
python -m pytest -q
npm ci
npx playwright install chromium webkit
PYTHON=.venv/bin/python npm run test:browser
```

Pass `BASE_URL=https://bong-bong-party.onrender.com` to exercise the Render service. The WebKit project uses iPhone 13 browser emulation. The Android Chromium project holds back server snapshots while it checks touch precision, reversals, a neutral stop, and two-finger steering and planting.

## Runtime

- QPyServe runs FastAPI and serves the same-origin Canvas client. The server owns collision, items, ballistics, time and results. A 30 Hz simulation publishes snapshots at roughly 15 Hz in active matches. Each connection has a bounded send queue. The client predicts at most 0.52 tiles ahead and uses the server's input acknowledgement to handle turns and releases. The server and client both limit corner assist to nearby blocked turns. The client interpolates other players.
- A 128-bit random guest ID and a signed reconnect token live in HttpOnly cookies. Nickname, character, audio and camera preferences live in the browser. Players have 38 seconds to reconnect to a surviving room. A replacement socket keeps the player's seat, score and position.
- The service uses one worker and one instance. Rooms, scores and chat are in memory. Render restarts end active matches. Free-tier cold starts can delay the first connection. Supabase is unnecessary for the current transient room model.
- Canvas targets 60 FPS via `requestAnimationFrame`. The renderer caches terrain and advances the run cycle by forward distance, with about four footfalls per second at base speed. Reduced-motion settings disable stride effects and camera easing. The sound settings provide separate music and effects gains, plus optional touch vibration when the browser supports it. Web Audio starts after a tap and can resume after an interruption.
- The original arrangements **Breezy Plaza** and **Splash Rally** use layered mallet, reed, pluck, bass and percussion voices. Both loop, and the result jingle briefly lowers the background music. The supplied kit WAVs remain in use for cues and audio fallbacks. To regenerate the added PCM files, install NumPy and run `python tools/compose_audio.py` from the repository root.

[Asset audit](reference/ASSET_AUDIT.md) · [Historical comparison](docs/VISUAL_QA.md) · [Artwork prompts](docs/ART_PROMPTS.md) · [Render deployment](DEPLOY.md)
