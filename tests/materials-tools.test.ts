import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PBR_LAYER_NAMES } from '../src/world/pbr-layers.ts';
import {
  bytesReport,
  creditsTable,
  DEFAULT_WEBP_SETTINGS,
  normaliseFactor,
  pickMaps,
  replaceBetweenMarkers,
  validateManifest,
  webpSettings,
  type MaterialsManifest,
} from '../tools/materials/lib.ts';

function validLayer(layer: string): Record<string, unknown> {
  return {
    layer,
    source: 'ambientcg',
    assetId: 'Plaster001',
    resolution: '1K-JPG',
    url: 'https://ambientcg.com/get?file=Plaster001_1K-JPG.zip',
    page: 'https://ambientcg.com/view?id=Plaster001',
    licence: 'CC0-1.0',
    sha256: '',
    tint: [1, 1, 1],
  };
}

function validManifest(names: readonly string[] = PBR_LAYER_NAMES): Record<string, unknown> {
  return {
    note: 'test manifest',
    userAgent: 'voxel-kherson (https://github.com/serhii-ilin/kherson)',
    layers: names.map(validLayer),
  };
}

describe('validateManifest', () => {
  it('accepts a manifest whose layers match the shared names in order', () => {
    expect(validateManifest(validManifest(), PBR_LAYER_NAMES)).toEqual([]);
  });

  it('rejects a manifest that is not an object or has no layer array', () => {
    expect(validateManifest(null, PBR_LAYER_NAMES)).toContain('manifest: expected a JSON object');
    expect(validateManifest([], PBR_LAYER_NAMES)).toContain('manifest: expected a JSON object');
    expect(validateManifest({ userAgent: 'x' }, PBR_LAYER_NAMES)).toContain('manifest layers: expected an array');
  });

  it('reports missing, extra and out-of-order layers by index', () => {
    const missing = validManifest(PBR_LAYER_NAMES.slice(0, -1));
    expect(validateManifest(missing, PBR_LAYER_NAMES).join('\n')).toMatch(/layers\[19\].*missing/);

    const extra = validManifest([...PBR_LAYER_NAMES, 'extra_layer']);
    expect(validateManifest(extra, PBR_LAYER_NAMES).join('\n')).toMatch(/layers\[20\].*unexpected extra layer "extra_layer"/);

    const names = [...PBR_LAYER_NAMES];
    [names[0], names[1]] = [names[1], names[0]];
    const swapped = validManifest(names);
    const errors = validateManifest(swapped, PBR_LAYER_NAMES);
    expect(errors.join('\n')).toContain('layers[0] (stucco_smooth): expected layer "stucco_smooth"');
    expect(errors.join('\n')).toContain('layers[1] (stucco_rough): expected layer "stucco_rough"');
  });

  it('requires the non-empty fields and a user agent', () => {
    const m = validManifest();
    delete m.userAgent;
    const layers = m.layers as Record<string, unknown>[];
    delete layers[0].assetId;
    layers[1].page = '';
    const errors = validateManifest(m, PBR_LAYER_NAMES);
    expect(errors).toContain('manifest userAgent: missing or empty');
    expect(errors.join('\n')).toContain('layers[0] (stucco_smooth): assetId missing or empty');
    expect(errors.join('\n')).toContain('layers[1] (stucco_rough): page missing or empty');
  });

  it('allows only CC0, https urls and a 64-hex or empty sha256', () => {
    const m = validManifest();
    const layers = m.layers as Record<string, unknown>[];
    layers[0].licence = 'CC-BY-4.0';
    layers[1].url = 'http://ambientcg.com/get?file=x.zip';
    layers[2].sha256 = 'a'.repeat(64);
    layers[3].sha256 = 'ABCDEF';
    const errors = validateManifest(m, PBR_LAYER_NAMES);
    expect(errors.join('\n')).toContain('layers[0] (stucco_smooth): licence must be one of CC0-1.0');
    expect(errors.join('\n')).toContain('layers[1] (stucco_rough): url must be an https URL');
    expect(errors.join('\n')).not.toContain('layers[2] (plaster_painted): sha256');
    expect(errors.join('\n')).toContain('layers[3] (limestone_shell): sha256 must be empty or 64 hex');
  });

  it('accepts an omitted tint but rejects a malformed one', () => {
    const good = validManifest();
    delete (good.layers as Record<string, unknown>[])[0].tint;
    expect(validateManifest(good, PBR_LAYER_NAMES)).toEqual([]);

    const bad = validManifest();
    (bad.layers as Record<string, unknown>[])[0].tint = [1, 0, 2];
    expect(validateManifest(bad, PBR_LAYER_NAMES).join('\n')).toMatch(/layers\[0\].*tint/);
  });

  it('accepts an optional saturation from 0 to 1 and rejects values outside it', () => {
    const good = validManifest();
    (good.layers as Record<string, unknown>[])[0].saturation = 0;
    (good.layers as Record<string, unknown>[])[1].saturation = 1;
    expect(validateManifest(good, PBR_LAYER_NAMES)).toEqual([]);

    const bad = validManifest();
    (bad.layers as Record<string, unknown>[])[0].saturation = 1.1;
    (bad.layers as Record<string, unknown>[])[1].saturation = -0.1;
    const errors = validateManifest(bad, PBR_LAYER_NAMES).join('\n');
    expect(errors).toMatch(/layers\[0\].*saturation must be a number from 0 to 1/);
    expect(errors).toMatch(/layers\[1\].*saturation must be a number from 0 to 1/);
  });

  it('allows empty url/page only when --resolve will fill them', () => {
    const m = validManifest();
    const first = (m.layers as Record<string, unknown>[])[0];
    first.url = '';
    first.page = '';
    expect(validateManifest(m, PBR_LAYER_NAMES).join('\n')).toContain('layers[0] (stucco_smooth): url must be an https URL');
    expect(validateManifest(m, PBR_LAYER_NAMES).join('\n')).toContain('layers[0] (stucco_smooth): page missing or empty');
    expect(validateManifest(m, PBR_LAYER_NAMES, { allowEmptyUrls: true })).toEqual([]);
  });

  it('validates the optional webp quality block', () => {
    const good = validManifest();
    good.webp = { albedoQ: 70, normalQ: 80 };
    expect(validateManifest(good, PBR_LAYER_NAMES)).toEqual([]);

    const bad = validManifest();
    bad.webp = { albedoQ: 101, normalQ: 12.5 };
    const errors = validateManifest(bad, PBR_LAYER_NAMES).join('\n');
    expect(errors).toMatch(/manifest webp\.albedoQ: must be an integer from 0 to 100/);
    expect(errors).toMatch(/manifest webp\.normalQ: must be an integer from 0 to 100/);
  });
});

