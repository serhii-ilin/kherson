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
| Phase 4: 0.2 m trees, street props, surface micro-detail, cross-fade, draw-call pass | ✅ (laptop 60 fps; phone fps pending) | `418796d` |
| Time of day: sun for Kherson in June, golden hour, moonlit night with stars, lit windows and lamps, time button (uk/en), `?time=HH:MM` | ✅ | `efeb49b` |

## Open tasks

### Later
- ⬜ Bollards along plaza edges (optional prop, not placed yet).
- ⬜ Light pools under street lamps at night (needs per-lamp data in the shader).

## Open issues

Priority: **P1** must fix soon (licence or budget breach) · **P2** visible defect · **P3** minor.

| # | P | Issue | Notes / proposed fix |
|---|---|---|---|
| 4 | P2 | 1 m / 2 m seam on buildings straddling the 250 m block-tier edge | now fades in instead of popping; a real fix assigns each building whole to one tier |
| 5 | P2 | 0.2 m ground AO near walls uses the 2 m building outline (halo up to 1 m off) | use the 1 m block column raster |
| 6 | P2 | Street trees and bushes placed on the 2 m grid may sit on fine asphalt or inside 1 m building edges | re-check placement against vector roads and 1 m footprints; unverified |
| 7 | P2 | Water edges still 2 m staircases with brown soil steps | fine-tier shoreline from water polygons |
| 8 | P2 | No lane markings on bridge decks | paint deck tops in the fine ground pass |
| 9 | P2 | Long land approaches of bridges may sag between ≤ 64 m road pieces | only the Ostrivske bridge checked; smooth profile across pieces |
| 10 | P2 | Left bank reads as plain flat grass after the city cut | floodplain look: reeds, willows, wetland colours |
| 11 | P2 | Walking on bridges uses the 2 m deck height; railings aren't solid | use the 1 m deck and rail columns in FineWorld |
| 12 | P3 | Coarse (2 m) facade tint varies per 24 m wall segment, not per building | needs a building id or palette in the coarse data |
| 13 | P3 | Coarse painted windows can be cut at wall-run ends | shader doesn't know run boundaries |
| 16 | P3 | Areas straddling the city boundary: painted in full in vector tiles, clipped in the coarse tier | clip concave polygons exactly |
| 17 | P3 | Few pines: OSM forests lack `leaf_type` | owner decision below |
| 18 | P2 | Coarse world uses `THREE.BatchedMesh`; browsers without `WEBGL_multi_draw` (possibly older Safari) fall back to one draw per chunk | check on Safari/iOS; keep per-chunk meshes as a fallback if needed |
| 19 | P3 | Above 300 m the sun-shadow map freezes (a fixed 200 m patch); it is redrawn when the time changes | acceptable at that height |
| 20 | P3 | Traffic lights face along the nearest road, not the OSM `dir` | use `dir` when present |
| 21 | P3 | About 10% of shops have no building within 25 m, so no sign; long names are already truncated in OSM | free-standing sign posts for those |
| 22 | P3 | 0.5 m and mid tree models are still built on the main thread (≈2 ms each, up to 9 ms cold) | move to the veg worker if hitches show |
| 24 | P3 | Shadow flicker at low sun (06:30 / 19:45) not checked with motion; `normalBias` grows as the sun gets lower | check while walking at golden hour |
| 25 | P3 | Phones narrower than ~380 px may crowd the top button row (time, quality, sound, language, places) | collapse into a menu if reported |
| 23 | P3 | 1 m khrushchevka is 3,962 triangles against the 4,000 test bound: little headroom for more facade detail | trim elsewhere before adding detail |

## Waiting on the owner

- ⛔ **Phone frame rate**: open the site on a phone, try HQ and LQ, report the fps from the HUD. Laptop done: MacBook Air 16 GB holds a steady 60 fps (display cap) on both LQ and HQ (2026-10-18), so the desktop 150 m / 250 m tier radii stay.
- ⛔ **Code licence**: none chosen yet (all rights reserved).
- ⛔ **Phone default**: phones start in LQ, so they don't see the 0.2 m ground and 1 m blocks unless switched to HQ. Keep or change?
- ⛔ **Landmarks removed by the city cut**: bring back the Antonivskyi bridge and/or the Karantynnyi island entry?
- ⛔ **Ambient sound**: owner's listening feedback.
- ⛔ **Pines**: make left-bank forests pine?

## Done (recent fixes)

| Fix | Commit |
|---|---|
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
