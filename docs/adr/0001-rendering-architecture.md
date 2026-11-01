# ADR 0001: Rendering architecture

Status: **accepted** (owner direction, 2026-11-01). Realistic rendering is for the whole city, not a centre box. This record chooses how. It does not implement the later phases.

The centre prototype in this PR (`?renderer=mesh`, box x 9984–11264, z 8320–10496) is phase 0 only. It stays small so the pull request can be reviewed.

## Context

The live city is a 2 m voxel grid, plus a 0.2 m ground tier and a 1 m block tier for nearby buildings. Voxels were a way to mesh OpenStreetMap cheaply. The product goal is a realistic walkable city ([REQUIREMENTS.md](../REQUIREMENTS.md) VIS-05, VR-01).

Measured on the current bake (10,118 buildings in the city mask, Freedom Square spawn 10293, 8817):

| Quantity | Value | Source |
|---|---:|---|
| Buildings in the centre prototype | 785 | `tools/mesh-report.ts` |
| Triangles for those buildings | 31,360 | same (39.9 triangles each) |
| GPU buffers for those buildings | 4.65 MB | same (5.9 KB each) |
| Vector tiles for that box and its neighbours | 0.25 MB, 35 files | same |
| Whole-city vector tiles | 2.09 MB, 937 files | bake log, 2026-11-01 |
| Baked world | 20.9 MB apparent | `du -sb public/world` |
| Scene at the square, voxel, headless | 1,120,506 triangles, 210 draws | `renderer.info`, SwiftShader, 1280×720, high quality |
| Same pose, mesh prototype | 982,870 triangles, 200 draws | same; building meshes 17,169 triangles, 2.55 MB resident |

Most of the scene is ground, trees and water. Swapping the 1 m blocks (145k triangles at that pose) for extruded meshes (17k) lowered the scene count. The building layer is not what fills the Article 4 caps (2.5M triangles / 400 draws desktop, 0.9M / 200 phone).

