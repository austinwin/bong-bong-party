# Render deployment

Deploy **a single Python web service** from `austinwin/bong-bong-party`, branch `main`, using the included `render.yaml` settings:

- Plan: free for friend testing, Ohio region.
- Build: `pip install -r requirements.txt`.
- Start: `python main.py --prod`.
- HTTP health check: `/api/health`.
- Environment: `PORT` supplied by Render; configure `BB_AUTH_SECRET` as a long random secret in Render Settings → Environment (never commit secrets).
- WebSockets: `wss://<render hostname>/ws/<room code>` behind the same HTTPS origin.

Never configure multiple worker processes or instances without adding a shared room-state and pub/sub layer. Existing guest reconnect cookies minted under an ephemeral signing key are invalidated by a restart, so configure `BB_AUTH_SECRET` before inviting friends if durable reauthentication is desired.

For basic verification, open the site in two separate browser profiles, choose different characters, join the same room, set ready, start, move both simultaneously, place bombs, test a blast and rescue, and reload one profile during the 38-second reconnect window. Verify audio on a real mobile browser after tapping Play, and check that image and WAV URLs under `/assets/` return successfully.

**Free-tier limitations:** cold starts, no persistent in-process rooms on restart, limited concurrent capacity, and no guarantee of stable pings. No Supabase database is needed for transient friend matches. Add one only for cross-session leaderboard, inventory or multi-instance matchmaking.
