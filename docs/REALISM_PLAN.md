# Realism and 10× resolution plan

Status: approved 2026-10-17. Phases ship independently; progress is tracked in the **Progress** section at the end.

## Context

**Where we are.** Voxel Kherson works and is live, but it looks flat:
- The world is one 2 m voxel grid.
- Walls are single-colour slabs: no windows, floors or entrances.
- Roads are grey cells: no markings, kerbs, crossings or lamps.
- Diagonal streets and building outlines are staircased at 2 m.
- No ambient occlusion, no shadows and no tone mapping.
- Tree crowns look like smooth slabs up close.

**What prompted it.** The user compared the site with *ukraine-ride* (a Canvas-2D pseudo-3D game that uses AI-painted pixel-art facades and tree cut-outs). They asked for a plan covering the four realism phases, plus **at least 10× finer resolution**.

**Decisions taken with the user (2026-10-17):**
- **Resolution:** 0.2 m micro-voxels, generated in workers near the camera from compact OSM vector tiles. The existing 2 m voxel world stays as the mid/far LOD. Surface shaders add 5–10 cm detail.
- **Art direction:** realistic daylight (sun shadows, ambient occlusion, tone mapping, haze). Time of day comes later.
- **Plan home:** this document.

**Spike results (already done, then reverted).**
- **Procedural facade in the wall shader:** worked first time on all 12,900 buildings.
- **Pixelated rendering:** added little, so it is dropped.

**Measured data volume.** Vector tiles will be small:

| Layer | Ways | Vertices |
|---|---|---|
| Buildings | 12.8k | 88k |
| Highways | 10.8k | 67k |
| Areas | 5.8k | 72k |

That totals about 230k vertices, roughly 1.5 MB.

**OSM data available:**
- 1,928 buildings with `building:levels`, 226 with `height`, and 184 with `roof:colour`;
- 476 named shop/amenity nodes;
- 1,118 roads with `lanes`;
- 1,255 crossings, 189 street lamps, 154 traffic signals and 309 bus stops.

## Target architecture: three detail tiers

| Tier | Distance (desktop / phone) | Source | Resolution |
|---|---|---|---|
| **Fine** (new) | 0 to 150 m / 0 to 70 m | vector tiles, then worker generation | 0.2 m geometry, plus ≤10 cm shader detail |
| **Coarse** (existing chunks) | 150 to 640 m / 70 to 384 m | `r_*.bin` 2 m cells | 2 m, with a procedural facade shader |
| **Overview** (existing) | beyond | `overview.bin` | 16 m |

- **Unit of fine generation:** the existing 64 m chunk, so swaps happen chunk by chunk. When a fine chunk is ready, the streamer hides that coarse chunk's mesh. Water stays a separate mesh. Hysteresis: generate within R + 32 m, swap at R, drop beyond R + 64 m.
- **Building ownership:** each building or road piece is stored once, in the region of its anchor (polygon centroid, or the midpoint of a road segment of 64 m or less). A fine job reads the 3×3 region neighbourhood and takes the items whose bounding box overlaps its chunk. Each building is generated whole by the chunk that owns its centroid.
- **Physics:** a new `FineWorld.heightAt` uses the fine ground raster (including kerbs) and building polygons where the fine tier is loaded, and falls back to the coarse `WorldStreamer.heightAt` elsewhere. Kerbs (0.15 m) are within the existing step-up.

## Step 0: document and constitution amendment (Opus)
- Commit this plan as `docs/REALISM_PLAN.md` and link it from the README. ✅
- Amend `CONSTITUTION.md` Article 4 in its own commit, before any code. Approving this plan counts as the owner's approval.

  | Budget | Desktop | Phone |
  |---|---|---|
  | Scene triangles | ≤ 2.5M | ≤ 0.9M |
  | Draw calls | ≤ 400 | ≤ 200 |
  | Fine-tier radius | 150 m | 70 m |
  | Shadows | on (2048 map, about 200 m) | off by default |
  | Baked world | ≤ 30 MB | same |

- Add a **quality setting** (High/Low) so phones can opt in or out. Touch parity and i18n apply.

