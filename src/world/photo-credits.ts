/**
 * Pure facade-photo credits (CONSTITUTION Article 8.3). The manifest in `data/photo-textures.json`
 * is turned into `photo-credits.data.json` by `npm run rectify-photos`; Vite bundles that JSON, so
 * the panel needs no runtime fetch and this module stays DOM-free and testable in Node.
 */
import photoCreditsJson from './photo-credits.data.json';
import type { Lang } from '../i18n.ts';

export interface PhotoCredit {
  id: string;
  building: string;
  author: string;
  licence: string;
  /** Empty for public domain and CC0, which need no deed link. */
  licenceUrl?: string;
  source: string;
  date: string;
}

/** One author-and-licence group shown in the panel. */
export interface PhotoCreditRow {
  author: string;
  licence: string;
  licenceUrl: string;
  /** Commons file page of the first photo in the group (by id). */
  source: string;
  /** Photo ids, sorted, so the row is deterministic. */
  ids: string[];
  /** Photo dates, sorted. */
  dates: string[];
  /** e.g. `Visem — CC BY-SA 4.0`. */
  label: string;
  /** Localised detail line, e.g. `2 фото · 2017-08-26`. */
  detail: string;
}

/** The generated runtime list. Empty until the maintainer adds photo rows and reruns the tool. */
export const PHOTO_CREDITS = photoCreditsJson as PhotoCredit[];

function compareText(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface Group {
  author: string;
  licence: string;
  licenceUrl: string;
  source: string;
  sourceId: string;
  ids: Set<string>;
  dates: Set<string>;
}

/**
 * Group the runtime rows by author and licence, sorted by author then licence. A group's author
 * links to the first photo's Commons page; several photos by the same author under one licence
 * collapse into a single row with a count and their dates.
 */
export function creditRows(data: readonly PhotoCredit[], lang: Lang): PhotoCreditRow[] {
  const groups = new Map<string, Group>();
  for (const photo of data) {
    const author = text(photo.author);
    const licence = text(photo.licence);
    const source = text(photo.source);
    if (author === '' || licence === '' || source === '') continue;
    const key = `${author}\u0000${licence}`;
    const group = groups.get(key) ?? {
      author,
      licence,
      licenceUrl: '',
      source,
      sourceId: '',
      ids: new Set<string>(),
      dates: new Set<string>(),
    };
    const id = text(photo.id);
    if (id !== '') group.ids.add(id);
    const date = text(photo.date);
    if (date !== '') group.dates.add(date);
    const licenceUrl = text(photo.licenceUrl);
    if (group.licenceUrl === '' && licenceUrl !== '') group.licenceUrl = licenceUrl;
    // The smallest id keeps the link stable when the manifest order changes.
    if (id !== '' && (group.sourceId === '' || id < group.sourceId)) {
      group.source = source;
      group.sourceId = id;
    }
    groups.set(key, group);
  }

  const rows: PhotoCreditRow[] = [];
  for (const group of groups.values()) {
    const ids = [...group.ids].sort(compareText);
    const dates = [...group.dates].sort();
    const count = ids.length;
    const dateText = dates.join(', ');
    const detail = lang === 'uk'
      ? `${count} фото${dateText === '' ? '' : ` · ${dateText}`}`
      : `${count === 1 ? '1 photo' : `${count} photos`}${dateText === '' ? '' : ` · ${dateText}`}`;
    rows.push({
      author: group.author,
      licence: group.licence,
      licenceUrl: group.licenceUrl,
      source: group.source,
      ids,
      dates,
      label: `${group.author} — ${group.licence}`,
      detail,
    });
  }

  rows.sort((a, b) => compareText(a.author, b.author) || compareText(a.licence, b.licence));
  return rows;
}

/** One line for the attribution button, e.g. `Фото: 2 · CC BY-SA 4.0`; empty when there are no rows. */
export function creditsSummary(data: readonly PhotoCredit[], lang: Lang): string {
  const rows = creditRows(data, lang);
  if (rows.length === 0) return '';
  const count = rows.reduce((sum, row) => sum + row.ids.length, 0);
  const licences = [...new Set(rows.map((row) => row.licence))].sort(compareText);
  return lang === 'uk'
    ? `Фото: ${count} · ${licences.join(', ')}`
    : `Photos: ${count} · ${licences.join(', ')}`;
}
