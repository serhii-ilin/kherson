// Pre-war restoration applied on top of the current (full) OSM snapshot.
// The January 2022 extract is a reference for tags and for objects that were
// deleted later. It is not a replacement for the snapshot: buildings mapped
// after that date stay. The bake reads the committed table; it does not
// recompute it.
import fs from "node:fs";
import type { LoadOptions } from "./osm.ts";
import { isAntonivskyiName } from "./bridge-corridor.ts";
import type { OsmEl } from "../osm-snapshot.ts";

export const RESTORATION_PATH = "data/osm/restoration.json";
export const OVERRIDES_PATH = "data/osm/restoration-overrides.json";
export const REFERENCE_SOURCE = "geofabrik:ukraine-220101";
export const INFERRED_SOURCE = "inferred:keep-footprint";

const DAMAGE_BUILDING = new Set(["ruins", "destroyed", "damaged", "collapsed"]);
const LIFECYCLE_PREFIX = /^(abandoned|demolished|razed|destroyed|was|disused|ruins):/;
const FLAG_KEYS = new Set(["ruins", "destroyed", "damaged", "demolished"]);
/** Tags copied back onto the Antonivskyi road bridge from the reference, plus its node list. */
const BRIDGE_SYNC = ["ruins", "destroyed", "damaged", "demolished", "access", "highway", "bridge", "proposed"];
const NAME_FIELDS = ["name", "name:uk", "name:en", "name:ru"] as const;
const OLD_FOR: Record<(typeof NAME_FIELDS)[number], string> = {
  name: "old_name",
  "name:uk": "old_name:uk",
  "name:en": "old_name:en",
  "name:ru": "old_name:ru",
};
/** A deleted building whose nodes mostly belong to a current building was redrawn, not removed. */
export const REDRAW_OVERLAP = 0.5;
const WAR_NAME = /незламн|територіальн\p{L}*\s+оборон|батальйон|бузков/iu;

export interface RestoreRow {
  type: "node" | "way" | "relation";
  id: number;
  /** Tag key, `nodes` (comma-separated ids), `@drop`, or `@add`. */
  field: string;
  /** Null deletes a tag. `@drop` / `@add` leave this null. */
  value: string | null;
  source: string;
  version: number | null;
  reason: string;
}

export interface RestoreFile {
  note: string;
  reference: string;
  reference_date: string;
  rows: RestoreRow[];
  /** Elements in the reference that the base no longer has (deleted buildings, missing bridge nodes). */
  additions: OsmEl[];
}

export interface RestoreOverrides {
  note?: string;
  /** Generated rows to ignore, matched on type, id and field. */
  skip?: { type: RestoreRow["type"]; id: number; field: string }[];
  /** Replace or append rows. Same type/id/field wins over the generated table. */
  rows?: RestoreRow[];
  additions?: OsmEl[];
}

export interface RestoreStats {
  rows: number;
  additions: number;
  drops: number;
  /** building=ruins / destroyed / damaged on the base, before the pass. */
  ruinsBefore: number;
}

const TYPE_ORDER: Record<string, number> = { node: 0, way: 1, relation: 2 };

function rowKey(r: { type: string; id: number; field: string }): string {
  return `${r.type}/${r.id}/${r.field}`;
}

function compareRows(a: RestoreRow, b: RestoreRow): number {
  return (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.id - b.id || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0);
}

export function isDamageKey(key: string): boolean {
  return FLAG_KEYS.has(key) || LIFECYCLE_PREFIX.test(key);
}

export function isDamageBuilding(value: string | undefined): boolean {
  return value !== undefined && DAMAGE_BUILDING.has(value);
}

/** War-related object mapped after the reference extract. Ordinary monuments are not included. */
export function isWarAddition(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  if (tags.military && tags.military !== "no") return true;
  if (tags.barrier === "barricade" || tags.barrier === "checkpoint") return true;
  if (tags.amenity === "checkpoint" || tags.highway === "checkpoint") return true;
  if (tags.memorial === "war_memorial") return true;
  const name = `${tags.name ?? ""} ${tags["name:uk"] ?? ""} ${tags["name:en"] ?? ""}`;
  return WAR_NAME.test(name) && (tags.historic === "memorial" || !!tags.memorial);
}

function alias(preOld: string | undefined, currentOld: string | undefined, displaced: string, kept: string): string {
  const parts: string[] = [];
  const add = (s: string | undefined): void => {
    for (const piece of (s ?? "").split(";")) {
      const t = piece.trim();
      if (t && t !== kept && !parts.includes(t)) parts.push(t);
    }
  };
  add(preOld);
  add(currentOld);
  add(displaced);
  return parts.join(";");
}

function pushRow(rows: RestoreRow[], seen: Set<string>, row: RestoreRow): void {
  const k = rowKey(row);
  if (seen.has(k)) return;
  seen.add(k);
  rows.push(row);
}

/**
 * Diff one current element against its reference version.
 * `pre` null means the object was mapped after the reference.
 */
