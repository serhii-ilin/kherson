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

### Later
- ⬜ Bollards along plaza edges (optional prop, not placed yet).
- ⬜ Light pools under street lamps at night (needs per-lamp data in the shader).

## Open issues

Priority: **P1** must fix soon (licence or budget breach) · **P2** visible defect · **P3** minor.

| # | P | Issue | Notes / proposed fix |
|---|---|---|---|
| 17 | P3 | Few pines: OSM forests lack `leaf_type` | owner decision below |
| 18 | P2 | Coarse world uses `THREE.BatchedMesh`; browsers without `WEBGL_multi_draw` (possibly older Safari) fall back to one draw per chunk | check on Safari/iOS; keep per-chunk meshes as a fallback if needed |
| 19 | P3 | Above 300 m the sun-shadow map freezes (a fixed 200 m patch); it is redrawn when the time changes | acceptable at that height |
| 24 | P3 | Shadow flicker at low sun (06:30 / 19:45) not checked with motion; `normalBias` grows as the sun gets lower | check while walking at golden hour |
| 23 | P3 | 1 m khrushchevka is 3,962 triangles against the 4,000 test bound: little headroom for more facade detail | trim elsewhere before adding detail |

## Waiting on the owner

- ✅ **Frame rates measured (2026-10-18)**: MacBook Air 16 GB steady 60 fps (display cap), owner's phone 60–90 fps, both on LQ and HQ.
- ⛔ **Code licence**: none chosen yet (all rights reserved).
- ⛔ **Phone default**: phones start in LQ, so they don't see the 0.2 m ground and 1 m blocks unless switched to HQ. The owner's phone runs HQ at 60–90 fps; switch the phone default to HQ?
- ⛔ **Landmarks removed by the city cut**: bring back the Antonivskyi bridge and/or the Karantynnyi island entry?
- ⛔ **Ambient sound**: owner's listening feedback.
- ⛔ **Pines**: make left-bank forests pine?

## Done (recent fixes)

| Fix | Commit |
|---|---|
| #4 Whole-building block-tier assignment across the 250 m edge; #12 per-building coarse tint; #13 facade run boundaries | `f0e8018` |
| #5 Fine AO uses the 1 m footprint raster; #7 polygon-based 0.2 m shoreline and sandy banks | `f0e8018` |
| #6 Vegetation positions are checked against vector roads/buildings; bake nudged 22,742 and dropped 2,853 placements | `f0e8018` |
| #8 Bridge-deck lane markings; #9 continuous multi-piece bridge profiles | `f0e8018` |
| #10 Floodplain reeds, wetland and meadow treatment on the left bank | `f0e8018` |
| #11 1 m bridge deck/rail physics, including walking under decks | `f0e8018` |
| #16 Concave/multi-ring vector-area clipping at the city boundary | `f0e8018` |
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
