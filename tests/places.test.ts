import { describe, expect, it } from 'vitest';
import { filterPlaces, translit, type Place } from '../src/ui/places.ts';

const places: Place[] = [
  { name: 'Площа Свободи', nameEn: 'Freedom Square', kind: 'square', x: 10270, z: 8820 },
  { name: 'Херсон', nameEn: 'Kherson', kind: 'city', x: 10270, z: 8829 },
  { name: 'Антонівка', kind: 'town', x: 19944, z: 4537 },
  { name: 'Олешки', nameEn: 'Oleshky', kind: 'town', x: 19274, z: 11242 },
];

describe('translit', () => {
  it('transliterates Ukrainian names', () => {
    expect(translit('Площа Свободи')).toBe('Ploshcha Svobody');
  });

  it('capitalizes the transliteration of uppercase letters', () => {
    expect(translit('Щ')).toBe('Shch');
    expect(translit('Херсон')).toBe('Kherson');
  });

  it('passes through latin and unknown characters', () => {
    expect(translit('abc 123')).toBe('abc 123');
  });
});

describe('filterPlaces', () => {
  it('finds by Latin substring of nameEn', () => {
    expect(filterPlaces(places, 'svobod').map((p) => p.name)).toEqual(['Площа Свободи']);
  });

  it('finds by Ukrainian substring of name', () => {
    expect(filterPlaces(places, 'площа').map((p) => p.name)).toEqual(['Площа Свободи']);
  });

  it('finds by Latin transliteration of name', () => {
    expect(filterPlaces(places, 'Ploshcha').map((p) => p.name)).toEqual(['Площа Свободи']);
  });

  it('is case-insensitive', () => {
    expect(filterPlaces(places, 'KHERSON').map((p) => p.name)).toEqual(['Херсон']);
    expect(filterPlaces(places, 'ПЛОЩА').map((p) => p.name)).toEqual(['Площа Свободи']);
  });

  it('returns the first N places for an empty query', () => {
    expect(filterPlaces(places, '', 2)).toEqual(places.slice(0, 2));
    expect(filterPlaces(places, '   ')).toEqual(places);
  });

  it('respects the limit', () => {
    expect(filterPlaces(places, 'о', 2)).toHaveLength(2);
    expect(filterPlaces(places, '', 3)).toHaveLength(3);
    expect(filterPlaces(places, 'nonsense')).toHaveLength(0);
  });
});
