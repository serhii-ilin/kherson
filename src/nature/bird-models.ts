import * as THREE from 'three';

/**
 * Voxel-ish bird models. Local frame: +x forward, +y up, +z to the right-hand side.
 * Attributes: position, normal, color, wing (-1 left / +1 right / 0 body), wingSpan (|z| of the vertex).
 */

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  wing: number[] = [];
  span: number[] = [];
  private c = new THREE.Color();

  /** Axis-aligned box centred at (cx,cy,cz) with sizes (sx,sy,sz). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, wing = 0): void {
    this.c.set(color);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // [normal, u axis, v axis]
    const faces: [number, number, number, number, number, number, number, number, number][] = [
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
      [-1, 0, 0, 0, 1, 0, 0, 0, -1],
      [0, 1, 0, 0, 0, 1, 1, 0, 0],
      [0, -1, 0, 0, 0, -1, 1, 0, 0],
      [0, 0, 1, 1, 0, 0, 0, 1, 0],
      [0, 0, -1, -1, 0, 0, 0, 1, 0],
    ];
    for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of faces) {
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const vert = (a: number, b: number): [number, number, number] => {
        // offset along u and v axes scaled by half sizes
        const x = cx + nx * hx + a * ux * hx + b * vx * hx;
        const y = cy + ny * hy + a * uy * hy + b * vy * hy;
        const z = cz + nz * hz + a * uz * hz + b * vz * hz;
        return [x, y, z];
      };
      const v = corners.map(([a, b]) => vert(a, b));
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const p = v[i];
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(nx, ny, nz);
        this.col.push(this.c.r, this.c.g, this.c.b);
        this.wing.push(wing);
        this.span.push(Math.abs(p[2]));
      }
    }
  }

  /** Mirrored pair of wing boxes (z given for the right wing). */
  wingPair(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number): void {
    this.box(cx, cy, cz, sx, sy, sz, color, 1);
    this.box(cx, cy, -cz, sx, sy, sz, color, -1);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('wing', new THREE.Float32BufferAttribute(this.wing, 1));
    g.setAttribute('wingSpan', new THREE.Float32BufferAttribute(this.span, 1));
    return g;
  }
}

/** Swift: ~0.17 m long, ~0.42 m wingspan, swept-back sickle wings, forked tail. */
export function buildSwiftGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  const dark = 0x2a2622;
  const wingC = 0x25211e;
  b.box(0, 0, 0, 0.09, 0.04, 0.04, dark);
  b.box(0.07, 0.004, 0, 0.04, 0.034, 0.034, dark);
  b.box(0.092, -0.012, 0, 0.012, 0.012, 0.016, 0xd9d4c8); // pale throat dot
  b.box(-0.06, 0, 0, 0.04, 0.01, 0.03, dark); // tail base
  b.box(-0.095, 0, 0.012, 0.05, 0.008, 0.012, dark); // fork
  b.box(-0.095, 0, -0.012, 0.05, 0.008, 0.012, dark);
  for (let i = 0; i < 5; i++) {
    const z = 0.04 + i * 0.04;
    const x = 0.02 - i * 0.025 - i * i * 0.006;
    const len = 0.06 - i * 0.006;
    b.wingPair(x, 0.012, z, len, 0.006, 0.04, wingC);
  }
  return b.build();
}

/** Feral pigeon: ~0.32 m long, plump, wingspan ~0.66 m with spread wings. */
export function buildDoveGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  const grey = 0x8d929a;
  const darker = 0x5d626b;
  b.box(-0.01, 0, 0, 0.2, 0.12, 0.12, grey); // body
  b.box(0.12, 0.06, 0, 0.08, 0.08, 0.07, darker); // head
  b.box(0.175, 0.055, 0, 0.03, 0.02, 0.02, 0xb59a9a); // beak
  b.box(0.095, 0.03, 0, 0.04, 0.05, 0.125, 0x4f7f6a); // neck band green
  b.box(0.092, 0.0, 0, 0.034, 0.045, 0.128, 0x6b4f7f); // neck band purple
  b.box(-0.15, -0.005, 0, 0.12, 0.02, 0.07, darker); // tail
  b.box(0.0, -0.075, 0.025, 0.012, 0.03, 0.012, 0xd9603a); // feet
  b.box(0.0, -0.075, -0.025, 0.012, 0.03, 0.012, 0xd9603a);
  for (let i = 0; i < 3; i++) {
    const z = 0.07 + i * 0.1;
    b.wingPair(-0.02 - i * 0.015, 0.05, z, 0.14 - i * 0.02, 0.012, 0.1, grey);
  }
  // two dark wing bars
  b.wingPair(-0.045, 0.058, 0.105, 0.015, 0.006, 0.17, 0x3a3d44);
  b.wingPair(-0.075, 0.058, 0.105, 0.015, 0.006, 0.17, 0x3a3d44);
  return b.build();
}
