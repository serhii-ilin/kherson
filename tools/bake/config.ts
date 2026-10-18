export const BBOX = { south: 46.58, west: 32.48, north: 46.72, east: 32.72 };

/**
 * OSM relation of the city of Kherson (type=multipolygon, place=city). The world contains only the city:
 * everything built or farmed outside this boundary (suburbs, villages) is dropped; water and natural land cover stay.
 * The bake fails if the relation is missing from the snapshot.
 */
export const CITY_RELATION = 2175078;
/** The city mask is grown by this many metres so buildings and streets at the edge are not clipped awkwardly. */
export const CITY_DILATE_M = 20;
