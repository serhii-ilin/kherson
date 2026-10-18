import { DEFAULT_BBOX, fromLatLon } from '../src/landmarks/geo.ts';
import { createLandmarks } from '../src/landmarks/index.ts';

const pierStart = fromLatLon(DEFAULT_BBOX, 46.6283698, 32.6209196);
const shorelineZ = pierStart.z + 36;
const context = {
  quality: 'high' as const,
  groundAt: (_x: number, _z: number) => 4,
  isWater: (_x: number, z: number) => z >= shorelineZ,
};

for (const landmark of createLandmarks(DEFAULT_BBOX)) {
  const built = landmark.build(context);
  const report = built.report;
  console.log(JSON.stringify({
    id: landmark.id,
    triangles: built.triangleCount,
    drawCalls: built.materialCount,
    pavedAreaM2: report?.pavedAreaM2 ?? 0,
    lamps: report?.lamps ?? 0,
    benches: report?.benches ?? 0,
    deckRoot: report?.deckRoot ?? null,
    deckTip: report?.deckTip ?? null,
    shoreline: report?.shoreline ?? null,
    deckRootDistanceToShoreline: report?.deckRoot && report.shoreline ? Math.hypot(report.deckRoot[0] - report.shoreline[0], report.deckRoot[1] - report.shoreline[1]) : null,
    deckTipDistanceToShoreline: report?.deckTip && report.shoreline ? Math.hypot(report.deckTip[0] - report.shoreline[0], report.deckTip[1] - report.shoreline[1]) : null,
  }));
}
