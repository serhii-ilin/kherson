import type { Mode } from './controller.ts';

const STORAGE_KEY = 'vk-pose';

/** Where the player stood or flew, so a reload puts them back there. Angles in radians. */
export interface SavedPose {
  mode: Mode;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

const round = (v: number, k: number): number => Math.round(v * k) / k;

export function encodePose(p: SavedPose): string {
  return JSON.stringify({
    mode: p.mode,
    x: round(p.x, 10),
    y: round(p.y, 10),
    z: round(p.z, 10),
    yaw: round(p.yaw, 1000),
    pitch: round(p.pitch, 1000),
  });
}

/** A stored pose inside the world (0..worldW, 0..worldH metres), or null if it is missing or damaged. */
export function decodePose(raw: string | null, worldW: number, worldH: number): SavedPose | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.mode !== 'walk' && o.mode !== 'fly') return null;
  const nums = [o.x, o.y, o.z, o.yaw, o.pitch];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, z, yaw, pitch] = nums as number[];
  if (x < 0 || x > worldW || z < 0 || z > worldH || y < -50 || y > 5000) return null;
  return { mode: o.mode, x, y, z, yaw, pitch };
}

export function readPose(worldW: number, worldH: number): SavedPose | null {
  try {
    return decodePose(localStorage.getItem(STORAGE_KEY), worldW, worldH);
  } catch {
    return null; // storage unavailable (private mode etc.)
  }
}

export function writePose(p: SavedPose): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodePose(p));
  } catch {
    // ignore
  }
}
