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
| Phase 3: buildings and bridges as 1 m blocks | 🟡 blocks and bridges done; shop signs open | `657dc30` |
| City limited to Kherson (OSM relation 2175078) | ✅ | `35e6147` |
| Street search: 686 named streets, former names searchable, teleport onto the street facing along it | ✅ | `90e4bed` |
| Phase 4: 10× near detail (0.2 m trees, props, surface detail, polish) | ⬜ | |
| Later: time of day, lit windows at dusk | ⬜ | |

## Open tasks

### Phase 3 (remaining)
- ⬜ **Shop signs**: Ukrainian names of the ~476 named shop/amenity points as a `CanvasTexture` atlas (system font), quads above the nearest shop front.

### Phase 4
- ⬜ 0.2 m trees and bushes within 40 m (25 m on phone), ≤ 6k triangles per tree, leaf cut-out pattern, crown AO.
- ⬜ Street props (instanced): lamps (189 OSM + generated every 25–35 m along lit roads), bus shelters (309), traffic lights (154), benches and bins along park paths, fences/walls from `barrier` lines, bollards. The snapshot has no benches, bins or entrances, so these are generated deterministically.
- ⬜ Surface micro-detail ≤ 10 cm: brick courses, plaster stains, panel seams, asphalt cracks and patches, grass tufts; fade with distance.
- ⬜ Cross-fade (dithered, ~0.3 s) when 0.2 m ground and 1 m blocks swap in.
- ⬜ Performance pass against Article 4; phone tuning.

### Later
- ⬜ Time of day with lit windows at dusk.

## Open issues

Priority: **P1** must fix soon (licence or budget breach) · **P2** visible defect · **P3** minor.

| # | P | Issue | Notes / proposed fix |
|---|---|---|---|
| 1 | P1 | No in-app "© OpenStreetMap contributors" credit (ODbL, Constitution 8.1) | small corner link in the UI, both languages |
| 2 | P1 | Draw calls over budget at altitude: 409 at 900 m, 576 at 1,600 m (limit 400) | disable 0.2 m ground and 1 m block tiers above ~300 m |
| 3 | P1 | Draw calls tight at street level: 377/400 worst measured | merge meshes before adding props or signs |
| 4 | P2 | 1 m / 2 m seam on buildings straddling the 250 m block-tier edge | fade, or extend a building's tier by ownership |
| 5 | P2 | 0.2 m ground AO near walls uses the 2 m building outline (halo up to 1 m off) | use the 1 m block column raster |
| 6 | P2 | Street trees and bushes placed on the 2 m grid may sit on fine asphalt or inside 1 m building edges | re-check placement against vector roads and 1 m footprints; unverified |
| 7 | P2 | Water edges still 2 m staircases with brown soil steps | fine-tier shoreline from water polygons |
| 8 | P2 | No lane markings on bridge decks | paint deck tops in the fine ground pass |
| 9 | P2 | Long land approaches of bridges may sag between ≤ 64 m road pieces | only the Ostrivske bridge checked; smooth profile across pieces |
| 10 | P2 | Left bank reads as plain flat grass after the city cut | floodplain look: reeds, willows, wetland colours |
| 11 | P2 | Walking on bridges uses the 2 m deck height; railings aren't solid | use the 1 m deck and rail columns in FineWorld |
| 12 | P3 | Coarse (2 m) facade tint varies per 24 m wall segment, not per building | needs a building id or palette in the coarse data |
| 13 | P3 | Coarse painted windows can be cut at wall-run ends | shader doesn't know run boundaries |
| 14 | P3 | No AO on vertical faces of 1 m blocks (disabled for the triangle budget) | shader-based reveal darkening |
| 15 | P3 | Dev HUD coarse triangle counter still counts hidden geometry | subtract hidden ranges |
| 16 | P3 | Areas straddling the city boundary: painted in full in vector tiles, clipped in the coarse tier | clip concave polygons exactly |
| 17 | P3 | Few pines: OSM forests lack `leaf_type` | owner decision below |

## Waiting on the owner

- ⛔ **Real-device frame rates**: open the site on a laptop and a phone, try HQ and LQ, report the fps from the HUD (Constitution open item; decides the 150 m / 250 m tier radii).
- ⛔ **Code licence**: none chosen yet (all rights reserved).
- ⛔ **Phone default**: phones start in LQ, so they don't see the 0.2 m ground and 1 m blocks unless switched to HQ. Keep or change?
- ⛔ **Landmarks removed by the city cut**: bring back the Antonivskyi bridge and/or the Karantynnyi island entry?
- ⛔ **Ambient sound**: owner's listening feedback.
- ⛔ **Pines**: make left-bank forests pine?

## Done (recent fixes)

| Fix | Commit |
|---|---|
| Fly mode fell through the ground → fly collision | before `bcac053` |
| Speckled shop windows (unsnapped wall plane in hashes) | `6dbd080` |
| `PCFSoftShadowMap` removed in three r186 → `PCFShadowMap`; exposure 1.2 → 1.0 | `6dbd080` |
| Sky showing through T-junction cracks in 0.2 m ground → polygon offset over coarse ground | `ac355fd` |
| CI test timeouts → global `testTimeout` 30 s | `c8c85d9` |
