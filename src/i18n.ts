import { getQuality, setQuality } from './quality.ts';
import { translit, type Place } from './ui/places.ts';
import { TIME_PRESETS, formatTime, nextPreset } from './world/daylight.ts';

export type Lang = 'uk' | 'en';
export const LANGS: readonly Lang[] = ['uk', 'en'];

const STRINGS = {
  uk: {
    title: 'Воксельний Херсон',
    walk: 'ПІШКИ',
    fly: 'ПОЛІТ',
    regions: 'регіони',
    chunks: 'чанки',
    jobs: 'задачі',
    tris: 'тис. трикутників',
    hintDesktop: 'Клікніть, щоб оглядатися · WASD рух · Shift біг · Пробіл стрибок/вгору · Q/C вниз · F політ/пішки',
    hintTouch: 'Ліворуч: рух · Праворуч: огляд · ▲/▼ вгору/вниз · ✈ політ/пішки',
    places: '📍 Місця',
    search: 'Пошук місць і вулиць…',
    formerly: 'раніше',
    attribution: 'Дані мапи © учасники OpenStreetMap',
    north: 'Пн',
    failed: 'Не вдалося запустити',
    switchTo: 'Switch to English',
    settings: 'Налаштування: час, якість, звук',
    mute: 'Вимкнути звук',
    unmute: 'Увімкнути звук',
    qualityHigh: 'Якість: висока (натисніть, щоб знизити)',
    qualityLow: 'Якість: низька (натисніть, щоб підвищити)',
    timeOfDay: 'Час доби (натисніть, щоб змінити)',
    zoomIn: 'Наблизити',
    zoomOut: 'Віддалити',
  },
  en: {
    title: 'Voxel Kherson',
    walk: 'WALK',
    fly: 'FLY',
    regions: 'regions',
    chunks: 'chunks',
    jobs: 'jobs',
    tris: 'k tris',
    hintDesktop: 'Click to look around · WASD move · Shift sprint · Space jump/up · Q/C down · F fly/walk',
    hintTouch: 'Left: move · Right: look · ▲/▼ up/down · ✈ fly/walk',
    places: '📍 Places',
    search: 'Search places and streets…',
    formerly: 'formerly',
    attribution: 'Map data © OpenStreetMap contributors',
    north: 'N',
    failed: 'Failed to start',
    switchTo: 'Перемкнути на українську',
    settings: 'Settings: time, quality, sound',
    mute: 'Mute sound',
    unmute: 'Unmute sound',
    qualityHigh: 'Quality: high (click to lower)',
    qualityLow: 'Quality: low (click to raise)',
    timeOfDay: 'Time of day (click to change)',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['uk'];

const KINDS: Record<string, { uk: string; en: string }> = {
  historic: { uk: 'пам’ятка', en: 'historic' },
  place_of_worship: { uk: 'храм', en: 'church' },
  park: { uk: 'парк', en: 'park' },
  attraction: { uk: 'атракція', en: 'attraction' },
  suburb: { uk: 'район', en: 'district' },
  quarter: { uk: 'квартал', en: 'quarter' },
  neighbourhood: { uk: 'мікрорайон', en: 'neighbourhood' },
  bridge: { uk: 'міст', en: 'bridge' },
  square: { uk: 'площа', en: 'square' },
  street: { uk: 'вулиця', en: 'street' },
  village: { uk: 'село', en: 'village' },
  locality: { uk: 'місцевість', en: 'locality' },
  island: { uk: 'острів', en: 'island' },
  town: { uk: 'місто', en: 'town' },
  city: { uk: 'місто', en: 'city' },
  townhall: { uk: 'адміністрація', en: 'town hall' },
  theatre: { uk: 'театр', en: 'theatre' },
  museum: { uk: 'музей', en: 'museum' },
  university: { uk: 'університет', en: 'university' },
  allotments: { uk: 'дачі', en: 'allotments' },
  ferry_terminal: { uk: 'причал', en: 'pier' },
  port: { uk: 'порт', en: 'port' },
};

const STORAGE_KEY = 'vk-lang';
const listeners: Array<(lang: Lang) => void> = [];

function isLang(v: unknown): v is Lang {
  return v === 'uk' || v === 'en';
}

/** ?lang= wins, then the saved choice, then Ukrainian. */
function initialLang(): Lang {
  if (typeof location === 'undefined') return 'uk'; // tests / non-browser
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // storage unavailable (private mode etc.)
  }
  return 'uk';
}

let current: Lang = initialLang();

export function getLang(): Lang {
  return current;
}

export function t(key: StringKey): string {
  return STRINGS[current][key];
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  applyDocument();
  for (const cb of listeners) cb(lang);
}

export function onLangChange(cb: (lang: Lang) => void): void {
  listeners.push(cb);
}

export function applyDocument(): void {
  document.documentElement.lang = current;
  document.title = t('title');
}

/** Place name in the current language; English falls back to a transliteration. */
export function placeName(p: Place): string {
  return current === 'uk' ? p.name : (p.nameEn ?? translit(p.name));
}

/** The other-language name shown as a secondary label, if it differs. */
export function placeAltName(p: Place): string | null {
  const alt = current === 'uk' ? (p.nameEn ?? null) : p.name;
  return alt !== null && alt !== placeName(p) ? alt : null;
}

export function kindLabel(kind: string): string {
  return KINDS[kind]?.[current] ?? kind.replace(/_/g, ' ');
}

/** "УКР | EN" toggle with the active language highlighted, placed left of the Places button. */
export function createLangSwitcher(parent: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vk-btn vk-lang';
  const uk = document.createElement('span');
  uk.textContent = 'УКР';
  const sep = document.createElement('span');
  sep.textContent = ' | ';
  sep.className = 'vk-lang-sep';
  const en = document.createElement('span');
  en.textContent = 'EN';
  btn.append(uk, sep, en);
  const render = (): void => {
    uk.className = current === 'uk' ? 'vk-lang-on' : 'vk-lang-off';
    en.className = current === 'en' ? 'vk-lang-on' : 'vk-lang-off';
    btn.title = t('switchTo');
    btn.setAttribute('aria-label', t('switchTo'));
  };
  btn.addEventListener('click', () => setLang(current === 'uk' ? 'en' : 'uk'));
  onLangChange(render);
  render();
  parent.appendChild(btn);
  createSettingsButton(parent);
  return btn;
}

const MENU_OPEN = 'vk-menu-open';

/**
 * "⚙" button, shown only on narrow screens (ui.css): there the time, quality and sound buttons are hidden
 * and drop down as a vertical stack under it (body.vk-menu-open) so the top row fits 320 px.
 */
function createSettingsButton(parent: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vk-btn vk-settings';
  btn.textContent = '⚙';
  const set = (open: boolean): void => {
    document.body.classList.toggle(MENU_OPEN, open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => set(!document.body.classList.contains(MENU_OPEN)));
  // a tap anywhere else (the Places button, the world) folds the menu back up
  document.addEventListener('click', (e) => {
    const el = e.target as Element | null;
    if (el !== null && el.closest('.vk-settings, .vk-time, .vk-quality, .vk-mute') === null) set(false);
  });
  const render = (): void => {
    btn.title = t('settings');
    btn.setAttribute('aria-label', t('settings'));
  };
  onLangChange(render);
  render();
  set(false);
  parent.appendChild(btn);
  return btn;
}

/** "HQ"/"LQ" toggle next to the mute button; saving the choice reloads the page to apply it. */
export function createQualityButton(parent: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vk-btn vk-quality';
  const render = (): void => {
    const high = getQuality() === 'high';
    btn.textContent = high ? 'HQ' : 'LQ';
    const label = t(high ? 'qualityHigh' : 'qualityLow');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  btn.addEventListener('click', () => {
    setQuality(getQuality() === 'high' ? 'low' : 'high');
    const url = new URL(location.href);
    url.searchParams.delete('quality'); // a ?quality= override would defeat the new choice
    location.replace(url.toString());
  });
  onLangChange(render);
  render();
  parent.appendChild(btn);
  return btn;
}

/** Time-of-day button left of the quality toggle: shows the preset icon and time, a tap cycles presets. */
export function createTimeButton(parent: HTMLElement, initialHours: number, onSelect: (hours: number) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vk-btn vk-time';
  const icon = document.createElement('span');
  const label = document.createElement('span');
  label.className = 'vk-time-text';
  btn.append(icon, label);
  let hours = initialHours;
  const render = (): void => {
    let near = 0, bd = Infinity;
    TIME_PRESETS.forEach((p, i) => {
      const d = Math.abs((((hours - p.hours + 12) % 24) + 24) % 24 - 12);
      if (d < bd) { bd = d; near = i; }
    });
    icon.textContent = TIME_PRESETS[near]!.icon;
    label.textContent = formatTime(hours);
    const text = `${t('timeOfDay')}: ${formatTime(hours)}`;
    btn.title = text;
    btn.setAttribute('aria-label', text);
  };
  btn.addEventListener('click', () => {
    hours = TIME_PRESETS[nextPreset(hours)]!.hours;
    render();
    onSelect(hours);
  });
  onLangChange(render);
  render();
  parent.appendChild(btn);
  return btn;
}

/** The ODbL credit for the map data (Constitution 8.1), linked to the OSM copyright page. */
export function createAttribution(parent: HTMLElement): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'vk-attribution';
  a.href = 'https://www.openstreetmap.org/copyright';
  a.target = '_blank';
  a.rel = 'noopener';
  const render = (): void => {
    a.textContent = t('attribution');
  };
  render();
  onLangChange(render);
  parent.appendChild(a);
  return a;
}
