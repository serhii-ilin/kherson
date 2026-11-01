# Deployment

Voxel Kherson is a fully static site with no server, database or API keys. GitHub Actions builds it and GitHub Pages hosts it.

- **Live site:** https://serhii-ilin.github.io/kherson/
- **Repository:** https://github.com/serhii-ilin/kherson
- **Workflow:** `.github/workflows/deploy.yml`

## 1. How a deploy works

Every push to `main` (or a manual **Run workflow**) runs:

| Step | Command | Notes |
|---|---|---|
| Checkout | `actions/checkout@v4` | includes the committed OSM snapshot `data/osm/kherson.json.gz` |
| Node | `actions/setup-node@v4` (Node 24, npm cache) | Node 24 is needed for `--experimental-strip-types` |
| Install | `npm ci` | |
| Test | `npm test` | a failing test blocks the deploy |
| Bake | `npm run bake` | regenerates `public/world/` from the snapshot (it is not committed) |
| Build | `npm run build` | `tsc --noEmit` and `vite build`, which outputs `dist/` (including `dist/world/`) |
| Upload | `actions/upload-pages-artifact@v3` (`dist`) | |
| Deploy | `actions/deploy-pages@v4` | environment `github-pages` |

A full run takes about 30–60 s. The site updates as soon as the deploy job turns green; a browser hard refresh may be needed.

Watch a run from the terminal:

```bash
gh run list -R serhii-ilin/kherson --limit 3
gh run watch <run-id> -R serhii-ilin/kherson --exit-status
gh run view <run-id> -R serhii-ilin/kherson --log-failed   # when it fails
```

## 2. First-time setup (new repository or fork)

1. **Create the repository and push.** GitHub Pages on a free plan needs a public repository.
   ```bash
   gh repo create <name> --public --source . --push
   ```
2. **Enable Pages with GitHub Actions as the source**, once, before the first deploy can publish.
   ```bash
   gh api -X POST repos/<owner>/<name>/pages -f build_type=workflow
   ```
   Or: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Set the base path.** Pages serves the site under `/<repo-name>/`. If the repository is not called `kherson`, change `base` in `vite.config.ts`:
   ```ts
   export default defineConfig({ base: '/<repo-name>/', ... })
   ```
   All runtime URLs (`world/…`, `places.json`) are built from `import.meta.env.BASE_URL`, so nothing else needs to change.
4. **Optionally, point the fetch tool at your repository.** Update the contact URL in the `User-Agent` in `tools/fetch-osm.ts` so Overpass operators can reach you.
5. Push to `main` and watch the run.

### Custom domain (optional)

1. Add a `public/CNAME` file containing the domain.
2. Set `base: '/'` in `vite.config.ts`.
3. Configure DNS as described in GitHub's Pages documentation.
4. Enable **Enforce HTTPS** in Settings → Pages.

## 3. Local production check

Run this before pushing anything non-trivial:

```bash
npm ci
npm test
npm run bake
npm run build
npm run preview          # http://localhost:4173/kherson/
```

Things to check in the browser:
- the spawn on Freedom Square;
- walk and fly (`F`);
- the Places menu;
- the language switch;
- that the console shows no WebGL or shader errors.

## 4. Refreshing the map data

The OSM snapshot is committed on purpose. Deploys bake that file and do not call Overpass. The Pages workflow is unchanged: if `data/osm/kherson.json.gz` is in the checkout, `npm run bake` never touches the network. It tries the frozen GitHub release only when the file is missing.

The snapshot is pre-war. Two ways to rebuild it:

### 4.1 Overpass attic (default)

`npm run fetch-osm` requests the database as of `2022-02-01T00:00:00Z` (override with `--date YYYY-MM-DDTHH:MM:SSZ`, or `--live` for the current database). The query is the same tiled fetch as before, with retries. Tiles are cached under `data/osm/tiles/<date>/` so an attic run cannot reuse a live tile. Public Overpass is often at capacity, and attic queries are heavier than live ones; a full run can take a long time or fail.

```bash
rm -rf data/osm/tiles
npm run fetch-osm                # attic 2022-02-01, 16 tiles
npm run fetch-osm -- --date 2022-01-15T00:00:00Z
npm run fetch-osm -- --live      # current OSM, not pre-war
```

If every tile fails and the requested instant is the default `2022-02-01T00:00:00Z`, fetch falls back to the frozen release below. That asset is the Geofabrik 2022-01-01 extract, not a 1 February attic result; the log says so. `--live` and any other `--date` do not fall back.

### 4.2 Offline, from Geofabrik `ukraine-220101.osm.pbf`

