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

- **The city of Kherson only**, limited to its OSM boundary (relation 2175078, plus a 20 m margin): the road and tram network, parks and landuse. Suburbs and villages (Oleshky, Chornobaivka, Komyshany, ...) are not baked. The Dnipro, Koshova, the islands and the natural floodplain (forest, scrub, sand) around the city stay. The Antonivskyi road bridge, which stands just outside that boundary, is included as a narrow corridor along the span and its approaches. It is rasterised from OSM at 2 m per voxel.
- **Streaming world.** Region files load and mesh around the camera in Web Workers. Buildings are extruded from the map footprints (the default). A low-resolution overview mesh fills the horizon. `?renderer=voxel` draws the old blocks instead.
- **Walk and fly modes**:
  - **Walk:** gravity, step-up, collision with buildings, tree trunks and water.
  - **Fly:** free flight that cannot pass through the ground or buildings.
- **Touch controls** for phones and tablets: virtual joystick, look-drag, and up/down/mode buttons.
- **Nature**:
  - **Trees:** about 396k trees of seven species (chestnut, linden, acacia, poplar, willow, pine, plane), including about 74k street trees. The default model is a low-poly trunk and branches with alpha-tested summer leaf cards, four levels of detail, wind sway, and a different colour and scale per tree. `?renderer=voxel` keeps the old micro-voxel crowns.
  - **Bushes:** about 313k, including flowering lilac and pink bushes, drawn with the same leaf cards.
  - **Water:** tessellated with a wave shader, shore foam and sky reflection.
  - **Birds:** boids-driven swift flocks, and dove groups that take off when you approach.
- **Share a link**: the 🔗 button copies a URL for your exact spot and view (`x`, `z`, `yaw`, `pitch`, `time`, plus `mode=fly&y=` when flying).
- **Time of day**: morning, noon, golden evening and a moonlit night with stars, lit windows and glowing street lamps (button next to the language switch, or `?time=HH:MM`).
- **Ambient sound.** Wind and water are synthesised in WebAudio. Common swifts, feral pigeons, collared doves, house sparrows, great tits, blackbirds and starlings use short CC0 / public-domain recordings (mono Opus, with AAC for Safari), loaded after the first click or tap. Other species stay synthesised. Swift fly-bys keep their Doppler shift, and dove groups still trigger the takeoff. There is a mute toggle. Sources are in [docs/AUDIO_CREDITS.md](docs/AUDIO_CREDITS.md).
- **UI**:
  - Places search and teleport, in Cyrillic or Latin: 171 landmarks and 773 streets. The displayed street name is the pre-war one; the current OSM name stays searchable (проспект Незалежності still finds проспект Ушакова). A street result puts you on the street, looking along it.
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
| `time=HH:MM` | time of day (e.g. `22:30` for night) |
| `quality=high` / `quality=low` | rendering quality |
| `renderer=voxel` | draw buildings and trees as voxels (the default is extruded meshes and leaf-card trees) |

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
| `npm run fetch-osm` | refresh the base snapshot from live Overpass (`--date` for an attic instant, `--geofabrik` for the 2022 reference clip, `--from-release` if the base file is missing) |
| `npm run build-restoration` | rebuild `data/osm/restoration.json` from the base snapshot and the 2022 reference |
| `npm run publish-snapshot` | pack the base snapshot, restoration table, 2022 clip and checksums for a GitHub Release (does not upload) |

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
- **Fine tier:** within 150 m of the camera (High quality), workers rebuild the ground at 0.2 m from per-region vector tiles: real road widths, raised sidewalks with kerbs, lane markings, zebra crossings and tram rails. Within 250 m, buildings and bridges are rebuilt as 1 m blocks with carved windows, entrances, balconies, cornices, pitched roofs, domes, decks, railings and piers, plus street lamps, traffic lights, bus shelters, benches, fences and shop signs with their real Ukrainian names. Trees within 40 m use the full leaf-card crown (trunk, branches, alpha-tested leaves). Bark and leaf images are procedural, not KTX2: a Basis transcoder would be another runtime binary, which the constitution does not allow. `?renderer=voxel` switches those crowns back to 0.2 m micro-voxels. High quality casts shadows from the near and mid crowns.
- **Determinism:** the bake is deterministic. Every random choice is a hash of the coordinates or the OSM id, so the same snapshot always yields the same world.