describe('webpSettings', () => {
  it('uses the tested defaults when the manifest has no webp block', () => {
    expect(webpSettings({ userAgent: 'x', layers: [] })).toEqual(DEFAULT_WEBP_SETTINGS);
  });

  it('takes the manifest qualities when present', () => {
    expect(webpSettings({ userAgent: 'x', layers: [], webp: { albedoQ: 60, normalQ: 70 } }))
      .toEqual({ albedoQ: 60, normalQ: 70 });
  });
});

describe('pickMaps', () => {
  it('selects the ambientCG suffixes and ignores other maps', () => {
    const picked = pickMaps([
      'Asphalt031_1K-JPG_Color.jpg',
      'Asphalt031_1K-JPG_Roughness.jpg',
      'Asphalt031_1K-JPG_NormalGL.jpg',
      'Asphalt031_1K-JPG_AmbientOcclusion.jpg',
      'Asphalt031_1K-JPG_NormalDX.jpg',
      'Asphalt031_1K-JPG_Displacement.jpg',
      'Asphalt031.png',
    ]);
    expect(picked).toEqual({
      color: 'Asphalt031_1K-JPG_Color.jpg',
      roughness: 'Asphalt031_1K-JPG_Roughness.jpg',
      normal: 'Asphalt031_1K-JPG_NormalGL.jpg',
      ao: 'Asphalt031_1K-JPG_AmbientOcclusion.jpg',
    });
  });

  it('reports missing optional AO and missing required maps as null', () => {
    expect(pickMaps(['Plaster001_Color.png', 'Plaster001_Roughness.png', 'Plaster001_NormalGL.png'])).toEqual({
      color: 'Plaster001_Color.png',
      roughness: 'Plaster001_Roughness.png',
      normal: 'Plaster001_NormalGL.png',
      ao: null,
    });
    expect(pickMaps(['notes.txt', 'Plaster001_Color.tif'])).toEqual({
      color: null,
      roughness: null,
      normal: null,
      ao: null,
    });
  });

  it('matches suffixes case-insensitively and is independent of listing order', () => {
    const files = ['b_Material_Color.PNG', 'a_Material_Color.JPG'];
    expect(pickMaps(files).color).toBe('a_Material_Color.JPG');
  });
});

describe('normaliseFactor', () => {
  it('scales the channel mean to 128 by the same factor for every channel', () => {
    expect(normaliseFactor([100, 100, 100])).toBeCloseTo(1.28);
    expect(normaliseFactor([64, 128, 192])).toBeCloseTo(1);
    expect(normaliseFactor([20, 40, 60])).toBeCloseTo(128 / 40);
  });

  it('honours a custom target and leaves an all-black image unchanged', () => {
    expect(normaliseFactor([100, 100, 100], 100)).toBeCloseTo(1);
    expect(normaliseFactor([0, 0, 0])).toBe(1);
  });
});

