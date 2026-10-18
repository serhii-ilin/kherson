import { MAT, materialColor } from '../world/materials.ts';

export const PROP = { LAMP: 1, TRAFFIC_LIGHT: 2, BUS_SHELTER: 3, BENCH: 4, BIN: 5, BOLLARD: 6, FENCE: 7 } as const;

/** Same vertex layout as the world's chunk meshes, so props can be merged into them. */
export interface PropModel {
  positions: Float32Array; // xyz, metres; origin at the base centre on the ground, +y up, the prop's FRONT faces +z
  normals: Float32Array;   // xyz, unit axis-aligned normals
  colors: Float32Array;    // rgb 0..1 from materialColor(mat), multiplied by a face shade: top 1.0, sides ±x 0.8, ±z 0.9, bottom 0.6
  walls: Float32Array;     // 4 floats per vertex: [mat id, 0, 0, 0]
  indices: Uint32Array;
  /** Axis-aligned bounds of all boxes. */
  min: [number, number, number];
  max: [number, number, number];
}

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  mat: number;
}

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  walls: number[] = [];
  indices: number[] = [];
  minBounds: [number, number, number] = [Infinity, Infinity, Infinity];
  maxBounds: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  addQuad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    nx: number, ny: number, nz: number,
    mat: number, shade: number,
  ): void {
    const startVertex = this.positions.length / 3;

    // Add positions
    const verts = [
      [x0, y0, z0],
      [x1, y1, z1],
      [x2, y2, z2],
      [x3, y3, z3],
    ];

    for (const [x, y, z] of verts) {
      this.positions.push(x, y, z);
      this.minBounds[0] = Math.min(this.minBounds[0], x);
      this.minBounds[1] = Math.min(this.minBounds[1], y);
      this.minBounds[2] = Math.min(this.minBounds[2], z);
      this.maxBounds[0] = Math.max(this.maxBounds[0], x);
      this.maxBounds[1] = Math.max(this.maxBounds[1], y);
      this.maxBounds[2] = Math.max(this.maxBounds[2], z);
    }

    // Add normals and colors
    const color = materialColor(mat);
    const r = color[0] * shade;
    const g = color[1] * shade;
    const b = color[2] * shade;

    for (let i = 0; i < 4; i++) {
      this.normals.push(nx, ny, nz);
      this.colors.push(r, g, b);
      this.walls.push(mat, 0, 0, 0);
    }

    // Add indices (two triangles, counter-clockwise from outside)
    this.indices.push(startVertex, startVertex + 1, startVertex + 2);
    this.indices.push(startVertex, startVertex + 2, startVertex + 3);
  }

  addBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number): void {
    // Top face (y = y1): normal (0, 1, 0), shade 1.0
    this.addQuad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, mat, 1.0);

    // Bottom face (y = y0): only if y0 > 0, normal (0, -1, 0), shade 0.6
    if (y0 > 0) {
      this.addQuad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, mat, 0.6);
    }

    // Front face (z = z1): normal (0, 0, 1), shade 0.9
    this.addQuad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, mat, 0.9);

    // Back face (z = z0): normal (0, 0, -1), shade 0.9
    this.addQuad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, mat, 0.9);

    // Right face (x = x1): normal (1, 0, 0), shade 0.8
    this.addQuad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, mat, 0.8);

    // Left face (x = x0): normal (-1, 0, 0), shade 0.8
    this.addQuad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, mat, 0.8);
  }

  build(): PropModel {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      walls: new Float32Array(this.walls),
      indices: new Uint32Array(this.indices),
      min: [this.minBounds[0], this.minBounds[1], this.minBounds[2]],
      max: [this.maxBounds[0], this.maxBounds[1], this.maxBounds[2]],
    };
  }
}

