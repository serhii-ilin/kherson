# Voxel Kherson: Project Constitution

These are the principles every change to this project must respect. Where they conflict with convenience, they win. To change one, see **Amendments** at the end.

## Purpose

Give anyone, anywhere, a free and faithful way to walk the streets of Kherson: its squares, its tree-lined avenues, its embankment and the Dnipro. It must work on an ordinary laptop or phone, in Ukrainian first.

The goal is a **realistic** view of the city. Buildings, trees, streets and water should look like Kherson's, not like blocks. Voxels are a means (streaming, collision, distant detail), not the look.

## Article 1: Serverless, static and free to run

1. The site is static files only: no backend, database, server-side rendering, accounts or API keys.
2. It must deploy to GitHub Pages and stay within its limits: 1 GB per site, 100 MB per file.
3. Runtime network access is limited to the site's own origin. No third-party scripts, CDNs, fonts or trackers at runtime.
4. Deploys must not depend on external services. Map data comes from the committed snapshot, never from Overpass at build time.

## Article 2: Real places, real data

1. **Source of truth:** OpenStreetMap is the source of the city's geometry. We don't invent streets, buildings or water. Where data is missing, fill it with plausible, deterministic, clearly generic content, such as default building heights or street-tree spacing.
2. **No silent changes:** the world is shown as OSM records it, including damaged or destroyed structures. Any hand-made landmark override must be explicit and documented in code.
3. **Determinism:** the bake is deterministic. Every pseudo-random choice is a hash of coordinates or an OSM id, never `Math.random()`. The same snapshot always produces byte-identical output.
4. **Deliberate refreshes:** snapshot refreshes are separate commits with the date, after the bake statistics have been reviewed (see `docs/DEPLOYMENT.md`).

## Article 3: Ukrainian first, everyone welcome

1. The default interface language is **Ukrainian**, and English must stay complete. Every user-visible string goes through `src/i18n.ts` in both languages; no hard-coded UI text.
2. Place names are shown in their original (Ukrainian) form. English uses OSM `name:en`, or a transliteration when that is absent.
3. **Touch parity:** every feature must be usable on a phone with touch controls. No action may be keyboard-only.
4. **Layout:** the interface must not cover the controls. Check desktop and phone layouts, in both languages, before merging UI changes.

## Article 4: Performance budgets

Measure with the dev HUD (`renderer.info`) at the spawn point (Freedom Square), in a park, and over the river.

| Budget | Desktop | Phone |
|---|---|---|
| Target frame rate | 60 fps on a mid-range laptop | 30 fps |
| Fine-tier radius (0.2 m detail) | 150 m | 70 m |
| Full-detail view radius (2 m voxels) | 640 m | 384 m |
| Scene triangles | at most about 2.5M | at most about 0.9M |
| Draw calls | at most about 400 | at most about 200 |
| Sun shadows | on (2048 map, about 200 m) | off by default |
| Vegetation, finest model (0.2 m) | 40 m or less, at most 6,000 triangles per tree | 25 m or less |
| Vegetation, near model (0.5 m) | 70 m or less, at most 1,500 triangles per tree | 40 m or less |
| Vegetation, mid model (1 m) | 250 m or less, at most 400 triangles | 150 m or less |
| Birds | at most about 170 | at most about 90 |
| Concurrent audio voices | at most 24 | at most 24 |
| Bird recordings, encoded (Opus/WebM and AAC/M4A together) | at most 1.6 MB, mono, fetched only after a user gesture | same |
| Baked world (`public/world/`) | at most 30 MB | same |
| Realistic assets (`public/assets/`: material textures and facade photos) | at most 15 MB; materials fetched at start in the size for the quality setting, a facade photo only within 600 m of its building | same |

A **Low** quality setting must exist so any device can fall back to the 2 m tier without shadows.

Rules:
1. **No allocation in hot paths:** no per-frame allocation in update loops (`update`, `step`, render callbacks). Preallocate and reuse.
2. **Workers for heavy work:** meshing and other heavy work runs in Web Workers, not on the main thread.
3. **Recompute only on change:** recompute LOD and stream lists only when the camera crosses a chunk boundary or data changes, never every frame.
4. **Budgets need an explicit change:** a change that exceeds a budget must lower detail elsewhere or amend this table explicitly. It must never loosen a test bound silently.

