# Render deployment

Use the existing Render web service for `austinwin/bong-bong-party` on `main`. The Blueprint defines one Python service, one instance, and the free Ohio plan. It sets the build and start commands and can generate a private `BB_AUTH_SECRET` at provisioning time. For a directly managed existing service, set that variable once in Render so signed guest cookies survive deploys. Changing the signing key invalidates earlier guest cookies.

| Setting | Value |
| --- | --- |
| Build | `pip install -r requirements.txt` |
| Start | `python main.py --prod` |
| Health | `/api/health` |
| WebSocket | `/ws/{room-code}` |
| Auto-deploy | After CI checks pass when the repo is connected |

Render provides `PORT` and `RENDER_GIT_COMMIT`. Compare the health response's `revision` with the expected GitHub commit. Check a WAV endpoint and run the browser suite against the public hostname before calling a release live.

The free service can sleep. Restarts and deploys reset in-memory rooms and scores. Use a single QPyServe worker and a single Render instance while room state resides in process memory.
