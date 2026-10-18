# Kherson summer soundscape

This is a short pre-24-Feb-2022-informed reference for the procedural mix. The source material supports the habitat assignments; the numeric weights are relative synthesis weights, not population estimates. `audio.ts` applies the habitat multipliers and normalises them at runtime.

| Українська | English | Latin | Habitat | Relative weight | Time |
|---|---|---|---|---:|---|
| горобець хатній | house sparrow | *Passer domesticus* | built-up | 22 | day, dawn/evening |
| горобець польовий | Eurasian tree sparrow | *Passer montanus* | built-up, edges | 9 | day |
| шпак звичайний | common starling | *Sturnus vulgaris* | built-up, park-trees | 10 | day |
| голуб сизий | rock (feral) pigeon | *Columba livia* | built-up, river | 15 | day |
| горлиця садова | Eurasian collared dove | *Streptopelia decaocto* | built-up, park-trees | 10 | day, dawn/evening |
| ворона сіра | hooded crow | *Corvus cornix* | built-up, river edge | 4 | day |
| грак | rook | *Corvus frugilegus* | built-up, open ground | 3 | day |
| сорока звичайна | Eurasian magpie | *Pica pica* | park-trees, built-up | 5 | day |
| синиця велика | great tit | *Parus major* | park-trees | 9 | dawn/day |
| дрізд чорний | common blackbird | *Turdus merula* | park-trees | 9 | dawn/evening |
| зяблик | common chaffinch | *Fringilla coelebs* | park-trees | 8 | dawn/day |
| вивільга | golden oriole | *Oriolus oriolus* | mature park-trees | 3 | dawn/evening |
| соловейко східний | common nightingale | *Luscinia megarhynchos* | dense park-trees | 3 | dawn/evening |
| ластівка сільська | barn swallow | *Hirundo rustica* | river/open air | 4 | day, evening |
| плиска біла | white wagtail | *Motacilla alba* | riverbank | 2 | day |
| мартин чорноголовий / жовтоногий / каспійський | black-headed / yellow-legged / Caspian gull | *Chroicocephalus ridibundus* / *Larus michahellis* / *Larus cachinnans* | Dnipro | 2 | day |
| серпокрилець чорний | common swift | *Apus apus* | built-up sky, river corridor | 3 | day, loudest evening |

The baseline weights deliberately make sparrows and pigeons dominant in streets, shift to tits/blackbirds/chaffinches/oriole/nightingale in trees, and turn gulls/swallow/wagtail on within about 150 m of water. Crows, rooks and gulls are rendered quieter and less frequent. All voices remain synthesised; there are no recordings or sample files.

## Sources

- [Екологія Херсонщини — urban habitats and fauna](https://www.library.kherson.ua/young/eco/8.htm) (Kherson regional library; accessed 2026-10-18). It names feral pigeons, rooks, crows, gulls, house/tree sparrows, swallows, swifts and starlings in the city’s open, built and river-associated habitats.
- [eBird Ukraine region](https://ebird.org/region/UA), [Kherson Oblast region](https://ebird.org/region/UA-65) and [eBird bar-chart method](https://ebird.freshdesk.com/en/support/solutions/articles/48001255130-ebird-bar-charts-and-graphs) (accessed 2026-10-18). eBird documents frequency-by-checklist bar charts; its current Explore UI does not provide town-level summaries, so this is corroboration rather than a Kherson-city count.
- [iNaturalist Ukraine](https://www.inaturalist.org/places/ukraine) and [bird observations in a Kherson-city bounding box](https://www.inaturalist.org/observations?iconic_taxa=Aves&nelat=46.75&nelng=32.80&swlat=46.50&swlng=32.45&subview=map) (accessed 2026-10-18). Used as an open observation cross-check; observation effort is uneven and not treated as abundance.
- [Urban shrub flora of Kherson](https://dspace.ksaeu.kherson.ua/handle/123456789/5603) (Boiko et al., 2020; accessed 2026-10-18). Used to support the park/tree habitat assumption: Kherson’s urban green structure includes a diverse shrub layer.

