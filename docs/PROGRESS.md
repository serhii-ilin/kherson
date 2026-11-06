# Progress

The single source of truth for what is done, in progress and still open. **Update this file in the same commit as the work it describes**: tick tasks off, add new issues as they are found, and move fixed issues to **Done** with the commit.

Plan details are in [REALISM_PLAN.md](REALISM_PLAN.md); rules and budgets in [CONSTITUTION.md](../CONSTITUTION.md); the owner's reference photos (private, git-ignored) are catalogued in [EVIDENCE.md](EVIDENCE.md).

Status: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked (waiting on the owner)

_Last updated: 2026-11-06_

## Phases

| Phase | Status | Commit |
|---|---|---|
| Foundation: OSM bake, streaming 2 m world, walk/fly/touch, places, minimap, i18n (uk/en) | ✅ | — |
| Nature: 0.5 m trees and bushes, birds, water waves, ambient sound | ✅ | — |
| Docs: README, deployment guide, constitution | ✅ | `bcac053` |
| Step 0: realism plan, Article 4 budget amendment | ✅ | `0e2902c`, `6b82737` |
| Phase 1: light (AO, shadows, ACES, sky), facade styles and shader, HQ/LQ toggle | ✅ | `6dbd080` |
| Phase 2: vector tiles, 0.2 m ground (roads, kerbs, markings, zebras, tracks) | ✅ | `ac355fd` |
| Phase 3: buildings and bridges as 1 m blocks, shop signs | ✅ | `657dc30`, `418796d` |
| City limited to Kherson (OSM relation 2175078) | ✅ | `35e6147` |
| Street search: 686 named streets, former names searchable, teleport onto the street facing along it | ✅ | `90e4bed` |
| Phase 4: 0.2 m trees, street props, surface micro-detail, cross-fade, draw-call pass | ✅ (laptop 60 fps, phone 60–90 fps) | `418796d` |
| Time of day: sun for Kherson in June, golden hour, moonlit night with stars, lit windows and lamps, time button (uk/en), `?time=HH:MM` | ✅ | `efeb49b` |
| Pre-war restoration on the full OSM snapshot (bridge corridor, restoration table) | ✅ | `e446c4e` |
| Mesh prototype: extruded buildings for the centre, behind `?renderer=mesh` | ✅ | `738c88f` |
| Whole-city mid meshes, on by default; props and signs stay | ✅ | `3f6017f` |
| Realistic trees and bushes: leaf-card crowns, default; voxel crowns behind `?renderer=voxel` | ✅ | `8fb1ee8` |
| Near crowns: no full-size plane up close; fuller mid and far crowns | 🟡 | this branch |
| Birds only from recordings: no synthetic calls; tree sparrow, crow, wagtail, woodpecker, cuckoo, gulls added; looped sparrow take replaced | ✅ | `078cd08`…`2648062` |
| Kherson trees: 15 species with a surveyed mix, branch skeletons, leaf clumps, per-species leaf and bark textures, translucency, whitewashed street trunks ([TREES.md](TREES.md)) | ✅ | `c0fbeda`, `daf4584`, `a3763a1`, `1c2ab10`, (this commit) |
| Realistic pre-war buildings and roads ([BUILDINGS_PLAN.md](BUILDINGS_PLAN.md), [ADR 0002](adr/0002-realistic-buildings.md)): CC0 PBR materials, near-LOD facades, road surfaces and detail, mid-distance road ribbons, facade descriptors for Ushakova and Suvorova, hero models for the four well-known areas | 🟡 wave 1 | `c47b75c`, `afb8158` |

## Kherson trees

The trees are the species that actually grow in Kherson, and they look like trees. OSM records almost no species here (259 of 2,193 tree nodes, nearly all just `broadleaved`), so the mix comes from surveys of the city's plantings. Sources, species and weights are in [TREES.md](TREES.md).

