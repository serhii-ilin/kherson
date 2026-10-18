# Freedom Square / Площа Свободи

Research brief for the pre-war high-realism state, with the square modeled as it
looked after the Lenin statue was removed and before 24 February 2022. The target
is the main public square in front of the Kherson Regional State Administration,
not a generic Soviet plaza and not the later damaged state.

> **Owner correction (2026-10-18):** in reality the square itself has few or no trees. Keep the
> open forecourt treeless: no generic or hand-placed trees on it. Trees exist only beyond its edges
> where OSM maps `natural=tree_row` / `natural=wood` (about 65-100 m from the plinth). OSM ways with
> ids above ~1.1e9 (e.g. the grass patches 1475034043-1475034049 and pedestrian area 1475248264)
> were drawn after 2022 and may show the post-war state; use them only with care.

## Target state

Use the **2015–2020** state: the large four-storey Soviet-era administration
building at Svobody Square 1, a broad paved forecourt, mature trees and planted
edges, the former Lenin plinth area without the statue but with the restrained
2014–2018 memorial/photo-board arrangement visible in the dated sequence, and the adjacent
Pushkin/Fontannyi Square with its restored fountain. The statue was removed on
**22 February 2014**; the 2015–2020 visual state therefore has no Lenin statue.
Sources: S1 (photo **2015-07-05**), S2 (photo **2011-07-16**, earlier comparison),
S3 (photo sequence includes **2014** removal and **2018** memorial work), S4
(historical event dates).

The 2019 fountain report concerns the Pushkin Square immediately behind the
administration building: it says the fountain was restarted, its basin was
refinished and fitted with new jets, old asphalt was replaced with paving,
benches were installed and bins replaced. Model this as the maintained
2019–2020 state. Source: S5, report date **2019-07-19**.

## Location and OSM anchors

| Point | Latitude | Longitude | Use |
|---|---:|---:|---|
| Square visual centre | 46.640300 | 32.615850 | Spawn/viewpoint anchor; central paved forecourt estimate. |
| Administration south-west facade anchor | 46.640210 | 32.615920 | Outer building way 130741413, facing the forecourt. |
| Administration north-west corner | 46.641023 | 32.616107 | Outer building corner; OSM-derived. |
| Administration east/south corner | 46.640538 | 32.616569 | Outer building corner; OSM-derived. |
| Administration west/south corner | 46.640181 | 32.615917 | Outer building corner; OSM-derived. |
| Inner courtyard/void centre | 46.640500 | 32.616344 | Inner way 161949999; do not fill this void as facade. |
| Former Lenin plinth / later memorial pad | 46.640292 | 32.614935 | Centre of OSM monument way 431154051; render the 2015–2020 plinth/pad, no statue. |
| Pushkin/Fontannyi fountain centre | 46.640838 | 32.616933 | OSM fountain way 1112877424; restored in 2019. |
| Pushkin/Fontannyi Square centre | 46.640910 | 32.616900 | OSM park way 932382968; planted/fountain area behind the administration. |
| Ushakova approach | 46.640700 | 32.614286 | Historic Ushakova Avenue approach, now mapped as Nezalezhnosti; OSM way 1474811222. |
| Main square road approach south | 46.639690 | 32.614903 | OSM way 49482591, `Свободи площа`; asphalt one-way edge. |
| Main square road approach east | 46.641586 | 32.617335 | OSM way 49482603, `Свободи площа`; asphalt edge. |

Relevant OSM elements:

