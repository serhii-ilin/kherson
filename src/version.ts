declare const __BUILD_ID__: string;

/** Id of this deploy (git sha in CI); the same id is written to dist/version.json. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** World data URL tied to this deploy: a new deploy changes the URL, so no stale cached tile is mixed in. */
export function versioned(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${BUILD_ID}`;
}

const CHECK_MS = 10 * 60 * 1000;
const RELOADED_KEY = 'vk-reloaded-for';

async function latestId(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const id = ((await r.json()) as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** Reopens the page under a new URL, which GitHub Pages' cache has never seen, keeping the other parameters. */
function reloadFor(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set('v', id);
  location.replace(url.toString());
}

/**
 * Production only. At start a newer deploy reloads the page at once (at most once per id, so a CDN that
 * still serves the old page cannot loop); later checks (every 10 min and when the tab comes back) show
 * a button instead of interrupting a walk.
 */
export function watchForUpdates(parent: HTMLElement, label: () => string): void {
  if (import.meta.env.DEV) return;
  let shown = false;
  const check = async (atStart: boolean): Promise<void> => {
    const id = await latestId();
    if (id === null || id === BUILD_ID || shown) return;
    let already = false;
    try { already = sessionStorage.getItem(RELOADED_KEY) === id; } catch { /* storage blocked */ }
    if (atStart && !already) {
      try { sessionStorage.setItem(RELOADED_KEY, id); } catch { /* storage blocked */ }
      reloadFor(id);
      return;
    }
    if (atStart) return;
    shown = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vk-btn vk-update';
    btn.textContent = label();
    btn.addEventListener('click', () => reloadFor(id));
    parent.appendChild(btn);
  };
  void check(true);
  setInterval(() => void check(false), CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(false); });
}
