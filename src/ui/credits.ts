/**
 * In-app «Автори фото / Photo credits» panel (CONSTITUTION Article 8.3): every facade-photo author,
 * licence, date and source, plus the CC0 material line, next to the OSM attribution. The panel is a
 * centred modal on both desktop and phone, scrolls inside a 520 px column, traps Tab focus and
 * returns focus on close. It is never open by default, so it cannot cover the touch controls.
 */
import { getLang, onLangChange, t } from '../i18n.ts';
import { PHOTO_CREDITS, creditRows } from '../world/photo-credits.ts';

export interface CreditsPanel {
  open(): void;
  close(): void;
}

const MATERIALS_CREDITS = 'https://github.com/serhii-ilin/kherson/blob/main/docs/ASSET_CREDITS.md';

let panelSequence = 0;

function isFocusable(element: HTMLElement): boolean {
  return !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true';
}

export function createCredits(parent: HTMLElement): CreditsPanel {
  const titleId = `vk-credits-title-${++panelSequence}`;

  const overlay = document.createElement('div');
  overlay.className = 'vk-credits';
  overlay.hidden = true;

  const panel = document.createElement('div');
  panel.className = 'vk-credits-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', titleId);

  const header = document.createElement('div');
  header.className = 'vk-credits-header';
  const title = document.createElement('h2');
  title.className = 'vk-credits-title';
  title.id = titleId;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'vk-credits-close';
  closeButton.textContent = '✕';

  const list = document.createElement('ul');
  list.className = 'vk-credits-list';

  const empty = document.createElement('p');
  empty.className = 'vk-credits-empty';

  const materials = document.createElement('p');
  materials.className = 'vk-credits-materials';
  const materialsLink = document.createElement('a');
  materialsLink.href = MATERIALS_CREDITS;
  materialsLink.target = '_blank';
  materialsLink.rel = 'noopener';
  materials.appendChild(materialsLink);

  header.append(title, closeButton);
  panel.append(header, list, empty, materials);
  overlay.appendChild(panel);
  parent.appendChild(overlay);

  let lastFocus: HTMLElement | null = null;
  let openState = false;

  const render = (): void => {
    title.textContent = t('creditsTitle');
    closeButton.title = t('creditsClose');
    closeButton.setAttribute('aria-label', t('creditsClose'));
    materialsLink.textContent = t('creditsMaterials');
    empty.textContent = t('creditsEmpty');

    const rows = creditRows(PHOTO_CREDITS, getLang());
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li');
      item.className = 'vk-credits-row';

      const author = document.createElement('a');
      author.className = 'vk-credits-author';
      author.href = row.source;
      author.target = '_blank';
      author.rel = 'noopener';
      author.textContent = row.author;

      const separator = document.createElement('span');
      separator.className = 'vk-credits-separator';
      separator.textContent = '—';
      separator.setAttribute('aria-hidden', 'true');

      let licence: HTMLElement;
      if (row.licenceUrl !== '') {
        const link = document.createElement('a');
        link.className = 'vk-credits-licence';
        link.href = row.licenceUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = row.licence;
        licence = link;
      } else {
        const span = document.createElement('span');
        span.className = 'vk-credits-licence';
        span.textContent = row.licence;
        licence = span;
      }

      const detail = document.createElement('span');
      detail.className = 'vk-credits-detail';
      detail.textContent = row.detail;

      item.append(author, separator, licence, detail);
      list.appendChild(item);
    }
    list.hidden = rows.length === 0;
    empty.hidden = rows.length > 0;
  };

  const focusables = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>('a[href], button')].filter(isFocusable);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  function open(): void {
    if (openState) return;
    openState = true;
    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    render();
    overlay.hidden = false;
    panel.scrollTop = 0;
    document.addEventListener('keydown', onKeyDown);
    closeButton.focus();
  }

  function close(): void {
    if (!openState) return;
    openState = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKeyDown);
    if (lastFocus !== null && lastFocus.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  onLangChange(() => {
    if (openState) render();
  });

  render();
  return { open, close };
}