export function rowsForElement(cur: OsmEl, pre: OsmEl | undefined, version: number | null): RestoreRow[] {
  const rows: RestoreRow[] = [];
  const seen = new Set<string>();
  const curTags = cur.tags ?? {};
  const preTags = pre?.tags ?? {};
  const source = pre ? REFERENCE_SOURCE : INFERRED_SOURCE;
  const base = { type: cur.type, id: cur.id, source, version: pre ? version : null };

  if (!pre && isWarAddition(curTags)) {
    pushRow(rows, seen, { ...base, field: "@drop", value: null, reason: "drop-war-addition", version: null, source: REFERENCE_SOURCE });
    return rows;
  }
  if (!pre && isAntonivskyiName(curTags) && (isDamageBuilding(curTags.building) || curTags.ruins || curTags.destroyed === "yes" || curTags.highway === "proposed")) {
    pushRow(rows, seen, { ...base, field: "@drop", value: null, reason: "drop-war-addition", version: null, source: REFERENCE_SOURCE });
    return rows;
  }

  for (const key of Object.keys(curTags).sort()) {
    if (!isDamageKey(key) || curTags[key] === preTags[key]) continue;
    if (pre && isDamageBuilding(preTags.building) && isDamageBuilding(curTags.building) && key === "building") continue;
    pushRow(rows, seen, {
      ...base,
      field: key,
      value: preTags[key] ?? null,
      reason: pre ? "war-tag" : "undo-ruin-tag",
    });
    const colon = key.indexOf(":");
    if (colon > 0) {
      const plain = key.slice(colon + 1);
      if (preTags[plain] !== undefined && curTags[plain] === undefined) {
        pushRow(rows, seen, { ...base, field: plain, value: preTags[plain]!, reason: "war-tag", source: REFERENCE_SOURCE, version });
      }
    }
  }

  if (isDamageBuilding(curTags.building) && !(pre && isDamageBuilding(preTags.building))) {
    const restored = preTags.building && !isDamageBuilding(preTags.building) ? preTags.building : "yes";
    if (curTags.building !== restored) {
      pushRow(rows, seen, {
        ...base,
        field: "building",
        value: restored,
        reason: preTags.building ? "war-tag" : "undo-ruin-tag",
        source: preTags.building ? REFERENCE_SOURCE : INFERRED_SOURCE,
        version: preTags.building ? version : null,
      });
    }
  }

  if (cur.tags?.highway && pre) {
    for (const field of NAME_FIELDS) {
      const prev = preTags[field];
      const now = curTags[field];
      if (!prev || prev === now) continue;
      pushRow(rows, seen, { ...base, field, value: prev, reason: "pre-war-name", source: REFERENCE_SOURCE, version });
      const oldField = OLD_FOR[field];
      const merged = alias(preTags[oldField], curTags[oldField], now ?? "", prev);
      if (merged && merged !== (curTags[oldField] ?? "")) {
        pushRow(rows, seen, { ...base, field: oldField, value: merged, reason: "keep-current-name", source: REFERENCE_SOURCE, version });
      }
    }
  }

  if (pre && cur.type === "way" && isAntonivskyiName(curTags) && !curTags.railway) {
    for (const key of BRIDGE_SYNC) {
      const prev = preTags[key];
      const now = curTags[key];
      if (prev === now) continue;
      pushRow(rows, seen, { ...base, field: key, value: prev ?? null, reason: "bridge-pre-war", source: REFERENCE_SOURCE, version });
    }
    const curNodes = (cur.nodes ?? []).join(",");
    const preNodes = (pre.nodes ?? []).join(",");
    if (preNodes && preNodes !== curNodes) {
      pushRow(rows, seen, { ...base, field: "nodes", value: preNodes, reason: "bridge-geometry", source: REFERENCE_SOURCE, version });
    }
  }
  return rows;
}

function buildingNodeUse(elements: readonly OsmEl[]): Set<number> {
  const used = new Set<number>();
  for (const e of elements) {
    if (e.type === "way" && e.tags?.building && e.tags.building !== "no") for (const id of e.nodes ?? []) used.add(id);
  }
  return used;
}

