# The Pier / Пірс («Пирс»)

Research brief for the pre-war, high-realism landmark pass. Coordinates are WGS84
latitude/longitude, rounded to 6 decimals. The target state is the latest state I
could verify inside 2016–2020; no post-24-Feb-2022 appearance is used.

## Identity and scope

This is the small public riverside landing at the foot of historic Ushakova
Avenue, where the avenue reaches the Dnipro promenade. It is not the River Port
or River Station. The River Station berths are farther north-west, around
46.6240, 32.6103–32.6117 (OSM nodes 6397020264, 6400412285, 6400412354 and
6400412395), and must not be substituted for this landmark.

The pier should read as a civic promenade/landing, not an industrial wharf: a
wide paved river edge, steps from the avenue, a short projecting deck, dark
ship-like railings, flower boxes, benches, lamps, mature trees and occasional
seasonal stalls. The nearby Frigate / First Shipbuilders monument is important
context but is not the pier itself.

## Location and OSM anchors

The OSM snapshot has no single clean `man_made=pier` way for this public deck.
Use the following geometry as the explicit override anchor and keep the deck
shape hand-authored from the estimates below:

| Point | Latitude | Longitude | Use |
|---|---:|---:|---|
| Avenue centreline end | 46.628370 | 32.620920 | Bottom of Ushakova Avenue; OSM way 42984703 ends here. |
| Stairs/ramp top | 46.628250 | 32.621050 | First landing below the avenue; estimated from the avenue end and dated promenade views. |
| Stairs/ramp bottom | 46.628090 | 32.621600 | Lower promenade landing; estimate, not an individually tagged OSM node. |
| Pier root | 46.628200 | 32.621900 | Where the short deck leaves the promenade; estimate from OSM footways 566366476/566366478. |
| Pier tip | 46.627850 | 32.622250 | River-facing end of the modeled deck; estimate from the same footway cluster and shoreline direction. |
| Promenade west end | 46.628450 | 32.620600 | Park/toilet side of the avenue landing. |
| Promenade east/context end | 46.628240 | 32.623300 | Frigate monument and public riverfront context. |
| First Shipbuilders monument | 46.628238 | 32.623299 | OSM node 8482629942; do not turn this monument into a pier. |

Relevant OSM elements:

