# Ushakova Avenue and Suvorova Street / проспект Ушакова, вулиця Суворова

Research brief for the Tier-K facade descriptors (`data/facades/*.json`, type `FacadeProfile` in `src/mesh/facade-profile.ts`) of the realistic-buildings plan ([BUILDINGS_PLAN.md](../BUILDINGS_PLAN.md)). Target state: 2016–2021. The pre-war names are used here. OSM now has проспект Незалежності and вулиця Європейська, with the old names in `old_name`.

## Scope

- **Ushakova Avenue** from Hotel «Фрегат» (No. 2, 46.6299 N) to Freedom Square (Nos. 47–51, 46.641 N). About 45 addressed buildings: odd side Nos. 9–51, even side Nos. 2–30. Several are tagged `ruins` in the current snapshot; the restoration table reverts most of them.
- **Suvorova Street**, the pedestrian street (way 49482570): 31 buildings, Nos. 1–32, 46.630–46.633 N.
- The OSM ids per address are listed by the query in the planning notes (re-run against the snapshot before writing rows).

## Sources

- Commons «Nezalezhnosti Avenue, Kherson»: 266 files dated 2008 to 23 Feb 2022, mostly CC BY-SA 4.0.
- Commons «Yevropeiska Street, Kherson»: 194 dated files, with per-address subcategories (e.g. «3 Yevropeiska Street, Kherson», «House of Alexander Suvorov, Kherson», «Gates at 17-19 Yevropeiska Street, Kherson»).

## Row rules

- Every row lists its sources (Commons file titles with dates), never the private evidence photos.
- Storeys, bay pattern per street-facing edge, window shape and surround, cornice, rustication, balconies and colours are read from photos dated 2016–2021. When photos disagree, the later pre-war one wins.
- Colours are recorded as `#rrggbb` sampled from sunlit, unsaturated wall areas, and rounded.
