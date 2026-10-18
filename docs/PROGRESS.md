# Progress

The single source of truth for what is done, in progress and still open. **Update this file in the same commit as the work it describes**: tick tasks off, add new issues as they are found, and move fixed issues to **Done** with the commit.

Plan details are in [REALISM_PLAN.md](REALISM_PLAN.md); rules and budgets in [CONSTITUTION.md](../CONSTITUTION.md).

Status: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked (waiting on the owner)

_Last updated: 2026-10-18_

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

- ⬜ Fences: OSM barriers plus Soviet concrete panel fences (PO-2) around industrial sites, e.g. the factory on Filatova Street (Codex).
- ⬜ Storey counts for untagged buildings (Filatova: 5-storey khrushchevkas, a 9-storey brick block look too low) and a more believable khrushchevka facade (Codex).

### Later
- ⬜ Bollards along plaza edges (optional prop, not placed yet).
- ⬜ Light pools under street lamps at night (needs per-lamp data in the shader).

## Open issues

Priority: **P1** must fix soon (licence or budget breach) · **P2** visible defect · **P3** minor.

| # | P | Issue | Notes / proposed fix |
|---|---|---|---|
| 26 | P3 | Banks of water that exists only as an OSM line (e.g. Koshova by the Ostrivske bridge) still follow the 2 m grid; the shoreline smoothing needs a water polygon | trace polygons from the line buffers in the bake |
| 27 | P3 | 1 m khrushchevka is 3,720 triangles (test bound 3,800): further facade detail needs trimming elsewhere | |
| 28 | P3 | The Pier is not in the Places menu | add it to the bake's landmark list and re-bake `public/world` |
| 29 | P3 | Tree rows between Freedom Square and the administration come from OSM `tree_row` ways drawn after 2022 (ids ~1.17e9); the owner says the square has few or no trees | owner to confirm whether they stood there before 2022; if not, exclude them |
| 30 | P3 | The Frigate (First Shipbuilders) monument next to the Pier is not modelled; thin grass slivers remain at the edges of the square's paving | model the monument; clip edge pavers to the polygon |
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
