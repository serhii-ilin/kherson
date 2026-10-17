import { translit, type Place } from './ui/places.ts';

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
    search: 'Пошук місць…',
    north: 'Пн',
    failed: 'Не вдалося запустити',
    switchTo: 'Switch to English',
    mute: 'Вимкнути звук',
    unmute: 'Увімкнути звук',
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
    search: 'Search places…',
    north: 'N',
    failed: 'Failed to start',
    switchTo: 'Перемкнути на українську',
    mute: 'Mute sound',
    unmute: 'Unmute sound',
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
  return btn;
}
