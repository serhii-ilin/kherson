import { describe, it, expect } from 'vitest';
import { cardShaderChunks, groupOf, modelOf, slotScale, whiteOf } from '../src/nature/vegetation.ts';
import { BUSH_SPECIES, SPECIES, TREE_SPECIES, VARIANTS } from '../src/nature/models.ts';
import { variantScale } from '../src/nature/realistic.ts';
import { FEATURE_BUSH, FEATURE_TREE, type Feature } from '../src/world/format.ts';

const ALL_SPECIES = [...TREE_SPECIES, ...BUSH_SPECIES];
const N_SPECIES = ALL_SPECIES.length;
const N_MODELS = N_SPECIES * VARIANTS;
/** Group slots per model: 0 = lod3, 1 = lod0, 2 = lod2, 3 = lod1. */
const SLOTS = 4;

function feature(type: number, param: number, species: number = SPECIES.GENERIC, seed = 0): Feature {
  return { type, param, x: 0, z: 0, species, seed };
}

describe('groupOf', () => {
  it('keeps slots 0 and 1 on their own variant', () => {
    for (let m = 0; m < N_MODELS; m++) {
      expect(groupOf(m, 0)).toBe(m * SLOTS);
      expect(groupOf(m, 1)).toBe(m * SLOTS + 1);
    }
  });

  it('maps the mid and far slots of variants 1 and 2 to variant 0', () => {
    for (let base = 0; base < N_MODELS; base += VARIANTS) {
      for (let v = 0; v < VARIANTS; v++) {
        const m = base + v;
        expect(groupOf(m, 2), `model ${m} slot 2`).toBe(base * SLOTS + 2);
        expect(groupOf(m, 3), `model ${m} slot 3`).toBe(base * SLOTS + 3);
      }
    }
  });

  it('never reuses a slot for a different model', () => {
    const seen = new Map<number, string>();
    for (let m = 0; m < N_MODELS; m++) {
      for (let s = 0; s < SLOTS; s++) {
        const g = groupOf(m, s);
        const owner = s >= 2 ? `base ${m - (m % VARIANTS)} slot ${s}` : `model ${m} slot ${s}`;
        expect(seen.get(g) ?? owner, `group ${g}`).toBe(owner);
        seen.set(g, owner);
      }
    }
  });

  it('creates exactly the reachable groups', () => {
    const groups = new Set<number>();
    for (let m = 0; m < N_MODELS; m++) {
      for (let s = 0; s < SLOTS; s++) groups.add(groupOf(m, s));
    }
    expect(groups.size).toBe(N_SPECIES * (VARIANTS * 2 + 2));
  });
});

describe('slotScale', () => {
  it('leaves the near slots unchanged', () => {
    for (let m = 0; m < N_MODELS; m++) {
      expect(slotScale(m, 0)).toBe(1);
      expect(slotScale(m, 1)).toBe(1);
    }
  });

  it('scales the shared mid and far models by the variant ratio', () => {
    for (let base = 0; base < N_MODELS; base += VARIANTS) {
      for (let v = 0; v < VARIANTS; v++) {
        const m = base + v;
        const ratio = variantScale(v) / variantScale(0);
        for (const s of [2, 3]) {
          expect(slotScale(m, s), `model ${m} slot ${s}`).toBeCloseTo(ratio, 6);
        }
      }
    }
  });
});

describe('whiteOf', () => {
  it('marks only street and tree-row trees as whitewashed', () => {
    expect(whiteOf(feature(FEATURE_TREE, 6))).toBe(1);
    expect(whiteOf(feature(FEATURE_TREE, 5))).toBe(0);
    expect(whiteOf(feature(FEATURE_TREE, 0))).toBe(0);
    expect(whiteOf(feature(FEATURE_BUSH, 6))).toBe(0);
    expect(whiteOf(feature(FEATURE_BUSH, 1))).toBe(0);
  });
});

describe('modelOf', () => {
  it('keeps explicit species', () => {
    for (const species of ALL_SPECIES) {
      for (let seed = 0; seed < 8; seed++) {
        const m = modelOf(feature(FEATURE_TREE, 5, species, seed));
        expect(ALL_SPECIES[Math.floor(m / VARIANTS)]).toBe(species);
      }
    }
  });

  it('maps GENERIC by the seed to maple, elm, linden or chestnut, never to GENERIC', () => {
    const allowed = new Set<number>([SPECIES.MAPLE, SPECIES.ELM, SPECIES.LINDEN, SPECIES.CHESTNUT]);
    const seen = new Set<number>();
    for (let seed = 0; seed < 256; seed++) {
      const m1 = modelOf(feature(FEATURE_TREE, 5, SPECIES.GENERIC, seed));
      const m2 = modelOf(feature(FEATURE_TREE, 5, SPECIES.GENERIC, seed));
      expect(m1, `seed ${seed}`).toBe(m2);
      const species = ALL_SPECIES[Math.floor(m1 / VARIANTS)]!;
      expect(species, `seed ${seed}`).not.toBe(SPECIES.GENERIC);
      expect(allowed.has(species), `seed ${seed} species ${species}`).toBe(true);
      seen.add(species);
    }
    expect(seen.size).toBe(4);
  });

  it('picks the species from bits 3 and 4 of the seed', () => {
    const expected = [SPECIES.MAPLE, SPECIES.ELM, SPECIES.LINDEN, SPECIES.CHESTNUT];
    for (let seed = 0; seed < 64; seed++) {
      const m = modelOf(feature(FEATURE_TREE, 5, SPECIES.GENERIC, seed));
      expect(ALL_SPECIES[Math.floor(m / VARIANTS)]).toBe(expected[(seed >> 3) & 3]);
    }
  });
});

describe('realistic tree shader chunks', () => {
  const glsl = cardShaderChunks().join('\n');

  it('samples texture arrays', () => {
    expect(glsl).toContain('sampler2DArray');
    expect(glsl).toContain('texture( uLeafArr');
    expect(glsl).toContain('texture( uBarkArr');
  });

  it('declares the whitewash and sun uniforms', () => {
    expect(glsl).toContain('aWhite');
    expect(glsl).toContain('uSunDir');
    expect(glsl).toContain('uSunColor');
  });

  it('keeps the alpha cut-out at 0.4 in both passes', () => {
    expect(glsl.match(/< 0\.4/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
