import { BBOX } from "./config.ts";

const latC = (BBOX.south + BBOX.north) / 2;
const mPerDegLat = 110540;
const mPerDegLon = 111320 * Math.cos((latC * Math.PI) / 180);

export function toWorld(lat: number, lon: number): [number, number] {
  const x = (lon - BBOX.west) * mPerDegLon;
  const z = (BBOX.north - lat) * mPerDegLat;
  return [x, z];
}

export function toLatLon(x: number, z: number): [number, number] {
  const lon = x / mPerDegLon + BBOX.west;
  const lat = BBOX.north - z / mPerDegLat;
  return [lat, lon];
}

export const WORLD_W: number = toWorld(BBOX.south, BBOX.east)[0];
export const WORLD_H: number = toWorld(BBOX.south, BBOX.east)[1];
