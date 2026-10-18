/**
 * Time of day for Kherson: a pure sun model plus a lighting palette. No three.js here, so it is cheap
 * to test; src/main.ts copies the numbers into lights, sky, fog and water whenever the time changes.
 *
 * The sun follows a simple solar-position formula for a fixed summer date (21 June). The palette is a
 * set of keyframes over the sun's elevation, interpolated smoothly, so morning and evening look alike
 * and every transition (golden hour, blue hour, night) is continuous. Below the horizon the
 * directional light becomes a weak cool "moon" from a fixed high direction; the night is dim and blue
 * but never black, so the city stays navigable.
 *
 * World axes: +x east, +y up, +z south (north is -z).
 */

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export const LATITUDE = 46.64;
export const LONGITUDE = 32.6;
/** Solar declination on 21 June (degrees). */
const DECLINATION = 23.44;
/** Local clock = UTC+3 (EEST) in summer. */
const UTC_OFFSET = 3;
/** Local clock hours at which the sun is due south (equation of time on 21 June is about -1.7 min). */
export const SOLAR_NOON = 12 + UTC_OFFSET - LONGITUDE / 15 + 0.03;

export const DEFAULT_HOURS = 13;
/** Fixed direction (towards the moon) used as the night light. */
export const MOON_DIR: Vec3 = (() => {
  const x = 0.5, y = 0.65, z = 0.55;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
})();
const MOON_COLOR: RGB = [0.62, 0.74, 1.0];
const MOON_INTENSITY = 0.7;
/** The shadow-casting light never gets lower than this elevation (sine), so low-sun shadows stay sharp. */
const MIN_LIGHT_Y = 0.17;