export function buildRestoration(base: readonly OsmEl[], ref: readonly OsmEl[], versions: ReadonlyMap<string, number> = new Map()): RestoreFile {
  const baseBy = new Map<string, OsmEl>();
  for (const e of base) baseBy.set(`${e.type}/${e.id}`, e);
  const refBy = new Map<string, OsmEl>();
  for (const e of ref) refBy.set(`${e.type}/${e.id}`, e);
  const used = buildingNodeUse(base);
  const rows: RestoreRow[] = [];
  const additions: OsmEl[] = [];
  const added = new Set<string>();

  const addEl = (e: OsmEl): void => {
    const k = `${e.type}/${e.id}`;
    if (baseBy.has(k) || added.has(k)) return;
    added.add(k);
    const copy: OsmEl = { type: e.type, id: e.id };
    if (e.lat !== undefined) copy.lat = e.lat;
    if (e.lon !== undefined) copy.lon = e.lon;
    if (e.nodes) copy.nodes = e.nodes;
    if (e.members) copy.members = e.members;
    if (e.tags && Object.keys(e.tags).length) copy.tags = e.tags;
    additions.push(copy);
    rows.push({
      type: e.type, id: e.id, field: "@add", value: null, source: REFERENCE_SOURCE,
      version: versions.get(k) ?? e.version ?? null, reason: "re-add-deleted",
    });
  };

  for (const cur of base) {
    const pre = refBy.get(`${cur.type}/${cur.id}`);
    rows.push(...rowsForElement(cur, pre, versions.get(`${cur.type}/${cur.id}`) ?? pre?.version ?? null));
  }

  for (const pre of ref) {
    if (pre.type !== "way" || !pre.tags?.building || pre.tags.building === "no") continue;
    if (baseBy.has(`way/${pre.id}`)) continue;
    const nodes = pre.nodes ?? [];
    const hit = nodes.filter((id) => used.has(id)).length;
    if (nodes.length > 0 && hit / nodes.length >= REDRAW_OVERLAP) continue;
    addEl(pre);
    for (const id of nodes) {
      const node = refBy.get(`node/${id}`);
      if (node) addEl(node);
    }
  }

  // Nodes the restored bridge geometry needs and the base does not have.
  for (const row of rows) {
    if (row.field !== "nodes" || !row.value) continue;
    for (const id of row.value.split(",")) {
      const node = refBy.get(`node/${id}`);
      if (node) addEl(node);
    }
  }

  rows.sort(compareRows);
  additions.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.id - b.id);
  return {
    note: "Generated by tools/build-restoration.ts from the current snapshot and Geofabrik ukraine-220101. Do not edit by hand; put exceptions in restoration-overrides.json.",
    reference: REFERENCE_SOURCE,
    reference_date: "2022-01-01T00:00:00Z",
    rows,
    additions,
  };
}

export function applyOverrides(file: RestoreFile, overrides: RestoreOverrides | null): RestoreFile {
  if (!overrides) return file;
  const skip = new Set((overrides.skip ?? []).map((s) => `${s.type}/${s.id}/${s.field}`));
  const map = new Map<string, RestoreRow>();
  for (const row of file.rows) if (!skip.has(rowKey(row))) map.set(rowKey(row), row);
  for (const row of overrides.rows ?? []) map.set(rowKey(row), row);
  const rows = [...map.values()].sort(compareRows);
  const additions = [...file.additions, ...(overrides.additions ?? [])];
  additions.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.id - b.id);
  return { ...file, rows, additions };
}

export function applyToElement(el: OsmEl, rows: readonly RestoreRow[]): OsmEl | null {
  if (rows.some((r) => r.field === "@drop")) return null;
  let tags = el.tags ? { ...el.tags } : undefined;
  let nodes = el.nodes ? el.nodes.slice() : undefined;
  for (const row of rows) {
    if (row.field === "@add" || row.field === "@drop") continue;
    if (row.field === "nodes") {
      nodes = row.value ? row.value.split(",").map((s) => Number(s)) : [];
      continue;
    }
    if (row.value === null) {
      if (tags) delete tags[row.field];
    } else {
      tags = tags ?? {};
      tags[row.field] = row.value;
    }
  }
  return { ...el, tags, nodes };
}

export interface PreparedRestoration {
  byId: Map<string, RestoreRow[]>;
  additions: OsmEl[];
  stats: { rows: number; additions: number; drops: number };
}

export function prepareRestoration(file: RestoreFile): PreparedRestoration {
  const byId = new Map<string, RestoreRow[]>();
  let drops = 0;
  for (const row of file.rows) {
    if (row.field === "@drop") drops++;
    const k = `${row.type}/${row.id}`;
    const list = byId.get(k);
    if (list) list.push(row);
    else byId.set(k, [row]);
  }
  return {
    byId,
    additions: file.additions,
    stats: { rows: file.rows.length, additions: file.additions.length, drops },
  };
}

export function loadOptionsFromRestoration(file: RestoreFile): { options: LoadOptions; stats: PreparedRestoration["stats"] } {
  const prepared = prepareRestoration(file);
  return {
    stats: prepared.stats,
    options: {
      mutate: (el) => {
        const rows = prepared.byId.get(`${String(el.type)}/${String(el.id)}`);
        return rows ? applyToElement(el as unknown as OsmEl, rows) as Record<string, unknown> | null : el;
      },
      extra: prepared.additions as unknown as Record<string, unknown>[],
    },
  };
}

export function readRestoration(tablePath = RESTORATION_PATH, overridesPath = OVERRIDES_PATH): RestoreFile | null {
  if (!fs.existsSync(tablePath)) return null;
  const file = JSON.parse(fs.readFileSync(tablePath, "utf8")) as RestoreFile;
  if (!fs.existsSync(overridesPath)) return file;
  const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8")) as RestoreOverrides;
  return applyOverrides(file, overrides);
}

/** How many building ways in `elements` carry a damage building value. */
export function countRuinBuildings(elements: readonly { type: string; tags?: Record<string, string> }[]): number {
  let n = 0;
  for (const e of elements) if (e.type === "way" && isDamageBuilding(e.tags?.building)) n++;
  return n;
}
