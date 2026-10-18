export const MAT = {
  AIR: 0,
  WATER: 1,
  GRASS: 2,
  ASPHALT: 3,
  SIDEWALK: 4,
  SAND: 5,
  DIRT: 6,
  RAIL: 7,
  PARK: 8,
  FOREST: 9,
  PLAZA: 10,
  // fine-tier ground (0.2 m micro-voxels, src/fine/); ids 11..19 are reserved for ground
  /** Painted road markings: white, slightly worn. */
  MARKING: 11,
  /** Rail / tram steel. */
  STEEL: 12,
  /** Concrete kerb side faces. */
  KERB: 13,
  /** Footway / cycleway paving. */
  PAVING: 14,
  WALL_HOUSE: 20,
  WALL_APART: 21,
  WALL_INDUSTRIAL: 22,
  WALL_CHURCH: 23,
  WALL_PUBLIC: 24,
  // facade styles (ids 25..39 are reserved for walls; the facade shader keys off them)
  WALL_KHRUSH: 25,
  WALL_PANEL: 26,
  WALL_STALIN: 27,
  WALL_MODERN: 28,
  WALL_GARAGE: 29,
  /** Pre-1917 stucco/brick in Kherson's pastel palette: yellow, pink, mint, light blue, cream. */
  WALL_HISTORIC: 30,
  WALL_HISTORIC_PINK: 31,
  WALL_HISTORIC_MINT: 32,
  WALL_HISTORIC_BLUE: 33,
  WALL_HISTORIC_CREAM: 34,
  /** Pastel variants of WALL_HOUSE (20). */
  WALL_HOUSE_YELLOW: 35,
  WALL_HOUSE_PINK: 36,
  WALL_HOUSE_MINT: 37,
  WALL_HOUSE_BLUE: 38,
  ROOF_RED: 40,
  ROOF_GREY: 41,
  ROOF_DARK: 42,
  ROOF_GOLD: 43,
  ROOF_GREEN: 44,
  // 1 m building/bridge blocks (src/fine/volume.ts); ids 45..59 are reserved for block details
  /** Window glass at the back of a carved opening (the facade shader adds reflections, lit windows). */
  GLASS: 45,
  /** Light stone/plaster trim: sills, cornices, plinths, window surrounds. */
  TRIM: 46,
  /** Bare concrete: bridge piers, balcony slabs, panel-block plinths. */
  CONCRETE: 47,
  /** Painted metal: railings, balcony rails, canopies. */
  METAL: 48,
  /** Entrance doors. */
  DOOR: 49,
  /** Shop-front glass (larger, darker than residential windows). */
  SHOPFRONT: 50,
  /** Street-lamp lens: pale by day, glows warm at night (the facade shader). */
  LAMP: 51,
  LEAVES: 60,
  TRUNK: 61,
  BRIDGE: 62,
} as const;

const COLORS: Record<number, number> = {
  [MAT.WATER]: 0x3b78b8,
  [MAT.GRASS]: 0x5fa845,
  [MAT.ASPHALT]: 0x4a4d52,
  [MAT.SIDEWALK]: 0xb4b2ab,
  [MAT.SAND]: 0xe0cf8f,
  [MAT.DIRT]: 0x8a6a45,
  [MAT.RAIL]: 0x6b5a4a,
  [MAT.PARK]: 0x4f9a3c,
  [MAT.FOREST]: 0x2f6b32,
  [MAT.PLAZA]: 0xd2c9b4,
  [MAT.MARKING]: 0xe9e8e1,
  [MAT.STEEL]: 0x8d9298,
  [MAT.KERB]: 0xa9a79f,
  [MAT.PAVING]: 0xa59f96,
  [MAT.WALL_HOUSE]: 0xe8dcc0,
  [MAT.WALL_APART]: 0xc9c4bb,
  [MAT.WALL_INDUSTRIAL]: 0x9a9fa3,
  [MAT.WALL_CHURCH]: 0xf2efe6,
  [MAT.WALL_PUBLIC]: 0xd9c08a,
  [MAT.WALL_KHRUSH]: 0xd8d5cc,
  [MAT.WALL_PANEL]: 0xb9b7b0,
  [MAT.WALL_STALIN]: 0xdcc596,
  [MAT.WALL_MODERN]: 0xc4ccd2,
  [MAT.WALL_GARAGE]: 0x8f8a80,
  [MAT.WALL_HISTORIC]: 0xe6cf86,
  [MAT.WALL_HISTORIC_PINK]: 0xdba7a0,
  [MAT.WALL_HISTORIC_MINT]: 0xa9d2b4,
  [MAT.WALL_HISTORIC_BLUE]: 0xa9c6e0,
  [MAT.WALL_HISTORIC_CREAM]: 0xeadfc2,
  [MAT.WALL_HOUSE_YELLOW]: 0xe9d68d,
  [MAT.WALL_HOUSE_PINK]: 0xe2b3ab,
  [MAT.WALL_HOUSE_MINT]: 0xb4d9bc,
  [MAT.WALL_HOUSE_BLUE]: 0xb4cde6,
  [MAT.ROOF_RED]: 0xb5472f,
  [MAT.ROOF_GREY]: 0x808589,
  [MAT.ROOF_DARK]: 0x45484d,
  [MAT.ROOF_GOLD]: 0xe2b93b,
  [MAT.ROOF_GREEN]: 0x3f7f5a,
  [MAT.LEAVES]: 0x3e8e3a,
  [MAT.TRUNK]: 0x6b4a2b,
  [MAT.BRIDGE]: 0x9b9486,
  [MAT.GLASS]: 0x3d5266,
  [MAT.TRIM]: 0xe6e0d2,
  [MAT.CONCRETE]: 0xa3a19b,
  [MAT.METAL]: 0x4a5258,
  [MAT.DOOR]: 0x5a3f2c,
  [MAT.SHOPFRONT]: 0x2c3a44,
  [MAT.LAMP]: 0xf4ecd0,
};

/** RGB bytes, 3 per material id; unknown ids are magenta. */
export const PALETTE: Uint8Array = (() => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = COLORS[i] ?? 0xff00ff;
    p[i * 3] = (c >> 16) & 255;
    p[i * 3 + 1] = (c >> 8) & 255;
    p[i * 3 + 2] = c & 255;
  }
  return p;
})();

/** Material colour as 0..1 floats. */
export function materialColor(id: number): [number, number, number] {
  const o = (id & 255) * 3;
  return [PALETTE[o]! / 255, PALETTE[o + 1]! / 255, PALETTE[o + 2]! / 255];
}

/** Palette variants (base first) the bake picks from by id hash. */
export const HISTORIC_WALLS: readonly number[] = [
  MAT.WALL_HISTORIC, MAT.WALL_HISTORIC_PINK, MAT.WALL_HISTORIC_MINT, MAT.WALL_HISTORIC_BLUE, MAT.WALL_HISTORIC_CREAM,
];
export const HOUSE_WALLS: readonly number[] = [
  MAT.WALL_HOUSE, MAT.WALL_HOUSE_YELLOW, MAT.WALL_HOUSE_PINK, MAT.WALL_HOUSE_MINT, MAT.WALL_HOUSE_BLUE,
];
