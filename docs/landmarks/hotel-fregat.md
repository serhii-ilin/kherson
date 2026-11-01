# Hotel «Фрегат»

Template for a photo-referenced hero landmark. Copy this file for the next one
and fill the same headings. The mesh is `public/landmarks/hotel-fregat.glb`
(Meshopt). The generic extrusion skips OSM way 116810729.

## Identity

| | |
|---|---|
| Name | Hotel «Фрегат» |
| OSM | way [116810729](https://www.openstreetmap.org/way/116810729) |
| Kind | 15-storey slab hotel with a stair tower and a sail-shaped crown |
| Role | Hero model. The rest of the city stays the extruded mid mesh. |

## Photos

The owner's reference photo is private (constitution 7.5). It is not in the
repository and not in the glTF.

| File | Date supplied | What it shows | SHA-256 (first 16) |
|---|---|---|---|
| `evidence/photos/…/06_hotel-fregat.png` | 2026-10-18 | Pre-war hotel: 15-storey slab, yellow balcony bands, tower with a sail crown | `9f9556fefb72f4a9` |

Licence: the owner's own reference, catalogued in [EVIDENCE.md](../EVIDENCE.md).
It is not redistributed. The model is geometry coloured from the palette below,
not a texture taken from the photo.

No photograph dated after 24 February 2022 is used.

## Measurements

From the baked vector tile `v_21_19.bin` (centimetres in the tile, metres here).
The height is the bake's storey figure, not a survey.

| | |
|---|---|
| Footprint centroid | world x 10829.4 m, z 9965.8 m |
| Footprint extent | about 66 m by 86 m |
| Storeys | 15 |
| Slab height | 46 m (about 3.07 m a floor) |
| Stair tower | 8 m square, 8 m above the slab, on the river side of the footprint |
| Sail crown | curved fin, tip about 60 m above the ground |

## Palette

Linear RGB, the vertex colours in the glTF.

| Part | RGB |
|---|---|
| Facade | 0.83, 0.76, 0.66 |
| Glass band | 0.36, 0.46, 0.55 |
| Balcony | 0.91, 0.73, 0.22 |
| Sail | 0.95, 0.95, 0.93 |
| Roof | 0.50, 0.51, 0.53 |
| Tower | 0.74, 0.73, 0.70 |

## Files

| | |
|---|---|
| Mesh | `public/landmarks/hotel-fregat.glb` |
| Generator | `npm run build-fregat` (`tools/build-hotel-fregat.ts`) |
| Shape | `src/landmarks/fregat-model.ts` |
| Loader | `src/landmarks/fregat.ts` (three's MeshoptDecoder) |
| Skip list | `src/mesh/heroes.ts` |

Regenerate the glTF after the footprint or the palette changes, and commit the
glb with the generator. The encoder (`meshoptimizer`) is a dev dependency. The
site does not ship it.
