# Costume and scenery artwork

The atlases were created with built-in ImageGen, then sliced into transparent sprites. The original reference boards and 64 px characters remain in the repository.

## Costumes

Reference file `reference/00_reference_boards/character_concept_sheet.png`. Output files are in `frontend/assets/10_costumes`.

> Generate a production game sprite atlas for the exact eight original chibi costume designs in the supplied concept image. The input is a visual design reference. Single atlas, precisely an aligned grid of four columns and two rows with transparent gutters and generous clear margins per cell so it can be cut into eight isolated sprites. Only the large costumes in the reference, no small turnaround sprite rows, no headings, no text, no other props, no shadows outside costumes, no borders. Order: top left orange fox with blue aviator goggles and cream-tipped tail, top second apple-green frog hood with big raised eyes and orange cheeks, top third blue cloud-tech with blue curls and white-blue spiral goggles and blue/white jumpsuit, top right purple star wizard with pointed purple hat and gold ornaments. Bottom left pink strawberry pixie with white daisy, green leaves and strawberry curls, bottom second sunny yellow duckling with prominent orange beak, orange boots and blue backpack, bottom third deep violet bat with winged hood and distinct pale skull ornament and red scarf, bottom right turquoise turtle scholar with teal shell cap and round dark glasses and backpack. Friendly original chibi facial proportions from reference, lively faces and outfit details, dark clean outlines, layered warm highlights; cohesive hand-painted 2D early-2000s game look, slightly top-down front 3/4 game view, boots aligned to a common baseline within each cell, full body, equal occupied heights, heads oversized. Keep items separated on fully transparent alpha, visually sharp and readable when resized to a 48px player in a game. No new costume design, preserve distinctive reference design and color per cell.

## Scenery

Reference file `reference/00_reference_boards/tiles_powerups_and_blasts.png`. Output files are in `frontend/assets/11_scenery`.

> Use the supplied retro water balloon arcade asset reference board as style reference. Output one production game sprite atlas with SIX completely isolated environmental props precisely centered in a clean 3 columns x 2 rows even grid, transparent background and transparent gaps, no text or other objects. Top row L-R: small Vietnamese village cottage with a red-orange tile roof and leafy wall, round broad-leaf emerald green topiary bush with three lobes, chunky glossy red-and-ivory mushroom with a cream stem. Bottom row L-R: tiny blue-tiled-roof village shelter with one golden window, small cyan icy conifer with snow layers, tropical palm tree with very broad leaves and a short trunk. Slightly top-down 2D casual arcade game asset, hand-painted smooth thick outlines, broad color groups and gentle top-left highlights, round and expressive claylike shapes, cohesive vibrant saturated colors, no ground, no drop shadow outside the silhouette, no watermark. Equal cell padding, each object fits fully in its cell. Playful 2000s PC game visual language. The objects will sit outside the playable grid as scenery.

## Directional movement

The standing costume atlas defined the outfits. The side stride atlas also served as the reference for the contact frame. The aligned 160 × 160 transparent WebP sprites are in `frontend/assets/12_motion`.

> Preserve all eight costumes, silhouettes, colors, facial proportions and costume details from the reference. Use a four-column, two-row atlas with transparent gutters. Place fox, frog, cloud and wizard on the top row, then berry, duck, bat and turtle. Keep the complete figures in their cells with no labels, shadows or ground.
>
> North stride. Show the characters running away from the viewer, with the rear of each costume and its backpack or tail visible.
>
> Side stride. Show all characters running to the right at a three-quarter angle, with staggered feet and pumping arms.
>
> South stride. Show the characters running toward the viewer with one boot raised and arms pumping.
>
> Side contact. Keep the same side angle and put the feet close to the body's center, with one boot planted and the trailing knee bent. Lower the torso slightly and reverse the arm swing when visible. Match the silhouette and head size so the renderer can alternate these frames within a step.

### Complementary footfalls

Four atlases were made with built-in ImageGen from the existing directional artwork. The rear poses share the original head and torso registration. The front pose uses the new lower body with the original face and accessories. The 32 added transparent frames are in `frontend/assets/12_motion` as `*-north-other.webp`, `*-north-settle.webp`, `*-south-other.webp`, and `*-side-other.webp`.

> Walk-cycle correction of the supplied back-facing animation atlas. Keep all eight walking directly AWAY from camera with the same costume and left/right accessory placements. Change which leg is extended, with the boot on the viewer's LEFT occupying the obvious long rear extension and showing the full ribbed sole, and the boot on the viewer's RIGHT tucked high near the body. Every character shows the same left-foot phase. Swing the two arms reciprocally. This must be the plain opposite footfall with the big rear sole specifically on the left of each character's center. Do not mirror the underlying heads, tails, bags, or hat accessories.

> Edit to a back-facing contact/pass pose for eight running animation sprites. Every character still looks straight AWAY, the way a top-down game appears when moving north. BOTH boots are visibly short, their heel edges nearly level and immediately underneath the hips, soles mostly hidden. No long extended leg. Arms relaxed closer to sides as they pass beneath the torso, rear waist position exactly matched. Keep cozy bouncy chibi appeal. The central alignment of the head, view angle and outfit design should very closely match the atlas. Preserve asymmetry of scarves, hats and tails.

> Edit this front-facing walking atlas for the opposite footfall. All eight chibi characters look toward us, with their heads, outfits, face scale, body center, and actual left/right accessory placements preserved. Move the big visible sole to the viewer's LEFT on every costume and make the boot on the RIGHT tuck back. Swap arm reach while preserving which side has the backpack or tail. Use lively happy rounded open-mouth smiles, only within each character's existing expression style. Show a clear alternating animation at game scale. No horizontally mirrored heads or accessories.

The first three prompts shared this guidance.

> Keep the exact eight costumes, transparent silhouettes, colors, outlines, camera angles, character scales and fully visible framing, in four columns by two rows with clear transparent gutters. Row 1 orange fox, green frog, blue cloud engineer, violet star wizard. Row 2 strawberry pixie, yellow duck, violet bat, teal turtle with backpack. No scene, ground, shadow, text, effects or extra objects. Export an RGBA atlas with transparent background. Preserve the shape of each head, head accessories and position of asymmetric details such as fox tail and wizard hat tassels. Keep the torso center and scale fixed and the hips visible over the legs, so the images can be alternated in a small sprite run cycle.

> Make the opposite stride animation frame of this exact eight-costume game sprite atlas. All figures stay facing RIGHT at the original right-facing three-quarter angle and positions. Only articulate the legs and swing the arms. In the reference, the larger near boot reaches toward screen right and the small far boot trails left. Swap leg depth: the larger near boot now sweeps toward screen LEFT behind the hip, clearly visible with a smudged sole, and the smaller far boot reaches ahead toward screen RIGHT; reverse the arm swing accordingly. Show both boots clearly and keep the hip, head, expressions, eyes, tails, headwear, backs and outfit silhouettes anchored to the reference. This is for alternating poses in a run cycle; stable upper-body alignment and crisp contour matter much more than a fresh redraw. Cute playful chibi energy. Four columns, two rows, original exact order orange fox, green frog, blue cloud engineer, purple wizard, then strawberry pink, yellow duck, violet bat and teal turtle. Transparent background and gutters. No ground, external shadow, border, effects or text.