### Project layout

```
src/
  main.ts               bootstrap, frame loop, wiring
  i18n.ts               Ukrainian/English strings, language switcher
  world/                format, mesher (+worker), streamer, overview LOD, materials, geo
  nature/               vegetation + models, water shader, birds, ambience (recordings + procedural beds)
  player/               input, walk physics, fly, touch controls, controller
  ui/                   places menu, minimap, styles
tools/
  fetch-osm.ts          Overpass attic download, or an offline build from a Geofabrik PBF
  bake.ts, bake/        projection, rasterisation, species placement, encoding
tests/                  Vitest unit tests
docs/DEPLOYMENT.md      build, deploy and data-refresh guide
docs/REALISM_PLAN.md    realism and 10× resolution roadmap
docs/PROGRESS.md        progress tracker: phases, open tasks, issues
CONSTITUTION.md         project principles, budgets and working rules
```

## Documentation

- [Deployment](docs/DEPLOYMENT.md): GitHub Pages, CI, refreshing map data, troubleshooting.
- [Constitution](CONSTITUTION.md): principles, performance budgets, code and contribution rules.
- [Progress](docs/PROGRESS.md): phase status, open tasks and known issues.
- [Realism plan](docs/REALISM_PLAN.md): roadmap for lighting, facades, streets and 0.2 m near-camera detail.
- [Requirements](docs/REQUIREMENTS.md): structured requirements (vision, performance, data, realism) and open decisions.
- [Rendering architecture](docs/adr/0001-rendering-architecture.md): why the city becomes mesh levels of detail, and the pull requests that delete the voxel buildings.

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). The baked world in `public/world/` is a derived database and stays under ODbL.

The committed snapshot `data/osm/kherson.json.gz` is the current OpenStreetMap extract, which is fuller than the January 2022 dump: buildings and tree rows mapped after 2022 stay, because they were missing from the old extract, not missing from the city. A restoration table (`data/osm/restoration.json`, regenerated with `npm run build-restoration`) undoes war effects on that base, using Geofabrik `ukraine-220101` (OSM as of **2022-01-01**) as the reference:

- `building=ruins` / `destroyed` / `damaged` and lifecycle prefixes (`abandoned:`, `demolished:`, `was:`, `disused:`, …) that were not already set on 2022-01-01 are put back. A footprint mapped only later and tagged ruins is kept as `building=yes`, not deleted.
- Buildings present on 2022-01-01 and missing now are re-added, unless the same nodes already belong to a current building (a redraw).
- The Antonivskyi road bridge is the pre-war span (tags and node list), drawn in a corridor outside the city polygon.
- Street `name` is the pre-war name. The current name is appended to `old_name`, so search still finds it.
- Checkpoints, barricades, `military=*` and `memorial=war_memorial` objects that are not in the 2022 reference are dropped. Ordinary monuments mapped later are kept.

Manual exceptions go in `data/osm/restoration-overrides.json`. The reference clip is `data/osm/reference/kherson-2022-01-01.osm.pbf`.

Bird recordings in `public/audio/birds/` are CC0 or public domain (no attribution requirement). The source URL, author and licence of each take are listed in [docs/AUDIO_CREDITS.md](docs/AUDIO_CREDITS.md). The running app shows a short “Bird recordings: CC0” line under the map credit.

## License

No license has been chosen for the source code yet, so all rights are reserved by the author until one is added. The map data is ODbL; see above.
