export type Quality = 'high' | 'low';

const STORAGE_KEY = 'vk-quality';

function isQuality(v: unknown): v is Quality {
  return v === 'high' || v === 'low';
}

/** ?quality= wins, then the saved choice, then Low on phones/touch devices and High elsewhere. */
export function resolveQuality(search: string | null, stored: string | null, isMobile: boolean): Quality {
  const fromUrl = search === null ? null : new URLSearchParams(search).get('quality');
  if (isQuality(fromUrl)) return fromUrl;
  if (isQuality(stored)) return stored;
  return isMobile ? 'low' : 'high';
}

function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const touch = typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  return touch || /Mobi|Android/i.test(navigator.userAgent);
}

function initialQuality(): Quality {
  if (typeof location === 'undefined') return 'high'; // tests / non-browser
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode etc.)
  }
  return resolveQuality(location.search, stored, detectMobile());
}

let current: Quality = initialQuality();

export function getQuality(): Quality {
  return current;
}

/** Persists the choice; callers reload the page to apply it. */
export function setQuality(q: Quality): void {
  current = q;
  try {
    localStorage.setItem(STORAGE_KEY, q);
  } catch {
    // ignore
  }
}
