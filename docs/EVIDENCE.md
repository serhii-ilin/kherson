# Evidence: reference photos

Photos the owner supplies of real places, kept as evidence for re-tests and map validation
([CONSTITUTION](../CONSTITUTION.md) 6.6, 7.5).

- **Where:** `evidence/photos/<place>/NN_<what>.png`. The folder is git-ignored and outside `public/`, so the
  photos are never committed or deployed. They exist only on the owner's machine: back the folder up
  separately.
- **Integrity:** the first 16 hex digits of each file's SHA-256 are listed below. Check them with
  `shasum -a 256 evidence/photos/*/*`.
- **Re-test:** after any change to a place, open each pose below (`npm run dev`, then
  `http://localhost:5173/kherson/?quality=high&time=13&<pose>`), compare it with the photo and record the
  date and result in the place's log.
- **Adding photos:** copy them into the folder with the next number, add a row (what it shows, what it
  validates, a pose, the hash) and a log line.

## Ushakova embankment («Набережна Ушакова»)

Photos 01–12 supplied on 2026-10-18 and 13–15 on 2026-10-19, in chat. All of them show the pre-war state (blue railings, intact monument).
They drove the rebuild in `666e4e5` (`src/landmarks/pier.ts`, `embankment-props.ts`, `port-cranes.ts`) and
the [photo pass](landmarks/pier.md#photo-pass-2026-10-18) in the brief.

| # | File | Shows | Validates | Pose | SHA-256 |
|---|---|---|---|---|---|
| 01 | `01_frigate-crook-lamp-railing.png` | Frigate from the land side, a crook lamp, blue S-post railing with white rails, rose beds, steps up to the park | lamp model; railing colours/shape; red relief block in front of the pylon; bed kerbs | `x=10944&z=10128&yaw=-138` | `311991205e90f3c2` |
| 02 | `02_promenade-to-port-cranes.png` | promenade toward the port: lamps along the railing, white-kerbed beds, benches on the park side, yellow cranes, ship | promenade width and layout; lamp rhythm; crane silhouettes behind the west end | `x=10905&z=10160&yaw=124` | `ca25e16adf661499` |
| 03 | `03_aerial-promenade-landing.png` | aerial along the quay: tree line, square beds, monument, floating landing with canopy, moored yachts | OSM promenade outline; bed spacing; landing and yachts at the ferry stop | `mode=fly&x=10915&z=10200&y=14&yaw=-15&pitch=-8` | `d5e5e3905c109ee2` |
| 04 | `04_lamps-monument-benches.png` | lamps, benches with cast-iron ends, white vases, monument with masts behind | bench model; lamp height (~4 m) | `x=10900&z=10140&yaw=-60` (approx.) | `f07a19f462f17c77` |
| 05 | `05_dusk-lit-lamps.png` | dusk, lit globes, monument, railing | only the globes glow at night | `x=10930&z=10150&yaw=-60&time=20:30` (approx.) | `ed6cd9b05666b52e` |
| 06 | `06_hotel-fregat.png` | Hotel «Фрегат»: 15-storey slab, yellow balcony bands, tower with sail crown | not modelled yet (PROGRESS #32) | pose TBD | `9f9556fefb72f4a9` |
| 07 | `07_frigate-relief-front.png` | Frigate front: bronze relief figures on the block, granite-course pylon, ship | monument proportions (relief ~2.6 m, pylon ~3× it) | `x=10944&z=10128&yaw=-138` | `ef3c38b24fc34412` |
| 08 | `08_sunset-railing-lamps.png` | sunset over the river: railing, lamps, beds, monument at the left, cranes far right | railing run and lamp spacing along the quay | `x=10844&z=10206&yaw=-56` | `d147063ec70ed1d0` |
| 09 | `09_timber-monument-port.png` | stacked-timber monument on a paved square by the water; cranes and warehouse across the inlet | not modelled: location unknown (PROGRESS #34) | pose TBD | `4b9da44b5a2a8b8d` |
| 10 | `10_black-yacht-quay-cranes.png` | black yacht along the quay wall, blue railing, port cranes | quay wall face; dark yacht; crane positions on the port quay | `mode=fly&x=10830&z=10265&y=4&yaw=135&pitch=0` (approx.) | `e49ba09133249959` |
| 11 | `11_bastion-cannon-port.png` | the cannon on the small bastion, square bed, port cranes across the water | bastion shape from OSM; cannon placement | `x=10930&z=10150&yaw=110` (approx.) | `f099d9746e8a4683` |
| 12 | `12_frigate-promenade-beds.png` | Frigate from the west with beds and lamps along the railing | monument silhouette against the river; bed row | `x=10905&z=10160&yaw=-60` (approx.) | `affea7f9c95c1c6c` |
| 13 | `13_fountain-plaza-open-edge.png` | fountain plaza (2017): lobed basin with a red-brown granite wall, white coping and teal mosaic; red-brown bands fanning out to the river; no railing in front of the plaza, railing resumes on both sides; port building on the right | railing gap and bathing steps centred on the quay point nearest the fountain; fountain colours; band pattern | `x=10790&z=10172&yaw=-150` | `26465e1f4f9c52e2` |
| 14 | `14_open-edge-chapel-statue.png` | paving running straight to the river with no railing; railing and lamps further on; white kiosk/chapel with a brown roof; a standing statue on a tall pedestal | open edge; the statue is **not modelled, location unknown** (PROGRESS #36) | `x=10822&z=10214&yaw=-145` (approx.) | `3dc1fc21e43248ea` |
| 15 | `15_water-steps-railing-statue.png` | white concrete steps down to the water where the railing ends, with a short railing; beds and lamps; the statue on a red pedestal at a point with a landing | parapets and short railings at the ends of the steps | `x=10860&z=10200&yaw=-50` (approx.) | `11395e63463fa790` |

Poses marked "approx." were estimated from the photo, not yet confirmed by a screenshot.

### Log

| Date | Commit | Result |
|---|---|---|
| 2026-10-18 | `666e4e5` | Poses 01/07, 02, 03 and 08 re-shot; layout, railing, lamps, benches, beds, monument and cranes match. Gaps: small cobbles (#33), Hotel Fregat facade (#32), timber monument (#34) |
| 2026-10-19 | `9333cc7` | Photos 13–15: added a railing-free stretch with four concrete bathing steps (±15 m around the quay point nearest the fountain), white parapets with short railings, red-brown bands fanning from the fountain, and the fountain's red granite wall, white coping and teal mosaic. Re-shot pose 13 and the steps from the water: they match. Open: the statue (#36) and the exact length of the stretch |

## Filatova 28 courtyard («вул. Філатова, 28»)

Photos 01–03 supplied on 2026-10-19, in chat. Early spring, bare trees. Building: 5-storey khrushchevka, beige panel facade, balconies, ground-floor entrance with a porch.

| # | File | Shows | Validates | Pose | SHA-256 |
|---|---|---|---|---|---|
| 01 | `01_courtyard-tyres-climbing-arch.png` | courtyard path with painted tyres half-buried in arcs (green, yellow, pink, teal) and flat blue/red tyre beds along the far verge; a green/orange climbing arch; a green bench and a pink-red table under a bottle-hung shelter on the left; big grey tractor tyre planter; 5-storey block at the right | khrushchevka facade (balcony stacks, window rhythm, grilles on ground floor); courtyard scale; props to add (#38) | `x=8858&z=8017&yaw=-29&pitch=-3` (approx.) | `6a228cfe965ec515` |
| 02 | `02_tyre-planters-board-ride.png` | stacked-tyre planters (blue/teal/purple/grey, red), a board-on-tyres ride with a bicycle handlebar, tables with benches, ivy-covered post, shelter of bottles; block behind | prop models for #38 (tyre planters, ride); courtyard layout | `x=8875&z=7990&yaw=104&pitch=-5` (approx.) | `0f1c5e14f2724ee7` |
| 03 | `03_facade-entrance-blossom.png` | block facade seen from the courtyard: window pairs, ground-floor entrance with porch and people, balconies (one glazed green), poplar, tyre beds along the path | facade proportions; entrance placement; balcony glazing variety | `x=8860&z=7996&yaw=-119&pitch=10` (approx.) | `d7a753cd0d7104f9` |

### Log

| Date | Commit | Result |
|---|---|---|
| 2026-10-19 | - | Photos 01–03 catalogued; owner: the yard is on the side of house 28 that faces the school (28-А) |
| 2026-10-19 | (next commit) | Courtyard landmark added (tyre arcs and flat beds, stacked planters, climbing arch, board ride, shelter with table and bottles, bench) on the west wall of way 130752880. Poses are approx.; a headless render showed the props but not the fine-tier house, so the layout is unconfirmed (PROGRESS #38) |
| 2026-10-19 | (next commit) | Fix: `45cfd64` read the bake's OSM coordinates (2 m voxels) as metres and put the yard at half the distance, outside the city, where the owner saw no house, school or road. Re-anchored to the real west wall (66 m), props moved off the service drive along it (c ≈ −6.5 m). Re-shot pose 01 and an aerial: house on the right, drive, tyre beds between drive and wall, the yard on the school side, as in the photo |
