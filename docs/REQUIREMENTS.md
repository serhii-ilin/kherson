# Voxel Kherson — Requirements

Structured requirements for later reference. Captured from Serhii’s statements on **2026-11-01**, plus constraints already in `CONSTITUTION.md`.

Status keys: **MUST** / **SHOULD** / **MAY**. Open items are marked **OPEN**. Closed decisions stay in section 7 so the question is not lost.

---

## 1. Vision and scope

| ID | Statement | Priority |
|---|---|---|
| VIS-01 | Deliver a **near-realistic, walkable 3D model of pre-war Kherson** (city as it stood before the full-scale invasion on 24 Feb 2022) that anyone can open in a browser. | MUST |
| VIS-02 | Users can **walk the streets and observe** notable places (squares, embankment, landmarks, everyday fabric), not only fly over a schematic map. | MUST |
| VIS-03 | **Ukrainian first**, English complete; respectful tone; no sensational war imagery beyond what unavoidable map data would show — prefer a frozen pre-war epoch so wartime damage is not the default. | MUST |
| VIS-04 | The product remains a **static site** suitable for GitHub Pages: free to run, no backend accounts or API keys at runtime (`CONSTITUTION` Art. 1). | MUST |
| VIS-05 | **Voxel appearance is not a product goal.** Voxels were chosen to save in-browser compute. The visual target is a **realistic 3D city**; the rendering approach **MAY** and **SHOULD** be re-evaluated against that goal. | MUST |

**In scope:** Kherson city (OSM relation 2175078 + margin as today), Dnipro/water context, streets, buildings, vegetation, landmarks, day/night, ambient sound, places search, shareable poses.

**Out of scope (unless later promoted):** full interiors of ordinary buildings; suburbs outside the city cut (Oleshky, etc.) unless the owner expands the mask; war / post-2022 reconstruction as the default world state; analytics/tracking.

---

## 2. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Walk mode with gravity, collision against buildings/ground/water, and step-up suitable for kerbs and embankments. | MUST |
| FR-02 | Fly mode that cannot pass through ground or buildings. | MUST |
| FR-03 | Touch controls with parity for every desktop action (`CONSTITUTION` Art. 3.3). | MUST |
| FR-04 | Places search and teleport (Cyrillic/Latin), including former street names where tagged. | MUST |
| FR-05 | Shareable URL poses (position, view, time, mode). | MUST |
| FR-06 | Time of day (including night lighting behaviour). | SHOULD |
| FR-07 | Ambient procedural audio with mute; no autoplay before a user gesture (`CONSTITUTION` Art. 7.3). | SHOULD |
| FR-08 | Minimap for orientation and teleport. | SHOULD |
| FR-09 | **Hero / memorable sites** are recognisable and more detailed than the generic city fabric, driven by **pre-war photographs** (and dated public imagery), not by post-24-Feb-2022 appearance. | MUST |
| FR-10 | Info / observe affordances (captions, guided walks) **MAY** be added so visitors can learn about places while walking. | SHOULD |
| FR-11 | Hand landmark overrides are **explicit and documented** in code (`CONSTITUTION` Art. 2.2). | MUST |
| FR-12 | OpenStreetMap remains the geometric source of truth for the city fabric; missing heights/detail use deterministic, clearly generic fill (`CONSTITUTION` Art. 2.1). | MUST |

---

## 3. Non-functional requirements

### 3.1 Performance (device tiers)

Primary target: **laptops**, including **integrated GPU**. Phones and desktops are supported.

| ID | Requirement | Priority |
|---|---|---|
| NFR-P01 | Desktop / laptop (incl. mid-range integrated GPU): target **~60 fps** at the spawn (Freedom Square), a park, and over the river, with a documented quality preset. Align with `CONSTITUTION` Art. 4 until budgets are explicitly amended. | MUST |
| NFR-P02 | Phone: target **≥30 fps** on a Low (or equivalent) preset; High quality optional when the device can hold it. | MUST |
| NFR-P03 | A Low quality path must exist so weaker devices fall back without shadows / without the finest tier (`CONSTITUTION` Art. 4). | MUST |
| NFR-P04 | No per-frame allocations in hot update paths; heavy meshing off the main thread (workers) (`CONSTITUTION` Art. 4). | MUST |
| NFR-P05 | Scene triangle / draw-call budgets in `CONSTITUTION` Art. 4 apply until a measured amendment ships with the renderer change. | MUST |

