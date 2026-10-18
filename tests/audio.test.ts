import { describe, expect, it } from 'vitest';
import {
  BIRD_STYLES, SPECIES, birdActivity, dopplerFactor, forwardFromYaw, generatePhrase,
  generateSpeciesPhrase, nextInterval, pickSpecies, radialVelocity, songbirdGain,
  speciesWeights, swiftInterval, waterGain, windGain,
} from '../src/nature/audio.ts';

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('audio helpers', () => {
  it('dopplerFactor clamps and is monotonic', () => {
    expect(dopplerFactor(0)).toBeCloseTo(1);
    expect(dopplerFactor(-1000)).toBe(1.25);
    expect(dopplerFactor(1000)).toBe(0.8);
    expect(dopplerFactor(-20)).toBeGreaterThan(1);
    expect(dopplerFactor(20)).toBeLessThan(1);
  });

  it('radialVelocity is positive when receding', () => {
    expect(radialVelocity(10, 0, 0, 5, 0, 0)).toBeCloseTo(5);
    expect(radialVelocity(10, 0, 0, -5, 0, 0)).toBeCloseTo(-5);
    expect(radialVelocity(0, 0, 0, 1, 1, 1)).toBe(0);
  });

  it('forwardFromYaw: 0 faces north, positive turns left', () => {
    const f0 = forwardFromYaw(0);
    expect(f0.x).toBeCloseTo(0);
    expect(f0.z).toBeCloseTo(-1);
    const f1 = forwardFromYaw(Math.PI / 2);
    expect(f1.x).toBeCloseTo(-1);
    expect(f1.z).toBeCloseTo(0);
    expect(f1.y).toBe(0);
  });

  it('songbirdGain scales with trees and fades with altitude', () => {
    expect(songbirdGain(0, 0)).toBeCloseTo(0.25);
    expect(songbirdGain(1, 10)).toBeCloseTo(1);
    expect(songbirdGain(1, 15)).toBeCloseTo(1);
    expect(songbirdGain(1, 120)).toBe(0);
    expect(songbirdGain(1, 500)).toBe(0);
    expect(songbirdGain(1, 60)).toBeLessThan(songbirdGain(1, 30));
    expect(songbirdGain(2, 0)).toBeCloseTo(1);
  });

  it('wind and water beds follow spec', () => {
    expect(windGain(0)).toBeCloseTo(0.03);
    expect(windGain(150)).toBeCloseTo(0.15);
    expect(windGain(1000)).toBeCloseTo(0.15);
    expect(waterGain(5)).toBeCloseTo(0.12);
    expect(waterGain(120)).toBeCloseTo(0);
    expect(waterGain(Infinity)).toBe(0);
  });

  it('intervals stay within range with a seeded rng', () => {
    const rng = prng(7);
    for (let i = 0; i < 200; i++) {
      const v = nextInterval(rng, 2, 9);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(9);
      expect(swiftInterval(rng, 30)).toBeLessThanOrEqual(1.6);
      expect(swiftInterval(rng, 100)).toBeGreaterThan(swiftInterval(() => 0, 30));
    }
    const a = nextInterval(prng(3), 2, 9);
    expect(nextInterval(prng(3), 2, 9)).toBe(a);
  });

  it('phrases are varied and within musical bounds', () => {
    const rng = prng(42);
    for (const style of BIRD_STYLES) {
      const sigs = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const notes = generatePhrase(style, rng, 0.9 + rng() * 0.2, 0.8 + rng() * 0.45);
        expect(notes.length).toBeGreaterThanOrEqual(3);
        expect(notes.length).toBeLessThanOrEqual(12);
        let last = -1;
        for (const n of notes) {
          expect(n.t).toBeGreaterThanOrEqual(last);
          last = n.t;
          expect(n.dur).toBeGreaterThanOrEqual(0.03);
          expect(n.dur).toBeLessThanOrEqual(0.22);
          expect(n.freqs.length).toBeGreaterThanOrEqual(2);
          for (const f of n.freqs) {
            expect(f).toBeGreaterThanOrEqual(700);
            expect(f).toBeLessThanOrEqual(8000);
          }
          expect(n.peak).toBeGreaterThan(0);
          expect(n.peak).toBeLessThanOrEqual(1);
        }
        sigs.add(notes.map((n) => Math.round(n.freqs[0])).join(','));
      }
      expect(sigs.size).toBeGreaterThan(10);
    }
  });

  it('normalises habitat weights and changes the dominant chorus', () => {
    const contexts = [
      { treeDensity: 0, builtUp: 1, waterDistance: Infinity, daylight: 1 },
      { treeDensity: 1, builtUp: 0, waterDistance: Infinity, daylight: 1 },
      { treeDensity: 0.3, builtUp: 0.2, waterDistance: 0, daylight: 1 },
      { treeDensity: 0.3, builtUp: 0.2, waterDistance: 250, daylight: 1 },
    ];
    for (const context of contexts) {
      const weights = speciesWeights(context);
      expect(Object.keys(weights)).toHaveLength(SPECIES.length);
      expect(Object.values(weights).every((v) => v >= 0)).toBe(true);
      expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
    const built = speciesWeights(contexts[0]!);
    expect(built.houseSparrow).toBeGreaterThan(built.greatTit);
    expect(built.houseSparrow).toBeGreaterThan(built.rockPigeon);
    expect(built.rockPigeon).toBeGreaterThan(built.chaffinch);
    const park = speciesWeights(contexts[1]!);
    expect(park.greatTit + park.blackbird + park.chaffinch).toBeGreaterThan(park.houseSparrow + park.rockPigeon);
    expect(speciesWeights(contexts[2]!).gull).toBeGreaterThan(0);
    expect(speciesWeights(contexts[3]!).gull).toBeCloseTo(0);
    expect(birdActivity({ ...contexts[0]!, daylight: 0 })).toBe(0);
  });

  it('seeded species selection follows the supplied distribution', () => {
    const weights = speciesWeights({ treeDensity: 0.35, builtUp: 0.6, waterDistance: 40, daylight: 1 });
    const counts: Record<string, number> = {};
    const rng = prng(123);
    const draws = 5000;
    for (let i = 0; i < draws; i++) {
      const species = pickSpecies(weights, rng);
      counts[species] = (counts[species] ?? 0) + 1;
    }
    for (const species of SPECIES) {
      const expected = weights[species] * draws;
      expect(counts[species] ?? 0).toBeGreaterThan(expected - Math.max(18, expected * 0.12));
      expect(counts[species] ?? 0).toBeLessThan(expected + Math.max(18, expected * 0.12));
    }
  });

  it('every species has finite, positive procedural notes in its call range', () => {
    const rng = prng(99);
    for (const species of SPECIES) {
      const notes = generateSpeciesPhrase(species, rng);
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(Number.isFinite(n.t)).toBe(true);
        expect(Number.isFinite(n.dur)).toBe(true);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.freqs.length).toBeGreaterThanOrEqual(2);
        for (const f of n.freqs) {
          expect(Number.isFinite(f)).toBe(true);
          expect(f).toBeGreaterThan(0);
          if (species === 'hoodedCrow' || species === 'rook') expect(f).toBeLessThan(3000);
          if (species === 'houseSparrow' || species === 'treeSparrow') expect(f).toBeGreaterThanOrEqual(2000);
          if (species === 'houseSparrow' || species === 'treeSparrow') expect(f).toBeLessThanOrEqual(6000);
          if (species === 'gull') expect(f).toBeLessThanOrEqual(3000);
        }
      }
    }
  });
});