This is the path that produced the committed file. The extract is OpenStreetMap for Ukraine as of 2022-01-01 (file written 2022-01-02), the nearest complete country dump published before the invasion. It needs [osmium-tool](https://osmcode.org/osmium-tool/).

```bash
npm run fetch-osm -- --geofabrik
# or, if the PBF is already on disk:
npm run fetch-osm -- --pbf data/osm/upstream/ukraine-220101.osm.pbf --date 2022-01-01T00:00:00Z
```

`--geofabrik` downloads `https://download.geofabrik.de/europe/ukraine-220101.osm.pbf` (678,386,418 bytes) into `data/osm/upstream/` (gitignored) and checks the size. osmium then clips it with `--strategy smart` to the project bbox plus 0.015° on each side, writes `data/osm/kherson-bbox.osm.pbf`, and the script filters that clip to the same tags as the Overpass query. Relation 2175078 and its member ways are kept even when a member way has no other matching tags. Ways of the Antonivskyi road bridge and its short approaches are kept even if they fall just outside the bbox.

### 4.3 Frozen release

The release is an owner step. This repository does not create it on push.

```bash
npm run publish-snapshot
```

That copies `data/osm/kherson.json.gz` and `data/osm/kherson-bbox.osm.pbf` into `data/osm/release/` (gitignored), writes `SHA256SUMS` and `NOTES.md`, and prints a `gh release create osm-2022-01-01 ...` command. It does not upload. The same steps are in `.github/workflows/snapshot-release.yml`, which is `workflow_dispatch` only and is separate from the Pages deploy.

`npm run fetch-osm -- --from-release` downloads `kherson.json.gz` from that release and checks it against the release's `SHA256SUMS`. `npm run bake` does the same if `data/osm/kherson.json.gz` is absent.

After a refresh:

```bash
npm run bake
npm test && npm run build
git add data/osm/kherson.json.gz
git commit -m "Refresh OSM snapshot (YYYY-MM-DD)"
```

- **Tile cache:** `data/osm/tiles/<date>/` is gitignored. Delete that directory to refetch one date.
- **City boundary:** the bake keeps the city inside OSM relation 2175078 (`CITY_RELATION` in `tools/bake/config.ts`, dilated by 20 m). Water and natural land cover stay outside it. The bake fails if the relation is missing.
- **Antonivskyi road bridge:** outside that polygon. The bake stamps a 30 m corridor around the carriageways (Wikidata Q4067525) and 450 m of each trunk approach. The railway bridge (Q4067523) is not included. The world bbox east edge is 32.73 so the span fits in the grid; west and north are unchanged, so existing `x`/`z` poses stay put.
- **Bbox:** `tools/bake/config.ts`, mirrored by `DEFAULT_BBOX` in `src/landmarks/geo.ts`. Changing west or north moves the world origin and every shared URL pose.
- **Review the bake stats before committing.** A sudden drop usually means a partial download. The 2022-01-01 bake is about 5,000 buildings, 386 named streets, 859 vector tiles, 325k trees, 244k bushes, and about 14 MB of world data. The earlier live snapshot was about twice as many buildings; that gap is the mapping added after January 2022, not a truncated download (the bbox clip has 6,072 building ways and the JSON keeps 5,900).

### Size limits

| Limit | GitHub Pages | Current |
|---|---|---|
| Published site | 1 GB | about 17 MB after this snapshot (the bake writes about 14 MB of world data; the site total depends on the JS bundle) |
| Single file | 100 MB | region files are about 60 KB or less |
| Snapshot in git | (keep it small) | `kherson.json.gz` is about 1.9 MB |

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `fetch-osm` gets `406 Not Acceptable` | Overpass rejects requests without an identifying User-Agent | keep the `User-Agent` with a contact URL in `tools/fetch-osm.ts` |
| `fetch-osm` reports `502` / "server is at capacity" | the public Overpass instance is overloaded | just wait; the script backs off and retries, and cached tiles are kept |
| `fetch-osm` fails on every mirror | outage | retry later; deploys are unaffected because they use the committed snapshot |
| CI fails at `npm test` with `Test timed out in …ms` | CI runners are about 3× slower than a laptop | the global `testTimeout` in `vite.config.ts` is 30 s; raise it for a single heavy test with `it(..., 60_000)` |
| `ERR_UNKNOWN_FILE_EXTENSION` or a syntax error in `tools/` | Node is too old, or a non-erasable TS feature (enum, namespace, parameter property) is used | use Node 24+; keep `src/world`, `src/nature/models.ts` and `tools/` to erasable TypeScript |
| Deploy succeeds but the page is blank, with 404s for `/assets/...` | wrong Vite `base` | set `base` to `/<repo-name>/` |
| The deploy job fails with "Pages not enabled" / 404 | Pages source not set | run step 2 of the first-time setup |
| The site shows an old version | browser or CDN cache | hard refresh; Pages caches for about 10 min |
| No sound | browsers block audio until a user gesture | click or tap once; check the 🔊 button isn't muted |

## 6. Rollback

Every deploy is a commit on `main`. To roll back:

```bash
git revert <bad-commit>     # creates an inverse commit
git push                    # triggers a normal deploy
```

To redeploy without code changes: **Actions → Deploy → Run workflow**, or `gh workflow run deploy.yml -R serhii-ilin/kherson`.