## Phase 1: light and facades (coarse tier)
**Goal:** the biggest visible change, with no data-format break.
- **Vertex ambient occlusion** in `src/world/mesher.ts` (`QuadBuilder`): classic per-corner voxel AO, using 3 neighbour samples per vertex from the cells, with region-edge data from the existing `RegionEdges` mechanism. Add a `color`-multiplied AO term, and flip the quad diagonal to avoid anisotropy.
- **Shadows** in `src/main.ts`: the sun `DirectionalLight` with `castShadow`, its orthographic frustum following the camera and snapped to texels to stop shimmer; PCF soft shadows. Coarse chunks within 250 m, vegetation near/mid and birds cast shadows; everything receives them. Vegetation's custom `onBeforeCompile` sway also needs a matching `customDepthMaterial`.
- **Tone and sky:** `ACESFilmicToneMapping` with exposure tuned; a sky dome with a gradient-and-sun shader (new `src/world/sky.ts`); fog colour matched to the horizon; hemisphere and sun intensities rebalanced.
- **Facade styles:**
  - Extend `MAT` (`src/world/materials.ts`) with wall-style ids, appended only, so the change stays backward compatible: `WALL_KHRUSH` (5-storey silicate brick), `WALL_PANEL` (9+ storey panel), `WALL_STALIN` (stucco plus cornice), `WALL_HISTORIC` (pre-1917 brick/stucco in pastels), `WALL_MODERN` (glass bands), `WALL_GARAGE`. Keep `WALL_HOUSE`, `WALL_INDUSTRIAL` and `WALL_CHURCH`.
  - `buildingSpec` in `tools/bake.ts` picks the style. It uses `building:architecture` and `building:levels` when present; otherwise the type plus a historic-centre radius around Freedom Square (≤3 levels, so historic), plus a hash for ties. The heuristic is documented in code, per Article 2.1.
  - Per-building palette variation comes from a hash of the building id, stored in a free bit range of the wall material, or as a new `MAT` per palette, whichever keeps the byte budget.
- **Facade shader:** generalise the spike in `groundNoise()`, `src/world/streamer.ts`, into `src/world/facade-shader.ts`.
  - Per style: floor height, bay width, window shape, plinth, a cornice at the building top, entrance bays, shop fronts and lit windows.
  - The building top comes from a new per-vertex attribute `aTop` that `QuadBuilder.wallX/wallZ` already knows (`yb`).
  - Detail fades with distance (`fwidth`) to avoid shimmer.
- **Ground shading:** asphalt grain, sidewalk tile grid and plaza paving in the same shader, all world-space procedural.
- **Tests:** AO values at known corners (mesher test); `buildingSpec` style selection is deterministic; materials compile with no shader errors (smoke test through a headless screenshot).

## Phase 2: fine tier engine and streets (0.2 m)
**Vector tiles: new shared contract `src/world/vector-format.ts`.**
- One `v_<rx>_<rz>.bin` per region, magic `VKV1`.
- Coordinates are u16 in centimetres relative to the region origin (512 m = 51,200).
- Layers:
  - **buildings:** rings and holes, height (cm), min height, levels, style, palette, roof shape and colour, id hash, name index;
  - **roads:** polyline, class, width, lanes, oneway, surface, bridge/layer, tram flag, sidewalk flag;
  - **areas:** polygon and ground material;
  - **lines:** barrier fence/wall/hedge, railway, tram;
  - **points:** lamp, crossing, traffic signals, bus stop, entrance, shop/amenity with a name index;
  - a UTF-8 string table.
- Encode and decode with round-trip tests. `manifest.json` gains `vectors: true`, and the client tolerates its absence.
- The bake emits the tiles from the same parsed OSM in `tools/bake/osm.ts`, deterministically.

