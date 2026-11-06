/**
 * Texture-array layers for realistic trees: the contract between the model builder
 * (`realistic.ts`, which writes a layer index per vertex into `VegModel.tex`), the texture
 * generator (`tree-textures.ts`) and the renderer (`vegetation.ts`, which samples a
 * `sampler2DArray`). Append only: a layer's index never changes.
 * Species and their look are documented in docs/TREES.md.
 */
import { SPECIES } from './species.ts';

/** Leaf-cluster layers, in texture-array order. */
export const LEAF_LAYER = {
  /** Horse chestnut: five to seven leaflets fanned from one point. */
  PALMATE: 0,
  /** Linden: small heart-shaped leaves. */
  HEART: 1,
  /** Catalpa: large pale heart-shaped leaves. */
  BIG_HEART: 2,
  /** Maple and plane: lobed leaves. */
  LOBED: 3,
  /** Robinia and gleditsia: fine pinnate leaflets, airy. */
  PINNATE_FINE: 4,
  /** Ailanthus and walnut: long pinnate fronds. */
  PINNATE_LONG: 5,
  /** Elm and mulberry: small serrated leaves on twigs. */
  SMALL_SERRATE: 6,
  /** Willow: narrow lanceolate leaves. */
  LANCEOLATE: 7,
  /** Poplar: triangular leaves. */
  TRIANGULAR: 8,
  /** Pine: needle tufts. */
  NEEDLE_TUFT: 9,
  /** Thuja (Platycladus): flat scale-leaf sprays. */
  SCALE_SPRAY: 10,
  /** Lilac and pink bush blossom clusters. */
  BLOSSOM: 11,
} as const;

export const LEAF_LAYERS = 12;

/** Bark layers, in texture-array order. */
export const BARK_LAYER = {
  /** Deep vertical furrows: robinia, gleditsia, elm, willow, mulberry. */
  FURROWED: 0,
  /** Plane: camouflage patches of olive, cream and grey. */
  MOTTLED: 1,
  /** Poplar, ailanthus, walnut: smooth grey with lenticels. */
  SMOOTH_LENTICEL: 2,
  /** Pine: grey-brown plates low, thin orange bark high up. */
  PLATED_PINE: 3,
  /** Thuja: fibrous reddish strips. */
  FIBROUS: 4,
  /** Linden, maple, chestnut, catalpa: fine shallow fissures. */
  FINE: 5,
} as const;

export const BARK_LAYERS = 6;

export interface SpeciesLayers {
  leaf: number;
  bark: number;
}

/** Leaf and bark layer of every species id; GENERIC renders as a linden. */
export const SPECIES_LAYERS: Readonly<Record<number, SpeciesLayers>> = {
  [SPECIES.GENERIC]: { leaf: LEAF_LAYER.HEART, bark: BARK_LAYER.FINE },
  [SPECIES.CHESTNUT]: { leaf: LEAF_LAYER.PALMATE, bark: BARK_LAYER.FINE },
  [SPECIES.LINDEN]: { leaf: LEAF_LAYER.HEART, bark: BARK_LAYER.FINE },
  [SPECIES.ACACIA]: { leaf: LEAF_LAYER.PINNATE_FINE, bark: BARK_LAYER.FURROWED },
  [SPECIES.POPLAR]: { leaf: LEAF_LAYER.TRIANGULAR, bark: BARK_LAYER.SMOOTH_LENTICEL },
  [SPECIES.WILLOW]: { leaf: LEAF_LAYER.LANCEOLATE, bark: BARK_LAYER.FURROWED },
  [SPECIES.PINE]: { leaf: LEAF_LAYER.NEEDLE_TUFT, bark: BARK_LAYER.PLATED_PINE },
  [SPECIES.PLANE]: { leaf: LEAF_LAYER.LOBED, bark: BARK_LAYER.MOTTLED },
  [SPECIES.MAPLE]: { leaf: LEAF_LAYER.LOBED, bark: BARK_LAYER.FINE },
  [SPECIES.ELM]: { leaf: LEAF_LAYER.SMALL_SERRATE, bark: BARK_LAYER.FURROWED },
  [SPECIES.GLEDITSIA]: { leaf: LEAF_LAYER.PINNATE_FINE, bark: BARK_LAYER.FURROWED },
  [SPECIES.MULBERRY]: { leaf: LEAF_LAYER.SMALL_SERRATE, bark: BARK_LAYER.FURROWED },
  [SPECIES.AILANTHUS]: { leaf: LEAF_LAYER.PINNATE_LONG, bark: BARK_LAYER.SMOOTH_LENTICEL },
  [SPECIES.CATALPA]: { leaf: LEAF_LAYER.BIG_HEART, bark: BARK_LAYER.FINE },
  [SPECIES.THUJA]: { leaf: LEAF_LAYER.SCALE_SPRAY, bark: BARK_LAYER.FIBROUS },
  [SPECIES.WALNUT]: { leaf: LEAF_LAYER.PINNATE_LONG, bark: BARK_LAYER.SMOOTH_LENTICEL },
  [SPECIES.BUSH]: { leaf: LEAF_LAYER.SMALL_SERRATE, bark: BARK_LAYER.FINE },
  [SPECIES.BUSH_LILAC]: { leaf: LEAF_LAYER.HEART, bark: BARK_LAYER.FINE },
  [SPECIES.BUSH_PINK]: { leaf: LEAF_LAYER.SMALL_SERRATE, bark: BARK_LAYER.FINE },
};

/** Layers for any species id, falling back to the linden look for unknown ids. */
export function speciesLayers(species: number): SpeciesLayers {
  return SPECIES_LAYERS[species] ?? SPECIES_LAYERS[SPECIES.LINDEN]!;
}
