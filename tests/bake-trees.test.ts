import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/nature/species.ts';
import { MAT } from '../src/world/materials.ts';
import {
  nearWaterWillow,
  pick,
  speciesOfTags,
  TREE_PARAM,
  TREE_PARAM_WHITEWASH,
  T_FOREST,
  T_MEADOW,
  T_PARK,
  T_REED,
  T_ROW,
  T_SAND_FOREST,
  T_SCRUB,
  T_STREET,
  T_UNTAGGED,
  T_WETLAND,
  type Table,
} from '../tools/bake/trees.ts';

const TABLES: readonly [string, Table][] = [
  ['T_STREET', T_STREET],
  ['T_PARK', T_PARK],
  ['T_ROW', T_ROW],
  ['T_UNTAGGED', T_UNTAGGED],
  ['T_FOREST', T_FOREST],
  ['T_MEADOW', T_MEADOW],
  ['T_SCRUB', T_SCRUB],
  ['T_SAND_FOREST', T_SAND_FOREST],
  ['T_WETLAND', T_WETLAND],
  ['T_REED', T_REED],
];

const shareOf = (table: Table, species: number): number => {
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  const weight = table.reduce((sum, [s, w]) => (s === species ? sum + w : sum), 0);
  return weight / total;
};

describe('bake trees', () => {
  it('picks deterministically and in proportion to the weights', () => {
    const N = 10_000;
    for (const [name, table] of TABLES) {
      const counts = new Map<number, number>();
      for (let i = 0; i < N; i++) {
        const r = (i + 0.5) / N;
        const a = pick(table, r);
        expect(pick(table, r)).toBe(a);
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      for (const [species] of table) {
        const share = (counts.get(species) ?? 0) / N;
        expect(Math.abs(share - shareOf(table, species)), `${name} species ${species}`).toBeLessThan(0.01);
      }
    }
  });

  it('never falls back to GENERIC in any table', () => {
    for (const [name, table] of TABLES) {
      expect(table.some(([s]) => s === SPECIES.GENERIC), name).toBe(false);
    }
  });

  it('matches the street, park and tree-row mixes in docs/TREES.md', () => {
    expect(T_STREET).toEqual([
      [SPECIES.ACACIA, 22], [SPECIES.PLANE, 12], [SPECIES.CHESTNUT, 12], [SPECIES.LINDEN, 12],
      [SPECIES.MAPLE, 12], [SPECIES.ELM, 8], [SPECIES.GLEDITSIA, 6], [SPECIES.CATALPA, 5],
      [SPECIES.POPLAR, 5], [SPECIES.AILANTHUS, 3], [SPECIES.MULBERRY, 3],
    ]);
    expect(T_PARK).toEqual([
      [SPECIES.CHESTNUT, 15], [SPECIES.MAPLE, 14], [SPECIES.LINDEN, 12], [SPECIES.ACACIA, 10],
      [SPECIES.PLANE, 8], [SPECIES.ELM, 8], [SPECIES.POPLAR, 8], [SPECIES.THUJA, 5],
      [SPECIES.PINE, 4], [SPECIES.CATALPA, 4], [SPECIES.GLEDITSIA, 4], [SPECIES.WILLOW, 4],
      [SPECIES.AILANTHUS, 2], [SPECIES.MULBERRY, 2],
    ]);
    expect(T_ROW).toEqual([
      [SPECIES.POPLAR, 35], [SPECIES.ACACIA, 25], [SPECIES.ELM, 20],
      [SPECIES.GLEDITSIA, 10], [SPECIES.MAPLE, 10],
    ]);
  });

  it('uses every tree species from 1 to 15 somewhere', () => {
    for (let species = 1; species <= 15; species++) {
      expect(TABLES.some(([, table]) => table.some(([s]) => s === species)), `species ${species}`).toBe(true);
    }
  });

  it('maps explicit taxa to their species', () => {
    expect(speciesOfTags({ genus: 'Acer' }, 1)).toBe(SPECIES.MAPLE);
    expect(speciesOfTags({ species: 'Ulmus pumila' }, 1)).toBe(SPECIES.ELM);
    expect(speciesOfTags({ genus: 'Gleditsia' }, 1)).toBe(SPECIES.GLEDITSIA);
    expect(speciesOfTags({ genus: 'Platycladus' }, 1)).toBe(SPECIES.THUJA);
    expect(speciesOfTags({ genus: 'Juglans' }, 1)).toBe(SPECIES.WALNUT);
    expect(speciesOfTags({ genus: 'Castanea' }, 1)).toBe(SPECIES.CHESTNUT);
    expect(speciesOfTags({ species: 'Robinia pseudoacacia' }, 1)).toBe(SPECIES.ACACIA);
    expect(speciesOfTags({ leaf_type: 'needleleaved' }, 1)).toBe(SPECIES.PINE);
  });

  it('maps every added genus, and gives genera without a model a real species', () => {
    expect(speciesOfTags({ genus: 'Morus' }, 1)).toBe(SPECIES.MULBERRY);
    expect(speciesOfTags({ genus: 'Ailanthus' }, 1)).toBe(SPECIES.AILANTHUS);
    expect(speciesOfTags({ genus: 'Catalpa' }, 1)).toBe(SPECIES.CATALPA);
    expect(speciesOfTags({ genus: 'Thuja' }, 1)).toBe(SPECIES.THUJA);
    expect(speciesOfTags({ genus: 'Juniperus' }, 1)).toBe(SPECIES.THUJA);
    expect(speciesOfTags({ genus: 'Fraxinus' }, 1)).toBe(SPECIES.ELM);
    expect(speciesOfTags({ genus: 'Quercus' }, 1)).toBe(SPECIES.ELM);
    expect(speciesOfTags({ genus: 'Carpinus' }, 1)).toBe(SPECIES.ELM);
    expect(speciesOfTags({ genus: 'Fagus' }, 1)).toBe(SPECIES.ELM);
    expect(speciesOfTags({ genus: 'Betula' }, 1)).toBe(SPECIES.LINDEN);
    expect(speciesOfTags({ genus: 'Prunus' }, 1)).toBe(SPECIES.MULBERRY);
    expect(speciesOfTags({ genus: 'Malus' }, 1)).toBe(SPECIES.MULBERRY);
    expect(speciesOfTags({ genus: 'Pyrus' }, 1)).toBe(SPECIES.MULBERRY);
  });

  it('makes forest trees willows near water with probability 0.6', () => {
    expect(nearWaterWillow(SPECIES.MAPLE, MAT.FOREST, 8, 0.5)).toBe(SPECIES.WILLOW);
    expect(nearWaterWillow(SPECIES.MAPLE, MAT.FOREST, 8, 0.7)).toBe(SPECIES.MAPLE);
  });

  it('makes park trees willows only on a natural bank within about 6 m of water', () => {
    for (const r of [0, 0.2, 0.5, 0.9]) {
      expect(nearWaterWillow(SPECIES.MAPLE, MAT.PARK, 8, r)).toBe(SPECIES.MAPLE);
    }
    expect(nearWaterWillow(SPECIES.MAPLE, MAT.PARK, 2, 0.2)).toBe(SPECIES.WILLOW);
    expect(nearWaterWillow(SPECIES.MAPLE, MAT.PARK, 2, 0.5)).toBe(SPECIES.MAPLE);
  });

  it('leaves pine, willow and other ground types unchanged by the near-water rule', () => {
    expect(nearWaterWillow(SPECIES.PINE, MAT.FOREST, 1, 0.1)).toBe(SPECIES.PINE);
    expect(nearWaterWillow(SPECIES.PINE, MAT.PARK, 1, 0.1)).toBe(SPECIES.PINE);
    expect(nearWaterWillow(SPECIES.WILLOW, MAT.FOREST, 1, 0.9)).toBe(SPECIES.WILLOW);
    expect(nearWaterWillow(SPECIES.WILLOW, MAT.PARK, 1, 0.9)).toBe(SPECIES.WILLOW);
    expect(nearWaterWillow(SPECIES.MAPLE, MAT.GRASS, 1, 0.1)).toBe(SPECIES.MAPLE);
  });

  it('gives untagged trees a deterministic non-GENERIC species', () => {
    const h = 0x12345678;
    const species = speciesOfTags({}, h);
    expect(species).toBe(speciesOfTags({}, h));
    expect(species).not.toBe(SPECIES.GENERIC);
    expect(species).toBeGreaterThanOrEqual(1);
    expect(species).toBeLessThanOrEqual(15);
  });

  it('uses feature params 5 for plain trees and 6 for whitewashed trunks', () => {
    expect(TREE_PARAM).toBe(5);
    expect(TREE_PARAM_WHITEWASH).toBe(6);
  });
});
