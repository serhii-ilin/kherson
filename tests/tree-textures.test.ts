import { describe, it, expect } from 'vitest';
import { makeBarkLayers, makeLeafLayers } from '../src/nature/tree-textures.ts';
import { BARK_LAYER, BARK_LAYERS, LEAF_LAYER, LEAF_LAYERS } from '../src/nature/tree-atlas.ts';

const LEAF_SIZE = 128;
const BARK_SIZE = 64;

function alphaAt(data: Uint8Array, size: number, layer: number, x: number, y: number): number {
  return data[(layer * size * size + y * size + x) * 4 + 3]!;
}

function coverage(data: Uint8Array, size: number, layer: number): number {
  let opaque = 0;
  for (let i = 0; i < size * size; i++) {
    if (data[(layer * size * size + i) * 4 + 3] === 255) opaque++;
  }
  return opaque / (size * size);
}

/** Mean absolute RGB difference between the first and last column (0) or row (1). */
function seamDiff(data: Uint8Array, size: number, layer: number, axis: 0 | 1): number {
  const at = (x: number, y: number, c: number): number => data[(layer * size * size + y * size + x) * 4 + c]!;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < size; i++) {
    const [x0, y0, x1, y1] = axis === 0 ? [0, i, size - 1, i] : [i, 0, i, size - 1];
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(at(x0, y0, c) - at(x1, y1, c));
      n++;
    }
  }
  return sum / n;
}

/** Mean absolute RGB difference of adjacent interior columns (0) or rows (1). */
function interiorStepDiff(data: Uint8Array, size: number, layer: number, axis: 0 | 1): number {
  const at = (x: number, y: number, c: number): number => data[(layer * size * size + y * size + x) * 4 + c]!;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < size - 2; i++) {
    for (let j = 0; j < size; j++) {
      const [x0, y0, x1, y1] = axis === 0 ? [i, j, i + 1, j] : [j, i, j, i + 1];
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(at(x0, y0, c) - at(x1, y1, c));
        n++;
      }
    }
  }
  return sum / n;
}

