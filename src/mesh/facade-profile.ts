/**
 * Facade descriptors for Tier-K buildings (docs/BUILDINGS_PLAN.md): one JSON row per OSM building on a
 * well-known street (Ushakova Avenue, Suvorova Street), researched from dated pre-war photos and built by the
 * architectural kit (src/landmarks/kit/). Rows live in `data/facades/*.json` as `FacadeProfile[]`.
 *
 * A row replaces the extruded OSM building with the same key: the footprint and height still come from the
 * vector tile, while everything that makes the facade recognisable comes from here. Types only; the builder
 * and the validator live with the kit.
 */

/** Bay codes used in `FacadeEdge.pattern` and `FacadeProfile.groundPattern`, one character per bay. */
export const BAY = {
  WINDOW: 'w',
  DOOR: 'd',
  SHOP: 's',
  /** Arched carriage passage into the courtyard (spans every storey it is drawn on). */
  GATE: 'g',
  /** Blank wall pier. */
  BLANK: 'b',
  /** Blind (painted or recessed) window. */
  BLIND: 'x',
} as const;

export type WindowShape = 'rect' | 'arched' | 'segmental' | 'paired';
export type WindowSurround = 'none' | 'band' | 'keystone' | 'pediment' | 'arch_moulding';
export type CorniceProfile = 'none' | 'simple' | 'dentil' | 'bracketed';
export type AtticKind = 'none' | 'parapet' | 'balustrade' | 'pediment';
export type BalconyKind = 'iron' | 'stone' | 'glazed';
export type RoofKind = 'flat' | 'gable' | 'hip' | 'mansard';

/** A rectified facade photo mapped onto one wall edge (data/photo-textures.json). */
export interface FacadePhoto {
  /** Row id in data/photo-textures.json. */
  id: string;
  /** Crop of the photo that covers this edge, 0..1 (u along the edge from its first vertex, v upward). */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** One street-facing wall: the outer-ring edge from vertex `edge` to vertex `edge + 1`. */
export interface FacadeEdge {
  /**
   * Vertex index in the OSM way's node list, closing node excluded. The bake preserves that order (first node
   * first, no reversal or rotation) and drops only the closing node and consecutive duplicate points, so edge `i`
   * always runs from the i-th vertex to the next one as seen in the OSM way.
   */
  edge: number;
  /** Upper-storey bays left to right as seen from the street, e.g. `"bwwwgwwwb"`. */
  pattern: string;
  /** Ground-floor bays when they differ from `pattern` (shop fronts, doors); same length. */
  groundPattern?: string;
  /** Bay width in metres; default: the edge length divided evenly. */
  bayM?: number;
  photo?: FacadePhoto;
}

export interface FacadeProfile {
  /** `w<id>` or `r<id>` (src/world/osm-ref.ts). */
  key: string;
  /** Address or name, for people reading the file. */
  label: string;
  /** Where the row comes from: brief section and dated photo references, never the private evidence photos. */
  sources: string[];
  storeys: number;
  /** Storey heights in metres, ground floor first; default 4.0 then 3.6. */
  floorHeights?: number[];
  /** Plinth height in metres; default 0.6. */
  plinthM?: number;
  /** Colours as `#rrggbb`. `pbr` names a `PBR_LAYER` key (src/world/pbr-layers.ts). */
  wall: { colour: string; pbr?: string };
  trim: { colour: string; pbr?: string };
  roof: { kind: RoofKind; colour: string; pbr?: string };
  windows: {
    shape: WindowShape;
    widthM: number;
    heightM: number;
    surround: WindowSurround;
    /** `#rrggbb` frame colour; pre-war mixes of white PVC and painted wood are per bay when `mixedFrames`. */
    frame: string;
    mixedFrames?: boolean;
    /** Ground-floor windows differ (e.g. taller arched shop windows). */
    ground?: { shape: WindowShape; widthM: number; heightM: number };
  };
  /** Banded rustication on the ground floor (and plinth). */
  rusticated?: boolean;
  /** Horizontal string courses between storeys. */
  stringCourses?: boolean;
  pilasters?: { everyBays: number; capital: 'plain' | 'ionic' | 'corinthian' };
  cornice: { profile: CorniceProfile; heightM: number; projectionM: number };
  attic?: { kind: AtticKind; heightM: number };
  /** Balconies by storey index (0 = ground) and bay index on the edges that list them. */
  balconies?: {
    kind: BalconyKind;
    storeys: number[];
    bays: number[];
    /** Street edge index from `edges`; default: the first edge listed in `edges`. */
    edge?: number;
  }[];
  /** Street-facing walls; other walls get plain windows on the same storeys. */
  edges: FacadeEdge[];
}