export function buildProp(kind: number, variant: number): PropModel {
  const v = Math.max(0, Math.min(2, variant));

  if (kind === PROP.LAMP) {
    return buildLamp(v);
  } else if (kind === PROP.TRAFFIC_LIGHT) {
    return buildTrafficLight(v);
  } else if (kind === PROP.BUS_SHELTER) {
    return buildBusShelter(v);
  } else if (kind === PROP.BENCH) {
    return buildBench(v);
  } else if (kind === PROP.BIN) {
    return buildBin(v);
  } else if (kind === PROP.BOLLARD) {
    return buildBollard(v);
  } else if (kind === PROP.FENCE) {
    return buildFence(v);
  }

  return buildBin(0);
}

function buildLamp(variant: number): PropModel {
  const b = new MeshBuilder();

  // Concrete base: 0.4 × 0.3 × 0.4
  const baseW = 0.4;
  const baseD = 0.3;
  const baseH = 0.4;
  b.addBox(-baseW / 2, 0, -baseD / 2, baseW / 2, baseH, baseD / 2, MAT.CONCRETE);

  // Metal pole: 0.16 × 0.16 × 7.0
  const poleW = 0.16;
  const poleH = 7.0;
  b.addBox(-poleW / 2, baseH, -poleW / 2, poleW / 2, baseH + poleH, poleW / 2, MAT.METAL);

  // Horizontal arm at the top, variant-dependent length
  const armTop = baseH + poleH;
  const armLen = variant === 0 ? 1.2 : variant === 1 ? 1.5 : 1.8;
  const armW = 0.08;
  const armH = 0.08;
  b.addBox(-armW / 2, armTop - armH / 2, -armW / 2, armW / 2, armTop + armH / 2, armLen, MAT.METAL);

  // Lamp head at the end of arm: 0.5 × 0.15 × 0.25
  const headW = 0.5;
  const headD = 0.15;
  const headH = 0.25;
  const headZ = armLen - headH / 2;
  const headY = armTop - headH / 2;

  // Lamp head body with METAL (all but bottom)
  // The bottom is the lens (MAT.LAMP), which glows at night
  const headY1 = headY + headH / 2;
  const headY0 = headY - headH / 2;
  const headZ0 = headZ - headD / 2;
  const headZ1 = headZ + headD / 2;
  const headX0 = -headW / 2;
  const headX1 = headW / 2;

  // Top face (y = headY1)
  b.addQuad(headX0, headY1, headZ1, headX1, headY1, headZ1, headX1, headY1, headZ0, headX0, headY1, headZ0,
            0, 1, 0, MAT.METAL, 1.0);

  // Bottom face: the lens (y = headY0)
  b.addQuad(headX0, headY0, headZ0, headX1, headY0, headZ0, headX1, headY0, headZ1, headX0, headY0, headZ1,
            0, -1, 0, MAT.LAMP, 1.0);

  // Front (z = headZ1)
  b.addQuad(headX0, headY0, headZ1, headX1, headY0, headZ1, headX1, headY1, headZ1, headX0, headY1, headZ1,
            0, 0, 1, MAT.METAL, 0.9);

  // Back (z = headZ0)
  b.addQuad(headX1, headY0, headZ0, headX0, headY0, headZ0, headX0, headY1, headZ0, headX1, headY1, headZ0,
            0, 0, -1, MAT.METAL, 0.9);

  // Right (x = headX1)
  b.addQuad(headX1, headY0, headZ1, headX1, headY0, headZ0, headX1, headY1, headZ0, headX1, headY1, headZ1,
            1, 0, 0, MAT.METAL, 0.8);

  // Left (x = headX0)
  b.addQuad(headX0, headY0, headZ0, headX0, headY0, headZ1, headX0, headY1, headZ1, headX0, headY1, headZ0,
            -1, 0, 0, MAT.METAL, 0.8);

  return b.build();
}