describe('creditsTable', () => {
  const manifest: MaterialsManifest = {
    userAgent: 'voxel-kherson (https://github.com/serhii-ilin/kherson)',
    layers: [
      {
        layer: 'asphalt',
        source: 'ambientcg',
        assetId: 'Asphalt031',
        resolution: '1K-JPG',
        url: 'https://ambientcg.com/get?file=Asphalt031_1K-JPG.zip',
        page: 'https://ambientcg.com/view?id=Asphalt031',
        licence: 'CC0-1.0',
        sha256: '',
      },
      {
        layer: 'gravel',
        source: 'ambientcg',
        assetId: 'Gravel023',
        resolution: '1K-JPG',
        url: 'https://ambientcg.com/get?file=Gravel023_1K-JPG.zip',
        page: 'https://ambientcg.com/view?id=Gravel023',
        licence: 'CC0-1.0',
        sha256: '',
      },
    ],
  };

  it('emits a stable table with the asset linked to its page', () => {
    const table = creditsTable(manifest);
    expect(table).toBe(
      '| Layer | Asset | Source | Licence |\n' +
      '|---|---|---|---|\n' +
      '| `asphalt` | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) | ambientcg | CC0-1.0 |\n' +
      '| `gravel` | [Gravel023](https://ambientcg.com/view?id=Gravel023) | ambientcg | CC0-1.0 |\n',
    );
    expect(creditsTable(manifest)).toBe(table);
  });
});

describe('replaceBetweenMarkers', () => {
  it('replaces only the body and is idempotent', () => {
    const text = 'intro\n<!-- materials:start -->\nold\n<!-- materials:end -->\noutro\n';
    const once = replaceBetweenMarkers(text, '<!-- materials:start -->', '<!-- materials:end -->', '| A |\n| B |\n');
    expect(once).toBe('intro\n<!-- materials:start -->\n| A |\n| B |\n<!-- materials:end -->\noutro\n');
    expect(replaceBetweenMarkers(once, '<!-- materials:start -->', '<!-- materials:end -->', '| A |\n| B |')).toBe(once);
  });

  it('throws clearly when a marker is missing or out of order', () => {
    expect(() => replaceBetweenMarkers('nothing', 'S', 'E', 'body')).toThrow(/missing start marker S/);
    expect(() => replaceBetweenMarkers('S only', 'S', 'E', 'body')).toThrow(/missing end marker E/);
    expect(() => replaceBetweenMarkers('E then S', 'S', 'E', 'body')).toThrow(/missing end marker E/);
  });
});

describe('bytesReport', () => {
  it('totals files deterministically and reports the budget', () => {
    const report = bytesReport([
      { path: 'b.webp', bytes: 2000 },
      { path: 'a.webp', bytes: 1000 },
    ], 5000);
    expect(report.total).toBe(3000);
    expect(report.limit).toBe(5000);
    expect(report.overLimit).toBe(false);
    expect(report.text).toContain('a.webp: 1000 bytes');
    expect(report.text.indexOf('a.webp')).toBeLessThan(report.text.indexOf('b.webp'));
    expect(report.text).toContain('total 3000 bytes of 5000 (60.0%) - ok');
  });

  it('flags the limit only when the total is strictly larger', () => {
    expect(bytesReport([{ path: 'a', bytes: 5000 }], 5000).overLimit).toBe(false);
    const over = bytesReport([{ path: 'a', bytes: 5001 }], 5000);
    expect(over.overLimit).toBe(true);
    expect(over.text).toContain('OVER LIMIT');
    expect(bytesReport([], 0).overLimit).toBe(false);
  });
});

describe('committed data/materials.json', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../data/materials.json', import.meta.url), 'utf8'),
  ) as MaterialsManifest;

  it('validates against the shared PBR layer contract, in index order', () => {
    expect(validateManifest(manifest, PBR_LAYER_NAMES)).toEqual([]);
    expect(manifest.layers.map((l) => l.layer)).toEqual([...PBR_LAYER_NAMES]);
  });

  it('has the chosen CC0 ambientCG entries, tested webp qualities and https urls', () => {
    expect(manifest.userAgent).toBe('voxel-kherson (https://github.com/serhii-ilin/kherson)');
    expect(manifest.layers).toHaveLength(PBR_LAYER_NAMES.length);
    expect(webpSettings(manifest)).toEqual({ albedoQ: 78, normalQ: 82 });
    for (const layer of manifest.layers) {
      expect(layer.source).toBe('ambientcg');
      expect(layer.licence).toBe('CC0-1.0');
      expect(['1K-JPG', '2K-JPG']).toContain(layer.resolution);
      expect(layer.url.startsWith('https://ambientcg.com/get?file=')).toBe(true);
      expect(layer.page).toBe(`https://ambientcg.com/view?id=${layer.assetId}`);
      expect(layer.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(layer.tint).toEqual([1, 1, 1]);
    }
    expect(manifest.layers[0].assetId).toBe('Plaster001');
    expect(manifest.layers[19].assetId).toBe('Gravel041');
    expect(manifest.layers.find((l) => l.layer === 'roof_tin_seam')?.saturation).toBe(0);
    expect(manifest.layers.find((l) => l.layer === 'roof_eternit')?.saturation).toBe(0);
  });
});
