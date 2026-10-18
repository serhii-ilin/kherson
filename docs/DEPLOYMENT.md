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

The OSM snapshot is committed on purpose. Deploys must not depend on the public Overpass servers, which are often at capacity. Refresh it deliberately:

```bash
rm -rf data/osm/tiles            # drop the per-tile download cache
npm run fetch-osm                # 16 tiles, exponential backoff; can take 5–30 min when Overpass is busy
npm run bake                     # check the stats it prints
npm test && npm run build
git add data/osm/kherson.json.gz
git commit -m "Refresh OSM snapshot (YYYY-MM-DD)"
git push
```

- **Tile cache:** `fetch-osm` caches each tile in `data/osm/tiles/`, which is gitignored. A rerun after a failure resumes from the cached tiles. Delete the folder to force a full refresh.
- **Bbox:** it lives in `tools/bake/config.ts`. Changing it moves the world origin, so it changes every world coordinate, including shared URL poses.
- **Review the bake stats before committing.** Counts of buildings, roads, water, trees and bushes per species, and the total size, should be close to the previous snapshot. A sudden drop usually means a partial download.

### Size limits

| Limit | GitHub Pages | Current |
|---|---|---|
| Published site | 1 GB | about 20 MB |
| Single file | 100 MB | `overview.bin` is about 3.4 MB; region files are 60 KB or less |
| Snapshot in git | (keep it small) | `kherson.json.gz` is about 4 MB |

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `fetch-osm` gets `406 Not Acceptable` | Overpass rejects requests without an identifying User-Agent | keep the `User-Agent` with a contact URL in `tools/fetch-osm.ts` |
| `fetch-osm` reports `502` / "server is at capacity" | the public Overpass instance is overloaded | just wait; the script backs off and retries, and cached tiles are kept |
| `fetch-osm` fails on every mirror | outage | retry later; deploys are unaffected because they use the committed snapshot |
| CI fails at `npm test` with `Test timed out in 5000ms` | CI runners are about 3× slower than a laptop | give simulation-heavy tests an explicit timeout (`it(..., 30_000)`) |
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