function buildTrafficLight(variant: number): PropModel {
  const b = new MeshBuilder();

  // Metal pole: 0.12 wide, 3.2 high
  const poleW = 0.12;
  const poleH = 3.2;
  b.addBox(-poleW / 2, 0, -poleW / 2, poleW / 2, poleH, poleW / 2, MAT.METAL);

  // Head: 0.35 × 1.0 × 0.25 on top facing +z
  const headW = 0.35;
  const headD = 1.0;
  const headH = 0.25;
  const headY = poleH;
  b.addBox(-headW / 2, headY, 0, headW / 2, headY + headH, headD, MAT.METAL);

  // Three lamp boxes 0.2 × 0.2 protruding 0.05 m on +z side
  const lampSize = 0.2;
  const lampProtrusion = 0.05;
  const lampY1 = headY + headH / 2 - lampSize / 2 - 0.15;
  const lampY2 = headY + headH / 2 - lampSize / 2;
  const lampY3 = headY + headH / 2 - lampSize / 2 + 0.15;

  b.addBox(-lampSize / 2, lampY1, headD, lampSize / 2, lampY1 + lampSize, headD + lampProtrusion, MAT.SHOPFRONT);
  b.addBox(-lampSize / 2, lampY2, headD, lampSize / 2, lampY2 + lampSize, headD + lampProtrusion, MAT.SHOPFRONT);
  b.addBox(-lampSize / 2, lampY3, headD, lampSize / 2, lampY3 + lampSize, headD + lampProtrusion, MAT.SHOPFRONT);

  return b.build();
}

function buildBusShelter(variant: number): PropModel {
  const b = new MeshBuilder();

  const shelterW = 3.5;
  const shelterD = 1.6;
  const shelterH = 2.5;
  const postThick = 0.08;
  const roofThick = 0.12;
  const overhang = 0.15;

  // Four metal posts
  b.addBox(-shelterW / 2, 0, -shelterD / 2, -shelterW / 2 + postThick, shelterH, -shelterD / 2 + postThick, MAT.METAL);
  b.addBox(shelterW / 2 - postThick, 0, -shelterD / 2, shelterW / 2, shelterH, -shelterD / 2 + postThick, MAT.METAL);
  b.addBox(-shelterW / 2, 0, shelterD / 2 - postThick, -shelterW / 2 + postThick, shelterH, shelterD / 2, MAT.METAL);
  b.addBox(shelterW / 2 - postThick, 0, shelterD / 2 - postThick, shelterW / 2, shelterH, shelterD / 2, MAT.METAL);

  // Roof slab with overhang
  const roofY = shelterH;
  b.addBox(-shelterW / 2 - overhang, roofY, -shelterD / 2 - overhang,
           shelterW / 2 + overhang, roofY + roofThick, shelterD / 2 + overhang, MAT.METAL);

  // Back wall of glass at -z side from 0.2 to 2.2 m
  const glassThick = 0.05;
  b.addBox(-shelterW / 2, 0.2, -shelterD / 2, shelterW / 2, 2.2, -shelterD / 2 + glassThick, MAT.GLASS);

  // Bench: 2.6 long, 0.4 deep, seat at 0.45 m
  const benchLen = 2.6;
  const benchD = 0.4;
  const benchSeatH = 0.45;
  const benchSeatThick = 0.05;
  const benchBackH = 0.4;

  const benchMat = variant === 0 ? MAT.DOOR : MAT.METAL;

  b.addBox(-benchLen / 2, benchSeatH, shelterD / 2 - benchD, benchLen / 2, benchSeatH + benchSeatThick, shelterD / 2, benchMat);

  // Backrest
  b.addBox(-benchLen / 2, benchSeatH + benchSeatThick, shelterD / 2 - benchSeatThick,
           benchLen / 2, benchSeatH + benchSeatThick + benchBackH, shelterD / 2 - benchSeatThick + benchSeatThick, benchMat);

  // Bench legs (METAL)
  const legW = 0.04;
  const legZ1 = shelterD / 2 - benchD + 0.05;
  const legZ2 = shelterD / 2 - 0.05;
  b.addBox(-benchLen / 2 + 0.1, 0, legZ1, -benchLen / 2 + 0.1 + legW, benchSeatH, legZ2, MAT.METAL);
  b.addBox(benchLen / 2 - 0.1 - legW, 0, legZ1, benchLen / 2 - 0.1, benchSeatH, legZ2, MAT.METAL);

  return b.build();
}