describe('makeLeafLayers', () => {
  const data = makeLeafLayers();

  it('has one RGBA layer per leaf shape', () => {
    expect(data.length).toBe(LEAF_SIZE * LEAF_SIZE * 4 * LEAF_LAYERS);
  });

  it('is deterministic', () => {
    expect(Array.from(makeLeafLayers())).toEqual(Array.from(data));
  });

  it('uses only fully opaque or fully transparent alpha', () => {
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i] === 0 || data[i] === 255).toBe(true);
    }
  });

  it('keeps opaque coverage of every layer between 0.35 and 0.80', () => {
    for (let layer = 0; layer < LEAF_LAYERS; layer++) {
      const c = coverage(data, LEAF_SIZE, layer);
      expect(c, `layer ${layer}`).toBeGreaterThanOrEqual(0.35);
      expect(c, `layer ${layer}`).toBeLessThanOrEqual(0.8);
    }
  });

  it('makes the airy pinnate and needle layers sparser than palmate and heart', () => {
    const palmate = coverage(data, LEAF_SIZE, LEAF_LAYER.PALMATE);
    const heart = coverage(data, LEAF_SIZE, LEAF_LAYER.HEART);
    expect(coverage(data, LEAF_SIZE, LEAF_LAYER.PINNATE_FINE)).toBeLessThan(palmate);
    expect(coverage(data, LEAF_SIZE, LEAF_LAYER.PINNATE_FINE)).toBeLessThan(heart);
    expect(coverage(data, LEAF_SIZE, LEAF_LAYER.NEEDLE_TUFT)).toBeLessThan(palmate);
    expect(coverage(data, LEAF_SIZE, LEAF_LAYER.NEEDLE_TUFT)).toBeLessThan(heart);
  });

  it('keeps dense layers at 0.55 opaque coverage or more', () => {
    for (const layer of [LEAF_LAYER.PALMATE, LEAF_LAYER.HEART, LEAF_LAYER.BIG_HEART, LEAF_LAYER.SCALE_SPRAY]) {
      expect(coverage(data, LEAF_SIZE, layer), `layer ${layer}`).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('keeps airy layers between 0.35 and 0.50 opaque coverage', () => {
    for (const layer of [LEAF_LAYER.PINNATE_FINE, LEAF_LAYER.NEEDLE_TUFT]) {
      const c = coverage(data, LEAF_SIZE, layer);
      expect(c, `layer ${layer}`).toBeGreaterThanOrEqual(0.35);
      expect(c, `layer ${layer}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('leaves a 3 px transparent border for mipmaps', () => {
    for (let layer = 0; layer < LEAF_LAYERS; layer++) {
      for (let y = 0; y < LEAF_SIZE; y++) {
        for (let x = 0; x < LEAF_SIZE; x++) {
          if (x >= 3 && x < LEAF_SIZE - 3 && y >= 3 && y < LEAF_SIZE - 3) continue;
          expect(alphaAt(data, LEAF_SIZE, layer, x, y), `layer ${layer} at ${x},${y}`).toBe(0);
        }
      }
    }
  });

  it('gives every pair of layers a clearly different alpha mask', () => {
    const minDiff = LEAF_SIZE * LEAF_SIZE * 0.1;
    for (let a = 0; a < LEAF_LAYERS; a++) {
      for (let b = a + 1; b < LEAF_LAYERS; b++) {
        let diff = 0;
        for (let i = 0; i < LEAF_SIZE * LEAF_SIZE; i++) {
          const aa = data[(a * LEAF_SIZE * LEAF_SIZE + i) * 4 + 3]! > 0;
          const bb = data[(b * LEAF_SIZE * LEAF_SIZE + i) * 4 + 3]! > 0;
          if (aa !== bb) diff++;
        }
        expect(diff, `layers ${a} and ${b}`).toBeGreaterThan(minDiff);
      }
    }
  });

  it('keeps opaque leaf RGB light, near-neutral multipliers', () => {
    for (let layer = 0; layer < LEAF_LAYERS; layer++) {
      for (let i = 0; i < LEAF_SIZE * LEAF_SIZE; i++) {
        const o = (layer * LEAF_SIZE * LEAF_SIZE + i) * 4;
        if (data[o + 3] === 0) continue;
        for (let c = 0; c < 3; c++) {
          expect(data[o + c]!).toBeGreaterThanOrEqual(150);
          expect(data[o + c]!).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe('makeBarkLayers', () => {
  const data = makeBarkLayers();

  it('has one RGBA layer per bark type', () => {
    expect(data.length).toBe(BARK_SIZE * BARK_SIZE * 4 * BARK_LAYERS);
  });

  it('is deterministic', () => {
    expect(Array.from(makeBarkLayers())).toEqual(Array.from(data));
  });

  it('is fully opaque', () => {
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('tiles seamlessly in u and v', () => {
    for (let layer = 0; layer < BARK_LAYERS; layer++) {
      expect(seamDiff(data, BARK_SIZE, layer, 0), `layer ${layer} columns`).toBeLessThan(25);
      expect(seamDiff(data, BARK_SIZE, layer, 1), `layer ${layer} rows`).toBeLessThan(25);
    }
  });

  it('keeps the wrap seam no rougher than interior pixel steps', () => {
    for (let layer = 0; layer < BARK_LAYERS; layer++) {
      for (const axis of [0, 1] as const) {
        const seam = seamDiff(data, BARK_SIZE, layer, axis);
        const interior = interiorStepDiff(data, BARK_SIZE, layer, axis);
        expect(seam, `layer ${layer} axis ${axis}`).toBeLessThanOrEqual(interior * 1.25);
      }
    }
  });

  it('keeps bark RGB inside the multiplier range', () => {
    for (let layer = 0; layer < BARK_LAYERS; layer++) {
      for (let i = 0; i < BARK_SIZE * BARK_SIZE; i++) {
        const o = (layer * BARK_SIZE * BARK_SIZE + i) * 4;
        for (let c = 0; c < 3; c++) {
          expect(data[o + c]!).toBeGreaterThanOrEqual(110);
          expect(data[o + c]!).toBeLessThanOrEqual(235);
        }
      }
    }
  });

  it('gives the plane bark coloured camouflage patches', () => {
    const layer = BARK_LAYER.MOTTLED;
    let min = 255;
    let max = 0;
    for (let i = 0; i < BARK_SIZE * BARK_SIZE; i++) {
      const red = data[(layer * BARK_SIZE * BARK_SIZE + i) * 4]!;
      min = Math.min(min, red);
      max = Math.max(max, red);
    }
    expect(max - min).toBeGreaterThan(40);
  });
});

describe('generation speed', () => {
  it('generates both texture arrays quickly', () => {
    const start = performance.now();
    makeLeafLayers();
    makeBarkLayers();
    // 150 ms is the budget; slower CI runners get headroom.
    expect(performance.now() - start).toBeLessThan(400);
  });
});
