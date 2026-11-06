# ADR 0002: Realistic buildings and roads

Status: **accepted** (owner direction, 2026-11-06). The design and the task breakdown are in [BUILDINGS_PLAN.md](../BUILDINGS_PLAN.md). This record fixes the choices that the tasks depend on.

## Context

The owner asked for buildings and roads that look photo-realistic, as Kherson was before 24 February 2022, especially in the well-known areas: Freedom Square, Ushakova Avenue, the embankment with Hotel «Фрегат», and the old town / Fortress. The pre-war data is already in place (`data/osm/restoration.json`). The look is not:

- Every building is an extruded footprint of about 40 triangles with a procedural window grid (`src/mesh/extrude.ts`, `src/mesh/facade.ts`). There are no textures, no window depth and no balconies. There is one level of detail, and no way to replace a particular OSM building.
- Roads keep only a paved/unpaved bit of `surface`. Beyond the 150 m fine radius they are flat 2 m cells. All ground shading is procedural Lambert noise.

ADR 0001 planned hero landmarks as photo-based glTF with Meshopt and KTX2. This record replaces that part.

## Decisions

1. **Three tiers of realism.**
   - **G (generic, the whole city):** CC0 PBR materials, near-LOD geometry (window reveals, entrances, balconies, cornices) and roof materials.
   - **K (known streets):** one JSON facade descriptor per building (`data/facades/*.json`, keyed `w<id>` / `r<id>`), researched from dated photos and built by an architectural kit. Used for Ushakova Avenue and Suvorova Street.
   - **H (heroes):** about 16 bespoke parametric models, some with rectified photo facades.
2. **Heroes are parametric TypeScript models, not glTF.** There is no Blender or glTF authoring tool in the toolchain. Code is deterministic (Article 2.3), reviewable, testable without a DOM (Article 5.4), and costs no download bytes for geometry. Only photo textures are downloaded.
3. **Textures are WebP in `DataArrayTexture`s, not KTX2.** KTX2 needs the Basis transcoder as another runtime binary (the same reason the trees use procedural arrays). Material layers are 512² on High and 256² on Low. About 20 layers × 2 maps come to about 56 MB / 14 MB of GPU memory with mipmaps. The files have no alpha channel, because browser canvas decoding premultiplies alpha: `_a` is albedo with ambient occlusion baked in, and `_n` is normal xy plus roughness in blue, with z rebuilt in the shader. Facade photos are single textures of at most 2048 px, loaded within 600 m of their building and released beyond 900 m.
4. **Sources.**
   - Materials: CC0 from ambientCG and Poly Haven.
   - Facade photos: CC0, CC-BY, CC-BY-SA or public domain, dated before 24 February 2022, never Google content (Constitution 8.3, amendment 7).
   - Provenance goes in `docs/ASSET_CREDITS.md` and an in-app credits panel.
   - The owner's private evidence photos are only used to check results (Constitution 6.6 / 7.5).
5. **Replacing OSM buildings.** A landmark lists the buildings it replaces (`Landmark.replaces`), and so does every K descriptor. The mesh streamer skips those ids in every LOD. The vector tile v3 keeps the OSM element type, so a way and a relation with the same number are not confused.
6. **Budgets.** `public/assets/` ≤ 15 MB (Constitution Article 4); the baked world stays ≤ 30 MB.

   The near-building row of ADR 0001 is replaced. Near LOD covers 100 m on desktop and 50 m on a phone, with at most 3,000 triangles per building and about 120 on average. The building layer stays under 250k / 80k resident triangles (laptop / phone).

   A hero is at most 40k triangles near and 4k beyond 250 m. Scene caps are unchanged.

## Consequences

- The vector tile format moves to v3. The decoder still reads v2, so a cached tile from an older deploy does not break a newer client.
- Fine-only ground materials take ids from 64 up. The 11–19 ground range is full.
- Getting each hero right depends on research: each one needs a brief with dated sources and dimensions before an implementer can build it.
