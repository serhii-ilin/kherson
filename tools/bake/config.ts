// East is 32.73, not 32.72, so the Antonivskyi bridge (centreline ~32.720, outline to ~32.721)
// and the city boundary's eastern tip (~32.726) sit inside the grid. The origin is still the
// north-west corner, so x/z of every point that was already inside 32.72 do not move.
// The city mask is still relation 2175078; the bridge is a corridor, not a wider polygon.
export const BBOX = { south: 46.58, west: 32.48, north: 46.72, east: 32.73 };

/**
 * OSM relation of the city of Kherson (type=multipolygon, place=city). The world contains only the city:
 * everything built or farmed outside this boundary (suburbs, villages) is dropped; water and natural land cover stay.
 * The bake fails if the relation is missing from the snapshot.
 */
export const CITY_RELATION = 2175078;
/** The city mask is grown by this many metres so buildings and streets at the edge are not clipped awkwardly. */
export const CITY_DILATE_M = 20;
