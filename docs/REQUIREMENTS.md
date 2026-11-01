# Requirements

Notes for the map data. Renderer requirements live with the mesh-renderer work and are not part of this file's data section.

## Map snapshot

The world is Kherson as OpenStreetMap recorded it before the full-scale invasion, not the later damaged map.

- The committed snapshot is built from Geofabrik `ukraine-220101.osm.pbf`: OpenStreetMap as of **2022-01-01** (the file was written 2022-01-02). The invasion began on 2022-02-24.
- `npm run fetch-osm` defaults to an Overpass attic query at `2022-02-01T00:00:00Z`, which is the requested instant. That path stays for a later refresh if the public instance answers. The file in git is the Geofabrik extract, because Overpass returned 502 when this snapshot was built. The two dates are not the same; docs must not call the Geofabrik file a 1 February extract.
- Deploys bake the committed `data/osm/kherson.json.gz`. They do not call Overpass. If that file is missing, bake and fetch may download the GitHub release `osm-2022-01-01` and check `SHA256SUMS`.
- Publishing that release is a manual owner step (`npm run publish-snapshot`, or the `Publish OSM snapshot` workflow). A normal push does not create it.

## Antonivskyi road bridge

The bridge (Wikidata Q4067525, ways that carry the name «Антонівський міст» and `highway`) stands in the Dnipro just outside city relation 2175078. Owner decision: include the pre-war, intact road bridge.

- Do not widen the city polygon to the left bank or to Antonivka.
- Stamp a corridor 30 m around the carriageways and the bridge outline, plus 450 m of trunk approach at each end (`tools/bake/bridge-corridor.ts`).
- The railway Antonivskyi bridge (Wikidata Q4067523) is a different structure and is not part of the corridor.
- The world rectangle's east edge is 32.73 so the span (centreline near 32.720) fits in the grid. West and north stay put, so existing `x`/`z` poses do not move.
