# Realistic pre-war buildings and roads

Status: approved 2026-11-06. Decisions are recorded in [ADR 0002](adr/0002-realistic-buildings.md); progress is tracked in [PROGRESS.md](PROGRESS.md).

## Context

The owner wants buildings and roads to look **photo-realistic, as Kherson was before 24 Feb 2022**, especially in the well-known areas. The data side of "pre-war" is already solved: `data/osm/restoration.json` reverts war edits against the Geofabrik 2022-01-01 extract (10,956 buildings, `building=ruins` 156 → 5). The gap is how things look.

**Buildings today** (default mesh path, `src/mesh/`):
- Every building is an extruded footprint of about 40 triangles: flat walls, one roof shape, a 0.45 m parapet (`extrude.ts:558-669`).
- One shared `MeshStandardMaterial` paints a procedural window grid, cornice band and plinth (`facade.ts`). There are no textures, no window depth, no balconies and no entrances.
- There is one LOD only. Nothing can replace a specific OSM building: there is no building exclusion, and landmarks only suppress props and trees.
- Style comes from heuristics in `tools/bake/building-style.ts`. `building:colour` only nudges the pick to the nearest of 5 pastels. `roof:colour`, `roof:material` and `start_date` are ignored.

**Roads today:**
- 0.2 m ground raster within 150 m (`src/fine/ground.ts`). `surface` is reduced to a paved/unpaved bit, so asphalt, pavers and setts look the same.
- No stop lines, manholes or patches. Trams are separate lines, not tracks set into the road.
- Beyond 150 m, roads are flat 2 m cells (staircased diagonals). All shading is procedural Lambert noise (`src/world/facade-shader.ts:213-290`).

**Owner decisions (this session):**
- **Photo source:** city-wide CC0 PBR materials (ambientCG / Poly Haven), plus hand-built hero buildings referenced from dated pre-war photos. Real facade photos are used as textures where the licence allows.
- **CC-BY-SA:** allowed for photo-derived facade textures only (constitution amendment; settles OQ-08). No owner photos for publishing, so the sources are research only. The private evidence photos are used only to check results (Article 6.6 / 7.5).
- **Hero areas:** all four. Freedom Square, Ushakova Avenue, the embankment with Hotel «Фрегат», and the old town / Fortress.
- **Budget:** a separate asset budget of **≤ 15 MB**, fetched lazily. The baked world stays ≤ 30 MB.
- **Roads:** materials plus street detail, including realistic roads beyond the fine radius.
- **Delegation (Article 9):** Opus plans, researches, verifies and merges. opencode `opencode-go/deepseek-v4.1-flash` implements (`~/.claude/skills/opencode-agents/scripts/oc-run.sh`). A Sonnet agent reviews every diff.

**Outcome:** three tiers of realism.
- **G (generic, the whole city):** real PBR materials, near-LOD window depth, balconies, entrances and roof materials.
- **K (known streets):** per-building facade descriptors (JSON rows researched from photos) built by an architectural kit, for Ushakova and Suvorova.
- **H (heroes):** about 16 bespoke parametric models, some with rectified photo facades.

Roads get real surfaces, worn detail and smooth mid-distance ribbons.

## Step 0: Opus, before any code