**Fine generator: `src/fine/`, pure and testable, running in workers.**
- `ground.ts` rasterises a 320×320 cell grid (0.2 m) per chunk:
  - **base:** the coarse cell's groundMat and groundH;
  - **areas:** painted on top;
  - **roads:** buffered polylines (width from the tag, or a class default × lanes) give asphalt;
  - **sidewalks:** 2–3 m bands outside the carriageway for residential and higher classes unless `sidewalk=no`, plus footway lines;
  - **kerbs:** sidewalks raised 0.15 m;
  - **markings** as material ids: centre dash (3 m on, 6 m off), lane separators from `lanes`, edge lines on primary and secondary roads, zebras at crossing nodes perpendicular to the road, stop lines at signals;
  - **tram rails:** 1524 mm gauge.
  - Greedy meshing per (material, height), reusing the `QuadBuilder` pattern from `src/world/mesher.ts`, with AO. Side walls are emitted at height steps, including at the chunk border using neighbour coarse cells, so there are no seams with coarse chunks.
- `streamer.ts`, a new `FineStreamer`: loads vector tiles (LRU), schedules fine jobs on the worker pool (a message type is added to `mesher.worker.ts`), and calls a new `WorldStreamer.setChunkHidden(cx, cz, hidden)`. It reports triangles and draw calls to the dev HUD.
- **Bridges:** bridge decks are generated from `bridge=yes` roads in the fine tier; coarse `FEATURE_BRIDGE_DECK` stays for the coarse tier.
- **Physics:** `FineWorld.heightAt` and the wall test, wired into `src/player/walk.ts` and `fly.ts` through the existing world interface.
- **Tests:**
  - vector-tile round trip;
  - road buffering width;
  - zebra orientation;
  - kerb height;
  - seam continuity (fine border heights equal coarse);
  - determinism, with a byte-identical fine mesh for the same input;
  - walk never falls through fine ground.

## Phase 3: buildings and bridges as 1 m blocks, signs and detail

*Revised 2026-10-18 with the owner:* buildings and bridges become **1 m voxel blocks** (2× finer than the 2 m world, 4× fewer triangles than 0.5 m), replacing the earlier 0.2 m wall-relief idea. Finer detail (frames, glass, lit windows, paving) stays in the shader.

- **Tier:** within 250 m on desktop and 100 m on phones (High quality), generated in workers from the vector tiles already shipped in Phase 2 (no new data). Beyond that, 2 m blocks with the facade shader.
- **Seamless chunks:** each 64 m chunk voxelises *every* building and bridge piece that overlaps it on the global 1 m grid (`src/fine/volume.ts`), so parts generated by neighbouring chunks meet exactly. The coarse chunk's structures (walls, roofs, bridge decks) are hidden with a draw range (ground stays), per chunk, with no extra draw call.
- **Buildings (`src/fine/buildings.ts`):** footprint rasterised at 1 m (point in polygon at column centres, holes respected), exact height and min height, floors from levels or style. Per-style facade rules carve one block deep: window openings with glass at the back and sills, entrances with canopies, ground-floor shop fronts, cornice and plinth courses sticking out one block, balconies on khrushchevka, panel and Stalinist blocks. Roofs: flat with a parapet, stepped gable or hip for houses, dome or cupola for churches, `roof:colour` when tagged. Window positions come from world-space wall coordinates, so they line up across chunk borders.
- **Bridges (`src/fine/bridges.ts`):** a deck slab along `ROAD_BRIDGE` roads at the coarse deck height, with kerbs and railings and piers down to the river bed every ~40 m, plus ramps at the ends.
- **Shader:** carved blocks tell the facade shader not to paint procedural windows; glass faces get the sky-reflection and lit-window shading.
- **Physics:** the walk/fly world uses the 1 m building columns where loaded, so you stop at the real wall.
- **Signs:** a `CanvasTexture` atlas of Ukrainian shop and amenity names (system font, Article 1.3) on quads above shop fronts.
- **Tests:** chunk-border continuity, watertight blocks, window grid aligned with floors, triangle bounds per style, deterministic output, physics stops at walls.

## Phase 4: 10× everywhere near (vegetation, props, surface detail, polish)
- **Trees and bushes:** a new near LOD at 0.2 m in `src/nature/models.ts`.
  - Branch skeleton plus sparse leaf clusters with gaps, so it is not a solid blob; at most 6k triangles per tree.
  - Used within 40 m (25 m on phones). Existing 0.5 m, 1 m and box LODs move outward.
  - A leaf cut-out pattern in the shader (alpha test at about 5 cm, near only).
  - Tree-crown AO and darker interior voxels.
