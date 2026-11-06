import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dopplerFactor } from '../src/nature/audio.ts';
import {
  BIRD_AUDIO_BUDGET_BYTES, BIRD_CLIPS, pickClip, readyClips, sampleVariation, screamCount, speciesHasClips,
} from '../src/nature/bird-samples.ts';

const DIR = 'public/audio/birds';

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

describe('bird recordings', () => {
  it('ships each clip as mono-container webm and m4a under the budget', () => {
    const names = readdirSync(DIR);
    const ids = new Set<string>();
    let bytes = 0;
    for (const clip of BIRD_CLIPS) {
      expect(ids.has(clip.id)).toBe(false);
      ids.add(clip.id);
      for (const ext of ['webm', 'm4a'] as const) {
        const file = `${clip.id}.${ext}`;
        expect(names).toContain(file);
        const path = `${DIR}/${file}`;
        const size = statSync(path).size;
        expect(size).toBeGreaterThan(400);
        bytes += size;
        const head = readFileSync(path).subarray(0, 16);
        if (ext === 'webm') {
          expect([...head.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
        } else {
          expect(head.subarray(4, 8).toString('ascii')).toBe('ftyp');
        }
      }
    }
    expect(names).toHaveLength(BIRD_CLIPS.length * 2);
    expect(bytes).toBeLessThanOrEqual(BIRD_AUDIO_BUDGET_BYTES);
    expect(bytes).toBeGreaterThan(100_000);
  });

  it('credits every source as CC0 or public domain', () => {
    const credits = readFileSync('docs/AUDIO_CREDITS.md', 'utf8');
    expect(credits).toMatch(/CC0/);
    expect(credits).toMatch(/public domain/i);
    expect(credits).not.toMatch(/NonCommercial|BY-NC|NoDeriv/i);
    const sources = new Set(BIRD_CLIPS.map((c) => c.source));
    for (const source of sources) {
      expect(credits).toContain(source);
    }
    for (const clip of BIRD_CLIPS) expect(credits).toContain(`\`${clip.id}\``);
  });

  it('varies playback without leaving the safe rate range, including Doppler', () => {
    const rng = prng(11);
    for (let i = 0; i < 200; i++) {
      const approaching = sampleVariation(rng, dopplerFactor(-40));
      const receding = sampleVariation(rng, dopplerFactor(40));
      expect(approaching.playbackRate).toBeGreaterThan(1);
      expect(receding.playbackRate).toBeLessThan(1);
      for (const v of [approaching, receding, sampleVariation(rng, dopplerFactor(-1000))]) {
        expect(v.playbackRate).toBeGreaterThanOrEqual(0.75);
        expect(v.playbackRate).toBeLessThanOrEqual(1.35);
        expect(v.gain).toBeGreaterThanOrEqual(0.72);
        expect(v.gain).toBeLessThanOrEqual(1.08);
      }
    }
    expect(sampleVariation(prng(4), 1).playbackRate).toBe(sampleVariation(prng(4), 1).playbackRate);
  });

  it('selects only loaded clips and stacks swift screams by distance', () => {
    const loaded = new Set(['swift-1', 'swift-6', 'pigeon-coo-1']);
    expect(readyClips('swift', ['scream'], loaded).map((c) => c.id).sort()).toEqual(['swift-1', 'swift-6']);
    expect(readyClips('rockPigeon', ['coo'], loaded)).toHaveLength(1);
    expect(readyClips('rockPigeon', ['wing'], loaded)).toHaveLength(0);
    expect(readyClips('gull', ['call'], loaded)).toHaveLength(0);
    expect(speciesHasClips('greatTit', ['song'])).toBe(true);
    expect(speciesHasClips('hoodedCrow', ['call'])).toBe(true);
    expect(speciesHasClips('woodpecker', ['drum'])).toBe(true);
    expect(speciesHasClips('cuckoo', ['call'])).toBe(false);
    expect(pickClip([], () => 0)).toBeNull();
    const only = readyClips('rockPigeon', ['coo'], loaded);
    expect(pickClip(only, () => 0.9)?.id).toBe('pigeon-coo-1');
    const rng = prng(3);
    expect(screamCount(true, 10, rng)).toBe(1);
    expect(screamCount(false, 80, rng)).toBe(1);
    const close = new Set<number>();
    for (let i = 0; i < 40; i++) close.add(screamCount(false, 20, rng));
    expect(close.has(2)).toBe(true);
    expect(close.has(3)).toBe(true);
    expect([...close].every((n) => n === 2 || n === 3)).toBe(true);
  });
});
