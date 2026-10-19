# Progress

The single source of truth for what is done, in progress and still open. **Update this file in the same commit as the work it describes**: tick tasks off, add new issues as they are found, and move fixed issues to **Done** with the commit.

Plan details are in [REALISM_PLAN.md](REALISM_PLAN.md); rules and budgets in [CONSTITUTION.md](../CONSTITUTION.md); the owner's reference photos (private, git-ignored) are catalogued in [EVIDENCE.md](EVIDENCE.md).

Status: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked (waiting on the owner)

_Last updated: 2026-10-19_

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

## Open tasks

### Next
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
| 29 | P3 | Tree rows between Freedom Square and the administration come from OSM `tree_row` ways drawn after 2022 (ids ~1.17e9); the owner says the square has few or no trees | owner to confirm whether they stood there before 2022; if not, exclude them |
| 30 | P3 | Thin grass slivers remain at the edges of Freedom Square's paving; its pavers are in the plain opaque mesh, so the fine ground (polygonOffset −1/−4) can also show through them at grazing angles, as it did on the embankment | clip edge pavers to the polygon; move the pavers to the `paving` mesh kind |
| 32 | P3 | Hotel «Фрегат» (owner's photo) still has the generic tower facade: no sail-shaped crown on the stair tower, no yellow balcony bands | landmark-style facade override for way 116810729 |
| 33 | P3 | Embankment pavers are 1.5 m slabs; the photos show small grey-beige cobbles (a 0.5 m grid would be ~3× the 129k triangles) | texture or shader pattern instead of geometry |
| 34 | P3 | The stacked-timber monument from the owner's photos is not modelled: its spot on the embankment is not mapped | owner to point at it on the map |
| 31 | P3 | Storeys are still guessed for ~70% of buildings (no open per-building height source covers Kherson, see [HEIGHT_SOURCES.md](HEIGHT_SOURCES.md)); short blocks (< 35 m) stay 3 storeys | add building:levels in OSM for known blocks; re-bake |
| 35 | P3 | `birds` (swift altitude band) and `landmarks` (budgets) tests failed once in a full local run and passed on rerun | watch CI; raise their timeouts or seed the swift test if it repeats |
| 36 | P3 | A standing statue on a tall red-and-grey pedestal (owner's photos 04, 05, 14, 15 in [EVIDENCE.md](EVIDENCE.md)) is not modelled: it is not in the current OSM (perhaps the Ushakov monument removed in 2022) and its spot is unknown | owner to point at it on the map |
| 37 | P3 | The railing-free stretch with the bathing steps is ±15 m around the quay point nearest the fountain, estimated from photos 13–15 | owner to confirm where it starts and ends |
| 38 | P3 | Filatova 28 courtyard (west side, facing school 28-А) is modelled from the owner's photos as a landmark (`src/landmarks/courtyard.ts`), but positions inside the yard are estimated; the house facade (entrance, glazed balcony) and the ivy are generic; the yard is sparser than in the photos (no trees or bushes of its own) | owner to confirm the layout in a real browser; compare with photos 01–03 |
| 39 | P2 | Buildings whose walls are not aligned with the 1 m grid (Filatova 28 is at 29°, most khrushchevkas in the microdistricts) are drawn as 1 m staircases: windows are carved only where a straight run exists, so they come out irregular and in steps, unlike the even rows in the owner's photos | draw slab blocks (khrushchevka/panel) as true-angle walls with windows laid along the wall instead of 1 m blocks; needs an owner decision (bigger change to the block tier) |
| 24 | P3 | Shadow flicker at low sun (06:30 / 19:45) not checked with motion; `normalBias` grows as the sun gets lower | check while walking at golden hour |

## Waiting on the owner

- ✅ **Frame rates measured (2026-10-18)**: MacBook Air 16 GB steady 60 fps (display cap), owner's phone 60–90 fps, both on LQ and HQ.
- ⛔ **Code licence**: none chosen yet (all rights reserved).
- ⛔ **Phone default**: phones start in LQ, so they don't see the 0.2 m ground and 1 m blocks unless switched to HQ. The owner's phone runs HQ at 60–90 fps; switch the phone default to HQ?
- ⛔ **Landmarks removed by the city cut**: bring back the Antonivskyi bridge and/or the Karantynnyi island entry?
- ⛔ **Ambient sound**: owner's listening feedback, now including the 17 synthesised Kherson species (sparrows, pigeons, collared doves, crows, gulls by the river…, see [BIRDS.md](BIRDS.md)).

## Done (recent fixes)

| Fix | Commit |
|---|---|
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