## Article 5: Code standards

1. **TypeScript:** strict mode, with no `any` unless justified in a comment.
2. **Erasable TypeScript only** in code shared with Node tools (`src/world/`, `src/nature/models.ts`, `tools/`): no enums, namespaces or parameter properties. Relative imports use explicit `.ts` extensions.
3. **Shared contracts:** the binary formats in `src/world/format.ts` are shared contracts between the bake tool and the browser. Change them only with a version bump or a backward-compatible encoding, and update both sides plus the round-trip tests in the same commit.
4. **Pure core logic:** keep core logic (meshing, rasterisation, physics, flocking, model generation, transliteration) in pure functions or classes that run without a DOM, so it can be unit-tested.
5. **Match the surrounding code:** same naming, comment density and idioms.
6. **Dependencies:** runtime dependencies stay minimal; currently only `three`. Adding one requires a stated reason.

## Article 6: Verification before shipping

A change is done only when all of these hold:

1. `npm test`, `npm run build` and `npm run bake` pass locally.
2. **New logic has unit tests:** formats round-trip, geometry bounds, physics invariants (no falling through the ground, no walking through walls), and deterministic outputs. Tests must be robust on slower CI runners; give long simulations explicit timeouts.
3. **Visual changes are seen, not assumed:** check them in a real browser render with screenshots from known URL poses. Animations are confirmed by comparing two frames. Phone layout is checked with device emulation.
4. **CI is the gate:** the deploy workflow passing on `main` is the release gate. Report a failing deploy and fix it promptly; never bypass it.
5. **Honest results:** claims about results (performance, counts, "it works") must come from measurements in this session, not expectations.
6. **Reference photos are evidence:** photos the owner supplies are kept under `evidence/photos/` and catalogued in [docs/EVIDENCE.md](docs/EVIDENCE.md) with what each one shows, what it validates (map geometry, models, colours) and a URL pose to re-shoot from. Any later change to the place a photo shows is re-checked against it with a screenshot from that pose, and the catalogue records the result.

## Article 7: Privacy and respect

1. **No tracking:** no analytics, cookies, fingerprinting or personal data collection. `localStorage` holds only viewer preferences (language, mute), and every access is wrapped in `try/catch`.
2. **Identifying requests:** requests to third-party services (Overpass) identify the project by name and repository URL only, never a personal email or other personal data.
3. **No sound before a gesture:** audio never starts without a user gesture, and it can always be muted with one tap.
4. **Tone:** the city is presented respectfully, with no war imagery or sensational content added beyond what the map data contains.
5. **Evidence stays private:** the repository and the site are public, so reference photos are never committed, deployed or uploaded anywhere. `evidence/photos/` is git-ignored and outside `public/`; only the text catalogue (descriptions, SHA-256 hashes, poses) is committed.

## Article 8: Licensing and attribution

1. **Attribution:** map data is © OpenStreetMap contributors, under ODbL. The attribution must be visible in the README and in the running app (bottom-left on desktop, bottom centre on phones). The baked world is a derived database under ODbL.
2. **Assets:** prefer procedurally generated assets (models, sounds). Wind and water stay synthesised. Any other external asset needs a licence compatible with public redistribution (CC0, CC-BY or public domain) and credit in the README. **Bird recordings are the exception to “prefer procedural”, and a tighter one:** birds are voiced only by recordings, and a recording may be used only when the file is CC0 or public domain (no BY, NC, SA or ND, and no ripped audio). Provenance — source URL, author, licence — goes in `docs/AUDIO_CREDITS.md`. The encoded set stays inside the Article 4 budget, is mono, and is fetched only after a user gesture. A species with no suitable recording is left out of the soundscape; there are no synthetic bird voices, and a clip that fails to load stays silent. The app may show a short CC0 line beside the map credit; that line is provenance, not a licence condition.
3. **Facade photos:** photo-derived facade textures may also be CC-BY-SA (besides CC0, CC-BY and public domain). The photo must be dated before 24 February 2022, and no Google Street View or Google 3D Tiles content is used. Each texture file keeps its source's licence; author, source URL, date and licence go in `docs/ASSET_CREDITS.md` and in an in-app credits panel. CC-BY-SA applies to those texture files only, not to code or other data.
4. **Code licence:** none chosen yet; the owner decides.

