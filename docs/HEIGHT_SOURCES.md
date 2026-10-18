# Open sources for Kherson building heights and storeys

Research snapshot: 2026-10-18. Access dates below are the date of this
research. The project constitution is controlling: the runtime must remain
static, OSM is the geometric source of truth, and any additional data baked
into the world must permit public redistribution of the derived result.

## Executive recommendation

Use a pinned **Overture Maps Buildings** release as the primary enrichment
source, but copy only a numeric `num_floors` or `height` value when it is
present and retain its `sources[]` provenance. Prefer OSM-origin values when
Overture exposes them, and do not silently replace an explicit OSM
`building:levels`/`height` value. Overture publishes the Buildings theme under
ODbL and exposes source dataset, record ID, update time, and licence metadata
per source ([schema](https://docs.overturemaps.org/schema/reference/buildings/building/),
[licensing](https://docs.overturemaps.org/attribution/)).

Use **OpenBuildingMap** as the licence-compatible fallback for missing OSM
values. It is ODbL, has OSM IDs for OSM-sourced features, and publishes
inferred height/story categories; it is not a direct survey, so treat its
categories as a prior rather than an exact measurement ([data description](https://datapub.gfz.de/download/10.5880.GFZ.LKUT.2025.002-Caweb/2025-002_Oostwegel-et-al_OpenBuildingMap_data-description.pdf)).

Use **GHSL GHS-BUILT-H** or **WSF-3D** only as a neighbourhood/cohort prior
and sanity check. Their approximately 90--100 m cells cannot reliably tell a
particular five-storey building from a particular nine-storey building. For
the final unresolved buildings, keep the existing deterministic heuristic and
label the result as inferred rather than presenting the grid value as a
building measurement.

The recommended deterministic order is therefore:

```text
explicit OSM height/levels
  -> Overture num_floors/height
  -> OpenBuildingMap height/story category
  -> GHSL-BUILT-H or WSF-3D neighbourhood prior
  -> existing deterministic building-type/footprint heuristic
```

The external provider samples were **not downloaded in this session**: the
sandbox could not resolve the provider endpoints, and the Overture client
probe therefore failed before obtaining a file. External Kherson feature
counts below are marked “not measured”, not zero. A future probe must record
the exact release, URL, checksum, byte size, and count.

## Local baseline

The checked-in OSM snapshot is `data/osm/kherson.json.gz`, covering roughly
46.58--46.72 N, 32.48--32.72 E. In the requested Filatova-area bbox
`46.642--46.653 N, 32.582--32.606 E`, a local Node inspection counted building
ways whose mean node coordinate fell inside the bbox:

| Item | Count |
|---|---:|
| OSM building ways | 555 |
| With `building:levels` or `levels` | 151 |
| With `height` | 1 |
| With neither levels nor height | 404 |

The one height-tagged way is also represented in the levels count. Counting a
way when any node intersects the bbox gives 581 buildings, 164 with levels,
and 417 without either attribute; this is a different boundary convention.
The levels present in the mean-coordinate sample include 33 five-storey and
9 nine-storey buildings. These are counts from the local snapshot, not a claim
about the current OSM database or the exact “402 of 566” example.

No external source count is reported yet. Once a source is fetched, the
probe should use the same OSM building set and report both the number of
successful joins and the number of buildings that received a usable numeric
height/storey value.

## Comparison

“Coverage” means product-level coverage unless the row says that the Kherson
tile or bbox was actually inspected. “Redistributable” is assessed for the
cached upstream data and derived baked values under Constitution Art. 8; it
does not replace a project-specific legal review.

| Source | What it contains | Kherson coverage verified? | Date / vintage | Licence and redistribution | Download / bbox size | Join to OSM | Expected accuracy |
|---|---|---|---|---|---|---|---|
| [Overture Maps Buildings](https://docs.overturemaps.org/guides/buildings/) | Global building polygons; `height` in metres, above-ground `num_floors`, `min_height`, parts, and `sources[]` provenance. | **Product yes; bbox sample not measured.** Official Python client supports a bbox and GeoJSON/GeoParquet output. | Current release observed in the docs: `2026-09-23.1`; individual source dates vary. OSM and imagery-derived records can be newer than the pre-2022 target. | Buildings theme is ODbL. Source licences and record IDs are exposed per feature; current Microsoft-derived records should be consumed through Overture’s compatible publication, not copied from Microsoft directly. Suitable candidate for the baked ODbL world, subject to retaining attribution. | Stream a tight bbox with the [Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/) or DuckDB. Exact Kherson bytes were not measured; record the downloaded file size. Do not download the full release. | First use a parseable OSM source record ID. Otherwise spatial candidate search, footprint IoU (target at least 0.5), centroid and area tie-breaks. Keep OSM geometry as authoritative. | Best candidate. Explicit OSM/manual attributes are strongest; other values are source-dependent estimates. Overture publishes no single Kherson error figure. Use only positive numeric values and preserve provenance. |
| [OpenBuildingMap](https://www.openbuildingmap.org/) | Global tiled building data combining OSM, Google Open Buildings and Microsoft footprints; OSM IDs, source IDs, occupancy, floorspace, inferred height/story category and metadata. Height is inferred using GHSL-derived information and GEM taxonomy. | **Product yes; Kherson tile/count not measured.** | OSM planet excerpt 2024-07-01; GHSL R2023A input; processing/data description 2025. Mostly prewar imagery, but OSM geometry is not frozen to prewar. | ODbL 1.0 according to the official data description/site. Compatible candidate; retain attribution and comply with ODbL. | Download the relevant level-6 quadkey `.gpkg.bz2` from the [download page](https://www.openbuildingmap.org/download/). Exact tile and size were not fetched. Use the package metadata to report known-height/source percentages. | Exact OSM way ID where `Source ID=0` and the OSM ID survives; otherwise spatial IoU/centroid. Convert a category conservatively to a floor band, not a false exact height. | No Kherson building-level validation found. Useful categorical fallback; weaker than explicit OSM/Overture and not a direct measurement. |
| [GHS-BUILT-H R2023A](https://human-settlement.emergency.copernicus.eu/ghs_buH2023.php) | Global raster average net/gross building height (`ANBH`/`AGBH`) at 100 m Mollweide and 3 arcsec WGS84. | **Product yes; raster sample not measured.** | 2018 Sentinel-2 composite, with AW3D30/SRTM ancillary elevation; safely pre-2022 as a broad prior. | GHSL reuse is open with acknowledgement; the [AWS registry entry](https://registry.opendata.aws/ghs-built-h/) identifies CC BY 4.0. Compatible with attribution. | Download only the tile/crop. At Kherson, a 3 arcsec cell is approximately 92.6 m north-south by 68.5 m east-west; the Filatova bbox spans roughly 13 by 35 cells. Exact compressed source size was not measured. | Sample raster at building centroid or area-weighted footprint. Use for neighbourhood/cohort calibration, never as an unqualified per-building height. | The JRC publication reports about 2.27 m MAE for the 100 m grid; this is grid-level error, not individual-building error ([publication](https://publications.jrc.ec.europa.eu/repository/handle/JRC136539)). |
| [WSF-3D](https://web.geoservice.dlr.de/web/datasets/wsf_3d) | Global 90 m raster layers for average height, volume, area and built-up fraction. | **Product yes; Kherson tile not measured.** | Temporal coverage 2012-01-01 to 2020-01-01; released 2023. Prewar-compatible as a coarse prior. | DLR states CC BY 4.0. Compatible with attribution. | 1 by 1 degree LZW GeoTIFF tiles, about 2.8 arcsec / 90 m. The official [download directory](https://download.geoservice.dlr.de/WSF3D/files/global/) shows tile sizes vary; Kherson tile size was not measured. | Centroid or area-weighted raster sampling only. | Useful as a second coarse prior and high-rise sanity check; 90 m cells cannot identify adjacent five- and nine-storey blocks reliably. No Kherson-specific error figure found. |
| [3D-GloBFP](https://essd.copernicus.org/articles/16/5357/2024/) | Individual global building footprints with estimated height in metres, distributed as gridded shapefiles; 2020 multi-source EO model. | **Global/Europe product suggests yes; Kherson tile not inspected.** | 2020. | The current [Zenodo Europe record](https://zenodo.org/records/15487037) did not state a usable dataset licence in the record’s rights field. **Do not redistribute or bake it without written licence clarification.** | Europe record is about 59.1 MB; exact Kherson grid file was not measured. | Spatial IoU/centroid; no dependable shared OSM IDs expected. | Reported RMSE spans roughly 1.9--14.6 m and R² 0.66--0.96 across 33 subregions, so transfer to Kherson is uncertain. Research lead, not current production choice. |
| [GHS-OBAT R2024A](https://data.jrc.ec.europa.eu/dataset/f41a22f1-5741-4c41-86eb-6384654f6927) | Per-building centroids and attributes including height, compactness, function and construction year; links to Overture/GERS IDs. | **No for the currently listed Ukraine distribution.** The official [CSV](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_OBAT_GLOBE_R2024A/GHS_OBAT_CSV_GLOBE_R2024A/V1-0/) and [GPKG](https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_OBAT_GLOBE_R2024A/GHS_OBAT_GPKG_GLOBE_R2024A/V1-0/) directories were inspected; country files reached Turkey and no `UKR` file was listed. | Reference date 2020; release R2024A. | CSV/GPKG resources are ODbL 1.0; statistics resources are CC BY 4.0. Licence would be compatible if a Ukraine file is published. | Country files can be manageable, but no Kherson/Ukraine file is currently listed; size therefore not applicable. | GERS ID only if the Overture 2024-07-22.0 geometry/version matches; otherwise spatial centroid/footprint matching. | Potentially useful if Ukraine is added, but not currently available for this city. |
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints/blob/main/README.md) | Global footprint polygons; where available, an estimated above-ground height in metres (`-1` means unavailable). Height is an average within the footprint, not a floor count. | **Global coverage map exists; Kherson tile and height coverage not verified.** Use the published coverage GeoJSON before downloading. | Baseline imagery varies, historically 2014--2021; current 2026 refresh includes some 2021--2025 updates. Not a uniform prewar snapshot. | Current official README says **CDLA Permissive 2.0**. This is not one of the explicit Art. 8 accepted licences; do not bake Microsoft files directly without a compatibility decision. | Country/quadkey line-delimited GeoJSON in compressed files; current links are in `dataset-links.csv`. Exact Kherson file and byte size were not measured. | Spatial IoU/centroid; no OSM IDs. | Official footprint metrics include Europe precision 94.3%, recall 85.9% and IoU 65.1%, but these are not height error metrics. No Kherson height RMSE was found. Prefer via Overture’s ODbL publication. |
| [GlobalBuildingAtlas](https://essd.copernicus.org/articles/17/6647/2025/) | Global LoD1-style building polygons with estimated height; 3 m height grid/product. | **Product is described as global; Kherson sample not inspected.** | Recent global product; paper uses contemporary multi-source inputs, not a single prewar epoch. | Dataset is reported as CC BY-NC / non-commercial in the project materials and is therefore unsuitable for the public GitHub Pages baked world. | Full product is multi-terabyte (project materials describe about 36 TB); not appropriate for this repo. | Spatial matching only. | Paper reports global height RMSE 5.5 m, Europe 4.1 m, Asia 5.9 m; not Kherson-specific. Reject on licence and size. |
| [UT-GLOBUS](https://pmc.ncbi.nlm.nih.gov/articles/PMC11327349/) | City/street-scale LoD1 buildings with estimated heights for more than 1,200 cities. | **Kherson coverage not verified.** | Recent research product; no confirmed prewar Kherson snapshot. | Article/dataset is CC BY-NC-ND 4.0, not compatible with a redistributable derived world. | About 53.5 GB total; Europe archive about 5.6 GB. | Spatial matching only. | Reported individual-building RMSE 9.1 m in tested US cities; unsuitable here on licence, coverage uncertainty and accuracy. |
| [EUBUCCO](https://docs.eubucco.com/main/) | Individual European buildings with height, type and construction year. | **No.** v0.1 covers EU27 plus Switzerland; Ukraine is outside that stated scope. | v0.1 data around 2022/2023; no Kherson file. | Source-dependent licences; no Ukraine coverage. | Not applicable. | Would use source geometry/IDs where available. | Not applicable to Kherson. |
| [Google Open Buildings 2.5D Temporal](https://sites.research.google/gr/open-buildings/temporal/?hl=en) | Annual 2016--2023 4 m raster-like building presence, fractional count and height estimates from Sentinel-2. | **No.** Google’s official country list is Global South and does not include Ukraine. | Annual 2016--2023; useful temporal concept but no Kherson coverage. | CC BY 4.0 with attribution for the published dataset. | Not applicable to Kherson. | Raster/polygon overlap if covered; no use here. | Not applicable to Kherson. |
| Copernicus DEM / [AW3D30](https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/) | DSM elevation including buildings/vegetation at about 30 m; subtracting a DTM leaves mixed building/vegetation/terrain signal. | **Product-level yes; Kherson height sample not measured.** | Copernicus DEM acquisition 2011--2015; AW3D30 is a 30 m DSM. | Copernicus DEM terms require notices and are not one of the explicit Art. 8 licences; AW3D30 terms/account access need separate review. Do not redistribute derived building heights without review. | 1 degree tiles / registered downloads; exact tile sizes not measured. | Raster sampling or a separate building-height model; not a direct join. | Too coarse and too mixed for individual 5/9-storey assignment. Use only as research input, not the recommended fallback. |
| Ukrainian city and regional open data | Official PDFs and portals can contain aggregate housing-stock floor counts; urban-cadastre and OSBB data may contain addresses, but an address-level, machine-readable height table was not verified. | **Aggregate Kherson counts verified; address-level source not verified.** | The 2023--2027 recovery plan is published in 2023; the 2021 housing programme is a historical comparison. | Each document/resource needs its own terms check. Public government PDFs are useful evidence but are not automatically a redistributable building database. | PDFs are small; no verified building-level download. | Address/geocoding would be fragile and needs a licensed address source; no direct OSM IDs. | Good for city-level sanity checks, not direct per-building heights. |

### Ukrainian aggregate evidence

The Kherson City Military Administration recovery plan reports 1,516 housing
buildings: 744 one/two-storey, 147 three/four-storey, 301 five-storey, 167
nine-storey, 20 ten-storey, 5 fourteen-storey and 6 sixteen-storey buildings
([plan PDF](https://miskrada-ks.gov.ua/wp-content/uploads/2023/10/614r-vid-25.10.2023-pro-zatverdzhennia-planu-vidnovlennia-ta-rozvytku-khmth-na-2023-2027.pdf)).
This is an aggregate check, not a spatially joinable source; the report is
post-2022 and may include a different housing-stock scope. A 2021 city housing
programme reports a different breakdown (669 one-to-three-storey, 680
four-to-five-storey, 7 six-to-seven-storey, 392 nine-storey, and 27
fourteen-to-sixteen-storey) ([2021 PDF](https://miskrada.kherson.ua/wp-content/uploads/2021/10/v612-2021.pdf)).
The differing totals are a warning not to force these reports into a
per-building allocation without a matching definition of “housing building”.

The [regional urban-planning documentation page](https://khoda.gov.ua/diialnist/mistobuduvannia-ta-arkhitektura/mistobudivna-dokumentatsiia),
state urban-cadastre announcements, OSBB/ЖБК registers on
[data.gov.ua](https://data.gov.ua/dataset/00ce9b57-9edd-4a43-b8c2-dd3af7601e25/resource/970ad777-2ce7-4c95-bb3b-5665a0cd249),
Wikimapia, Mapillary and OpenAddresses were checked as leads. None was
verified as a licence-safe, address-level Kherson storey dataset: the OSBB
CSV is primarily organisation/address metadata, Mapillary is imagery/map data,
OpenAddresses is address data with source-specific licences, and Wikimapia’s
terms/licence are not sufficiently clear for this use.

## Bake integration plan

This is a plan for the bake implementation; this task intentionally adds no
fetch or bake code.

1. Pin a release and fetch once. A future probe/fetch script should accept the
   Overture release and bbox, download the Overture building subset, and
   optionally fetch the relevant OpenBuildingMap tile plus one GHSL or WSF
   raster crop. Store the upstream file, URL, release/date, licence, checksum,
   and byte size under `data/heights/`. Do not make the browser request any of
   these providers.
2. Keep OSM geometry authoritative. Parse the existing OSM snapshot first;
   use exact OSM IDs when the upstream source provides them. For other
   features, use a spatial index and deterministic matching: bbox filter,
   polygon intersection-over-union, then centroid and area tie-break. Reject
   ambiguous overlaps rather than assigning a neighbouring tower.
3. Resolve values in the order above. A valid Overture value must be numeric
   and positive. Prefer `num_floors` for storey rendering and use `height` for
   metric extrusion; do not infer a precise floor count from a coarse raster.
   OpenBuildingMap categories should map to a conservative floor band. GHSL/
   WSF values should alter a neighbourhood prior or identify outliers, not
   overwrite a known building value.
4. Emit provenance with each resolved building value: source name, release or
   reference date, upstream feature ID where available, matched confidence,
   and whether the value is explicit or inferred. This makes future refreshes
   reproducible and prevents a later release from silently changing the city.
5. Bake only the compact resolved result into `public/world`. Keep raw source
   files out of the browser bundle and check the resulting artifact against
   the project’s size budget. If a committed raw cache is too large, document
   the exact one-time download and checksum rather than making deployment
   depend on a live service.
6. Add attribution in the README and in-app attribution during the bake/UI
   implementation: OpenStreetMap contributors and ODbL, plus the selected
   Overture/OpenBuildingMap/GHSL/WSF dataset name, link, version/date and
   licence. The attribution must describe that building heights are derived
   data. This document does not edit those other files because the task
   explicitly limits its write scope.
7. For validation, rerun the Filatova report after every source refresh:
   total OSM buildings, joined buildings, explicit heights/storeys, inferred
   values, rejected/ambiguous matches, and the distribution of resolved
   floors. Compare the resulting city-wide distribution with the official
   aggregate reports, without treating them as ground truth for individual
   addresses.

## Risks and limits

- **Time mismatch.** Current Overture/OSM and recent ML products can reflect
  post-2022 edits, demolition or war damage, while the target scene should
  represent the prewar city. Record source dates and avoid using a current
  damaged footprint to overwrite an older OSM building silently.
- **Height is not storeys.** DSM/ML height can include roof structures,
  vegetation, terrain and antennas. A five-storey building and a nine-storey
  building may both be represented by the same 90--100 m raster cell.
- **Model uncertainty.** Published error figures are usually regional or
  grid-level, not Kherson building-level validation. Overture’s source
  provenance is essential; an absent height is not evidence that the building
  is three storeys.
- **Geometry matching.** Multipolygons, building parts, merged footprints,
  OSM edits and source tiling can create one-to-many or many-to-one matches.
  Keep a confidence threshold and reject ambiguous matches.
- **Licence drift.** Microsoft’s current direct licence is CDLA Permissive,
  3D-GloBFP’s current Zenodo record does not state a clear redistribution
  licence, and GlobalBuildingAtlas/UT-GLOBUS are non-commercial. A source
  that was described as ODbL by an older paper is not automatically safe;
  use the current provider terms and prefer the ODbL Overture/OpenBuildingMap
  routes.
- **Raw-data size.** Global products are far larger than this static site’s
  budget. Fetch only a bbox/tile, cache it with a checksum, and bake a compact
  result.
- **Ukrainian records.** City plans and registers are valuable validation
  leads but may have changing scopes, incomplete addresses, access controls or
  unclear reuse terms. They should not become a hidden dependency of a public
  build.