### 3.2 Download size and hosting

| ID | Requirement | Priority |
|---|---|---|
| NFR-D01 | Stay within GitHub Pages limits: **≤1 GB site**, **≤100 MB per file** (`CONSTITUTION` Art. 1.2). | MUST |
| NFR-D02 | Prefer streaming / tiling so first paint does not require downloading the entire city. Bake measured 2026-11-01 under `public/world/`: **20.9 MB** apparent (`du -sb` = 20,904,363 bytes). `du -sh` prints 26M because the ~2,000 small region and vector files are stored in 4 KiB blocks. The **≤30 MB** constitution budget applies until amended for a mesh/texture world. | MUST |
| NFR-D03 | Runtime network access is limited to the site’s own origin — no third-party scripts, CDNs, fonts, or trackers at runtime (`CONSTITUTION` Art. 1.3). | MUST |

### 3.3 Offline resilience

| ID | Requirement | Priority |
|---|---|---|
| NFR-O01 | **Pre-cache OSM** (and bake inputs) so the project can be rebuilt if Overpass/OSM public services are down. | MUST |
| NFR-O02 | Deploys must not call Overpass at CI bake time; use a committed or Release-hosted snapshot (`CONSTITUTION` Art. 1.4). | MUST |
| NFR-O03 | Prefer a GitHub Release (and/or LFS) for frozen pre-war extracts and checksums in addition to the small committed gzip. | SHOULD |

---

## 4. Data requirements

| ID | Requirement | Priority |
|---|---|---|
| DR-01 | Default appearance is **pre-war**. The base file is the current OSM extract. A committed restoration table, generated from Geofabrik `ukraine-220101` (OSM as of 2022-01-01), undoes war-only changes. Buildings and tree rows mapped after January 2022 stay. The bake applies the table and does not call Overpass. | MUST |
| DR-02 | OSM snapshot refresh is deliberate, dated, and reviewed (`CONSTITUTION` Art. 2.4; `docs/DEPLOYMENT.md`). | MUST |
| DR-03 | Bake is **deterministic** (`CONSTITUTION` Art. 2.3). | MUST |
| DR-04 | Offline cache strategy includes: committed `data/osm/*.json.gz`, optional bbox `.osm.pbf` clip, SHA-256, source URL/date; national PBF may live in a Release, not in git. | SHOULD |
| DR-05 | Map data remains **ODbL**; attribution visible in README and UI (`CONSTITUTION` Art. 8.1). | MUST |
| DR-06 | External height/enrichment sources only if redistribution-compatible (see `docs/HEIGHT_SOURCES.md`). | MUST |
| DR-07 | Reference photos: owner evidence under git-ignored `evidence/photos/`; catalogue in `docs/EVIDENCE.md` only (`CONSTITUTION` Art. 6.6, 7.5). | MUST |
| DR-08 | Do not commit or redistribute Google Street View / Photorealistic 3D Tiles content; view-only research at most. | MUST |

---

## 5. Visual realism requirements

| ID | Requirement | Priority |
|---|---|---|
| VR-01 | Aim for a **realistic 3D** walkable city (materials, roofs, facades, street detail) within browser budgets — not a voxel aesthetic for its own sake. | MUST |
| VR-02 | **Re-evaluate the renderer** (voxel vs extruded OSM meshes vs hybrid glTF heroes vs other). Decision and migration path are recorded in the plan Page (“Rendering approach re-evaluation”). | MUST |
| VR-03 | **Memorable sites** must be more detailed than generic fabric, using **pre-war photos** (existing landmark attempts are acknowledged as not yet successful enough). | MUST |
| VR-04 | Prefer licence-clean references: owner photos, Wikimedia Commons / Mapillary with dated pre-2022 captures and explicit licence checks before baking textures. | MUST |
| VR-05 | City fabric may use procedural facades/materials derived from OSM tags + style heuristics until photo-backed data exists. | SHOULD |

