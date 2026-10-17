import fs from "node:fs";
import zlib from "node:zlib";
import { BBOX } from "./bake/config.ts";

// The whole bbox in one Overpass query is too heavy for busy public servers,
// so we fetch it as a grid of tiles (cached on disk) and merge by element id.
const TILES = 4;
const CACHE_DIR = "data/osm/tiles";
const OUT = "data/osm/kherson.json.gz";

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function buildQuery(b: string): string {
  return `[out:json][timeout:300][maxsize:536870912];
(
  nwr(${b})["building"];
  nwr(${b})["highway"];
  nwr(${b})["railway"~"tram|rail|light_rail"];
  nwr(${b})["natural"~"water|wood|scrub|beach|sand|wetland|tree"];
  nwr(${b})["waterway"~"riverbank|river|canal|stream"];
  nwr(${b})["landuse"];
  nwr(${b})["leisure"~"park|garden|pitch|stadium|playground"];
  nwr(${b})["place"];
  nwr(${b})["amenity"]["name"];
  nwr(${b})["tourism"]["name"];
  nwr(${b})["historic"]["name"];
  nwr(${b})["bridge"="yes"];
  nwr(${b})["man_made"="bridge"];
);
out body;
>;
out skel qt;
`;
}

async function fetchOverpass(url: string, query: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "voxel-kherson/0.1 (+https://github.com/serhii-ilin/kherson)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) throw new Error("non-JSON response");
  const remark = /"remark":\s*"([^"]*)"/.exec(text.slice(-2000));
  if (remark) throw new Error(`Overpass remark: ${remark[1]}`);
  return text;
}

async function fetchTile(b: string, label: string): Promise<string> {
  let wait = 15_000;
  for (let attempt = 1; attempt <= 8; attempt++) {
    for (const url of endpoints) {
      try {
        return await fetchOverpass(url, buildQuery(b));
      } catch (e) {
        console.error(`  tile ${label} ${new URL(url).host} attempt ${attempt}: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 240_000);
  }
  throw new Error(`tile ${label} failed after retries`);
}

interface Element { type: string; id: number; [k: string]: unknown }

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const dLat = (BBOX.north - BBOX.south) / TILES;
  const dLon = (BBOX.east - BBOX.west) / TILES;
  const merged = new Map<string, Element>();
  for (let ty = 0; ty < TILES; ty++) {
    for (let tx = 0; tx < TILES; tx++) {
      const label = `${tx}_${ty}`;
      const file = `${CACHE_DIR}/${label}.json.gz`;
      let text: string;
      if (fs.existsSync(file)) {
        text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
      } else {
        const s = BBOX.south + ty * dLat, w = BBOX.west + tx * dLon;
        const b = `${s.toFixed(5)},${w.toFixed(5)},${(s + dLat).toFixed(5)},${(w + dLon).toFixed(5)}`;
        console.log(`fetching tile ${label} (${b})`);
        text = await fetchTile(b, label);
        fs.writeFileSync(file, zlib.gzipSync(Buffer.from(text, "utf8"), { level: 6 }));
      }
      const els = (JSON.parse(text) as { elements: Element[] }).elements;
      for (const el of els) {
        const key = `${el.type}/${el.id}`;
        const prev = merged.get(key);
        // Skeleton output ("out skel") lacks tags; keep the richer copy.
        if (!prev || (!prev.tags && el.tags)) merged.set(key, el);
      }
      console.log(`tile ${label}: ${els.length} elements (total ${merged.size})`);
    }
  }

  const elements = [...merged.values()];
  const json = JSON.stringify({ version: 0.6, bbox: BBOX, elements });
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  fs.writeFileSync(OUT, gz);
  const count = (t: string) => elements.filter((e) => e.type === t).length;
  console.log(`Wrote ${OUT} (${gz.length} bytes gzipped, ${json.length} bytes raw)`);
  console.log(`nodes=${count("node")} ways=${count("way")} relations=${count("relation")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