## Article 9: How the work is done (AI-assisted workflow)

The project is built with AI agents under a cost-aware division of labour:

| Role | Model | Responsibilities |
|---|---|---|
| Architect and verifier | Claude Opus | plans, specs and interfaces; verification (gates, screenshots, perf); tricky bugs; merges, commits and deploys |
| Implementer | opencode `opencode-go/deepseek-v4.1-flash` | features from Opus specs, one git worktree and branch per task, committed on that branch for review |
| Reviewer | Claude Sonnet (agent) | reviews every implementer diff against its spec before merge |
| Fallback | Claude Sonnet / Haiku | when an implementer task fails two fix rounds |

Free opencode models were used for boilerplate until 2026-10-18; after repeated stalls the owner moved all delegation to Anthropic models. From 2026-10-18 the owner chose Codex `gpt-5.6-luna` (high) as the implementer, with every diff reviewed by Claude Opus. From 2026-11-06 the implementer is opencode `opencode-go/deepseek-v4.1-flash` and a Claude Sonnet agent reviews every diff; Opus plans and verifies.

Working rules:
1. **Specs first:** every delegated task gets a self-contained spec naming the files it owns, the interfaces, conventions and acceptance commands.
2. **No parallel conflicts:** agents working at the same time must not edit the same files.
3. **Review before merge:** delegated output is reviewed before it is merged. Reported numbers are re-measured, and loosened tests are rejected.
4. **Owner approval:** outward-facing actions (creating repositories, publishing, changing visibility) need the owner's approval.

## Open items

These are known gaps against this constitution. Fix them before adding new features where possible:

- Choose a code licence (Article 8.4).
### Measured frame rates

| Date | Device | Quality | Result |
|---|---|---|---|
| 2026-10-18 | MacBook Air, 16 GB (owner) | LQ and HQ | steady 60 fps (display cap) |
| 2026-10-18 | owner's phone | LQ and HQ | 60–90 fps |

## Amendments

1. **Process:** amend this document through a normal commit that changes only `CONSTITUTION.md`. Explain the reason in the commit message, and get the owner's approval.
2. **Code follows the rules:** code changes that depend on an amendment come after it, never before it.
3. **2026-11-01 — recorded birds.** The owner rejected the synthetic doves and swifts: they do not resemble the real birds. Article 4 gains a 1.5 MB budget for encoded bird recordings, loaded only after a gesture. Article 8.2 allows that set under CC0 or public domain only. Wind and water stay procedural. Approved by the owner in the request for this change.
4. **2026-11-06 — no synthetic birds.** The owner asked for the bird voices that do not sound natural to go. Article 8.2 now voices birds only with CC0 or public-domain recordings: a species without one is left out, and a failed download is silent instead of synthesised. Wind, water and the fish splash stay procedural, and the 1.5 MB budget is unchanged. Approved by the owner in the request for this change.
5. **2026-11-06 — gulls over the Dnipro.** The owner asked to hear gulls now and then over the river, and the recording set had 26 KB left. Article 4 raises the bird-recording budget from 1.5 MB to 1.6 MB. It stays mono, CC0 or public domain, and fetched only after a gesture. Approved by the owner, who chose 1.6 MB over dropping existing clips or going to 2 MB.
6. **2026-11-06 — realistic Kherson; new delegation.** The owner changed the project's goal to a realistic view of the city, so the Purpose now says voxels are a means, not the look. The owner also moved implementation to opencode agents on `opencode-go/deepseek-v4.1-flash`, with a Claude Sonnet agent reviewing every diff and Opus planning and verifying (Article 9). Approved by the owner with the realistic-trees plan.
7. **2026-11-06 — realistic buildings and roads.** The owner asked for photo-realistic, pre-war buildings and roads, especially in the well-known areas. Article 4 gains a separate 15 MB budget for realistic assets (CC0 material textures and facade photos), fetched lazily; the 30 MB baked-world budget is unchanged. Article 8.3 allows CC-BY-SA for photo-derived facade textures only, from photos dated before 24 February 2022, credited in `docs/ASSET_CREDITS.md` and in the app (settles REQUIREMENTS OQ-08). Approved by the owner in the planning session for this change.
