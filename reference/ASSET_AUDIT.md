# Supplied asset-kit inspection

Original upload: `Bubble_Arena_2007_Design_Reference_Kit(1).zip`

SHA-256: `603998596bbfa813c12ab9f13b0baf5ffc13526e8ad756a7cde53fa77d4da181`

## Complete inventory

| Source directory | Supplied | Application use |
| --- | ---: | --- |
| `01_characters` | 8 PNG | Fallback art for the player chooser, match, roster and room slots |
| `02_floor_tiles` | 8 PNG | All eight stage floors |
| `03_obstacles` | 10 PNG | Solid pillars and destructible decorations across maps |
| `04_powerups` | 9 PNG | Visible and collectible power-ups; server logic implements all nine |
| `05_water_balloons` | 4 PNG | Fuse/pulse animation |
| `06_water_blasts` | 6 PNG | Blast animation and trapped-player water outline |
| `07_ui` | 4 PNG | Join/ready/start/cancel controls, matching built-in text artwork |
| `08_audio` | 11 WAV | Lobby loop + 10 effects and victory/defeat sounds |
| `00_reference_boards` | 5 images | Design comparison only, not used as in-game assets |
| `09_previews` | 2 images | Design comparison only, not used as in-game assets |

**Audit finding:** `character_concept_sheet.png` and `full_2007_inspired_asset_reference.png` had WebP/RIFF content despite `.png` filenames. Original source archive was left unchanged; the reference folder contains losslessly re-encoded valid PNG copies for consistent visualization. None of the 60 playable files had incompatible signatures or zero-sized content. All playable PNG sprites except 4 UI buttons are 64×64 RGBA; UI buttons are 280×70 RGBA.

The eight enhanced costumes in `frontend/assets/10_costumes` are ImageGen redraws based on `character_concept_sheet.png`. The six scenery sprites in `frontend/assets/11_scenery` use `tiles_powerups_and_blasts.png` as their art reference. Both atlases were sliced into individual transparent WebP sprites. Scenery sits beyond the collision grid. See [art prompts](../docs/ART_PROMPTS.md) for the generation brief.

**Aesthetic fidelity:** An early-2007 layout is not fully documented by the supplied reference kit; some historical screenshots date from years later. Matching the blue side panel and tile scale is a design choice, not measured historical pixel-perfect equivalence. Avoid using these original kit prototype sprites as proof of source-client accuracy.
