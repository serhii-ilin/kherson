# Voxel Kherson · Воксельний Херсон

A walkable voxel model of the whole city of Kherson, Ukraine, built from OpenStreetMap data and running entirely in the browser.

**Live:** https://serhii-ilin.github.io/kherson/

You can walk the streets of the centre or fly over the Dnipro. It has:
- tree-lined streets, parks and bushes;
- doves on the squares and swifts over the roofs;
- waving water on the river and lakes;
- an ambient summer soundscape.

The interface is Ukrainian by default, with English available.

## Features

- **The city of Kherson only**, limited to its OSM boundary (relation 2175078, plus a 20 m margin): about 10,100 buildings, the road and tram network, parks and landuse. Suburbs and villages (Oleshky, Chornobaivka, Komyshany, ...) are not baked. The Dnipro, Koshova, the islands and the natural floodplain (forest, scrub, sand) around the city stay. It is rasterised from OSM at 2 m per voxel.
- **Streaming world.** Region files load and mesh around the camera in Web Workers. A low-resolution overview mesh fills the horizon.
- **Walk and fly modes**:
  - **Walk:** gravity, step-up, collision with buildings, tree trunks and water.
  - **Fly:** free flight that cannot pass through the ground or buildings.
- **Touch controls** for phones and tablets: virtual joystick, look-drag, and up/down/mode buttons.
- **Nature**:
  - **Trees:** about 340k trees of seven species, built from 0.5 m micro-voxels with three levels of detail and wind sway. They include about 119k street trees.
  - **Bushes:** about 200k, including flowering lilac and pink bushes.
  - **Water:** tessellated with a wave shader, shore foam and sky reflection.
  - **Birds:** boids-driven swift flocks, and dove groups that take off when you approach.
- **Ambient sound**, synthesised in real time with WebAudio (no audio files): songbirds, screaming swift fly-bys with Doppler shift, cooing doves, wind and water. There is a mute toggle.
- **UI**:
  - Places search and teleport, covering 209 named places, in Cyrillic or Latin.
  - A minimap.
  - A language switcher (УКР | EN).
  - Shareable URL poses.

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Look | click the view, then move the mouse | drag on the right half |
| Move | `W` `A` `S` `D` / arrow keys | joystick on the left half |
| Sprint | `Shift` | push the joystick to the edge |
| Jump (walk) / up (fly) | `Space` | ▲ |
| Down (fly) | `Q` or `C` | ▼ |
| Toggle walk / fly | `F` | ✈ |
| Zoom the minimap | click the minimap | tap the minimap |

### URL parameters

| Parameter | Meaning |
|---|---|
| `x`, `z` | world position in metres (origin at the NW corner of the bbox, `+x` east, `+z` south) |
| `y` | camera height in metres (fly mode) |
| `yaw`, `pitch` | view direction in degrees (`yaw` 0 = north, positive turns left) |
| `mode=fly` | start in fly mode |
| `lang=uk` / `lang=en` | interface language |

Example: `?mode=fly&x=10900&z=9900&y=180&yaw=135&pitch=-22`

## Quick start

Requirements: **Node.js 24+**. The data tools run TypeScript directly via `--experimental-strip-types`; CI uses Node 24.

```bash
npm ci
npm run bake      # OSM snapshot → public/world/ (~2–5 s, ~16 MB)
npm run dev       # http://localhost:5173/kherson/
```

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | type-check (`tsc --noEmit`) and production build to `dist/` |
| `npm run preview` | serve the production build |
| `npm test` | Vitest unit tests |
| `npm run bake` | convert `data/osm/kherson.json.gz` into region files, overview and places |
| `npm run fetch-osm` | download a fresh OSM snapshot from Overpass (tiled, with retries) |

## How it works

```
data/osm/kherson.json.gz  ──bake──►  public/world/            ──►  browser
(committed OSM snapshot)             manifest.json                 WorldStreamer (regions by distance)
                                     r_<rx>_<rz>.bin  (RLE)        mesher workers (greedy meshing)
                                     overview.bin                  Overview LOD, Vegetation, Water,
                                     places.json                   Birds, Ambience, Player, UI
                                     v_<rx>_<rz>.bin  (vectors)    FineStreamer (0.2 m ground near the camera)
```

- **World grid:** 1 voxel is 2 m. A chunk is 32 × 32 cells (64 m); a region is 8 × 8 chunks (512 m), giving 36 × 31 regions.
- **Cells (2.5D columns):** each cell stores 5 bytes: ground material, ground height, structure height, wall material and roof material.
- **Features:** region files also carry a list of features (trees, bushes, bridge decks), each with a species and a seed. Vegetation is rendered with instancing, separately from the voxel grid.
- **Fine tier:** within 150 m of the camera (High quality), workers rebuild the ground at 0.2 m from per-region vector tiles: real road widths, raised sidewalks with kerbs, lane markings, zebra crossings and tram rails. Within 250 m, buildings and bridges are rebuilt as 1 m blocks with carved windows, entrances, balconies, cornices, pitched roofs, domes, decks, railings and piers.
- **Determinism:** the bake is deterministic. Every random choice is a hash of the coordinates or the OSM id, so the same snapshot always yields the same world.

### Project layout

```
src/
  main.ts               bootstrap, frame loop, wiring
  i18n.ts               Ukrainian/English strings, language switcher
  world/                format, mesher (+worker), streamer, overview LOD, materials, geo
  nature/               vegetation + models, water shader, birds, procedural audio
  player/               input, walk physics, fly, touch controls, controller
  ui/                   places menu, minimap, styles
tools/
  fetch-osm.ts          Overpass download (tiled, cached in data/osm/tiles/)
  bake.ts, bake/        projection, rasterisation, species placement, encoding
tests/                  Vitest unit tests
docs/DEPLOYMENT.md      build, deploy and data-refresh guide
docs/REALISM_PLAN.md    realism and 10× resolution roadmap
CONSTITUTION.md         project principles, budgets and working rules
```

## Documentation

- [Deployment](docs/DEPLOYMENT.md): GitHub Pages, CI, refreshing map data, troubleshooting.
- [Constitution](CONSTITUTION.md): principles, performance budgets, code and contribution rules.
- [Realism plan](docs/REALISM_PLAN.md): roadmap for lighting, facades, streets and 0.2 m near-camera detail.

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). The baked world in `public/world/` is a derived database and stays under ODbL.

The OSM data reflects what mappers have recorded. Damaged or destroyed structures, such as the Antonivskyi bridge, are shown as OSM records them.

## License

No license has been chosen for the source code yet, so all rights are reserved by the author until one is added. The map data is ODbL; see above.