- [Ushakova Avenue / current Nezalezhnosti Avenue, way 42984703](https://www.openstreetmap.org/way/42984703): `old_name=проспект Ушакова`, four lanes, asphalt; its final node is the approach anchor.
- [waterfront park, way 203239252](https://www.openstreetmap.org/way/203239252): `leisure=park`, the public green strip around the landing.
- [footway 566366476](https://www.openstreetmap.org/way/566366476) and [footway 566366478](https://www.openstreetmap.org/way/566366478): short lower paths near the estimated deck/root.
- [footway 1089978497](https://www.openstreetmap.org/way/1089978497): path continuing through the waterfront park.
- [unclassified waterfront/service route 203239253](https://www.openstreetmap.org/way/203239253): keep it behind the public promenade; it is not the pier deck.
- [Dnipro river way 162682945](https://www.openstreetmap.org/way/162682945): water context only.
- [First Shipbuilders monument node 8482629942](https://www.openstreetmap.org/node/8482629942): adjacent landmark, at 46.628238, 32.623299.
- [Hotel “Fregat”, way 116810729](https://www.openstreetmap.org/way/116810729): nearby built context, not the River Station.
- River Station exclusion: [node 6397020264](https://www.openstreetmap.org/node/6397020264), [node 6400412285](https://www.openstreetmap.org/node/6400412285), [node 6400412354](https://www.openstreetmap.org/node/6400412354) and [node 6400412395](https://www.openstreetmap.org/node/6400412395).

The OSM links are geometry/tag references, not proof of the historical visual
state. The current snapshot includes later edits; do not copy current `ruins`,
water-level or wartime tags into this pre-war landmark.

## Target state and changes over time

1. The major embankment reconstruction was completed for the end of August
   **2008**. The retrospective describes replacement of broken asphalt with
   three-colour paving, unified park benches and bins, lamps with flower boxes,
   repaired bank-retaining wall, several descents to the water, repaired
   mooring elements and new greenery. Source: S1, state date **2008**.
2. The same reconstruction made a fountain with a basin on the avenue axis at
   the bottom of the embankment; the source says it was visible from both the
   avenue and the Dnipro. Treat that as the axial promenade fountain, not a
   fountain inside the later hotel grounds. Source: S1, state date **2008**.
3. The First Shipbuilders / Frigate monument received modern illumination in
   **2010**. It is a 15 m copper-sheet, granite-and-concrete composition; use it
   only as the recognizable background landmark. Sources: S1, state date **2010**;
   S3, photo date **2020-05-23**; S4, photo date **2018-08-19**.
4. A 2020 photo record still shows the tree-lined public promenade, railings,
   moored small craft and the Frigate context. Use **2020-05-23** as the latest
   verified visual state for the public-facing promenade. Source: S3.
5. Do not add a sandy beach strip as a pre-war feature. A beach-like strip is a
   later post-2022 condition and is outside this brief; the 2008–2020 evidence
   supports a hard quay/retaining edge with planted public space above it.

## Plan, dimensions and verticals

These are modeling dimensions, not a cadastral survey. “OSM estimate” means
measured from the coordinates and line geometry above; “photo estimate” means
scaled against the known 15 m monument or ordinary people/boats in S3/S4.

| Element | Target dimension | Method and confidence |
|---|---:|---|
| Upper promenade at avenue landing | 10–12 m clear width | OSM park/footway envelope plus S3; medium. |
| Axial approach from avenue to lower landing | 7–9 m clear width | Symmetry implied by S1; low/medium. |
| Pier deck | 40–45 m long, 4.5–5.5 m wide | OSM footway cluster and shoreline direction; photo-scale estimate; low. |
| Deck height above ordinary river surface | 1.2–1.8 m | Photo estimate from railing and boat freeboard; low. Preserve a vertical quay face below it. |
| Promenade retaining wall | 1.5–2.5 m visible above lower water edge | S1 says the bank-strengthening wall was repaired; exact height not published; low. |
| Stairs from avenue to promenade | 10–14 risers, 0.14–0.17 m each, 3.0–4.0 m wide | OSM approach plus photo-scale estimate; low. |
| Accessible ramp | 1:12 to 1:15, 2.0–2.5 m wide | Explicitly include beside the steps; ramp geometry is not tagged in the snapshot; low. |
| Lower deck access | 2–3 steps at 0.15 m, or a short flush gangway | Use a flush gangway if the modeled river level makes steps implausible; low. |
| Railings | 1.0–1.1 m high; posts every 1.8–2.4 m | S3/S4 visual scale; medium for height, low for spacing. |
| Lamp spacing | 18–25 m along the main promenade; 12–18 m around the landing | Three-colour paving and flower-box lamps are verified by S1; spacing is photo estimate. |
| Lamp height | 4.5–6.0 m | Photo estimate; low. |
| Benches | 1.8–2.2 m long, 0.42–0.50 m deep, seat at 0.43–0.48 m | Unified park benches are verified by S1; dimensions are generic public-furniture scale. |
| Tree spacing | 7–12 m in irregular rows; 12–18 m around the open landing | S1/S3 greenery plus OSM park outline; medium for rhythm, low for exact positions. |

Model stairs/ramp as a descent from the avenue at 46.628370, 32.620920 to
the lower promenade at 46.628090, 32.621600. Keep the river-facing deck axis
roughly south-east from root 46.628200, 32.621900 to tip 46.627850,
32.622250. If the implementer later obtains a dated survey or Street View
capture, replace these two estimates without changing the landmark identity.

## Materials and colours

Hex values are visual starting points, not sampled colours. They should receive
sun/fog variation and not be flat untextured swatches.

| Surface/prop | Target treatment | Approx. colour |
|---|---|---|
| Main promenade paving | Concrete pavers in three muted colours; broad longitudinal/rectangular bands with occasional small blocks, not a glossy modern plaza. | grey `#8A8B86`, warm grey `#A7A39A`, muted red-brown `#9A6254` |
| Avenue asphalt | Dark worn asphalt, patch variation and a pale kerb. | `#34383A`, kerb `#B2B0A5` |
| Retaining wall/quay | Grey concrete or granite-faced vertical bank wall, slightly stained at the lower edge. | concrete `#777A78`, granite `#626762` |
| Pier deck | Grey concrete slabs or dark timber-like boards only if the dated reference angle shows boards; default to concrete/paving for the 2008 reconstruction. | `#747875` / `#6A6259` |
| Railing | Ship-leer/rope-like metal pattern: dark green-black posts and horizontal rails, simple repeats, no ornate gold. | `#263331` with worn highlight `#56635D` |
| Lamps | Narrow dark metal posts, small lantern or shallow cap; flower box below the lantern on the main promenade. | `#27302E`, warm light `#F4D69A` |
| Benches | Dark metal sides with medium-brown slats; face the river or sit perpendicular to the path. | metal `#303836`, wood `#77523B` |
| Bins | Unified dark metal cylindrical or square bins beside benches and lamps. | `#3D4642` |
| Planters/flower beds | Low concrete or stone edging, seasonal reds/yellows/greens; flower carpets are a documented 2012 event, so use restrained beds rather than a festival installation. | edging `#868580`, foliage `#3C713E`, flowers `#C75B48` / `#E3B64E` |
| Water | Broad blue-grey Dnipro surface with low wind ripple; no beach sand. | `#557A86` with reflected sky `#92B5B8` |

## Furniture, props and arrangement

- Put the main pedestrian axis on the avenue centreline. The 2008 source says
  the fountain was on this axis; it should frame the avenue-to-river view.
- Place 5–8 benches on the upper/lower promenade, mostly facing the Dnipro,
  with 15–22 m gaps. Add two benches near the pier root and one near the tip
  only if the deck remains at least 1.5 m clear at its narrowest point.
- Use 6–10 lamp posts in the modeled 40–45 m deck/promenade segment. Keep the
  flower boxes under a subset, not every lamp; S1 confirms the type, not the
  count.
- Add 4–8 low planters or planted beds along the retaining wall and stairs.
  The 2012 flower-carpet event confirms active floral display, but it does not
  justify covering the whole promenade in flowers.
- Add 1–3 small seasonal kiosks/tent cafés near the upper promenade or Frigate
  context, each 2.5–4 m wide, with a simple awning and no invented brand logo.
  The 2020 photo record shows public activity and small craft, but the exact
  kiosk inventory is not verifiable; keep these props sparse and optional.
- Add a few mooring cleats/low bollards at the water edge, painted dark metal;
  do not turn the deck into an industrial cargo berth.
- Add no permanent beach furniture, sun umbrellas or water-sports equipment
  unless a dated 2000–2020 reference is later found.
- Background context: the 15 m Frigate monument at 46.628238, 32.623299,
  granite/concrete base, copper ship silhouette and a small amount of
  illumination. It is a high-value recognition cue, but keep its monument
  geometry separate from the short public pier.

## What makes it recognisable — top five

1. The straight descent of Ushakova Avenue into a broad, three-colour paved
   riverside promenade.
2. The short deck projecting from the promenade with dark ship-like railings.
3. Lamp posts with flower boxes, matching benches and bins.
4. Mature greenery and low flower beds framing an open Dnipro view.
5. The nearby 15 m copper Frigate monument and occasional small excursion craft;
   this is public riverfront context, not the River Station.

## Not to include

- No war damage, shelling, checkpoints, military positions, occupation signage
  or sensational imagery.
- Nothing photographed or built after **24 February 2022**; specifically omit
  later flood/beach conditions.
- Do not use the River Port/River Station berths as the landmark.
- Do not copy any source image into the repository. Use the links only as visual
  references; all geometry and props must remain procedural/project-owned.

## Sources and dates

S1. [Kherson Daily — “Набережная Днепра по проспекту Ушакова”](https://khersondaily.com/news/naberezhnaja_dnepra_po_prospektu_ushakova), retrospective state dates **2008** reconstruction, **2010** monument lighting and **2012** flower-carpet event; page capture date not stated.

S2. [ArtKavun — “За чотири роки тут буде…”](https://artkavun.kherson.ua/en-cherez_chetyre_goda_zdes_budet.htm), article date **2008-05-01**; describes the then-current reconstruction proposal, 15,000 m² work area, paving, lamps, benches, flower beds and fountain. Treat proposals as low-confidence unless S1/S3 agree.

S3. [Top Photo Spots — Ushakova Avenue Embankment](https://topphotospots.com/location/naberezhnaya-prospekta-ushakova-herson), photograph/capture date **2020-05-23**; dated visual reference for the promenade, river edge, railings, small craft, trees and Frigate context.

S4. [Turbina Travels — Central Dnipro Embankment](https://turbinatravels.com/guide/Kherson-Ukraina-91385/Otzyvy/Tchto-delat-dostoprimetchatelnosti/Arkhitektura-Pamyatniki/3/0/Tsentralnaya-naberezhnaya-57364/Otzyv/Dneprovskaya-naberezhnaya-v-Khersone-86134/), photo trip date **2018-08-19**; confirms the public promenade between the River Port and the industrial/working-waterfront context and the use of the embankment for small passenger craft.

S5. [OSM way 42984703](https://www.openstreetmap.org/way/42984703), [OSM park way 203239252](https://www.openstreetmap.org/way/203239252), [OSM footway 566366476](https://www.openstreetmap.org/way/566366476), [OSM footway 566366478](https://www.openstreetmap.org/way/566366478), [OSM node 8482629942](https://www.openstreetmap.org/node/8482629942) and [OSM river way 162682945](https://www.openstreetmap.org/way/162682945), geometry/tag anchors from the project snapshot; OSM capture date is not a historical visual date, so use only for coordinates and exclusions.

## Confidence and gaps

Overall confidence: **medium for identity, promenade character and 2008–2020
materials; low for the exact short-deck footprint and vertical dimensions**.

Verified: the avenue-end location, public promenade identity, 2008 material and
furniture changes, repaired retaining wall and water descents, 2020 promenade
visuals, Frigate monument context and the River Station distinction.

Not verified: a historical OSM `pier` polygon, exact pier root/tip, ordinary
water level, stair count, railing post spacing, lamp count/height, bench count,
tree species, kiosk inventory and whether a separate public beach strip existed
before 2020. Keep those values easy to revise and favor the documented 2008
promenade over invented detail.

## Photo pass (2026-10-18)

The owner supplied twelve photos of the pre-war embankment. They override the
guesses above where they disagree:

- The promenade is the OSM pedestrian multipolygon 2727475 (outer way
  203239247, ~11,000 m²), not a plaza on the avenue axis. Its river edge is
  shared with the water polygon and includes the small cannon bastion; the
  Frigate pedestal (way 203239246) and the fountain (way 1089978496) are its
  holes. There is no long projecting deck: the guessed 45 m deck is dropped.
- Railing: royal-blue curved (S-shaped) flat posts about 2 m apart with three
  white/light-grey tube rails, on a light coping above a grey quay wall, with a
  red-brown border band on the land side. Not dark green.
- Lamps: black cast-iron poles with a fluted base, collars, a shepherd's-crook
  top with a small scroll, and a bell cap over a frosted globe; about every
  15 m along the railing and along the park edge.
- Paving: grey-beige concrete cobbles with occasional warmer stones.
- Long rectangular rose beds with white kerbs down the middle; wooden-slat
  benches with black cast-iron ends facing the river.
- The First Shipbuilders monument: a red-brown relief block toward the land, a
  tapering pylon of grey granite courses, a dark bronze three-master on top.
- The cannon («Гармата», node 6690931027) on the bastion tip.
- Moored yachts (white, and one black) and a floating landing at the
  «Центральна набережна» stop; the yellow portal cranes of the cargo port
  along its river quay (way 340197014) behind the west end.