- [Administration relation 2168547](https://www.openstreetmap.org/relation/2168547), address Svobody Square 1; its current tags have later `building=ruins`, which must be ignored for this brief.
- [Administration outer way 130741413](https://www.openstreetmap.org/way/130741413) and [inner way 161949999](https://www.openstreetmap.org/way/161949999): footprint and courtyard/void geometry.
- [Historic Ushakova/Nezalezhnosti approach, way 1474811222](https://www.openstreetmap.org/way/1474811222), plus [way 42984703](https://www.openstreetmap.org/way/42984703) for the avenue farther south; both retain `old_name=проспект Ушакова` in the snapshot.
- [Square road way 49482591](https://www.openstreetmap.org/way/49482591) and [square road way 49482603](https://www.openstreetmap.org/way/49482603): asphalt perimeter/approach geometry.
- [Former-plinth/memorial way 431154051](https://www.openstreetmap.org/way/431154051): location anchor only; current label is “Небесна Сотня”.
- [Fontannyi/Pushkin Square way 932382968](https://www.openstreetmap.org/way/932382968), [fountain way 1112877424](https://www.openstreetmap.org/way/1112877424), [fountain footway 1112877425](https://www.openstreetmap.org/way/1112877425), and [steps way 1166313181](https://www.openstreetmap.org/way/1166313181).
- Nearby context: [Court building way 130741412](https://www.openstreetmap.org/way/130741412), [Ukraina cinema way 130756586](https://www.openstreetmap.org/way/130756586), and the surrounding residential/apartment footprints. Use their pre-war massing from the dated photos; do not use current `ruins` tags.

The OSM links provide anchors and tags only. They are not a historical capture;
the current snapshot contains post-2022 edits. All appearance decisions below
come from dated 2004/2011/2015/2018/2019 evidence.

## Plan and dimensions

The public square is not a single OSM polygon. Separate the large road envelope
from the actual pedestrian forecourt and green islands:

| Element | Target dimension | Method and confidence |
|---|---:|---|
| Administration footprint | about 93 × 80 m overall, with a small inner void | OSM outer/inner way extents; high for footprint, medium for historical continuity. |
| Main pedestrian forecourt | about 105 × 75 m of mostly hard surface | OSM road/building envelope plus S1/S2 visual scaling; medium. |
| Whole square/road-to-road envelope | roughly 230 × 270 m including perimeter roads, trees and side approaches | OSM perimeter ways; do not make all of this open paving; medium. |
| Former plinth/memorial paved pad | about 15–18 × 15–18 m | OSM way 431154051; medium for pad, low for the original pedestal itself. |
| Original pedestal block | about 5–7 × 5–7 m, 3–4 m high | S2 2011 statue image and S3 2014–2018 sequence; low/medium. Render only the empty plinth/pad in target state. |
| Fountain basin | about 8 m diameter, shallow | OSM fountain way 1112877424 extents; high for mapped diameter, medium for visible basin edge. |
| Fountain jets | 20–30 small jets in a ring/cluster, 1–2 m peak | S5 says new nozzles/jets, but not count; low; keep subdued. |
| Main path clear width | 4–7 m | S1/S3 photo scale and OSM footways; medium. |
| Side paths | 2.0–3.5 m | OSM footways; medium. |
| Steps near the administration/side approach | 14–18 risers at 0.14–0.17 m, 3–4 m wide | OSM steps way 1166313181 is about 16 m in plan; count is estimated; low. |
| Lamps | 5–7 m high, 25–35 m apart around the forecourt; 18–25 m in the planted square | Photo scale; low/medium. |
| Benches | 1.8–2.2 m long, 0.45 m deep | S5 confirms benches after 2019; dimensions are standard public-furniture scale. |
| Tree rows | none on the open square; only the OSM tree rows / woods beyond its edges | Owner correction; high. |

Use the following point-to-point structure:

- Main open forecourt: centre 46.640300, 32.615850; keep the plinth pad west
  of the administration and the building as the dominant north/east wall.
- Administration facade: use the full outer way, but expose the long facade
  from 46.640181, 32.615917 through the north/east corners to
  46.640538, 32.616569. Preserve the inner void around 46.640500, 32.616344.
- Fountain garden: use the mapped 8 m basin at 46.640838, 32.616933, with
  paved paths and grass/trees inside the `Fontannyi Square` envelope. This is
  the verified 2019 fountain; no second large fountain is confirmed in the
  main forecourt.
- Approaches: bring the Ushakova/Nezalezhnosti axis from 46.640700, 32.614286
  toward the south-west forecourt; keep perimeter roads asphalt and visibly
  separate from the pedestrian paving.

## Administration building

The building is the visual wall that makes the location read as Freedom Square:

- Four storeys, long low Soviet administrative mass, flat roof/parapet and a
  broad, nearly symmetrical public facade. The 1955 construction date is a
  historical fact, not a claim about the current post-war state. Sources S1/S2/S4.
- Use a pale warm grey/beige rendered facade, lightly weathered, with a darker
  grey granite/concrete base course. Approximate facade `#B3B1A8`, shadowed
  recesses `#7D7E79`, base `#656965`.
- Windows are repeated dark rectangular bays, approximately 1.4–1.8 m wide by
  2.0–2.3 m high, with 3.0–4.5 m bay rhythm. Use a few darker open/recessed
  windows but no glowing night windows in the daytime target. Dimensions are
  photo estimates from S1/S2, medium confidence.
- The principal elevation has a stronger horizontal ground-floor/base band and
  a central entrance emphasis. Use shallow pilaster/column rhythm in a lighter
  tone, not an ornate classical palace. Exact column count is not verified.
- Roof: flat, shallow parapet, dark grey `#515755`; no bright pitched roof.
- Add Ukrainian state flags on simple flagpoles only where the dated reference
  shows them; use 2015 photo placement as the source of truth. Do not add
  post-2022 banners or military signs.

## Paving, plinth and planted areas

- Treat the main forecourt as grey concrete/asphalt-derived paving with broad
  rectangular bands, not a polished contemporary plaza. Use light grey
  `#9A9B95`, medium grey `#777B78` and restrained red-brown accents
  `#8A5C52` only where the photo reference supports them. The exact herringbone
  or radial motif is not verifiable from the available dated text; use a simple
  rectangular grid/band pattern and mark the material as an estimate.
- The empty-of-Lenin state is essential. Remove the statue completely. Keep a
  low, broad light-grey stone/concrete pedestal or memorial pad with dark
  joints, surrounded by open paving. For the latest target state, add a small
  restrained row of dark/neutral memorial boards or photo panels near the pad,
  as seen in the **2018** sequence; use blank/abstract panel faces rather than
  graphic photographs. Do not insert a new statue, angel, military symbol or
  post-2020 memorial redesign.
- Use the OSM pad centre 46.640292, 32.614935 but do not blindly use its current
  polygon as the pedestal: it is larger than the visible pedestal and likely
  includes surrounding hardscape.
- The fountain garden behind the administration has a round/near-round basin,
  pale stone/concrete edging and a ring/cluster of jets. S5 confirms exterior
  tile cladding, internal refit and modern nozzles in 2019. Basin edge
  `#AAA9A1`, water `#6E9AA0`, metal nozzles `#73756D`.
- Add low flower beds at the square edges; no trees on the open square (owner
  correction), only the existing OSM tree rows and woods beyond its edges. OSM tree points around 46.638905–46.639246,
  32.615490–32.616433 are useful row anchors, but species tags are absent.
  Use generic broadleaf trees; do not assert linden, poplar or plane tree.

## Lamps, benches and small props

- Lamps: simple dark painted metal posts, 5–7 m high, with shallow lanterns or
  straight caps. Place them along perimeter paths and at the fountain garden;
  avoid the decorative ship-style lamps used on the embankment unless a source
  shows them here. Daylight target colour `#303735`, warm lamp glass `#E8D29E`.
- Benches: 1.8–2.2 m long, dark metal frames and medium-brown slats, mostly on
  planted edges and beside the fountain paths. S5 explicitly reports benches
  installed during the 2019 Pushkin Square work.
- Bins: one near each bench cluster and at approach corners, dark green/grey,
  compact, no bright branding. S5 confirms replacement of bins in 2019.
- Flagpoles: a small group at/near the administration entrance; use blue/yellow
  Ukrainian flags only when placed as in S1. Keep poles slender, about 8–10 m.
- Signage: one restrained Ukrainian address/administration sign at the building
  entrance; no current political slogans, no temporary wartime signage.
- Kiosks/cafés: none in the square core. Existing surrounding buildings may
  have ground-floor commercial doors, but do not add freestanding stalls to the
  administration forecourt without a dated source.

## Surrounding buildings and approaches

Model only the immediately visible edges at high detail:

- Administration: relation 2168547 / ways 130741413 and 161949999, dominant
  four-storey block.
- East/north-east edge: the former regional court footprint, OSM way 130741412,
  historically a four-storey red-roof building. Use the pre-2022 massing and
  a dark red roof `#6F3D34`; ignore current `ruins` tags.
- South-west/approach: the avenue and perimeter roads are asphalt, two-to-four
  lanes in the OSM tags, with pedestrian paving separated by pale kerbs.
- Nearby low and mid-rise apartment/commercial edges may be visible beyond the
  square. Use OSM footprints/levels where tagged, but keep them secondary to
  the administration facade, empty plinth and fountain garden.
- The approach from Ushakova Avenue should read as a gradual reveal: avenue
  asphalt and rows of trees first, then the open square, then the long
  administration wall. Avoid a sudden isolated building in a blank plane.

## What makes it recognisable — top five

1. The long, pale four-storey Regional State Administration facade enclosing the
   main forecourt.
2. The former Lenin plinth area, empty of the statue in the 2015–2020 state.
3. A broad, open grey paved space with no trees on it, flower beds at its
   edges and a strong Ushakova Avenue approach.
4. The maintained round fountain and planted Pushkin/Fontannyi Square directly
   behind/alongside the administration, matching the 2019 report.
5. Soviet civic scale: repeated windows, restrained columns, dark lamps,
   benches, bins and Ukrainian flags, with surrounding buildings framing the
   square.

## Not to include

- No war damage, blast holes, burned facades, checkpoints, military positions,
  occupation imagery or sensational treatment.
- No Lenin statue in the target state; the statue was removed in 2014.
- No post-2020 memorial redesign, post-2022 banners, sandbags or
  post-24-Feb-2022 visual changes.
- Do not use current OSM `ruins` tags to damage the pre-war administration or
  court buildings; retain their 2015–2020 massing.
- Do not copy Commons or news photographs into the repository. Use the links as
  research references and recreate the forms procedurally.

## Sources and dates

S1. [Wikimedia Commons — KhersonODA.jpg](https://commons.wikimedia.org/wiki/File:KhersonODA.jpg), photograph date **2015-07-05**; pre-war administration facade, roof/parapet, window rhythm, flags and forecourt context. CC-BY-SA is noted only for research; no image is copied.

S2. [Wikimedia Commons — Center of the city.jpg](https://commons.wikimedia.org/wiki/File:Center_of_the_city.jpg), photograph date **2011-07-16**; earlier pre-removal comparison for square scale, administration and plinth/statue relationship.

S3. [Kavun.City — photo history of Freedom Square](https://kavun.city/articles/110297/yak-viglyadala-ploscha-svobodi-v-hersoni-z-1908-roku-do-nashih-dniv-mi-zibrali-stari-foto), dated visual sequence includes the Lenin removal on **2014-02-22** and the memorial/photo-board state in **summer 2014** and **2018**; article update shown as **2020**. Use only the 2014/2018 pre-war images, not the later update images.

S4. [Wikipedia — Freedom Square, Kherson](https://ru.wikipedia.org/wiki/%D0%9F%D0%BB%D0%BE%D1%89%D0%B0%D0%B4%D1%8C_%D0%A1%D0%B2%D0%BE%D0%B1%D0%BE%D0%B4%D1%8B_%28%D0%A5%D0%B5%D1%80%D1%81%D0%BE%D0%BD%29), historical event dates **1955** (administration building), **1965** (Lenin monument) and **2014** (removal and plinth reuse); text is a historical reference, not a post-2022 visual source. The Ukrainian-language regional history page [“Площа Свободи”](https://krai.lib.kherson.ua/pl-svobodu.htm) is a complementary historical reference.

S5. [Kherson Plus — fountain restored in Pushkin Square](https://khersontv.com/u-pushkinskomu-skveri-v-khersoni-vidnovyly-fontan/), report date **2019-07-19**; fountain basin refinish, new jets, paving, benches and bins behind the administration.

S6. [OSM relation 2168547](https://www.openstreetmap.org/relation/2168547), [outer way 130741413](https://www.openstreetmap.org/way/130741413), [inner way 161949999](https://www.openstreetmap.org/way/161949999), [monument way 431154051](https://www.openstreetmap.org/way/431154051), [fountain way 1112877424](https://www.openstreetmap.org/way/1112877424), [park way 932382968](https://www.openstreetmap.org/way/932382968), [steps way 1166313181](https://www.openstreetmap.org/way/1166313181), [approach way 1474811222](https://www.openstreetmap.org/way/1474811222) and [square roads 49482591/49482603](https://www.openstreetmap.org/way/49482591). OSM capture date is not a historical visual date; use these only for geometry, IDs and tags.

## Confidence and gaps

Overall confidence: **medium-high for location, administration massing, the
2014–2020 empty-plinth state and the 2019 fountain garden; medium for paved
layout and trees; low for exact colours, lamp spacing and pedestal dimensions**.

Verified: relation/outer/inner footprint, four-storey administration identity,
2011/2015 pre-war facade evidence, 2014 statue removal, 2018 memorial-state
sequence, 2019 fountain/paving/bench/bin work, and the avenue/road approaches.

Not verified: a dated plan of the entire square, exact paver pattern and colour
mix, exact plinth dimensions/height, exact lamp model/spacing, tree species,
the number and placement of flagpoles, and whether a second fountain stood in
the main forecourt. Keep those values as adjustable estimates and do not fill
the gaps with post-2022 imagery.
