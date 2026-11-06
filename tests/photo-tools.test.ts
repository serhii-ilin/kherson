import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PHOTOS_END_MARKER,
  PHOTOS_START_MARKER,
  commonsDate,
  creditsMarkdown,
  perspectiveArgs,
  photoCreditsData,
  replaceBetweenMarkers,
  stripHtml,
  validatePhotoManifest,
  type PhotoEntry,
  type PhotoManifest,
} from '../tools/photos/lib.ts';

function validPhoto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'frehat-east',
    building: 'w116810729',
    title: 'File:Hotel Fregat in Kherson.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Hotel_Fregat_in_Kherson.jpg',
    author: 'Visem',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    date: '2017-08-26',
    sha256: '',
    corners: [[120, 80], [960, 90], [970, 1490], [110, 1480]],
    size: [1024, 1536],
    wallMetres: [24, 36],
    levels: { black: 0, white: 255, gamma: 1 },
    masks: [],
    ...overrides,
  };
}

function validManifest(photos: unknown[] = []): Record<string, unknown> {
  return {
    note: 'test manifest',
    userAgent: 'voxel-kherson (https://github.com/serhii-ilin/kherson)',
    photos,
  };
}

describe('validatePhotoManifest', () => {
  it('accepts an empty list and one fully specified photo', () => {
    expect(validatePhotoManifest(validManifest())).toEqual([]);
    expect(validatePhotoManifest(validManifest([validPhoto()]))).toEqual([]);
  });

  it('rejects a non-object or a missing photos array', () => {
    expect(validatePhotoManifest(null)).toEqual(['manifest: expected a JSON object']);
    expect(validatePhotoManifest([])).toEqual(['manifest: expected a JSON object']);
    expect(validatePhotoManifest({ userAgent: 'x' })).toContain('manifest photos: expected an array');
  });

  it('requires an id pattern, unique ids and an OSM building key', () => {
    const badId = validatePhotoManifest(validManifest([validPhoto({ id: 'Frehat East' })]));
    expect(badId.join('\n')).toContain('id must match [a-z0-9-]+');

    const duplicate = validatePhotoManifest(validManifest([validPhoto(), validPhoto()]));
    expect(duplicate.join('\n')).toContain('photos[1] (frehat-east): duplicate id');

    for (const building of ['116810729', 'w0', 'way116810729', 'x116810729']) {
      const errors = validatePhotoManifest(validManifest([validPhoto({ building })]));
      expect(errors.join('\n')).toContain('building must be an OSM key like w123 or r123');
    }
    expect(validatePhotoManifest(validManifest([validPhoto({ building: 'r116810729' })]))).toEqual([]);
  });

  it('allows only https Commons/Wikimedia URLs and rejects Google content', () => {
    for (const source of [
      'http://commons.wikimedia.org/wiki/File:Hotel_Fregat_in_Kherson.jpg',
      'https://maps.google.com/streetview/123',
      'https://commons.wikimedia.org.evil.example/x',
      'not a url',
    ]) {
      const errors = validatePhotoManifest(validManifest([validPhoto({ source })]));
      expect(errors.join('\n')).toContain('source');
    }
    expect(
      validatePhotoManifest(validManifest([validPhoto({ source: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg' })])),
    ).toEqual([]);
  });

  it('accepts only the allowed licences with a matching deed URL', () => {
    const nc = validatePhotoManifest(validManifest([validPhoto({ licence: 'CC BY-NC 4.0' })]));
    expect(nc.join('\n')).toContain('licence must be one of CC0');

    const missingUrl = validatePhotoManifest(validManifest([validPhoto({ licenceUrl: '' })]));
    expect(missingUrl.join('\n')).toContain('licenceUrl is required for CC BY-SA 4.0');

    const wrongUrl = validatePhotoManifest(
      validManifest([validPhoto({ licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' })]),
    );
    expect(wrongUrl.join('\n')).toContain('licenceUrl must be https://creativecommons.org/licenses/by-sa/4.0/');

    expect(
      validatePhotoManifest(validManifest([validPhoto({ licence: 'CC0', licenceUrl: '' })])),
    ).toEqual([]);
    expect(
      validatePhotoManifest(validManifest([validPhoto({ licence: 'Public domain', licenceUrl: '' })])),
    ).toEqual([]);
  });

  it('requires a real ISO date before 24 February 2022', () => {
    expect(validatePhotoManifest(validManifest([validPhoto({ date: '2022-03-01' })]))).toContain(
      'photos[0] (frehat-east): date must be before 2022-02-24',
    );
    expect(validatePhotoManifest(validManifest([validPhoto({ date: '2022-02-24' })]))).toContain(
      'photos[0] (frehat-east): date must be before 2022-02-24',
    );
    expect(validatePhotoManifest(validManifest([validPhoto({ date: '2022-02-23' })]))).toEqual([]);
    for (const date of ['2017-02-30', '26.08.2017', '2017-8-26', '']) {
      const errors = validatePhotoManifest(validManifest([validPhoto({ date })]));
      expect(errors.join('\n')).toContain('date must be a real ISO date');
    }
  });

  it('requires four corners, a bounded integer size, an empty or 64-hex hash and sane masks', () => {
    for (const corners of [[[0, 0]], [[0, 0], [1, 1], [2, 2], ['3', 4]], 'corner']) {
      const errors = validatePhotoManifest(validManifest([validPhoto({ corners })]));
      expect(errors.join('\n')).toContain('corners must be four');
    }
    for (const size of [[2049, 100], [0, 100], [1024.5, 100], [100]]) {
      const errors = validatePhotoManifest(validManifest([validPhoto({ size })]));
      expect(errors.join('\n')).toContain('size must be two integers from 1 to 2048');
    }
    expect(validatePhotoManifest(validManifest([validPhoto({ size: [2048, 1] })]))).toEqual([]);
    expect(validatePhotoManifest(validManifest([validPhoto({ sha256: 'abc' })]))).toContain(
      'photos[0] (frehat-east): sha256 must be empty or 64 hex characters',
    );
    expect(
      validatePhotoManifest(validManifest([validPhoto({ sha256: 'A'.repeat(64) })])).join('\n'),
    ).toContain('sha256 must be lower-case hex');
    expect(validatePhotoManifest(validManifest([validPhoto({ sha256: 'a'.repeat(64) })]))).toEqual([]);

    const mask = validatePhotoManifest(validManifest([validPhoto({ masks: [[10, 10, 10, 20]] })]));
    expect(mask.join('\n')).toContain('masks must be [x0, y0, x1, y1]');
    const negative = validatePhotoManifest(validManifest([validPhoto({ masks: [[-1, 0, 10, 20]] })]));
    expect(negative.join('\n')).toContain('masks must be [x0, y0, x1, y1]');
  });
});

describe('perspectiveArgs', () => {
  it('maps TL, TR, BR, BL to the output rectangle, deterministically', () => {
    const corners = [[100, 200], [900, 210], [910, 1500], [90, 1490]] as const;
    const expected = '100,200 0,0  900,210 1024,0  910,1500 1024,1536  90,1490 0,1536';
    expect(perspectiveArgs(corners, [1024, 1536])).toBe(expected);
    expect(perspectiveArgs(corners, [1024, 1536])).toBe(expected);
  });

  it('trims floating-point noise to three decimals', () => {
    expect(
      perspectiveArgs([[0.123456, 1.0004], [2.5, 3], [4, 5], [6, 7]], [800, 600]),
    ).toBe('0.123,1 0,0  2.5,3 800,0  4,5 800,600  6,7 0,600');
  });
});

describe('creditsMarkdown', () => {
  const photos = [
    validPhoto(),
    validPhoto({
      id: 'fregat-west',
      building: 'r108158686',
      author: 'Old Kherson',
      licence: 'Public domain',
      licenceUrl: '',
      source: 'https://commons.wikimedia.org/wiki/File:Fregat_west.jpg',
      title: 'File:Fregat west.jpg',
      date: '1955-06-01',
    }),
  ] as unknown as PhotoEntry[];

  it('writes a deterministic, linked table', () => {
    const expected = [
      '| id | building | author | source | date | licence |',
      '|---|---|---|---|---|---|',
      '| `frehat-east` | w116810729 | Visem | [File:Hotel Fregat in Kherson.jpg](https://commons.wikimedia.org/wiki/File:Hotel_Fregat_in_Kherson.jpg) | 2017-08-26 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |',
      '| `fregat-west` | r108158686 | Old Kherson | [File:Fregat west.jpg](https://commons.wikimedia.org/wiki/File:Fregat_west.jpg) | 1955-06-01 | Public domain |',
      '',
    ].join('\n');
    expect(creditsMarkdown(photos)).toBe(expected);
    expect(creditsMarkdown(photos)).toBe(expected);
  });

  it('produces the runtime data rows in manifest order', () => {
    expect(photoCreditsData(photos)).toEqual([
      {
        id: 'frehat-east',
        building: 'w116810729',
        author: 'Visem',
        licence: 'CC BY-SA 4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        source: 'https://commons.wikimedia.org/wiki/File:Hotel_Fregat_in_Kherson.jpg',
        date: '2017-08-26',
      },
      {
        id: 'fregat-west',
        building: 'r108158686',
        author: 'Old Kherson',
        licence: 'Public domain',
        licenceUrl: '',
        source: 'https://commons.wikimedia.org/wiki/File:Fregat_west.jpg',
        date: '1955-06-01',
      },
    ]);
    expect(photoCreditsData([])).toEqual([]);
  });

  it('escapes pipes and is idempotent between the docs markers', () => {
    const pipe = validPhoto({ author: 'A | B' }) as unknown as PhotoEntry;
    expect(creditsMarkdown([pipe]).split('\n')[2]).toContain('A \\| B');

    const document = 'before\n<!-- photos:start -->\nold\n<!-- photos:end -->\nafter\n';
    const once = replaceBetweenMarkers(document, PHOTOS_START_MARKER, PHOTOS_END_MARKER, creditsMarkdown(photos));
    const twice = replaceBetweenMarkers(once, PHOTOS_START_MARKER, PHOTOS_END_MARKER, creditsMarkdown(photos));
    expect(once).toBe(twice);
    expect(once).toContain(creditsMarkdown(photos).trim());
    expect(once.startsWith('before\n<!-- photos:start -->\n')).toBe(true);
    expect(once.endsWith('<!-- photos:end -->\nafter\n')).toBe(true);
    expect(() => replaceBetweenMarkers('nothing', PHOTOS_START_MARKER, PHOTOS_END_MARKER, '')).toThrow(
      'missing start marker',
    );
  });
});

describe('Commons fields', () => {
  it('strips the HTML Commons puts around authors and licence names', () => {
    expect(stripHtml('<a href="https://example.org">Visem</a>')).toBe('Visem');
    expect(stripHtml('  Visem&nbsp;&amp;&nbsp;Co  ')).toBe('Visem & Co');
    expect(stripHtml('<span>CC BY-SA 4.0</span>')).toBe('CC BY-SA 4.0');
  });

  it('takes the leading ISO date from DateTimeOriginal', () => {
    expect(commonsDate('2017-08-26 14:05:00')).toBe('2017-08-26');
    expect(commonsDate('2017-08-26')).toBe('2017-08-26');
    expect(commonsDate('26 August 2017')).toBeNull();
    expect(commonsDate('2017-02-30')).toBeNull();
  });
});

describe('committed photo manifest and generated files', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../data/photo-textures.json', import.meta.url), 'utf8'),
  ) as PhotoManifest;

  it('validates; the maintainer has not added photo rows yet', () => {
    expect(validatePhotoManifest(manifest)).toEqual([]);
    expect(manifest.photos).toEqual([]);
    expect(manifest.userAgent).toBe('voxel-kherson (https://github.com/serhii-ilin/kherson)');
  });

  it('keeps docs/ASSET_CREDITS.md and the runtime data generated from the manifest', () => {
    const credits = readFileSync(new URL('../docs/ASSET_CREDITS.md', import.meta.url), 'utf8');
    expect(credits).toContain(PHOTOS_START_MARKER);
    expect(credits).toContain(PHOTOS_END_MARKER);
    expect(
      replaceBetweenMarkers(credits, PHOTOS_START_MARKER, PHOTOS_END_MARKER, creditsMarkdown(manifest.photos)),
    ).toBe(credits);

    const data = JSON.parse(readFileSync(new URL('../src/world/photo-credits.data.json', import.meta.url), 'utf8'));
    expect(data).toEqual(photoCreditsData(manifest.photos));
  });
});