**What changed**
- **15 tree species:** chestnut, linden, robinia, pyramidal poplar, willow, pine, plane, maple, elm (*U. pumila*), gleditsia, mulberry, ailanthus, catalpa, thuja and walnut. Robinia and elm lead on streets, and willows stay on natural banks: within 6 m of water in parks (before, a park within 20 m of water was 60% willow, which put weeping willows behind the stone embankment; owner's photo 03 shows lindens and chestnuts there).
- **Models:** every tree is a deterministic branch skeleton (trunk with lean and flare, scaffold limbs, child branches, short twigs) carrying leaf clumps that fill the species' crown envelope with sky gaps. The pine is a bare trunk under a flat umbrella, the poplar a column, the willow hangs curtains to about 1 m, and the thuja is a dense cone. Leaf cards are 0.45–0.9 m, so leaves come out at their real size.
- **Textures:** 12 procedural leaf-cluster layers (palmate, heart, lobed, pinnate, needle tufts, scale sprays, blossom…) and 6 bark layers (the plane's camouflage, robinia furrows, the pine's plates…), drawn as texture arrays with no external files.
- **Light:** leaf normals fan out from below the crown centre, so the lower crown is not black. Back faces keep their authored normal. Leaves glow slightly against the sun, and a soft wrap term is added.
- **Whitewash:** 78,239 street and tree-row trees have white trunks up to about 1.2 m.
- **Draw calls:** the mid and far models are shared by the three variants of a species and scaled, and on phones there are now fewer draw calls than before. `?renderer=voxel` folds the new species onto the voxel shapes they borrow, so it stays at its old cost.

**Delegation.** Implemented by opencode `opencode-go/deepseek-v4.1-flash` in five tasks (bake mix, textures, models, renderer, willow rule), about $0.55 in total. A Sonnet agent reviewed every diff; Opus planned, verified and fixed the last renderer issues (buffer release order, voxel draw calls).

**Triangles per tree** (heaviest variant): near 780–2,710 (cap 3,000 in the tests, 6,000 in Article 4), 70 m 340–1,150 (cap 1,200 / 1,500), mid ≤ 152 (cap 160 / 400), far 14 (cap 24).

**Measured** (headless Chrome, SwiftShader, `time=13`; the frame interval is not a laptop frame time). Before is `8f75c7c`, after is this commit. The same instances are in both columns.

| Pose | Before: triangles, draws | After: triangles, draws | Vegetation after |
|---|---|---|---|
| Street `x=10270&z=8850&yaw=-75&pitch=4`, desktop High | 772,151 · 228 | 1,070,071 · 227 | 347,628 tris |
| Aerial `mode=fly&x=10340&z=9000&y=90&yaw=-15&pitch=-32` | 845,652 · 244 | 1,248,496 · 239 | 433,100 tris |
| Under the plane tree `x=10276.5&z=8858.5&pitch=58` | 668,263 · 191 | 969,773 · 179 | 357,086 tris |
| Park `x=10656&z=9349&yaw=0&pitch=2` | 1,177,401 · 272 | 2,030,047 · 303 | 825,714 tris |
| Hydropark `mode=fly&x=7379&z=12980&y=12&yaw=30&pitch=-10` | 826,024 · 296 | 1,452,866 · 327 | 527,226 tris |
| Street, phone (Android UA, touch, 390×844) | 234,145 · 114 | 276,131 · 95 | |
| Park, phone | 375,131 · 125 | 548,367 · 114 | |
| Hydropark, phone | 270,932 · 139 | 398,746 · 124 | |
| Park, `?renderer=voxel` | 2,012,232 · 283 | 2,066,708 · 289 | |

Every pose is inside the budgets: desktop ≤ about 2.5M triangles and 400 draws, phone ≤ 0.9M and 200. The densest park is at 81% of the desktop triangle budget (#40). The baked world is 27 MB (budget 30 MB).

## Near crowns

The dark green block in the corner of the street shot was not the 0.2 m voxel crown. The default path already built leaf cards. The near model was three quads the size of the whole crown, so standing next to a tree showed one flat face.

The near model (inside 40 m, 25 m on a phone) is now many overlapping cards. Each card is smaller than the tree, and its normals point outward from the crown so the mass shades instead of reading as one plane. From 70 m outward the mid model uses a few crown-sized planes plus a canopy, which is what keeps a row of trees solid at street distance. The far slot is still a crossed billboard and a canopy. `?renderer=voxel` is unchanged and is the only path that builds micro-voxel crowns.

Heaviest variant after the change, triangles: chestnut near 636 (cap 6,000), 70 m 298 (cap 1,500), mid 76 (cap 400), far 14 (cap 24). Headless Chrome, SwiftShader, 1280×720, High. The frame interval is about 2 s and is not a laptop frame time.

| Pose | Before | After |
|---|---|---|
| Street `x=10270&z=8850&yaw=-75&pitch=4` | 528,997 tris, 196 draws, vegetation 133,036 tris | 653,861 tris, 191 draws, vegetation 204,732 tris |
| Aerial `mode=fly&x=10340&z=9000&y=90&yaw=-15&pitch=-32` | 548,020 tris, 206 draws, vegetation 158,978 tris | 700,268 tris, 206 draws, vegetation 235,102 tris |
| Under the plane tree at 10276.5, 8858.5, looking up (`pitch=58`) | 467,224 tris, one flat crown | 627,980 tris, 188 draws, a shaded crown |

Same instance counts (9,283 on the street, 11,448 in the air, 9,485 under the tree). Draws stay near 190.

## Realistic trees and bushes

The default vegetation is no longer micro-voxels. Each of the seven tree species, and the bushes (plain, lilac, pink), is an instanced low-poly trunk with alpha-tested summer leaf cards. Wind sway, per-instance colour and scale, and trunk collision are unchanged: collision is still the baked tree position, not the mesh. `?renderer=voxel` keeps the old crowns and the old buildings, so one URL is the before/after. Bark and leaves are procedural `DataTexture`s. KTX2 was not used, because decoding it needs a Basis transcoder, which would be another runtime binary.

Levels of detail are the existing four slots. Radii are unchanged (full model 40 m, simpler cards 70 m, mid 250 m, billboard out to the view radius; phones use 25 / 40 / 150 / 384 m). Article 4 caps still hold. The heaviest variant of each species, in triangles:

| | Near (lod 3, cap 6,000) | 70 m (lod 0, cap 1,500) | Mid (lod 2, cap 400) | Far (lod 1, cap 24) |
|---|---:|---:|---:|---:|
| Poplar, the heaviest tree | 260 | 94 | 40 | 14 |
| Bush / lilac / pink | 104–116 | 54–58 | 30 | 6 |

The bake still places about 396k trees and 313k bushes. Only the ones inside the view are drawn, and only the nearest use the full model. Headless Chrome (SwiftShader, 1280×720, `quality=high`) after the scene settled. The same instances are in both columns; the leaf-card path is fewer triangles. The frame interval is about 2 s and is not a laptop frame time.

| Pose | Path | Scene triangles | Draws | Vegetation |
|---|---|---:|---:|---|
| Street `x=10270&z=8850&yaw=-75&pitch=4` | `?renderer=voxel` | 989,970 | 188 | 9,283 instances, 369,988 tris |
| Same street | default | 502,855 | 189 | 9,283 instances, 133,036 tris |
| Aerial `mode=fly&x=10340&z=9000&y=90&yaw=-15&pitch=-32` | voxel | 1,282,456 | 206 | 11,448 instances, 521,856 tris |
| Same aerial | default | 534,280 | 205 | 11,448 instances, 158,978 tris |

High quality casts shadows from every crown except the far billboard. Both poses stay inside the scene caps (about 2.5M triangles and 400 draws).

### Next

Hotel «Фрегат» and the other hero glTFs, the far skyline, collision and the overview off voxel columns, then delete the voxel renderer.

## Whole-city meshes (phase 1)

Extruded mid-detail buildings are the default for every chunk inside the view radius (640 m on a laptop, 384 m on a phone or Low). `?renderer=voxel` is the comparison path. Where a mesh chunk is installed, coarse building voxels are hidden (bridge decks stay). High quality still draws street props and shop signs from the block tier, without the 1 m building voxels. Laptop High at the Freedom Square spawn, the 640 m disc (`tools/mesh-report.ts`, buildings only): **454 buildings, 18,033 triangles, 2.66 MB**. Headless Chrome (SwiftShader, 1280×720, `quality=high`) after the scene settled:

| Pose | Path | Scene triangles | Draws | Building layer |
|---|---|---:|---:|---|
| Street `x=10270&z=8850&yaw=-75&pitch=4` | `?renderer=voxel` | 984,698 | 190 | 50,056 block tris |
| Same street | default meshes | 646,419 | 111 | 18,660 tris, 2.76 MB, plus 3,776 prop tris |
| Aerial `mode=fly&x=10340&z=9000&y=90&yaw=-15&pitch=-32` | voxel | 1,283,626 | 207 | 68,832 block tris |
| Same aerial | default meshes | 1,209,006 | 205 | 19,957 tris, 2.95 MB, plus 3,148 prop tris |

The resident building layer is far under the ADR cap (250k triangles, 20 MB). The SwiftShader frame interval is about 2 s either way and is not a laptop frame time.

## Mesh prototype (2026-11-01)

The centre box below was phase 0. The owner direction (2026-11-01) is that realistic meshes cover the whole city. The migration, the budgets, and the PR that deletes the voxel buildings are in [ADR 0001](adr/0001-rendering-architecture.md). This pull request does not widen the box. It is rebased onto main after PR #2 (the restoration pass) merged. Spawn is still 10293, 8817, so the box in metres did not move.

`?renderer=mesh` extrudes OSM footprints from the existing `v_*.bin` tiles for one neighbourhood: Freedom Square and Ushakova / Nezalezhnosti avenue down to the embankment, world box **x 9984–11264, z 8320–10496** (about 1.3 × 2.2 km, regions rx 19–21 and rz 16–20). The voxel path is unchanged and remains the default. Ground, streets, vegetation, water, birds, audio and UI are the same. In that box the 1 m block tier (carved voxel buildings, shop signs, street props) is left off so buildings are not drawn twice; landmark lamps on the square stay. Walk collision is still the voxel columns. The outer 96 m of the box keeps its voxel buildings so a footprint is not cut in half. Meshes are built in a worker and instanced in one `BatchedMesh`; a chunk is meshed once the coarse region it needs is loaded.

Materials are procedural (no new texture files): tiling albedo, roughness and a window grid from `building:levels` (or the bake's storey heuristic). Flat roofs get a parapet; gable, hip, pyramid, skillion and dome follow the tile's `roof:shape`, with untagged houses gabled.

### Geometry (full neighbourhood, no WebGL)

`node --experimental-strip-types tools/mesh-report.ts` after `npm run bake`, ground height fixed so the count is the mesh not the terrain:

| | |
|---|---|
| Buildings | 863 |
| Chunks with a mesh | 402 of 680 |
| Triangles | 34,501 |
| GPU buffers | 5.12 MB |
| Vector tiles read | 35 files, 0.26 MB |
| Baked world | 22.1 MB apparent (22,076,877 bytes) |

City-wide the restored bake has 10,956 buildings (was 10,118 before the restoration). The centre gained 78 footprints. Triangles per building stay at 40.

The headless Chrome scene counts further down were taken on the pre-restoration bake and were not re-run after the rebase. They are not the centre-box measurement.

### Same poses, headless Chrome (SwiftShader, 1280×720, `quality=high`, pre-restoration bake)

`renderer.info` after the scene settled. Frame interval is the wall-clock gap between `requestAnimationFrame` callbacks. This Chrome does not vsync, and `gl.finish` returns before the GPU process, so the interval is a software-rasteriser figure, not a laptop frame time. The owner's 2026-10-18 MacBook Air measurement of the voxel path (60 fps) still stands. Samples are short (one to two gaps) because the software rasteriser is about one frame a second.

Freedom Square, street (`x=10270&z=8850&yaw=-75&pitch=4`):

| | Voxel | Mesh |
|---|---|---|
| Scene triangles | 1,120,506 | 982,870 |
| Draw calls | 210 | 200 |
| Block triangles | 144,994 | 0 |
| Mesh triangles / GPU | — | 17,169 / 2.55 MB |
| rAF interval | ~1.4 s | ~2.5 s (one gap) |

Oblique, above the administration roof (`mode=fly&x=10315&z=8895&y=24&yaw=-55&pitch=-16`):

| | Voxel | Mesh |
|---|---|---|
| Scene triangles | 1,191,210 | 1,034,627 |
| Draw calls | 219 | 198 |

Both poses stay inside the constitution caps (about 2.5M triangles and 400 draws on desktop). The mesh path is fewer triangles and fewer draws because the 1 m blocks are not built. Streamed world bytes at the pose were about 5 MB encoded (dev server, not gzip); the mesh reads the vector tiles the fine ground already uses and adds no bake files.

### Next

- Hero landmarks: superseded by [ADR 0002](adr/0002-realistic-buildings.md) (parametric models with photo textures).
- Freeze a pre-war OSM extract around 2022-02-01 and keep it in a GitHub Release, with the committed gzip as the small cache.
- Bring street props and shop signs back in the mesh neighbourhood (they are generated with the block tier today).
- Re-measure on a laptop before extending the meshes past this neighbourhood, and amend Article 4 only if a real device exceeds a budget.

## Open tasks

### Next
- 🟡 Realistic pre-war buildings and roads ([BUILDINGS_PLAN.md](BUILDINGS_PLAN.md)). Heroes are parametric models with photo textures, not glTF ([ADR 0002](adr/0002-realistic-buildings.md)).
  - ✅ Constitution amendment 7: ≤ 15 MB asset budget, CC-BY-SA facade photos (`c47b75c`)
  - ✅ Step 0: ADR 0002, the plan (`afb8158`), shared contracts (this commit): vector tile v3 (building OSM type, colour, roof colour, material, roof material, start year; road surface, tram-in-road and cycle flags; v2 still decodes), fine ground ids 64–72, `src/world/pbr-layers.ts`, `src/world/osm-ref.ts`, landmark `replaces` / `textured` meshes, `src/mesh/facade-profile.ts`. Vector tiles 2.13 → 2.21 MB, baked world 27.0 MB
  - 🟡 Wave 1: A material tools and CC0 assets · ✅ B runtime PBR library (`src/world/pbr-library.ts`, `pbr-glsl.ts`; alpha-free `_a`/`_n` texture arrays, one upload after a 4×4 placeholder, IQ anti-tiling) · ✅ C bake v3 fields (`feat/bake-v3`) · D hero research briefs (Opus)
    - C measured: of 10,956 buildings, only 3 carry `building:colour`, 2 `roof:colour`, 14 `building:material`, 0 `roof:material`, 7 `start_date`, so facade colour must come from the descriptors and style palette, not OSM. Roads: 4,134 asphalt, 22 paving stones, 17 sett, 1,415 dirt, 19,098 untagged. The bake is byte-identical on a rerun.
    - The snapshot (and the 2022-01-01 reference) has no `railway=tram` ways: Kherson ran trolleybuses, not trams, before the war. The tram-in-road flag is unit-tested only and stays 0; trolleybus overhead wires on the main avenues are a possible later detail.
  - ⬜ Wave 2: E1 near-LOD geometry · E2 building shading · F1 road surfaces and detail · F2 road shading · H architectural kit and hero plumbing
  - ⬜ Wave 3: G mid-distance road ribbons · K facade-descriptor builder · P photo facade pipeline and credits panel
  - ⬜ Heroes: embankment (Фрегат #32, Річморвокзал, Зелений театр) → Freedom Square (administration, court, «Україна») → Fortress (Catherine's Cathedral, Ochakiv Gate, Art Museum, Greek-Sofia, Assumption, museum, drama theatre) → Ushakova and Suvorova descriptors
- ⬜ The far skyline, collision and the overview off voxel columns, then delete the voxel renderer (ADR 0001 phases 3–5).
- ⬜ High-realism landmark spots: the Pier / embankment («Пірс-Набережна») and Freedom Square («Площа Свободи»). Close reconstruction from pre-war photos and panoramas only (2000–2020, nothing after 24 Feb 2022), with more detail than the rest of the city.
  - ✅ Research briefs (pre-war sources, OSM anchors, dimensions, materials): [pier](landmarks/pier.md), [Freedom Square](landmarks/freedom-square.md).
  - ✅ Landmark detail layer, first pass (see Done).


### Later
- ⬜ Bollards along plaza edges (optional prop, not placed yet).
- ⬜ Light pools under street lamps at night (needs per-lamp data in the shader).

## Open issues

Priority: **P1** must fix soon (licence or budget breach) · **P2** visible defect · **P3** minor.

| # | P | Issue | Notes / proposed fix |
|---|---|---|---|
| 26 | P3 | Banks of water that exists only as an OSM line (e.g. Koshova by the Ostrivske bridge) still follow the 2 m grid; the shoreline smoothing needs a water polygon | trace polygons from the line buffers in the bake |
| 27 | P3 | 1 m khrushchevka is 3,720 triangles (test bound 3,800): further facade detail needs trimming elsewhere | |
| 28 | P3 | The Ushakova embankment is not in the Places menu | add it to the bake's landmark list and re-bake `public/world` |
| 29 | P3 | Tree rows between Freedom Square and the administration came from OSM `tree_row` ways drawn after 2022 | the 2022-01-01 snapshot has 14 `tree_row` ways, none with id > 1e9 (was 798, of which 789 had id > 1e9). Owner to confirm the square in the browser |
| 30 | P3 | Thin grass slivers remain at the edges of Freedom Square's paving; its pavers are in the plain opaque mesh, so the fine ground (polygonOffset −1/−4) can also show through them at grazing angles, as it did on the embankment | clip edge pavers to the polygon; move the pavers to the `paving` mesh kind |
| 32 | P3 | Hotel «Фрегат» (owner's photo) still has the generic tower facade: no sail-shaped crown on the stair tower, no yellow balcony bands | first hero of the realistic-buildings plan (embankment wave) |
| 33 | P3 | Embankment pavers are 1.5 m slabs; the photos show small grey-beige cobbles (a 0.5 m grid would be ~3× the 129k triangles) | texture or shader pattern instead of geometry |
| 34 | P3 | The stacked-timber monument from the owner's photos is not modelled: its spot on the embankment is not mapped | owner to point at it on the map |
| 31 | P3 | Storeys are still guessed for ~70% of buildings (no open per-building height source covers Kherson, see [HEIGHT_SOURCES.md](HEIGHT_SOURCES.md)); short blocks (< 35 m) stay 3 storeys | add building:levels in OSM for known blocks; re-bake |
| 35 | P3 | `birds` (swift altitude band) and `landmarks` (budgets) tests failed once in a full local run and passed on rerun | watch CI; raise their timeouts or seed the swift test if it repeats |
| 36 | P3 | A standing statue on a tall red-and-grey pedestal (owner's photos 04, 05, 14, 15 in [EVIDENCE.md](EVIDENCE.md)) is not modelled: it is not in the current OSM (perhaps the Ushakov monument removed in 2022) and its spot is unknown | owner to point at it on the map |
| 37 | P3 | The railing-free stretch with the bathing steps is ±15 m around the quay point nearest the fountain, estimated from photos 13–15 | owner to confirm where it starts and ends |
| 38 | P3 | Filatova 28 courtyard (west side, facing school 28-А) is modelled from the owner's photos as a landmark (`src/landmarks/courtyard.ts`), but positions inside the yard are estimated; the house facade (entrance, glazed balcony) and the ivy are generic; the yard is sparser than in the photos (no trees or bushes of its own) | owner to confirm the layout in a real browser; compare with photos 01–03 |
| 40 | P3 | The densest park pose is 2.03M triangles on desktop High (81% of the 2.5M budget); 0.83M of it is vegetation | if a denser spot crosses the budget: drop the near radius to 35 m or trim lod 0 cards in parks |
| 41 | P3 | Mid-distance trees (70–250 m) are see-through up close: their cards tile the leaf cluster 2×2 and show the transparent gaps | denser mid cards, or a crown-filling cluster layer for mid LOD only |
| 42 | P3 | Frame rate of the new trees is not yet measured on a real laptop or phone (headless SwiftShader only) | owner to check the park and Hydropark poses on the MacBook Air and phone |
| 24 | P3 | Shadow flicker at low sun (06:30 / 19:45) not checked with motion; `normalBias` grows as the sun gets lower | check while walking at golden hour |

## Waiting on the owner

- ✅ **Frame rates measured (2026-10-18)**: MacBook Air 16 GB steady 60 fps (display cap), owner's phone 60–90 fps, both on LQ and HQ.
- ⛔ **Code licence**: none chosen yet (all rights reserved).
- ⛔ **Phone default**: phones start in LQ, so they don't see the 0.2 m ground and 1 m blocks unless switched to HQ. The owner's phone runs HQ at 60–90 fps; switch the phone default to HQ?
- ⛔ **Karantynnyi island entry** was removed by the city cut. Bring it back?
- ✅ **Antonivskyi road bridge** (owner, 2026-11-01): include the pre-war span. The city polygon stays relation 2175078. A 30 m corridor covers the carriageways (ways 4424601 and 118181459, outline 188496941, Wikidata Q4067525) and 450 m of trunk approach. The railway bridge (Q4067523) is not included. World bbox east is 32.73 so the span fits; west and north are unchanged. The new cells contain 3 buildings.
- ✅ **Unnatural bird calls** (owner, 2026-11-06): every synthetic bird voice is gone. The ambient slots also used to synthesise pigeons, doves and swifts, because they asked only for `song`/`call` takes; they now play the recorded coos and screams. Added CC0 house sparrow (a chattering group and single chirps), tree sparrow, crow (carrion-crow takes for the hooded crow), white wagtail, great spotted woodpecker (drumming and calls) and cuckoo. Crows come every 2–5 min, woodpeckers about every 2 min in parks, cuckoos every 3–6 min in parks and by the river. `sparrow-3` sounded like a loop and was replaced. Rook, magpie, chaffinch, oriole, nightingale and swallow have no clip and are silent. Gulls were added the same day at the owner's request: about once a minute at the river's edge (budget raised to 1.6 MB, amendment 5). 50 clips, 1,568,087 bytes. Constitution amendments 4 and 5.
- ✅ **Ambient sound** (owner, 2026-11-01): the synthetic doves and swifts were replaced. Common swift, feral pigeon, collared dove, house sparrow, great tit, blackbird and starling play CC0 / public-domain recordings (34 clips, Opus and AAC, about 1.00 MB, loaded after a gesture). Tree sparrow, crows, rook, magpie, chaffinch, swallow, oriole, nightingale, wagtail and gulls stay synthesised, as do wind and water. See [BIRDS.md](BIRDS.md) and [AUDIO_CREDITS.md](AUDIO_CREDITS.md).

## Done (recent fixes)

| Fix | Commit |
|---|---|
| Kherson trees: species mix from surveys, skeleton + clump models, texture arrays, translucency, whitewash; willows off the embankment park (owner's photo 03) | (this commit) |
| Pages deploy timeout: run 42239220239 was aborted after GitHub Pages queued and synced for 10 min (the `deploy-pages` default limit); the limit is now 30 min | (this commit) |
| Reload keeps your place: walk/fly mode, position and view direction are saved in `localStorage` (`vk-pose`) about once a second and when the tab is hidden, and restored on load; `?x=&z=` links still win. Checked in headless Chromium for walk and fly | `d7d5202` |
| Gulls over the Dnipro: CC0 black-headed gull calls and a herring-gull laughing call (standing in for yellow-legged and Caspian), only near the water, about once a minute at the edge. Bird-recording budget raised to 1.6 MB (constitution amendment 5); 50 clips, 1,568,087 bytes | `6771c7f`, `2648062` |
| Birds only from recordings: synthetic calls removed (including the synthetic pigeons, doves and swifts the ambient slots played), CC0 tree sparrow, crow, white wagtail, woodpecker and cuckoo added, a looped-sounding sparrow take replaced; crows, woodpeckers and cuckoos kept occasional. 47 clips, 1,473,902 bytes. Constitution amendment 4 | `078cd08`, `17afbb6` |
| Bird recordings: CC0 / public-domain swifts (daytime screams and an evening party, Doppler on fly-bys), feral-pigeon coo and wing clap, collared-dove song and landing, plus house sparrow, great tit, blackbird and starling. 34 mono clips, Opus/WebM and AAC/M4A, 1,000,694 bytes, fetched after a gesture; other species and the wind/water beds stay synthesised, with a synthetic fallback if a file fails. Provenance in [AUDIO_CREDITS.md](AUDIO_CREDITS.md). Constitution Article 4 budget and Article 8.2 exception | `b6994d8` |
| Pre-war restoration on the current OSM snapshot, not a rollback to the January 2022 extract (that extract dropped buildings and tree rows that were mapped later). `data/osm/restoration.json` reverts ruin/lifecycle tags, restores the Antonivskyi carriageways, puts street names back to the 2022-01-01 reference (current name kept in `old_name`), re-adds 1,016 deleted buildings that were not redrawn, and drops 13 war additions. `building=ruins/destroyed/damaged` 156 → 5. Baked buildings 10,118 → 10,956; tree rows stay 798. Corridor mask unchanged | `e446c4e` |
| #39 No more 1 m staircases on skewed apartment blocks: flat-roofed khrushchevka/panel/Stalin/brick/apartment blocks whose walls are > 4° off the grid are drawn true-angle in the block tier (`src/fine/smooth.ts`): walls along the real polygon edges, flat roof with a low parapet, windows painted along each wall by the facade shader, entrances with canopies and stair windows on the long wall facing the service drive, balcony stacks on long walls; physics keeps the 1 m column raster; the chunk holding the ring's first vertex emits the mesh. Fine worker +12 kB | (next commit) |
| Khrushchevka facade matched to the owner's photos of Filatova 28: warm grey pebble-dash (1.5 cm stones, 5 cm clusters, faint 3.2 × 3 m joints), 1.5 m windows with 2 m piers (2-wide openings in 4 m bays, kept off corners), an entrance every 4 bays with a light portal and a concrete canopy, some painted wooden frames (blue, brown) among white ones; 5-storey slabs are no longer picked as Stalin-era at random (Filatova 28 had tall Stalin windows; Stalin styles 63) | (next commit) |
| Share a link: 🔗 button copies a URL with position, height (fly), view direction, tilt and time of day (share sheet on phones); `?pitch=` now also applies in walk mode | `cbf91b1` |
| Embankment, owner's photos 13–15: no railing in front of the fountain plaza; four broad concrete bathing steps into the river there (walkable), white parapets with short railings at both ends; red-brown bands fanning from the fountain; the fountain gets a red granite wall, white coping and teal mosaic | `9333cc7` |
| Owner's 12 embankment photos kept as private evidence in git-ignored `evidence/photos/ushakova-embankment/`, catalogued in [EVIDENCE.md](EVIDENCE.md) with what each shows and validates, a re-shoot pose and SHA-256; rule added as CONSTITUTION 6.6 / 7.5 (`9de7cb5`) | `341ffa2` |
| Stale pages after a deploy (GitHub Pages caches everything for 10 min and its headers can't be changed): each build gets an id (git sha), written to `version.json`; all world data is fetched with `?v=<id>`, so a new deploy never mixes with cached tiles. On start a newer `version.json` reopens the page once under `?v=<new id>` (a URL the cache has not seen); later checks (every 10 min, and when the tab comes back) show a «Є нова версія — оновити» button instead of interrupting | `5210101` |
| Ushakova embankment rebuilt from the owner's photos: paving over the whole OSM pedestrian area (10.9k m², edge tiles split to follow the outline) with a red-brown band and coping along the quay wall; blue S-shaped railing posts with white tube rails along the 380 m river edge and the cannon bastion (solid for the walker); 47 black shepherd's-crook lamps with bell caps and globes (only the globes glow); wooden benches with cast-iron ends and bins along the park edge; white-kerbed rose beds down the middle; the Frigate monument on its mapped pedestal (red-brown relief, tapering granite pylon, bronze three-master); the cannon; the axial fountain on its OSM outline; a floating landing with gangway, canopy and three moored yachts; five yellow/green portal cranes on the port quay (separate `port-cranes` landmark). Paving uses a new `paving` mesh kind with a stronger depth bias so the fine ground no longer shows through. The old guessed 45 m deck and avenue plaza are gone. 129k + 2.7k triangles, 4 + 1 draw calls | `666e4e5` |
| Fences and storeys: OSM barrier=fence/wall baked and drawn; 2.2 m Soviet concrete panel fences (PO-2) around industrial land with gaps at crossing roads; storeys for untagged buildings from the footprint (khrushchevka slabs → 5, point towers → 9, small houses 1–2), calibrated against the city's 2021 housing stock (`npm run height-report`); brick facade for building:material=brick; khrushchevka facade with panel seams, stair windows, balcony stacks. Filatova: 5-storey 51 → 91, 9-storey 9 → 18. Baked world 20 MB | `119c68f` |
| Freedom Square fixed after the owner's screenshot (crooked, half paved): the frame is derived from the perimeter roads (−22°), pavers, bands, kerbs and furniture are laid in that frame with straight clipped edges over the whole square between the roads (10.9k m²), the plinth pad sits on and turns with its OSM polygon, pavers always above the ground, neutral greys; 37k triangles, 3 draw calls | `151daa1` |
| Clouds: procedural cumulus + cirrus in the sky shader (0 extra draw calls), drifting NW→SE, white at noon, pink/orange at golden hour, faint at night hiding stars. Swifts: 10 small screaming parties of 4–15 (6 on phones), low passes over streets, busier 18:00–21:30; doves 70 / 30 so all birds stay within ~170 / ~90 | `de4f554` |
| Landmarks, first pass: Freedom Square (OSM-derived treeless forecourt with ~1 m pavers on a mortar bed following the ground, empty stepped former-Lenin pad with blank panels, Pushkin-square fountain, lamps, benches, bins, flower beds, Ukrainian flags) and the Pier at the bottom of Ushakova (placed on the real quay edge found along the avenue axis, paved promenade, 45 m walkable deck over the water with railings, lamps with flower boxes, bollards, axial fountain). 144k / 32k triangles, 3 draw calls each; whole frame ≈ 1.2M tris / 205 calls at the square | `34b5aec` |
| Bird sounds: 17 procedural Kherson species mixed by habitat (built-up → sparrows, pigeons, doves, crows; trees → tits, blackbird, chaffinch, oriole, nightingale; river → gulls, swallows, wagtails), pigeon vs collared-dove coos, caw and noisy voices; weights and sources in [BIRDS.md](BIRDS.md); ≤ 16 voices measured | `d472da6` |
| River fish: sporadic jumps (arc, ring on the waves, droplets, a quiet plop) and dark shadows under the surface, 15–60 m ahead, daytime only; at most 6 events (3 on phones), 4 draw calls. `waveHeight()` mirrors the water shader so surface effects ride the waves | `1dbb4f5` |
| Minimap: + / − zoom buttons (400 m … whole city), click or tap to move there, drag the player arrow to move there (keeps facing; Codex `gpt-5.6-luna`, reviewed by Opus) | `3a46378` |
| Codex-round review: coarse ground backing sinks only where the 0.2 m bank dips below it or meets water (keeps crack cover on streets); tall drops into the river drawn as an embankment wall | `118acad` |
| #17 Pines on sandy forest ground (23 → 1,300) | `f0e8018` |
| #18 `BatchedMesh` without `WEBGL_multi_draw` verified: three falls back to one draw per chunk (same as before batching); `?nomultidraw=1` dev flag | `f0e8018` |
| #19 Shadows fade out between 250 and 320 m and stop above; no frozen patch | `f0e8018` |
| #23 Block mesher merges better: khrushchevka 3,962 → 3,720 triangles, other styles 5–37% fewer | `f0e8018` |
| Places: one «Херсон» entry; piers («причал») and the river port searchable; places nudged onto walkable ground | `f0e8018` |
| #4 Whole-building block-tier assignment across the 250 m edge; #12 per-building coarse tint; #13 facade run boundaries | `f0e8018` |
| #5 Fine AO uses the 1 m footprint raster; #7 polygon-based 0.2 m shoreline and sandy banks | `f0e8018` |
| #6 Vegetation positions are checked against vector roads/buildings; bake nudged 22,742 and dropped 2,853 placements | `f0e8018` |
| #8 Bridge-deck lane markings; #9 continuous multi-piece bridge profiles | `f0e8018` |
| #10 Floodplain reeds, wetland and meadow treatment on the left bank | `f0e8018` |
| #11 1 m bridge deck/rail physics, including walking under decks | `f0e8018` |
| #16 Built-up areas straddling the city boundary are left out of the vector tiles (the 2 m ground covers them); multi-ring area bounds fixed | `f0e8018` |
| #20 OSM traffic-light direction; #21 free-standing shop signs; #22 worker-prioritized vegetation LOD builds | `f0e8018` |
| #25 Narrow-phone settings menu layout | `f0e8018` |
| #2 Draw calls at altitude 409/576 → 135/99: 0.2 m and 1 m tiers off above 250 m, shadows frozen above 300 m | `418796d` |
| #3 Street-level draw calls 342–377 → 214–243: coarse chunks and water in `BatchedMesh` | `418796d` |
| #14 Recess shading for 1 m block window reveals, balcony undersides and glass | `418796d` |
| #15 HUD coarse triangle counter counts only drawn geometry | `418796d` |
| 0.2 m tree regression (sparse pads, bead poplars, thick trunks, striped cut-out) → dense shells, slender trunks, cut-out off | `418796d` |
| Asphalt cracks read as long drawn curves → faint and only within 12 m | `418796d` |
| #1 In-app "© OpenStreetMap contributors" credit, both languages, desktop and phone | `b4a3d12` |
| Fly mode fell through the ground → fly collision | before `bcac053` |
| Speckled shop windows (unsnapped wall plane in hashes) | `6dbd080` |
| `PCFSoftShadowMap` removed in three r186 → `PCFShadowMap`; exposure 1.2 → 1.0 | `6dbd080` |
| Sky showing through T-junction cracks in 0.2 m ground → polygon offset over coarse ground | `ac355fd` |
| CI test timeouts → global `testTimeout` 30 s | `c8c85d9` |