- **Props** (`src/fine/props.ts`, instanced micro-voxel models like vegetation):
  - street lamps: 189 from OSM, plus generated every 25–35 m along lit road classes, alternating sides;
  - bus shelters (309);
  - traffic lights (154);
  - benches and bins along park paths;
  - fences and walls from `barrier` lines and house plots;
  - bollards at pedestrian plazas.
- **Surface micro-detail at 10 cm or less:** brick courses and mortar, plaster noise and stains, panel seams, asphalt cracks and patches, paving pattern, grass tufts. All are procedural and fade by distance.
- **LOD polish:** cross-fade the fine and coarse swap with dithered alpha over 0.3 s; a performance pass against the amended budgets; phone tuning.

## Delegation (Article 9)

| Work | Who |
|---|---|
| Plan doc, constitution amendment, format specs, integration in `src/main.ts`, every review, all verification, commits and deploys | **Opus** |
| Phase 1 AO, shadows, sky and facade shader; Phase 2 `FineStreamer` and ground raster; Phase 3 1 m buildings, bridges and facade rules; Phase 4 0.2 m trees | **Sonnet** |
| `vector-format.ts` and tests, `signs.ts` atlas, `props.ts` models, `sky.ts` | **opencode mimo-free** (one run at a time) |
| Fallback | **Haiku**, when mimo fails twice |

Parallel agents never share files. Each spec names its files, interfaces and acceptance commands.

## Rollout
- Each phase is independently deployable and goes to `main` only after all checks pass.
- The fine tier sits behind the quality setting and `?fine=0|1`, so it can be compared and rolled back.
- **Critical files:**
  - `src/world/mesher.ts`, `streamer.ts`, `materials.ts`, and the new `facade-shader.ts`, `sky.ts`, `vector-format.ts`;
  - `src/fine/*` (new);
  - `tools/bake.ts` (`buildingSpec`, vector emission);
  - `src/nature/models.ts`, `vegetation.ts`;
  - `src/player/walk.ts`, `fly.ts`;
  - `src/main.ts`, `src/i18n.ts`;
  - `CONSTITUTION.md`, `README.md`, `docs/DEPLOYMENT.md` (size table).

## Verification (every phase)
1. `npm test`, `npm run bake` and `npm run build` all pass. Bake stats print the vector-tile size, and the total stays within 30 MB.
2. **CDP screenshots, before and after, at fixed poses:**
   - Freedom Square spawn;
   - Ushakova Avenue at street level;
   - a khrushchevka yard;
   - the embankment and river;
   - a church;
   - the aerial view `?mode=fly&x=10900&z=9900&y=180&yaw=135&pitch=-22`.
   Also: phone emulation, both languages, and `?fine=0` against `?fine=1`.
3. **Specific visual checks:**
   - Phase 1: AO is visible at wall bases; shadows don't shimmer while moving (two-frame diff while stationary).
   - Phase 2: no seams at the fine/coarse border; kerbs and zebras are visible; walking over kerbs works.
   - Phase 3: no seams at chunk borders or at the 1 m / 2 m switch; windows line up with floors; signs are readable.
4. **Performance:** dev HUD triangles and draw calls at the four poses, against the amended budgets. Ask the user for real-device fps on desktop and phone, and record it in the Constitution (an open item).
5. Push, watch the Pages deploy go green, then take a live-site screenshot.

## Progress

| Step | Status |
|---|---|
| 0. Plan document and constitution amendment | done |
| 1. Light and facades | done (AO, shadows, ACES, sky, facade styles + shader, quality toggle) |
| 2. Fine tier engine and streets | done (vector tiles 1.7 MB, 0.2 m ground: roads, kerbs, markings, zebras, tracks; coarse ground stays underneath to cover T-junction cracks; bridges still coarse) |
| 3. Buildings and bridges as 1 m blocks, signs and detail | blocks and bridges done (250 m, 128 m merged tiles, carved windows, balconies, cornices, roofs, piers); shop signs still to do |
| 4. 10× everywhere near | not started |