export interface Daylight {
  hours: number;
  /** Sun elevation in degrees (negative below the horizon). */
  elevation: number;
  /** True direction towards the sun (unit, may point below the horizon). */
  sunDir: Vec3;
  /** Direction towards the dominant light: sun (kept above ~10 degrees), blending to the moon at night. */
  lightDir: Vec3;
  moonDir: Vec3;
  lightColor: RGB;
  lightIntensity: number;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  zenith: RGB;
  horizon: RGB;
  ground: RGB;
  fog: RGB;
  /** Colour the water reflects. */
  reflect: RGB;
  exposure: number;
  /** 0 by day .. 1 in full night: stars and moon in the sky. */
  night: number;
  /** 0..1 how much artificial light is on (windows, lamps): starts in the golden hour, full by dusk. */
  lights: number;
  /** 0..1 golden / blue hour glow near the horizon. */
  dusk: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Wraps any number of hours into [0, 24). */
export function wrapHours(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** Sun elevation (degrees) and the unit vector towards the sun in world axes. */
export function sunPosition(hours: number): { elevation: number; dir: Vec3 } {
  const rad = Math.PI / 180;
  const lat = LATITUDE * rad;
  const dec = DECLINATION * rad;
  const ha = (wrapHours(hours) - SOLAR_NOON) * 15 * rad;
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const east = -Math.cos(dec) * Math.sin(ha);
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha);
  const l = Math.hypot(east, up, north);
  return { elevation: Math.asin(up / l) / rad, dir: [east / l, up / l, -north / l] };
}

function rgb(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

interface Key {
  /** Sun elevation, degrees. */
  e: number;
  sun: RGB;
  sunI: number;
  hSky: RGB;
  hGnd: RGB;
  hI: number;
  zen: RGB;
  hor: RGB;
  gnd: RGB;
  fog: RGB;
  refl: RGB;
  exp: number;
}

const key = (e: number, sun: number, sunI: number, hSky: number, hGnd: number, hI: number, zen: number, hor: number, gnd: number, fog: number, refl: number, exp: number): Key => ({
  e, sun: rgb(sun), sunI, hSky: rgb(hSky), hGnd: rgb(hGnd), hI, zen: rgb(zen), hor: rgb(hor), gnd: rgb(gnd), fog: rgb(fog), refl: rgb(refl), exp,
});

/** Keyframes in ascending sun elevation. Noon matches the original fixed look. */
const KEYS: readonly Key[] = [
  key(-18, 0x7080b0, 0.0, 0x2a3c70, 0x141a2c, 0.85, 0x070c22, 0x16224a, 0x0c1426, 0x141e40, 0x1a2850, 1.25),
  key(-9, 0x8090c0, 0.0, 0x34487c, 0x1c2234, 0.85, 0x101c44, 0x34487e, 0x1a2540, 0x303f6c, 0x3a4e86, 1.2),
  key(-4, 0xff6a3a, 0.0, 0x56608e, 0x2e2c3c, 0.88, 0x23396f, 0x8b6b86, 0x4a4a62, 0x77698a, 0x7a6a8c, 1.1),
  key(0, 0xff7e42, 0.55, 0x9a8aa6, 0x4a3a34, 0.9, 0x3a5a9c, 0xf0946a, 0xa08488, 0xe0a07c, 0xe8a47e, 1.05),
  key(5, 0xffa458, 1.25, 0xb8b4c4, 0x5a4a3a, 1.0, 0x4676bc, 0xf4c49c, 0xb4a8a0, 0xe8c4a4, 0xe8c4a4, 1.0),
  key(14, 0xffd496, 1.6, 0xbcd0ec, 0x645638, 0.95, 0x417ccc, 0xdce0e8, 0xa8b4c0, 0xd2dbe6, 0xb4cdea, 1.0),
  key(30, 0xfff0d0, 1.8, 0xbfd8ff, 0x6b5a3a, 1.0, 0x3f7fd0, 0xc9dff0, 0x9fb3c4, 0xc9dff0, 0x9cc8ef, 1.0),
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function norm(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Everything the renderer needs for a given local time (hours, fractional). */
export function daylightAt(hoursIn: number): Daylight {
  const hours = wrapHours(hoursIn);
  const { elevation, dir } = sunPosition(hours);
  // keyframe interpolation over elevation, eased so slopes are continuous at the keys
  let i = 0;
  while (i < KEYS.length - 2 && elevation > KEYS[i + 1]!.e) i++;
  const a = KEYS[i]!, b = KEYS[i + 1]!;
  const t0 = clamp01((elevation - a.e) / (b.e - a.e));
  const t = t0 * t0 * (3 - 2 * t0);

  const sun = lerpRgb(a.sun, b.sun, t);
  const sunI = lerp(a.sunI, b.sunI, t);
  const hemiSky = lerpRgb(a.hSky, b.hSky, t);
  const hemiGround = lerpRgb(a.hGnd, b.hGnd, t);
  const hemiI = lerp(a.hI, b.hI, t);

  // the directional light: the sun held above ~10 degrees, handing over to the moon around the horizon
  const moonW = smoothstep(2, -8, elevation);
  let sx = dir[0], sy = dir[1], sz = dir[2];
  if (sy < MIN_LIGHT_Y) {
    const h = Math.hypot(sx, sz) || 1;
    const k = Math.sqrt(1 - MIN_LIGHT_Y * MIN_LIGHT_Y) / h;
    sx *= k; sz *= k; sy = MIN_LIGHT_Y;
  }
  const lightDir = norm(lerp(sx, MOON_DIR[0], moonW), lerp(sy, MOON_DIR[1], moonW), lerp(sz, MOON_DIR[2], moonW));
  const lightColor = lerpRgb(sun, MOON_COLOR, moonW);
  const lightIntensity = lerp(sunI, MOON_INTENSITY, moonW);

  const night = 1 - smoothstep(-14, -3, elevation);
  const lights = 1 - smoothstep(-5, 9, elevation);
  const dusk = smoothstep(-8, 0, elevation) * (1 - smoothstep(6, 18, elevation));

  return {
    hours,
    elevation,
    sunDir: dir,
    lightDir,
    moonDir: MOON_DIR,
    lightColor,
    lightIntensity,
    hemiSky,
    hemiGround,
    hemiIntensity: hemiI,
    zenith: lerpRgb(a.zen, b.zen, t),
    horizon: lerpRgb(a.hor, b.hor, t),
    ground: lerpRgb(a.gnd, b.gnd, t),
    fog: lerpRgb(a.fog, b.fog, t),
    reflect: lerpRgb(a.refl, b.refl, t),
    exposure: lerp(a.exp, b.exp, t),
    night,
    lights,
    dusk,
  };
}

// ---------------------------------------------------------------- time preference

export const TIME_STORAGE_KEY = 'vk-time';

/** Parses "HH:MM" (or "H", "HH.MM") into hours, or null when invalid. */
export function parseTime(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const m = /^\s*(\d{1,2})(?:[:.](\d{1,2}))?\s*$/.exec(s);
  if (m === null) return null;
  const h = Number(m[1]), min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h + min / 60;
}

export function formatTime(hours: number): string {
  const total = Math.round(wrapHours(hours) * 60) % 1440;
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** URL `?time=` wins over the stored preference, which wins over the default (13:00). */
export function resolveTime(urlValue: string | null | undefined, stored: string | null | undefined): number {
  return parseTime(urlValue) ?? parseTime(stored) ?? DEFAULT_HOURS;
}

export interface TimePreset { hours: number; icon: string }
/** Presets the time button cycles through. */
export const TIME_PRESETS: readonly TimePreset[] = [
  { hours: 6.5, icon: '🌅' },
  { hours: 13, icon: '☀️' },
  { hours: 19.75, icon: '🌇' },
  { hours: 22.5, icon: '🌃' },
];

/** Index of the preset after the one nearest to `hours`. */
export function nextPreset(hours: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < TIME_PRESETS.length; i++) {
    const d = Math.abs(wrapHours(hours - TIME_PRESETS[i]!.hours + 12) - 12);
    if (d < bd) { bd = d; best = i; }
  }
  return (best + 1) % TIME_PRESETS.length;
}

export function readStoredTime(): string | null {
  try {
    return localStorage.getItem(TIME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredTime(hours: number): void {
  try {
    localStorage.setItem(TIME_STORAGE_KEY, formatTime(hours));
  } catch {
    // ignore (private mode, blocked storage)
  }
}
