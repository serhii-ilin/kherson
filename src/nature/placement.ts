/** Shared by rendering and collision: where a vegetation feature stands inside its cell. */

/** Jitter in cells, ±0.35, derived from the seed byte. */
export function jitterX(seed: number): number {
  return (((seed * 37 + 11) & 255) / 255 * 2 - 1) * 0.35;
}

export function jitterZ(seed: number): number {
  return (((seed * 91 + 53) & 255) / 255 * 2 - 1) * 0.35;
}
