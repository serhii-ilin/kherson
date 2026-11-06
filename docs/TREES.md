# Trees of Kherson

The city's trees are a large part of how Kherson looks: acacia and plane avenues, horse chestnuts and lindens in the squares, pyramidal poplars along roads, willows on the Dnipro, and pines on the sands. This page records which species the scene draws, how each one looks, and where the mix comes from.

## Why the mix is estimated

OpenStreetMap barely records species here. Of 2,193 `natural=tree` nodes in the snapshot, 259 carry any species-like tag, and almost all of those say only `leaf_type=broadleaved` (4 say `castanea`). So, following Article 2.1, the bake fills species with a plausible, deterministic mix weighted from published surveys of Kherson's plantings. Explicit `species` / `genus` / `taxon` / `leaf_type` tags always win.

## Sources

- KSAEU survey of Kherson street plantings ([dspace.ksaeu.kherson.ua 4844](https://dspace.ksaeu.kherson.ua/handle/123456789/4844)): 59 woody species. The dominant ones include *Platanus orientalis*, *Acer platanoides*, *A. pseudoplatanus*, *Morus nigra*, *Robinia pseudoacacia* and *Gleditsia*.
- T. O. Boyko (2019), linear plantings along Kherson roads, *Scientific Bulletin of UNFU* 29(8): 51–54, [doi:10.36930/40290807](https://doi.org/10.36930/40290807) ([DOAJ](https://doaj.org/article/16a9e4e60b7049d5bc90344fca30aadf)). Angiosperms are 55 of 59 species. Fabaceae (robinia, gleditsia, sophora) and Cupressaceae (thuja / *Platycladus*, junipers) are the richest families.
- A. O. Zagorulko, [taxonomic analysis of Kherson parks](https://seanewdim.com/wp-content/uploads/2021/04/Taxonomic-analysis-and-phytomonitoring-of-parks-in-Kherson-A.-O.-Zagorulko.pdf), covering 10 parks aged 40–80 years. It also lists park introductions such as *Koelreuteria* and other robinias.
- Regional street surveys from Dnipro and Kryvyi Rih, used as context only:
  - *Ulmus pumila* is about 15% of street trees in Dnipro.
  - *Acer negundo*, *Ailanthus* and *Robinia* are common there.
  - Horse chestnut and Bolle's / black poplar are the most numerous in Kryvyi Rih.
- Common local knowledge, not quantified:
  - Walnut, mulberry and apricot grow in private yards.
  - Willows and white poplars line the Dnipro.
  - *Pinus sylvestris* and *P. pallasiana* grow on the Oleshky sands.
  - Spring whitewashing of street-tree trunks.

## Species drawn

Species ids are baked as a u8 per feature (`src/nature/species.ts`). The ids are append only.

| Id | Species | Crown | Leaf / bark layer |
|---|---|---|---|
| 1 | Horse chestnut (*Aesculus hippocastanum*) | dense dome | palmate / fine |
| 2 | Linden (*Tilia cordata*) | dense ovoid | heart / fine |
| 3 | Black locust (*Robinia pseudoacacia*), "white acacia" | open, irregular, airy, yellow-green | fine pinnate / furrowed |
| 4 | Pyramidal poplar (*Populus nigra* 'Italica') | columnar | triangular / smooth with lenticels |
| 5 | White willow (*Salix alba*) | weeping, by water | lanceolate / furrowed |
| 6 | Scots and Crimean pine | tall bare trunk, flat umbrella top | needle tufts / plated, orange high up |
| 7 | Plane (*Platanus*) | broad, spreading, high | lobed / mottled camouflage |
| 8 | Maple (*Acer platanoides*, *A. pseudoplatanus*) | round, dense | lobed / fine |
| 9 | Elm (*Ulmus pumila*) | irregular, small leaves, twiggy | small serrate / furrowed |
| 10 | Honey locust (*Gleditsia triacanthos*) | flat, very airy, layered | fine pinnate / dark furrowed |
| 11 | Mulberry (*Morus*) | low broad dome, often multi-stem | small serrate / furrowed |
| 12 | Tree of heaven (*Ailanthus altissima*) | sparse, few thick limbs, long fronds | long pinnate / smooth |
| 13 | Catalpa (*Catalpa bignonioides*) | broad, big pale leaves | big heart / fine |
| 14 | Thuja (*Platycladus orientalis*) | dense narrow cone to the ground | scale sprays / fibrous |
| 15 | Walnut (*Juglans regia*) | broad, round, thick limbs | long pinnate / smooth grey |

`GENERIC` (0) is kept for old data only. The client draws it as maple, elm, linden or chestnut, chosen by the seed.

## Placement mix

The weights below are per table in `tools/bake/trees.ts`, and each pick is a hash of the cell, as before.

| Table | Mix (weights) |
|---|---|
| Street (sidewalk border of residential to primary roads) | robinia 22, plane 12, chestnut 12, linden 12, maple 12, elm 8, gleditsia 6, catalpa 5, poplar 5, ailanthus 3, mulberry 3 |
| Park | chestnut 15, maple 14, linden 12, robinia 10, plane 8, elm 8, poplar 8, thuja 5, pine 4, catalpa 4, gleditsia 4, willow 4, ailanthus 2, mulberry 2; the near-water willow rule still applies |
| Tree row (`natural=tree_row`) | poplar 35, robinia 25, elm 20, gleditsia 10, maple 10 |
| Forest, scrub, meadow, untagged | as before, with `GENERIC` replaced by elm, maple, mulberry and walnut |
| Wetland, reed, sandy forest | unchanged (willow and poplar; the 70% pine rule near sand) |

**Whitewash.** Street and tree-row trees are baked with feature `param = 6` instead of 5, and the renderer paints their trunks white up to about 1.2 m, as Kherson's street trees are every spring. Park and forest trees keep bare bark.
