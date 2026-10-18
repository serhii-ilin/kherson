// Chamfer (3-4) distance transform over a cell raster, used by the floodplain and pine-belt rules of the bake.

/** Distance units per cell in the output of `distanceTransform`. */
export const DIST_UNIT = 3;

/**
 * Distance from every cell to the nearest source cell (`src[i] !== 0`), in 1/3 cells (orthogonal step 3, diagonal 4),
 * saturating at 255 (85 cells = 170 m). Two passes, O(cells), output is a new Uint8Array of the same size.
 */
export function distanceTransform(src: Uint8Array, w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : 255;
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (d[i] === 0) continue;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (z > 0) {
        v = Math.min(v, d[i - w]! + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + 4);
      }
      d[i] = Math.min(255, v);
    }
  }
  for (let z = h - 1; z >= 0; z--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = z * w + x;
      if (d[i] === 0) continue;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 3);
      if (z < h - 1) {
        v = Math.min(v, d[i + w]! + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + 4);
      }
      d[i] = Math.min(255, v);
    }
  }
  return d;
}
