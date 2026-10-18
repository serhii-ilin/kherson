import { fromLatLon } from './geo.ts';
import { EMBANKMENT_DATA } from './data.ts';
import { addPortalCrane } from './embankment-props.ts';
import { buildResult, LandmarkMeshBuilder, type Landmark } from './types.ts';
import type { Bbox } from '../world/manifest.ts';

type Point = [number, number];

// Arc positions along the quay (m), slew relative to the river and boom luff; two cranes have green houses.
const CRANES: readonly [s: number, slew: number, luff: number, green: boolean][] = [
  [10, 0.15, 0.95, false], [36, -0.5, 1.1, true], [62, 0.35, 0.85, false], [88, 1.2, 1.0, false], [114, -0.25, 0.9, true],
];

/** The yellow portal cranes of the cargo port, the backdrop of every photo along the embankment. */
export function createPortCranes(bbox: Bbox): Landmark {
  const quay: Point[] = EMBANKMENT_DATA.portQuay.map(([lat, lon]) => { const p = fromLatLon(bbox, lat, lon); return [p.x, p.z]; });
  const mid = quay[1]!;
  return {
    id: 'port-cranes',
    name: 'Портові крани',
    anchor: { lat: EMBANKMENT_DATA.portQuay[1]![0], lon: EMBANKMENT_DATA.portQuay[1]![1], x: mid[0], z: mid[1] },
    footprint: [],
    ready: (ctx) => ctx.groundAt(mid[0], mid[1]) !== null,
    build: (ctx) => {
      const b = new LandmarkMeshBuilder();
      let s0 = 0, placed = 0;
      for (let i = 1; i < quay.length; i++) {
        const p = quay[i - 1]!, q = quay[i]!, len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len;
        // land side: the normal whose probe is not river
        let nx = -uz, nz = ux;
        const probe = [p[0] + ux * len / 2 + nx * 12, p[1] + uz * len / 2 + nz * 12] as const;
        if (ctx.isWater?.(probe[0], probe[1])) { nx = -nx; nz = -nz; }
        for (const [s, slew, luff, green] of CRANES) {
          if (s < s0 || s >= s0 + len) continue;
          const t = s - s0, x = p[0] + ux * t + nx * 8, z = p[1] + uz * t + nz * 8;
          const y = ctx.groundAt(x, z) ?? 0;
          // frame u points out over the river
          addPortalCrane(b, { x, z, ux: -nx, uz: -nz, vx: uz, vz: -ux }, y, slew, luff, green);
          placed++;
        }
        s0 += len;
      }
      return buildResult([b.finish('opaque')], [], undefined, { pavedAreaM2: 0, lamps: 0, benches: placed });
    },
  };
}
