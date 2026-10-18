import { describe, expect, it } from 'vitest';
import { resolveQuality } from '../src/quality.ts';

describe('resolveQuality', () => {
  it('defaults by device', () => {
    expect(resolveQuality('', null, false)).toBe('high');
    expect(resolveQuality(null, null, true)).toBe('low');
  });
  it('uses the stored value over the default', () => {
    expect(resolveQuality('', 'low', false)).toBe('low');
    expect(resolveQuality('', 'high', true)).toBe('high');
  });
  it('lets the URL win over storage', () => {
    expect(resolveQuality('?quality=high', 'low', true)).toBe('high');
    expect(resolveQuality('?x=1&quality=low', 'high', false)).toBe('low');
  });
  it('ignores invalid values', () => {
    expect(resolveQuality('?quality=ultra', 'bogus', true)).toBe('low');
    expect(resolveQuality('?quality=ultra', 'bogus', false)).toBe('high');
  });
});