function buildBench(variant: number): PropModel {
  const b = new MeshBuilder();

  const benchLen = 1.8;
  const seatH = 0.45;
  const seatD = 0.45;
  const seatThick = 0.05;
  const backH = 0.4;
  const backThick = 0.05;

  const seatMat = variant === 0 ? MAT.DOOR : MAT.METAL;

  // Seat
  b.addBox(-benchLen / 2, seatH, -seatD / 2, benchLen / 2, seatH + seatThick, seatD / 2, seatMat);

  // Backrest at -z edge
  b.addBox(-benchLen / 2, seatH + seatThick, -seatD / 2, benchLen / 2, seatH + seatThick + backH, -seatD / 2 + backThick, seatMat);

  // Two leg boxes
  const legW = 0.04;
  const legD = 0.04;
  b.addBox(-benchLen / 2 + 0.1, 0, -seatD / 2 + 0.05, -benchLen / 2 + 0.1 + legW, seatH, -seatD / 2 + 0.05 + legD, MAT.METAL);
  b.addBox(benchLen / 2 - 0.1 - legW, 0, -seatD / 2 + 0.05, benchLen / 2 - 0.1, seatH, -seatD / 2 + 0.05 + legD, MAT.METAL);

  return b.build();
}

function buildBin(variant: number): PropModel {
  const b = new MeshBuilder();

  const binW = 0.45;
  const binD = 0.8;
  const binH = 0.45;
  const rimW = 0.5;
  const rimD = 0.5;
  const rimThick = 0.05;

  // Metal body
  b.addBox(-binW / 2, 0, -binD / 2, binW / 2, binH, binD / 2, MAT.METAL);

  // Rim on top
  b.addBox(-rimW / 2, binH, -rimD / 2, rimW / 2, binH + rimThick, rimD / 2, MAT.METAL);

  return b.build();
}

function buildBollard(variant: number): PropModel {
  const b = new MeshBuilder();

  const bollardW = 0.15;
  const bollardH = 0.9;
  const capW = 0.18;
  const capH = 0.05;

  // Metal body
  b.addBox(-bollardW / 2, 0, -bollardW / 2, bollardW / 2, bollardH, bollardW / 2, MAT.METAL);

  // Trim cap on top
  b.addBox(-capW / 2, bollardH, -capW / 2, capW / 2, bollardH + capH, capW / 2, MAT.TRIM);

  return b.build();
}

function buildFence(variant: number): PropModel {
  const b = new MeshBuilder();

  const fenceLen = 2.0;
  const fenceH = 1.2;
  const postW = 0.06;
  const railThick = 0.04;
  const picketW = 0.02;
  const picketH = 1.1;

  // Two posts at x = ±1.0
  const postX1 = -fenceLen / 2 + postW / 2;
  const postX2 = fenceLen / 2 - postW / 2;
  b.addBox(postX1 - postW / 2, 0, -postW / 2, postX1 + postW / 2, fenceH, postW / 2, MAT.METAL);
  b.addBox(postX2 - postW / 2, 0, -postW / 2, postX2 + postW / 2, fenceH, postW / 2, MAT.METAL);

  // Top rail
  b.addBox(-fenceLen / 2, fenceH - railThick, -railThick / 2, fenceLen / 2, fenceH, railThick / 2, MAT.METAL);

  // Bottom rail
  b.addBox(-fenceLen / 2, railThick / 2, -railThick / 2, fenceLen / 2, railThick / 2 + railThick, railThick / 2, MAT.METAL);

  // 9 vertical pickets evenly spaced
  const spacing = fenceLen / 10;
  for (let i = 1; i < 10; i++) {
    const x = -fenceLen / 2 + i * spacing;
    b.addBox(x - picketW / 2, 0.05, -picketW / 2, x + picketW / 2, 0.05 + picketH, picketW / 2, MAT.METAL);
  }

  return b.build();
}
