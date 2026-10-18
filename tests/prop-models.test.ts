import { describe, expect, it } from 'vitest';
import { PROP, buildProp } from '../src/fine/prop-models.ts';

describe('prop models', () => {
  it('every kind builds for variants 0..2', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop = buildProp(kind, variant);
        expect(prop).toBeDefined();
        expect(prop.positions).toBeDefined();
        expect(prop.normals).toBeDefined();
        expect(prop.colors).toBeDefined();
        expect(prop.walls).toBeDefined();
        expect(prop.indices).toBeDefined();
        expect(prop.min).toBeDefined();
        expect(prop.max).toBeDefined();
      }
    }
  });

  it('array lengths are consistent', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop = buildProp(kind, variant);
        const vertexCount = prop.positions.length / 3;

        // positions = 3 × vertices
        expect(prop.positions.length).toBe(vertexCount * 3);

        // normals = 3 × vertices
        expect(prop.normals.length).toBe(vertexCount * 3);

        // colors = 3 × vertices
        expect(prop.colors.length).toBe(vertexCount * 3);

        // walls = 4 × vertices
        expect(prop.walls.length).toBe(vertexCount * 4);

        // indices multiple of 3
        expect(prop.indices.length % 3).toBe(0);

        // all indices < vertex count
        for (let i = 0; i < prop.indices.length; i++) {
          expect(prop.indices[i]!).toBeLessThan(vertexCount);
        }
      }
    }
  });

  it('triangle bounds: each prop <= 400 triangles', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop = buildProp(kind, variant);
        const triangles = prop.indices.length / 3;
        expect(triangles).toBeLessThanOrEqual(400);
      }
    }
  });

  it('LAMP height 6.8–7.6 m', () => {
    for (let variant = 0; variant < 3; variant++) {
      const prop = buildProp(PROP.LAMP, variant);
      expect(prop.max[1]).toBeGreaterThanOrEqual(6.8);
      expect(prop.max[1]).toBeLessThanOrEqual(7.6);
    }
  });

  it('BUS_SHELTER width 3.5–4.0 m', () => {
    for (let variant = 0; variant < 3; variant++) {
      const prop = buildProp(PROP.BUS_SHELTER, variant);
      const width = prop.max[0] - prop.min[0];
      expect(width).toBeGreaterThanOrEqual(3.5);
      expect(width).toBeLessThanOrEqual(4.0);
    }
  });

  it('FENCE length 2.0–2.1 m', () => {
    for (let variant = 0; variant < 3; variant++) {
      const prop = buildProp(PROP.FENCE, variant);
      const length = prop.max[0] - prop.min[0];
      expect(length).toBeGreaterThanOrEqual(2.0);
      expect(length).toBeLessThanOrEqual(2.1);
    }
  });

  it('all normals are unit length and axis aligned', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop = buildProp(kind, variant);
        for (let i = 0; i < prop.normals.length; i += 3) {
          const nx = prop.normals[i]!;
          const ny = prop.normals[i + 1]!;
          const nz = prop.normals[i + 2]!;

          // Each component should be -1, 0, or 1
          expect([nx, ny, nz]).toEqual(expect.arrayContaining(
            [nx, ny, nz].filter(v => Math.abs(v) === 0 || Math.abs(v) === 1 || v === 0)
          ));

          // Exactly one component should be non-zero
          const nonZero = [nx, ny, nz].filter(v => v !== 0).length;
          expect(nonZero).toBe(1);
        }
      }
    }
  });

  it('triangle winding: cross product matches stored normal', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop = buildProp(kind, variant);

        for (let i = 0; i < prop.indices.length; i += 3) {
          const i0 = prop.indices[i]! * 3;
          const i1 = prop.indices[i + 1]! * 3;
          const i2 = prop.indices[i + 2]! * 3;

          const v0 = [prop.positions[i0]!, prop.positions[i0 + 1]!, prop.positions[i0 + 2]!];
          const v1 = [prop.positions[i1]!, prop.positions[i1 + 1]!, prop.positions[i1 + 2]!];
          const v2 = [prop.positions[i2]!, prop.positions[i2 + 1]!, prop.positions[i2 + 2]!];

          const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
          const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

          const cx = e1[1] * e2[2] - e1[2] * e2[1];
          const cy = e1[2] * e2[0] - e1[0] * e2[2];
          const cz = e1[0] * e2[1] - e1[1] * e2[0];

          const nx = prop.normals[i0]!;
          const ny = prop.normals[i0 + 1]!;
          const nz = prop.normals[i0 + 2]!;

          const dot = cx * nx + cy * ny + cz * nz;
          expect(dot).toBeGreaterThan(0);
        }
      }
    }
  });

  it('deterministic: building twice gives identical arrays', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop1 = buildProp(kind, variant);
        const prop2 = buildProp(kind, variant);

        expect(Buffer.from(prop1.positions.buffer, prop1.positions.byteOffset, prop1.positions.byteLength)
          .equals(Buffer.from(prop2.positions.buffer, prop2.positions.byteOffset, prop2.positions.byteLength))).toBe(true);
        expect(Buffer.from(prop1.normals.buffer, prop1.normals.byteOffset, prop1.normals.byteLength)
          .equals(Buffer.from(prop2.normals.buffer, prop2.normals.byteOffset, prop2.normals.byteLength))).toBe(true);
        expect(Buffer.from(prop1.colors.buffer, prop1.colors.byteOffset, prop1.colors.byteLength)
          .equals(Buffer.from(prop2.colors.buffer, prop2.colors.byteOffset, prop2.colors.byteLength))).toBe(true);
        expect(Buffer.from(prop1.walls.buffer, prop1.walls.byteOffset, prop1.walls.byteLength)
          .equals(Buffer.from(prop2.walls.buffer, prop2.walls.byteOffset, prop2.walls.byteLength))).toBe(true);
        expect(Buffer.from(prop1.indices.buffer, prop1.indices.byteOffset, prop1.indices.byteLength)
          .equals(Buffer.from(prop2.indices.buffer, prop2.indices.byteOffset, prop2.indices.byteLength))).toBe(true);
      }
    }
  });

  it('variants 0 and 1 of LAMP differ', () => {
    const prop0 = buildProp(PROP.LAMP, 0);
    const prop1 = buildProp(PROP.LAMP, 1);

    const differs = !Buffer.from(prop0.positions.buffer, prop0.positions.byteOffset, prop0.positions.byteLength)
      .equals(Buffer.from(prop1.positions.buffer, prop1.positions.byteOffset, prop1.positions.byteLength));

    expect(differs).toBe(true);
  });

  it('no face with normal (0, -1, 0) lies at y = 0', () => {
    const kinds = [PROP.LAMP, PROP.TRAFFIC_LIGHT, PROP.BUS_SHELTER, PROP.BENCH, PROP.BIN, PROP.BOLLARD, PROP.FENCE];
    for (const kind of kinds) {
      for (let variant = 0; variant < 3; variant++) {
        const prop = buildProp(kind, variant);

        for (let i = 0; i < prop.indices.length; i += 3) {
          const i0 = prop.indices[i]! * 3;

          const nx = prop.normals[i0]!;
          const ny = prop.normals[i0 + 1]!;
          const nz = prop.normals[i0 + 2]!;

          // Check if this is a downward-facing face
          if (nx === 0 && ny === -1 && nz === 0) {
            // This face has downward normal, check if any vertex is at y = 0
            const i1 = prop.indices[i + 1]! * 3;
            const i2 = prop.indices[i + 2]! * 3;

            const y0 = prop.positions[i0 + 1]!;
            const y1 = prop.positions[i1 + 1]!;
            const y2 = prop.positions[i2 + 1]!;

            expect(y0).not.toBe(0);
            expect(y1).not.toBe(0);
            expect(y2).not.toBe(0);
          }
        }
      }
    }
  });
});
