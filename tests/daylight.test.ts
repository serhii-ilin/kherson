import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOURS, TIME_PRESETS, daylightAt, formatTime, nextPreset, parseTime, resolveTime, sunPosition,
  type Daylight, type RGB,
} from '../src/world/daylight.ts';

const flat = (d: Daylight): number[] => [
  d.elevation, ...d.sunDir, ...d.lightDir, ...d.lightColor, d.lightIntensity, ...d.hemiSky, ...d.hemiGround, d.hemiIntensity,
  ...d.zenith, ...d.horizon, ...d.ground, ...d.fog, ...d.reflect, d.exposure, d.night, d.lights, d.dusk,
];

describe('sun model', () => {
  it('is high and southern at noon, below the horizon at 22:30', () => {
    const noon = sunPosition(12.85);
    expect(noon.elevation).toBeGreaterThan(60);
    expect(noon.dir[2]).toBeGreaterThanOrEqual(0); // +z is south
    expect(sunPosition(13).elevation).toBeGreaterThan(60);
    expect(sunPosition(22.5).elevation).toBeLessThan(-5);
    expect(sunPosition(3).elevation).toBeLessThan(0);
  });
  it('rises in the east and sets in the west', () => {
    expect(sunPosition(7).dir[0]).toBeGreaterThan(0);
    expect(sunPosition(19.75).dir[0]).toBeLessThan(0);
  });
  it('is a unit vector', () => {
    for (let h = 0; h < 24; h += 0.5) expect(Math.hypot(...sunPosition(h).dir)).toBeCloseTo(1, 6);
  });
});

describe('palette', () => {
  it('is bright by day, dark but never black at night', () => {
    const day = daylightAt(13), night = daylightAt(22.5), deep = daylightAt(1);
    expect(day.night).toBe(0);
    expect(day.lights).toBe(0);
    expect(night.night).toBeGreaterThan(0.9);
    expect(deep.night).toBe(1);
    expect(deep.lights).toBe(1);
    expect(day.lightIntensity).toBeGreaterThan(1.5);
    for (const d of [night, deep]) {
      expect(d.lightIntensity).toBeGreaterThan(0.2);
      expect(d.lightIntensity).toBeLessThan(day.lightIntensity / 2);
      expect(d.hemiIntensity).toBeGreaterThan(0.3);
      expect(d.lightDir[1]).toBeGreaterThan(0.4); // the moon stays high
    }
    const lum = (c: RGB): number => c[0] + c[1] + c[2];
    expect(lum(day.horizon)).toBeGreaterThan(lum(deep.horizon) * 3);
  });
  it('has a golden evening: warm sun, dusk factor, windows starting to glow', () => {
    const d = daylightAt(20.25);
    expect(d.elevation).toBeGreaterThan(-2);
    expect(d.elevation).toBeLessThan(6);
    expect(d.dusk).toBeGreaterThan(0.3);
    expect(d.lightColor[0]).toBeGreaterThan(d.lightColor[2]);
    expect(d.lights).toBeGreaterThan(0.3);
  });
  it('keeps the light above ~10 degrees so low-sun shadows stay usable', () => {
    for (let h = 0; h < 24; h += 0.1) expect(daylightAt(h).lightDir[1]).toBeGreaterThan(0.16);
  });
  it('keeps every channel in range', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const d = daylightAt(h);
      for (const c of [d.lightColor, d.hemiSky, d.hemiGround, d.zenith, d.horizon, d.ground, d.fog, d.reflect]) {
        for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
      for (const v of [d.night, d.lights, d.dusk]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(d.exposure).toBeGreaterThan(0.5);
    }
  });
  it('is continuous over the day (including midnight)', () => {
    let prev = flat(daylightAt(0));
    const step = 1 / 60; // one minute
    for (let h = step; h <= 24 + 1e-9; h += step) {
      const cur = flat(daylightAt(h));
      for (let i = 0; i < cur.length; i++) expect(Math.abs(cur[i]! - prev[i]!)).toBeLessThan(i === 0 ? 0.5 : 0.08);
      prev = cur;
    }
  });
});

describe('time preference', () => {
  it('parses HH:MM', () => {
    expect(parseTime('19:45')).toBeCloseTo(19.75);
    expect(parseTime('7')).toBe(7);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:75')).toBeNull();
    expect(parseTime('noon')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
  it('resolves URL > storage > default', () => {
    expect(resolveTime('22:30', '07:00')).toBe(22.5);
    expect(resolveTime(null, '07:00')).toBe(7);
    expect(resolveTime('garbage', '07:00')).toBe(7);
    expect(resolveTime(null, null)).toBe(DEFAULT_HOURS);
    expect(resolveTime('x', 'y')).toBe(13);
  });
  it('formats times and cycles presets', () => {
    expect(formatTime(19.75)).toBe('19:45');
    expect(formatTime(24)).toBe('00:00');
    expect(nextPreset(13)).toBe(2);
    expect(nextPreset(22.5)).toBe(0);
    expect(nextPreset(14.2)).toBe(2);
    expect(TIME_PRESETS.length).toBe(4);
  });
});
