# Deployment checklist

The source is intentionally a standalone project; it is not connected to other games or websites.

1. Create a new, empty GitHub repository named `bong-bong-party` and place the contents of this folder at its root (including the hidden `.github` folder). Push to `main`.
2. Select the intended Render workspace. Create a Python Web Service from the repository, or create a Render Blueprint from `render.yaml`.
3. Use the included defaults: Free plan for previews, Ohio region, build `pip install -r requirements.txt`, start `python main.py --prod`, health-check `/api/health`.
4. Open the deployed URL, create a room, and connect from an incognito window or another device. Verify movement, bombs, chat, music, restart and mobile touch controls.
5. If moving beyond a hobby test, upgrade from Free, externalize room/session and score storage, and test with actual concurrent players.

**Important:** one worker only. Render Free spins down after periods of inactivity. Score history and rooms do not survive service restarts. Browser cookie identities and local nickname preferences do survive in the same browser as long as the user retains that local browser data.