1. **Constitution amendment 7** ✅ (a commit touching only `CONSTITUTION.md`; the answers above are the owner's approval):
   - **Article 4:** a new row, "Realistic assets (`public/assets/`): ≤ 15 MB". Materials are fetched at start in the size for the quality setting; facade photos are fetched only within 600 m of their building.
   - **Article 8.2:** photo-derived facade textures may be CC-BY-SA as well as CC0, CC-BY or public domain. The photos must be dated before 24 Feb 2022, with no Google content (DR-08). Each file keeps its licence, and author, source URL, date and licence go in `docs/ASSET_CREDITS.md` and an in-app credits panel.
   - A dated amendment line.
2. **ADR 0002 `docs/adr/0002-realistic-buildings.md`:**
   - Heroes are **parametric TypeScript models** (kit + photo textures), not glTF. There is no Blender in the toolchain, and code is deterministic, reviewable and costs no download bytes for geometry.
   - Textures are **WebP in `DataArrayTexture`s**, not KTX2, so there is no Basis transcoder. Layers are 512² on High and 256² on Low, about 56 MB / 14 MB of GPU memory for 20 layers × 2 maps.
   - Update ADR 0001's near-building budget: near LOD within 100 m desktop / 50 m phone, at most 3k triangles per building. The building layer stays under 250k / 80k triangles resident.
3. **Docs:** `docs/BUILDINGS_PLAN.md` holds this design. `docs/PROGRESS.md` gains a phase row and open tasks; issue #32 (Фрегат) moves under it.
4. **Shared-contract commit** (Opus, small, with round-trip tests). It fixes the interfaces so wave-1 agents can run in parallel:
   - **`src/world/vector-format.ts` → v3.** The decoder accepts v2 and v3 (backward compatible, Article 5.3).
     - Building: the `heightHeuristic` byte becomes `flags` (bit0 heuristic, bits1–2 OSM type node/way/relation), plus new fields:
       - `colour` u24 (0 = none), from `building:colour`;
       - `roofColour` u24;
       - `material` u8 enum (plaster, brick, silicate_brick, concrete, panel, stone/limestone, glass, wood, metal);
       - `roofMaterial` u8 enum (tin_seam, clay_tile, eternit/шифер, bitumen, concrete, copper, gold);
       - `startYear` u16 (0 = unknown).
     - Road: `surface` u8 enum (asphalt, concrete, concrete_plates, paving_stones, sett, cobblestone, compacted, gravel, dirt). New flag bits: `TRAM_EMBEDDED`, `CYCLE`.
   - **`src/world/materials.ts`:** append fine-only ground ids from 64: `SETT`, `PAVERS`, `CONCRETE_SLAB`, `ASPHALT_PATCH`, `GRANITE`, `TRAM_BED`, `MANHOLE`, `DRAIN`, `STOP_LINE`. Fix every `id < 20` style range check.
   - **New `src/world/pbr-layers.ts`** (pure constants, append only): `PBR_LAYER` name → index, about 20 layers:
     - walls: STUCCO_SMOOTH, STUCCO_ROUGH, PLASTER_PAINTED, LIMESTONE_SHELL (Kherson ракушняк), BRICK_RED, BRICK_SILICATE, PEBBLEDASH, PANEL_CONCRETE, CONCRETE, GRANITE;
     - roofs: ROOF_TIN_SEAM, ROOF_CLAY_TILE, ROOF_ETERNIT, ROOF_BITUMEN;
     - ground: ASPHALT, ASPHALT_WORN, PAVERS_BEHATON, SETT_GRANITE, CONCRETE_SLABS, GRAVEL.

     Also `STYLE_PBR`: wall-style id → layer, and `SURFACE_PBR`: surface/material id → layer.
   - **`src/landmarks/types.ts`:**
     - `LandmarkMesh` gains optional `uv`, `pbr` (layer per vertex) and `photo` (facade texture id);
     - a new mesh kind `'textured'`;
     - `Landmark.replaces?: {type, id}[]`, the OSM buildings it hides.
   - **New `src/mesh/facade-profile.ts`** (types only): the `FacadeProfile` descriptor, keyed `"w<id>"` / `"r<id>"`. Fields:
     - storeys and floor heights;
     - bay rhythm per wall edge;
     - window type (rect / arched / segmental / paired) and surround;
     - rustication, pilasters, cornice profile, attic/parapet;
     - balcony stacks, shop fronts, entrance positions;
     - colours (wall / trim / roof) and pbr layers;
     - optional photo faces (edge index, texture id, u/v crop).

## Wave 1 (parallel, disjoint files; deepseek unless noted)

**A. Material asset tools** (`tools/materials/*`, `data/materials.json`, `docs/ASSET_CREDITS.md`)
- `data/materials.json` lists each layer: ambientCG / Poly Haven asset id, URL, licence CC0, sha256, and per-map tweaks (tint, scale in metres).
- `fetch-materials.ts` downloads into git-ignored `data/material-sources/` and checks the sha256.
- `pack-materials.ts` shells out to `magick` and `cwebp`:
  - packs albedo×AO (`_a`) and normal xy + roughness (`_n`) into WebP without alpha at 512 and 256;
  - checks that each layer tiles seamlessly (edge-difference metric);
  - writes `public/assets/materials/{hi,lo}/<layer>_{a,n}.webp` and a size report.
- Opus runs the fetch, checks the licences and commits the outputs. CI only serves them. Gate: the materials total ≤ 5 MB.

**B. Runtime PBR library** (new `src/world/pbr-library.ts`, `src/world/pbr-glsl.ts`)
- Fetches the quality's set with `?v=` and decodes it off the main thread (`createImageBitmap` + `OffscreenCanvas`) into two `DataArrayTexture`s with mipmaps.
- Until it loads, or if it fails, it uses flat 4×4 placeholder layers, so the current look stays as the fallback.
- A GLSL chunk `pbrSample(layer, uvM, scale)` with:
  - anti-tiling (hash-rotated stochastic tiling, two taps, to hide repetition);
  - normal xy from `_n.rg` (z rebuilt), roughness from `_n.b`, AO baked into `_a`;
  - a distance fade to the flat colour beyond 400 m.
- Tests: the layer table matches `pbr-layers.ts`; placeholder fallback; the shader chunk compiles in the existing smoke harness.

**C. Bake v3 fields** (`tools/bake/vectors.ts`, `tools/bake/building-style.ts`, `tools/bake.ts` call sites)
- Parse `building:colour` / `roof:colour` (names plus hex) into u24, `building:material`, `roof:material`, `start_date` (year from `YYYY`, `~YYYY`, `C19`).
- Road `surface` → enum. `TRAM_EMBEDDED` is set when a tram line runs within the carriageway buffer for ≥ 20 m.
- Tests extend `bake-vectors.test.ts` and `bake-style.test.ts`. Gate: the bake is byte-identical across two runs, and `public/world` stays ≤ 30 MB.

**D. Hero research** (Opus with `web-fetch` agents; no code)
- One brief per area in `docs/landmarks/`: `freedom-square.md` (extend), `pier.md` (extend), new `ushakova.md` and `fortress.md`.
- Each brief records: OSM ids, dated 2015–2021 photo sources with licence and author, measured dimensions (from footprint plus storey counts), materials and colours, bay rhythm and roof.
- Initial hero list (ids from the snapshot):
  - **Freedom Square:** administration rel 2168547, court way 130741412, «Україна» cinema 130756586.
  - **Embankment:** Hotel «Фрегат» 116810729 (sail crown, yellow balcony bands; owner photo 06 is the evidence), Річморвокзал 108158686, Зелений театр 1112919132.
  - **Fortress / old town:** Catherine's Cathedral 401093980, Ochakiv Gate 320667764, Art Museum (old Duma with tower) 320667761, Greek-Sofia church 1376864315, Assumption cathedral 320667760, local-lore museum rel 4871954, Kulish drama theatre 203252619.
  - **Ushakova and Suvorova:** a descriptor row for every building fronting the avenue from the square to the embankment, and the pedestrian Suvorova.
- Output: the briefs plus `data/facades/*.json` descriptor rows. Opus also chooses which photos become textures and records their corner points.

## Wave 2 (after Step 0 and B are merged; disjoint files)

**E1. Near-LOD building geometry** (`src/mesh/extrude.ts`, `chunk.ts`, `streamer.ts`, `protocol.ts`, `mesh.worker.ts`)
- The streamer builds a chunk as **near** (≤ 100 m desktop / 50 m phone, with hysteresis) or **mid** (as today), and rebuilds when it crosses the threshold. The swap happens only on chunk-boundary crossings (Article 4.3).
- Near geometry:
  - window reveals inset 0.18 m with a sill and lintel, on the same world-space grid the shader uses;
  - entrance recesses and canopies on the long wall facing the service drive (reuse the rules in `src/fine/smooth.ts`);
  - balcony stacks on khrushchevka and panel blocks, with hash-varied ad-hoc glazing (open rail, white PVC, wood, colour);
  - cornice and plinth profiles on historic and Stalin styles; parapet thickness.
- Every vertex carries `aPbr`. Mid chunks keep about 40 triangles per building.
- `hiddenIds` (from landmarks' `replaces` and from K descriptors) skip the building in both LODs.
- Tests:
  - near khrushchevka ≤ 3k triangles, near mid-average ≤ 120;
  - windows align across chunk borders;
  - determinism;
  - a hidden id emits nothing;
  - LOD hysteresis in `stream-math`-style pure tests.

**E2. Building shading** (`src/mesh/facade.ts`; Opus wires `scene.environment` in `src/main.ts`)
- Sample the PBR layer per style and part (wall / roof / parapet / trim). Tint by the v3 `colour` / `roofColour` when present, else the style palette.
- Window glass reflects a PMREM of the sky (`src/world/sky.ts`), regenerated only when the time of day changes by ≥ 10 min.
- Dirt streaks under sills and the AO at wall bases are kept. Night lit windows are unchanged.

**F1. Road surfaces and detail, data** (`src/fine/ground.ts`, `raster.ts`, `mesh.ts`)
- Map `surface` → `ASPHALT` / `SETT` / `PAVERS` / `CONCRETE_SLAB` / `DIRT`. Sidewalks default to `PAVERS` (behaton) in the centre and `ASPHALT` elsewhere. Kerbs become `GRANITE` on primary and secondary roads.
- `TRAM_BED`: concrete slabs between and beside the rails where `TRAM_EMBEDDED`.
- Stop lines at traffic signals, perpendicular to the road. `MANHOLE` discs and `DRAIN` grates along the gutter, placed by hash about every 35 m. `ASPHALT_PATCH` rectangles by hash.
- Tests extend `fine-markings`, `fine-roads` and `fine-mesh`: surface mapping, stop-line orientation, manhole spacing, determinism, triangle bounds.

**F2. Road shading** (the ground section of `src/world/facade-shader.ts`, the material in `src/fine/streamer.ts`)
- Fine and coarse ground sample `pbrSample` by material: asphalt plus worn asphalt blended by a wheel-track mask, pavers, setts, granite kerbs.
- Markings get wear and chipping over the asphalt texture. MeshStandard on High, Lambert on Low.

**H. Architectural kit and hero plumbing** (new `src/landmarks/kit/*`, `src/landmarks/layer.ts`)
- Kit (pure, UV'd, `pbr` per vertex): walls with openings, windows (rect / arched / segmental) with surrounds and sills, pilasters, rustication, profiled cornices swept along a polyline, balustrades, columns, pediments, domes on drums (hemispherical, onion), bell towers, arched gates, and a clock face.
- `layer.ts`:
  - the `'textured'` kind uses the PBR library; `photo` textures load on approach (≤ 600 m) and are released beyond 900 m;
  - a hero LOD swap at 250 m (the builder takes `lod`);
  - `replaces` ids are published to the mesh streamer.
- Collision: each hero returns its footprint prisms through `LandmarkPhysics.blockedAt`.
- Tests: kit watertightness and UV ranges, determinism, the triangle cap per hero (≤ 40k near, ≤ 4k far), replaced ids exposed.

## Wave 3

**G. Mid-distance road ribbons** (new `src/mesh/roads.ts`, plus a hook in the mesh worker after E1 merges)
- Smooth carriageway and sidewalk ribbons from the vector roads for chunks between the fine radius and the view radius. Markings come from the ribbon `u` coordinate in the shader, with junction polygons.
- They sit with a polygon offset over the coarse ground, so diagonal streets are no longer staircased at 150–640 m.
- Tests: ribbon width, no gaps at junctions, triangle cap per chunk.

**K. Facade-profile builder** (new `src/landmarks/facade-building.ts`, `src/landmarks/facades.ts`)
- Builds a Tier-K building from its OSM footprint (vector tile) plus its `FacadeProfile` using the kit. All rows in `data/facades/*.json` are registered as one landmark per area, and their ids are hidden on the mesh path.
- Tests: every descriptor row validates against the schema and its id exists in the baked tiles; output is deterministic.

**P. Photo facade pipeline and credits** (`tools/photos/rectify.ts`, `data/photo-textures.json`, `src/ui/credits.ts`, `src/i18n.ts`)
- Each row holds: source URL, author, licence, date (< 2022-02-24), sha256, four corner points and the target size.
- `magick -distort Perspective` rectifies, then colour-normalises and crops. Output goes to `public/assets/facades/*.webp` (≤ 2048 px wide). Sources are cached in git-ignored `data/photo-sources/`.
- A test fails if any row lacks a licence or date, or has a licence outside CC0 / CC-BY / CC-BY-SA / PD.
- An in-app «Автори фото / Photo credits» panel next to the OSM credit, in both languages, with touch parity and the phone layout checked.

## Wave 4+: heroes, one deepseek task per 2–3 buildings, area by area

Spec per task: `src/landmarks/heroes/<name>.ts` from the Opus brief (dimensions, rhythm, materials, photo faces), registered in `src/landmarks/index.ts`, with landmark-report numbers.

Order:
1. **Embankment:** Фрегат first (open issue #32, owner photo 06 as evidence), then Річморвокзал and Зелений театр.
2. **Freedom Square:** administration, court, «Україна».
3. **Fortress:** Catherine's Cathedral, Ochakiv Gate, Art Museum, Greek-Sofia, Assumption, museum, theatre.
4. **Ushakova and Suvorova:** descriptor rows only (K builds them). Opus adds rows in batches; a deepseek task fixes kit gaps the rows reveal.

## Review loop (every branch)

1. A Sonnet `Agent` (model `sonnet`) reviews `git diff main...feat/<task>` against the spec. It checks:
   - correctness and determinism (no `Math.random`);
   - Article 4.1 hot-path allocations and budgets;
   - Article 5.3 format rules;
   - loosened tests;
   - licence rows.
2. Opus re-runs the gates in the worktree and loops the new tests 10×.
3. Fixes go back to the same opencode session (`-s`). After 2 failed rounds, Sonnet or Opus fixes it.
4. Merge `--no-ff` locally and update `docs/PROGRESS.md` in the same commit. Nothing is pushed without the owner's go-ahead.
5. If parallel runs hit "database is locked", run the wave sequentially.

## Critical files

- `src/world/vector-format.ts`, `materials.ts`, `facade-shader.ts`, `sky.ts`; new `pbr-layers.ts`, `pbr-library.ts`, `pbr-glsl.ts`
- `src/mesh/extrude.ts`, `facade.ts`, `chunk.ts`, `streamer.ts`, `mesh.worker.ts`; new `facade-profile.ts`, `roads.ts`
- `src/fine/ground.ts`, `raster.ts`, `mesh.ts`, `streamer.ts`
- `src/landmarks/types.ts`, `layer.ts`, `physics.ts`, `index.ts`; new `kit/`, `heroes/`, `facade-building.ts`
- `tools/bake/vectors.ts`, `building-style.ts`; new `tools/materials/`, `tools/photos/`
- `CONSTITUTION.md`, `docs/adr/0002-…`, `docs/BUILDINGS_PLAN.md`, `docs/PROGRESS.md`, `docs/ASSET_CREDITS.md`, `docs/landmarks/*`, `README.md` (credits)

## Verification (Opus, per wave and at the end)

1. `npm test`, `npm run build` and `npm run bake` pass on merged `main`. The bake is byte-identical on a rerun. `du -sb public/world` ≤ 30 MB and `du -sb public/assets` ≤ 15 MB.
2. **Headless Chrome screenshots** (SwiftShader, 1280×720, `quality=high&time=13`), before and after, with `?probe=1` triangles, draws and texture count:
   - Freedom Square street `x=10270&z=8850&yaw=-75&pitch=4`;
   - aerial `mode=fly&x=10340&z=9000&y=90&yaw=-15&pitch=-32`;
   - a khrushchevka yard (Filatova 28 poses from `docs/EVIDENCE.md`);
   - Ushakova at street level;
   - the embankment and Фрегат;
   - the Fortress cathedral;
   - a diagonal street at 300 m (ribbons);
   - night `time=22:30` for lit windows.
3. **Phone emulation** (Android UA, 390×844, Low and High), both languages, with the credits panel open.
4. **Budgets:** desktop ≤ 2.5M triangles / 400 draws, phone ≤ 0.9M / 200, building layer < 250k / 80k resident. Record the measurements in `docs/PROGRESS.md`. Ask the owner for real-device fps at the densest new pose.
5. **Evidence (Article 6.6):** re-shoot the embankment poses (photos 01–15, especially 06 Фрегат) and the Filatova 28 poses, compare them, and log the result in `docs/EVIDENCE.md`.
6. **Licence audit:** every file under `public/assets/` has a row in `docs/ASSET_CREDITS.md`, and the credits panel lists every photo author.
7. Push only with the owner's go-ahead, then watch the Pages deploy and take a live-site screenshot.