[PR #2](https://github.com/serhii-ilin/kherson/pull/2) replaces the OSM snapshot with a pre-war extract (about 5,012 buildings inside the mask, plus the Antonivskyi corridor). It is being reworked and will merge first. This branch should be rebased onto it before this PR merges. Counts below use ~10,100 buildings, the current bake, so they stay an upper bound if the pre-war extract has fewer footprints.

## Options

### A. Delete the voxel renderer in one step

Buildings, ground, collision, the minimap and the overview all move at once. Walking breaks until the new collision exists. Too much for one review, and there is no fallback if a pose is wrong.

### B. Keep voxels as the distant LOD only

Near and mid distances become meshes. Beyond the view radius the 2 m chunks and the 16 m overview stay voxel. Fast to ship, and collision can stay on the columns for a while.

The skyline stays blocky, which fails the "whole city" direction as soon as you look up. Two meshing pipelines remain forever: the voxel mesher and the extruder. Column physics keeps the staircased walls that the meshes were meant to leave behind.

### C. Mesh levels of detail everywhere, then delete the voxel buildings

| Distance | What is drawn | Role |
|---|---|---|
| Near (about 0–150 m desktop, 0–70 m phone) | Extruded footprints with the facade shader, street props, and photo glTF for hero landmarks | The street you are standing on |
| Mid (to the Article 4 full-detail radius: 640 m / 384 m) | The same extruder, simplified: walls, one roof, no parapet thickness, no dome rings | The next blocks |
| Far | Not a building each. A merged low-poly mesh per region, or the existing overview height field used as an impostor skyline | Horizon |

Ground stays a height field (the fine raster up close, the overview farther out), not a column of voxels with a building stuffed in the same cell. Water, vegetation and birds stay as they are.

## Decision

**Option C.** Realism has to cover the city the camera can see, including the horizon, so voxels are not the far building representation. They also should not be deleted in this pull request. Each phase below is its own PR. The last phase deletes the voxel building path once nothing reads it.

Option B is only the fallback drawn for a chunk whose mesh is not ready yet. It is not the end state.

## Collision, minimap, overview

These three still assume the voxel grid. They move off it before the grid is deleted.

**Walking and flying.** `Walk` and `Fly` call `heightAt`, which reads coarse structure columns and, up close, the 1 m block columns. The mesh prototype does not change that: you still stop on the voxel wall, which is why a diagonal mesh can be slightly ahead of the collision. The replacement is a ground height (the fine raster, then a coarse height grid) plus a prism test against the streamed footprint (point in the polygon, height and `min_height` from the vector tile). Bridges stay polylines with a deck height, not a column of cells. Step-up and the "no falling through the ground" tests move with it.

**Minimap.** It already draws a picture of `overview.bin`, not a live column sample (`Minimap.setBackground`). When the overview is no longer baked from voxel cells, the minimap follows that image. No new runtime path.

**Overview.** `overview.bin` is a 16 m greedy height field (`BLOCK_M` in `src/world/lod.ts`). Keep that shape for the far skyline. Bake it from landuse and the maximum building height in each cell, not from the 2 m struct grid. Until that bake exists, the current overview remains the far impostor.

## Budgets

Arithmetic from the measurement, not a device frame time. Headless SwiftShader ran at about one frame a second for both paths; that number is not a laptop result. The owner's MacBook Air still stands at 60 fps for the voxel build (2026-10-18). Article 4 is not amended here. A later phase that misses 60 fps on a laptop amends the table in its own commit, before the code that depends on the new numbers.

**If every building used the prototype mesh and all of them were resident** (the figure to avoid):

- 10,100 / 785 × 31,360 ≈ **404,000 triangles**
- 10,100 / 785 × 4.65 MB ≈ **60 MB** of building buffers

A laptop iGPU can hold 60 MB. The phone scene cap is 0.9M triangles for everything, and one pose is already ~1.1M before those 404k are added. The whole city must not be uploaded at once. Streaming is the budget.

Planning density for the upper bound: the centre box averages 785 / 2.79 km² ≈ 280 buildings/km², river included. Budgets below use **560 / km²** (twice that) so a built-up block is not under-counted. Near-detail triangles are **120 per building** (about 3× the prototype's 40, for thicker props on the building itself). Mid triangles are **16 per building** (a box and a roof). Props and hero glTF are separate caps, not multiplied per ordinary building.

| Tier | Laptop iGPU (primary) | Phone | Desktop |
|---|---|---|---|
| Near radius | 150 m | 70 m | 200 m |
| Near buildings, upper bound | ~60 × 120 tris ≈ 7k | ~15 × 80 tris ≈ 1k | ~100 × 120 tris ≈ 12k |
| Props in that radius | ≤ 40k tris | ≤ 15k tris | ≤ 60k tris |
| Hero glTF in view | one, ≤ 40k tris | none on Low; one on High if the frame holds | two, ≤ 80k tris |
| Mid buildings | annulus to 640 m, ≤ 40k tris | annulus to 384 m, ≤ 20k tris | annulus to 800 m, ≤ 60k tris |
| Far skyline | overview / region impostor ≤ 80k tris | ≤ 40k tris, shadows off | ≤ 100k tris |
| **Building layer, resident** | **under 250k tris, under 20 MB** | **under 80k tris, under 8 MB** | **under 350k tris, under 30 MB** |
| Scene cap (Article 4, unchanged) | 2.5M tris, ~400 draws, 60 fps | 0.9M tris, ~200 draws, 30 fps | same as the laptop column |

The building layer is a slice of the scene cap, not a new cap. Trees, ground and water keep the rest. Resident GPU is the streamed window, not the 60 MB all-resident figure.

Download does not grow with these triangles: the fabric is generated from vector tiles already inside the 20.9 MB bake (2.09 MB of that is the tiles). Hero textures are the new bytes. Plan on ≤ 2 MB of KTX2 per hero and ≤ 8 heroes in the first set (≤ 16 MB), fetched when the camera approaches, not at first paint. That needs the Article 4 bake budget amended when it is real (requirements OQ-07), not before.

## Migration

Each row is a pull request. Do not start the next one inside this PR.

PR #2 merges first. Rebase this branch onto it, re-run `npm test`, `npm run bake`, `npm run build`, and `tools/mesh-report.ts`, and correct the building count in [PROGRESS.md](../PROGRESS.md) if the pre-war extract changes it. Then the phases:

| Phase | PR | What it does | Voxels |
|---|---|---|---|
| 0 | this PR | Centre prototype, this ADR, PR checks | Still the default everywhere, and the fallback inside the box until a mesh chunk is installed |
| 1 | rebase onto PR #2 | Pre-war bake only. No renderer change beyond what the new footprints do | Unchanged |
| 2 | whole-city mid meshes | `?renderer=mesh` (or the high-quality default, behind the flag until it is measured) extrudes every loaded chunk, not only the centre box. Same worker and the same simplified mesh as today | Drawn only where the mesh is not ready |
| 3 | near detail | Props and shop signs move off the 1 m block tier. First hero glTF: Hotel «Фрегат», way 116810729, Meshopt + KTX2 | Block tier still exists outside the near radius |
| 4 | far skyline | Overview (or one merged mesh per region) replaces coarse voxel buildings on the horizon. Coarse struct meshes stop being drawn | Ground columns may still feed collision |
| 5 | collision and overview bake | `heightAt` becomes ground height plus footprint prisms. Overview and the minimap image are baked from that, not from struct cells | No runtime reader of struct columns |
| 6 | delete the voxel buildings | Remove the coarse struct mesher, the 1 m block tier, and the building branch of the facade shader. Ground, water, vegetation, birds stay | **Voxel building renderer deleted** |

Phase 6 is the recommendation, not a maybe. It waits until phase 5 has removed the last reader. If a laptop misses 60 fps, the constitution table changes in a commit of its own before phase 6.

## Consequences

- This PR does not widen the centre box. Doing that here would mix a prototype with a city-wide switch.
- Two pipelines stay until phase 6. That is the cost of a reviewable migration. The ADR is what stops the centre box being mistaken for the product.
- Article 4 is still in force. The estimates above fit inside it. They are not a measurement on a laptop, and they must be replaced with one before the flag becomes the default.
