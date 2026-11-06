/** Baked as a u8 per feature; append only. Kherson species and their mix: docs/TREES.md. */
export const SPECIES = {
  GENERIC: 0, CHESTNUT: 1, LINDEN: 2, ACACIA: 3, POPLAR: 4, WILLOW: 5, PINE: 6, PLANE: 7,
  MAPLE: 8, ELM: 9, GLEDITSIA: 10, MULBERRY: 11, AILANTHUS: 12, CATALPA: 13, THUJA: 14, WALNUT: 15,
  BUSH: 16, BUSH_LILAC: 17, BUSH_PINK: 18,
} as const;

export const TREE_SPECIES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
export const BUSH_SPECIES: readonly number[] = [16, 17, 18];
export const VARIANTS = 3;