---

## 6. Constraints and assumptions

| ID | Constraint / assumption |
|---|---|
| CA-01 | `CONSTITUTION.md` wins on conflicts with convenience; amendments need an explicit commit and owner approval. |
| CA-02 | Node 24+, TypeScript strict, runtime dependency ideally only `three` unless a stated reason adds another (`CONSTITUTION` Art. 5). |
| CA-03 | Verification: `npm test`, `npm run bake`, `npm run build`; visual claims from screenshots/measurements (`CONSTITUTION` Art. 6). |
| CA-04 | Assumption: GitHub Pages remains the host; serverless static delivery remains non-negotiable unless the constitution is amended. |
| CA-05 | Assumption: “Pre-war” means latest verified appearance in ~2016–early 2022 after decommunization renames, without post-invasion damage. |
| CA-06 | Assumption: Primary users are on **laptops**; phones and desktops must not be broken. |
| CA-07 | Open: code licence still unset (`CONSTITUTION` Art. 8.3) — affects redistribution of derived textures (e.g. CC-BY-SA). |

---

## 7. Open questions / decisions

| ID | Question | Needed from |
|---|---|---|
| OQ-01 | Renderer: stay on voxels, or move to a hybrid. **Decided 2026-11-01:** hybrid. The city fabric becomes streamed OSM-extruded meshes with procedural PBR facades; memorable sites become photo-based glTF later (Meshopt/KTX2). The voxel path stays until the meshes cover the city. First slice is `?renderer=mesh` for the centre (see [PROGRESS.md](PROGRESS.md)). | Owner — decided |
| OQ-02 | Bring Antonivskyi bridge / Karantynnyi back past the city cut? | Owner |
| OQ-03 | Freedom Square tree_rows (post-2022 OSM ids) — exclude? | Owner |
| OQ-04 | Phone default quality HQ vs LQ? | Owner |
| OQ-05 | Choose a code licence. | Owner |
| OQ-06 | Locations of timber monument (#34) and standing statue (#36). | Owner |
| OQ-07 | Amend Art. 4 baked-world ≤30 MB if textured mesh streaming exceeds it. | Owner + measured spike |
| OQ-08 | Acceptable use of CC-BY-SA Commons photos as baked texture sources given OQ-05. | Owner |

---

## 8. Traceability

Each requirement traces to a source statement or document. Date: **2026-11-01** (America/Indianapolis) unless noted.

| Req IDs | Source |
|---|---|
| VIS-01, VIS-02, FR-01–FR-02, FR-09 | Serhii: project is a near-realistic walkable pre-war Kherson where you can walk and observe; memorable sites more detailed from pre-war photos (chat 2026-11-01). |
| VIS-05, VR-01, VR-02 | Serhii: voxel look not valuable as such; want realistic 3D city; voxels were for compute savings; re-evaluate (chat 2026-11-01). |
| NFR-O01–O03, DR-02–DR-04 | Serhii: pre-cache OSM in case it goes down (chat 2026-11-01). |
| NFR-P01–P02, CA-06 | Serhii: mostly laptops; phones and desktops too (chat 2026-11-01). |
| This document structure | Serhii: capture all requirements in a structured requirements document (chat 2026-11-01). |
| VIS-03–04, FR-03, FR-07, FR-11–12, NFR-P03–P05, NFR-D01–D03, DR-03, DR-05–DR-07, CA-01–CA-03, CA-07 | `CONSTITUTION.md` (repo, as of clone 2026-11-01). |
| DR-01, VR-03–VR-04, OQ-02–OQ-08 | Derived from the above plus plan review / `docs/PROGRESS.md` open items (2026-11-01). |
| OQ-01 (decision) | Serhii: target is a hybrid on three.js — streamed OSM-extruded meshes with procedural PBR facades, then photo-based hero glTFs (chat 2026-11-01). |

---

## Revision history

| Date | Change |
|---|---|
| 2026-11-01 | Initial capture from Serhii’s statements + constitution fold-in. |
| 2026-11-01 | Committed. Baked-world size corrected to the measured apparent bytes (20.9 MB; 26M was 4 KiB block allocation). OQ-01 recorded as decided. |
