import { describe, expect, it } from 'vitest';
import { LANGS, stringsFor } from '../src/i18n.ts';
import { PHOTO_CREDITS, creditRows, creditsSummary, type PhotoCredit } from '../src/world/photo-credits.ts';

function photo(overrides: Partial<PhotoCredit> & Pick<PhotoCredit, 'id' | 'author' | 'licence'>): PhotoCredit {
  return {
    building: 'w116810729',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source: `https://commons.wikimedia.org/wiki/File:${overrides.id}.jpg`,
    date: '2017-08-26',
    ...overrides,
  };
}

const data: PhotoCredit[] = [
  photo({ id: 'frehat-west', author: 'Visem', licence: 'CC BY-SA 4.0', date: '2019-05-01' }),
  photo({ id: 'frehat-east', author: 'Visem', licence: 'CC BY-SA 4.0', date: '2017-08-26' }),
  photo({ id: 'alice-by', author: 'Alice', licence: 'CC BY 4.0', date: '2020-01-02', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' }),
  photo({ id: 'alice-zero', author: 'Alice', licence: 'CC0', date: '2018-03-04', licenceUrl: '' }),
  photo({ id: 'bob-sa', author: 'Bob', licence: 'CC BY-SA 3.0', date: '2016-07-08', licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' }),
];

describe('creditRows', () => {
  it('groups by author and licence, sorted by author then licence', () => {
    const rows = creditRows(data, 'uk');
    expect(rows.map((row) => row.label)).toEqual([
      'Alice — CC BY 4.0',
      'Alice — CC0',
      'Bob — CC BY-SA 3.0',
      'Visem — CC BY-SA 4.0',
    ]);
    expect(rows.map((row) => row.ids)).toEqual([
      ['alice-by'],
      ['alice-zero'],
      ['bob-sa'],
      ['frehat-east', 'frehat-west'],
    ]);
  });

  it('picks the smallest id as the author link and keeps every date sorted', () => {
    const row = creditRows(data, 'uk').find((candidate) => candidate.author === 'Visem')!;
    expect(row.source).toBe('https://commons.wikimedia.org/wiki/File:frehat-east.jpg');
    expect(row.licenceUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(row.dates).toEqual(['2017-08-26', '2019-05-01']);
    expect(row.detail).toBe('2 фото · 2017-08-26, 2019-05-01');
    expect(row.label).toBe('Visem — CC BY-SA 4.0');
  });

  it('localises the count line and keeps the licence list for English', () => {
    const uk = creditRows(data, 'uk');
    const en = creditRows(data, 'en');
    expect(uk.map((row) => row.detail)).toEqual([
      '1 фото · 2020-01-02',
      '1 фото · 2018-03-04',
      '1 фото · 2016-07-08',
      '2 фото · 2017-08-26, 2019-05-01',
    ]);
    expect(en.map((row) => row.detail)).toEqual([
      '1 photo · 2020-01-02',
      '1 photo · 2018-03-04',
      '1 photo · 2016-07-08',
      '2 photos · 2017-08-26, 2019-05-01',
    ]);
  });

  it('preserves the first non-empty licence URL and skips unusable rows', () => {
    const rows = creditRows(
      [
        photo({ id: 'one', author: 'A', licence: 'CC0', licenceUrl: '' }),
        photo({ id: 'two', author: 'A', licence: 'CC0', licenceUrl: '' }),
        photo({ id: '', author: '', licence: 'CC BY 4.0' }),
      ],
      'en',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.licenceUrl).toBe('');
    expect(rows[0]!.ids).toEqual(['one', 'two']);
  });

  it('returns nothing for an empty list', () => {
    expect(creditRows([], 'uk')).toEqual([]);
    expect(creditsSummary([], 'uk')).toBe('');
    expect(creditsSummary([], 'en')).toBe('');
  });
});

describe('creditsSummary', () => {
  it('summarises the photo count and licences in both languages', () => {
    expect(creditsSummary(data, 'uk')).toBe('Фото: 5 · CC BY 4.0, CC BY-SA 3.0, CC BY-SA 4.0, CC0');
    expect(creditsSummary(data, 'en')).toBe('Photos: 5 · CC BY 4.0, CC BY-SA 3.0, CC BY-SA 4.0, CC0');
  });

  it('is deterministic', () => {
    expect(creditsSummary(data, 'uk')).toBe(creditsSummary([...data].reverse(), 'uk'));
  });
});

describe('generated runtime data', () => {
  it('is an empty list until the maintainer adds photo rows', () => {
    expect(PHOTO_CREDITS).toEqual([]);
    expect(creditRows(PHOTO_CREDITS, 'uk')).toEqual([]);
  });
});

describe('i18n credits strings', () => {
  const NEW_KEYS = ['creditsButton', 'creditsTitle', 'creditsClose', 'creditsMaterials', 'creditsEmpty'] as const;

  it('has the same non-empty keys in every language', () => {
    const english = stringsFor('en');
    for (const lang of LANGS) {
      const strings = stringsFor(lang);
      expect(Object.keys(strings).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(strings)) {
        expect(typeof value, `${lang}.${key}`).toBe('string');
        expect(value.trim(), `${lang}.${key}`).not.toBe('');
      }
    }
  });

  it('defines every new credits key in both Ukrainian and English', () => {
    for (const key of NEW_KEYS) {
      expect(stringsFor('uk')[key]).toBeTruthy();
      expect(stringsFor('en')[key]).toBeTruthy();
    }
    expect(stringsFor('uk').creditsButton).toBe('Фото: автори');
    expect(stringsFor('en').creditsButton).toBe('Photos: credits');
    expect(stringsFor('uk').creditsMaterials).toBe('Матеріали: ambientCG, CC0');
    expect(stringsFor('en').creditsMaterials).toBe('Materials: ambientCG, CC0');
  });
});
