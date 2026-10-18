import './ui.css';
import { kindLabel, onLangChange, placeAltName, placeName, t } from '../i18n.ts';

export interface Place {
  name: string;
  nameEn?: string;
  kind: string;
  x: number;
  z: number;
  /** Streets only: direction along the street in degrees (0 = north, positive turns left). */
  yaw?: number;
  /** Former names (OSM `old_name`), searchable: many people still use them. */
  old?: string[];
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ь: '', ю: 'yu', я: 'ya', "'": '', '’': '', 'ʼ': '',
  ы: 'y', э: 'e', ё: 'yo', ъ: '',
};

/** Basic Ukrainian (plus a few Russian) Cyrillic → Latin transliteration. Case is preserved. */
export function translit(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    if (ch !== lower && mapped.length > 0) {
      out += mapped[0]!.toUpperCase() + mapped.slice(1);
    } else {
      out += mapped;
    }
  }
  return out;
}

/** Case-insensitive substring match on name, nameEn and the Latin transliteration of name. */
function matchesText(text: string, q: string): boolean {
  return text.toLowerCase().includes(q) || translit(text).toLowerCase().includes(q);
}

/** The former name that matches `query` when the current names don't, else null. */
export function matchedOldName(p: Place, query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q || p.old === undefined) return null;
  if (matchesText(p.name, q) || (p.nameEn !== undefined && p.nameEn.toLowerCase().includes(q))) return null;
  return p.old.find((o) => matchesText(o, q)) ?? null;
}

export function filterPlaces(places: Place[], query: string, limit = 50): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return places.slice(0, limit);
  const out: Place[] = [];
  for (const p of places) {
    if (out.length >= limit) break;
    if (
      matchesText(p.name, q) ||
      (p.nameEn !== undefined && p.nameEn.toLowerCase().includes(q)) ||
      (p.old !== undefined && p.old.some((o) => matchesText(o, q)))
    ) {
      out.push(p);
    }
  }
  return out;
}

const ROW_LIMIT = 50;

export class PlacesMenu {
  private readonly places: Place[];
  private readonly onSelect: (p: Place) => void;
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private openState = false;

  constructor(parent: HTMLElement, places: Place[], onSelect: (p: Place) => void) {
    this.places = places;
    this.onSelect = onSelect;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'vk-btn vk-places';
    this.button.textContent = t('places');
    this.button.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.className = 'vk-panel';
    this.panel.hidden = true;

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.className = 'vk-search';
    this.input.placeholder = t('search');
    this.input.setAttribute('autocomplete', 'off');
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('keypress', (e) => e.stopPropagation());

    this.list = document.createElement('div');
    this.list.className = 'vk-place-list';

    this.panel.append(this.input, this.list);
    parent.append(this.button, this.panel);
    this.render();
    onLangChange(() => {
      this.button.textContent = t('places');
      this.input.placeholder = t('search');
      this.render();
    });
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.openState = true;
    this.panel.hidden = false;
    this.render();
    this.input.focus();
  }

  close(): void {
    this.openState = false;
    this.panel.hidden = true;
    this.input.blur();
    this.input.value = '';
    this.render();
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  private render(): void {
    const matches = filterPlaces(this.places, this.input.value, ROW_LIMIT);
    this.list.replaceChildren();
    for (const p of matches) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vk-place-row';

      const text = document.createElement('span');
      text.className = 'vk-place-text';
      const name = document.createElement('span');
      name.className = 'vk-place-name';
      name.textContent = placeName(p);
      text.appendChild(name);
      const former = matchedOldName(p, this.input.value);
      const alt = former !== null ? `${t('formerly')}: ${former}` : placeAltName(p);
      if (alt !== null) {
        const sub = document.createElement('span');
        sub.className = 'vk-place-en';
        sub.textContent = alt;
        text.appendChild(sub);
      }
      row.appendChild(text);

      const kind = document.createElement('span');
      kind.className = 'vk-place-kind';
      kind.textContent = kindLabel(p.kind);
      row.appendChild(kind);

      row.addEventListener('click', () => {
        this.onSelect(p);
        this.close();
      });
      this.list.appendChild(row);
    }
  }
}
