import * as THREE from 'three';

/** A small, deliberately low-poly fish. Local +x is the nose direction. */
export function buildFishGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const seg = 8;
  const xs = [-0.5, -0.38, -0.16, 0.14, 0.37, 0.5];
  const ry = [0.015, 0.075, 0.13, 0.14, 0.085, 0.012];
  const rz = [0.012, 0.09, 0.15, 0.15, 0.085, 0.01];
  const vertices: { p: [number, number, number]; n: [number, number, number]; c: number }[][] = [];
  const color = (v: number): number => v > 0.38 ? 0x4d5741 : v < -0.38 ? 0xd7d6bd : 0x9aa19a;
  for (let i = 0; i < xs.length; i++) {
    const row: { p: [number, number, number]; n: [number, number, number]; c: number }[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const sy = Math.sin(a), cz = Math.cos(a);
      const y = sy * ry[i], z = cz * rz[i];
      const nl = Math.hypot(sy, cz) || 1;
      row.push({ p: [xs[i]!, y, z], n: [0, sy / nl, cz / nl], c: color(sy) });
    }
    vertices.push(row);
  }
  const add = (v: { p: [number, number, number]; n: [number, number, number]; c: number }): void => {
    pos.push(v.p[0], v.p[1], v.p[2]);
    nor.push(v.n[0], v.n[1], v.n[2]);
    const cc = new THREE.Color(v.c);
    col.push(cc.r, cc.g, cc.b);
  };
  const tri = (
    a: { p: [number, number, number]; n: [number, number, number]; c: number },
    b: { p: [number, number, number]; n: [number, number, number]; c: number },
    c: { p: [number, number, number]; n: [number, number, number]; c: number },
  ): void => { add(a); add(b); add(c); };
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = vertices[i]![j]!;
      const b = vertices[i]![((j + 1) % seg)]!;
      const c = vertices[i + 1]![((j + 1) % seg)]!;
      const d = vertices[i + 1]![j]!;
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  const fin = (a: [number, number, number], b: [number, number, number], c: [number, number, number], colour: number): void => {
    const cc = new THREE.Color(colour);
    const n: [number, number, number] = [0, 1, 0];
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      col.push(cc.r, cc.g, cc.b);
    }
  };
  // A broad tail and two little pectoral fins give the silhouette some fish character.
  fin([-0.42, 0, 0], [-0.62, 0.13, 0], [-0.62, 0, 0.13], 0x596452);
  fin([-0.42, 0, 0], [-0.62, 0, -0.13], [-0.62, 0.13, 0], 0x596452);
  fin([0.12, 0.015, 0.07], [0.27, -0.015, 0.28], [0.27, 0.02, 0.07], 0x7c8879);
  fin([0.12, 0.015, -0.07], [0.27, 0.02, -0.07], [0.27, -0.015, -0.28], 0x7c8879);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
