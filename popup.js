import { groupName, findDuplicates } from './rules.js';

globalThis.browser ??= chrome;

const SETTINGS = { dev: true, sort: 'recent', view: 'groups' };
const IS_PAGE = new URLSearchParams(location.search).has('page');
const IS_FIREFOX = typeof browser.runtime.getBrowserInfo === 'function';
const CONFIRM_ABOVE = 10;
const VISIBLE_IN_STACK = 5;

const state = {
  ...SETTINGS,
  query: '', selected: -1,
  tabs: [], windows: [], currentWindow: null, ownTabId: null, duplicates: 0,
  openGroups: new Set(), openKeepers: new Set(),
};

const $ = selector => document.querySelector(selector);
const body = $('#body');
const search = $('#search');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canHover = matchMedia('(hover: hover) and (pointer: fine)');

// Stroke icons drawn from Lucide (ISC license). Text glyphs like ⚙ render tiny and differ per font.
const ICONS = {
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  page: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  move: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  closeCopies: '<path d="m12 12 6 6"/><path d="m12 18 6-6"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
};

function icon(name) {
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Case- and diacritics-insensitive: "cestovne" finds "Cestovné".
function fold(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// ---------- data ----------
async function load() {
  const [windows, current] = await Promise.all([
    browser.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    browser.windows.getCurrent(),
  ]);
  windows.sort((a, b) => a.id - b.id);
  state.windows = windows.map(w => w.id);
  state.currentWindow = current.id;
  state.tabs = windows.flatMap(w => w.tabs).filter(tab => tab.id !== state.ownTabId);
  for (const tab of state.tabs) tab.url ||= tab.pendingUrl ?? '';
  analyze();
}

function analyze() {
  for (const tab of state.tabs) {
    tab.group = groupName(tab.url, state.dev);
    tab.set = null;
    tab.isDup = false;
  }
  state.duplicates = 0;
  for (const { keeper, copies } of findDuplicates(state.tabs, state.dev)) {
    const set = { keeper, size: copies.length + 1 };
    keeper.set = set;
    for (const copy of copies) {
      copy.set = set;
      copy.isDup = true;
    }
    state.duplicates += copies.length;
  }
}

function matches(tab) {
  if (!state.query) return true;
  const query = fold(state.query);
  return fold(tab.title ?? '').includes(query) || fold(tab.url).includes(query) || fold(tab.group).includes(query);
}

function sortTabs(list) {
  if (state.sort === 'recent') return list.sort((a, b) => b.lastAccessed - a.lastAccessed);
  return list.sort((a, b) => state.windows.indexOf(a.windowId) - state.windows.indexOf(b.windowId) || a.index - b.index);
}

function groupsOf(list) {
  const groups = new Map();
  for (const tab of list) {
    if (!groups.has(tab.group)) groups.set(tab.group, []);
    groups.get(tab.group).push(tab);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function tabsIn(windowId) {
  return state.tabs.filter(tab => tab.windowId === windowId);
}

// The window's biggest group plus how many others it holds.
function windowName(windowId) {
  const groups = groupsOf(tabsIn(windowId));
  if (groups.length === 0) return 'Empty window';
  const rest = groups.length - 1;
  return rest > 0 ? `${groups[0][0]} & ${rest} more` : groups[0][0];
}

// ---------- favicons ----------
function tileSrc(text) {
  let hue = 0;
  for (const char of text) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  const letter = esc((text.replace(/^www\./, '')[0] ?? '•').toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl(${hue} 45% 48%)"/><text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="white">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function faviconSrc(tab) {
  // Chrome serves favicons from its own cache, so nothing is fetched from the network.
  if (!IS_FIREFOX) {
    const url = new URL(browser.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', tab.url);
    // 64 px so 24–32 px icons stay sharp on high-density screens.
    url.searchParams.set('size', '64');
    return url.href;
  }
  return tab.favIconUrl || tileSrc(hostLabel(tab.url));
}

function hostLabel(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || '?';
  }
}

function favicon(tab, { cls = '', attrs = 'draggable="false"', style = '', alt = '' } = {}) {
  return `<img class="fav ${cls}" src="${esc(faviconSrc(tab))}" alt="${esc(alt)}" data-host="${esc(hostLabel(tab.url))}" style="${style}" ${attrs}>`;
}

// A favicon that fails to load (privileged URL, no icon) becomes a letter tile.
document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav') || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = tileSrc(img.dataset.host ?? '?');
}, true);

// ---------- rendering ----------
function windowLabel(windowId) {
  const n = state.windows.indexOf(windowId) + 1;
  const current = windowId === state.currentWindow;
  const title = `Window ${n}${current ? ' (this window)' : ''}: ${windowName(windowId)}`;
  return `<span class="wl-icon${current ? ' cur' : ''}" title="${esc(title)}">${n}</span>`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname) return url;
    return u.hostname.replace(/^www\./, '') + decodeURI(u.pathname) + u.search + u.hash;
  } catch {
    return url;
  }
}

function copiesButton(tab) {
  if (!tab.set || tab.isDup) return '';
  const copies = tab.set.size - 1;
  return `<button type="button" class="copies" data-copies="${tab.id}" title="Show copies">+${copies} ${copies === 1 ? 'copy' : 'copies'}</button>`;
}

function rowHtml(tab, nested = false) {
  return `<li class="row${nested ? ' nested' : ''}" data-id="${tab.id}">
    ${favicon(tab)}
    <span class="t"><span class="title">${esc(tab.title || tab.url)}</span><span class="url">${esc(shortUrl(tab.url))}</span></span>
    ${copiesButton(tab)}
    ${windowLabel(tab.windowId)}
    <span class="actions">
      <button type="button" class="icon-btn" data-move-tab="${tab.id}" title="Move to…" aria-label="Move to window">${icon('move')}</button>
      <button type="button" class="icon-btn" data-close="${tab.id}" title="Close tab" aria-label="Close tab">${icon('close')}</button>
    </span>
  </li>`;
}

// Duplicates sit under their keeper and show only when the keeper's "+N copies" is opened.
function groupRows(list) {
  const html = [];
  for (const tab of list) {
    if (tab.isDup && list.includes(tab.set.keeper)) continue;
    html.push(rowHtml(tab));
    if (tab.set && !tab.isDup && state.openKeepers.has(tab.id)) {
      for (const copy of list.filter(t => t.isDup && t.set.keeper === tab)) html.push(rowHtml(copy, true));
    }
  }
  return html.join('');
}

function renderGroups(list) {
  const groups = groupsOf(list);
  if (groups.length === 0) return '<div class="empty">No tabs match.</div>';
  const html = groups.map(([name, members]) => {
    const open = state.query || state.openGroups.has(name);
    const dups = members.filter(tab => tab.isDup).length;
    return `<details class="group" data-group="${esc(name)}" ${open ? 'open' : ''}>
      <summary>
        <span class="chev">${icon('chevron')}</span>
        <span class="mini-stack">${members.slice(0, 4).map(tab => favicon(tab)).join('')}</span>
        <span class="g-name">${esc(name)}</span>
        <span class="g-meta">${members.length}</span>
        ${dups ? `<span class="dup-count">${dups} dup${dups === 1 ? '' : 's'}</span>` : ''}
        <span class="g-spacer"></span>
        ${dups ? `<button type="button" class="icon-btn" data-close-group-dups="${esc(name)}" title="Close duplicates in group" aria-label="Close duplicates in group">${icon('closeCopies')}</button>` : ''}
        <button type="button" class="icon-btn" data-move-group="${esc(name)}" title="Move group to…" aria-label="Move group to window">${icon('move')}</button>
        <button type="button" class="icon-btn" data-close-group="${esc(name)}" title="Close group" aria-label="Close group">${icon('close')}</button>
      </summary>
      <ul class="rows">${groupRows(sortTabs(members))}</ul>
    </details>`;
  }).join('');
  return `<div class="groups">${html}</div>`;
}

function renderWindows(list) {
  const cards = state.windows.map(windowId => {
    const members = list.filter(tab => tab.windowId === windowId);
    if (members.length === 0) return '';
    const n = state.windows.indexOf(windowId) + 1;
    const stacks = groupsOf(members).map(([name, groupTabs]) => {
      const icons = sortTabs(groupTabs).map((tab, i) => favicon(tab, {
        cls: tab.isDup ? 'dup' : '',
        // No title attribute: the panel's info line shows the title at once, the native tooltip only after a delay.
        attrs: `draggable="true" data-tab="${tab.id}"`,
        style: `--i:${i}`,
        alt: tab.title ?? '',
      })).join('');
      const more = groupTabs.length > VISIBLE_IN_STACK ? `<span class="more">+${groupTabs.length - VISIBLE_IN_STACK}</span>` : '';
      return `<div class="stack" tabindex="0" draggable="true" data-stack-group="${esc(name)}" data-w="${windowId}" aria-label="${esc(name)}, ${groupTabs.length} tabs">
        <div class="icons"><div class="panel-name">${esc(name)} · ${groupTabs.length}</div>${icons}${more}<div class="panel-info"><span class="pi-hint">Point at a tab to see what it is</span></div></div>
        <div class="stack-name">${esc(name)} · ${groupTabs.length}</div>
      </div>`;
    }).join('');
    const current = windowId === state.currentWindow;
    return `<section class="win${current ? ' cur' : ''}" data-drop-w="${windowId}">
      <div class="win-head"><span class="win-name" title="${esc(windowName(windowId))}">${esc(windowName(windowId))}</span><span class="win-count">${current ? 'This window' : `Window ${n}`} · ${members.length} tab${members.length === 1 ? '' : 's'}</span></div>
      <div class="stacks">${stacks}</div>
    </section>`;
  }).join('');
  return `<div class="windows">${cards}<section class="win new" data-drop-w="new">+ New window</section></div>`;
}

function render() {
  const list = state.tabs.filter(matches);
  document.documentElement.classList.toggle('mono', state.dev);

  const closeDups = $('#close-dups');
  closeDups.textContent = `Close duplicates (${state.duplicates})`;
  closeDups.disabled = state.duplicates === 0;

  $('#results-bar').innerHTML = state.query ? `<span>${list.length} results</span>
    <button type="button" class="btn" id="move-results" ${list.length ? '' : 'disabled'}>Move results (${list.length}) to new window</button>
    <button type="button" class="btn danger" id="close-results" ${list.length ? '' : 'disabled'}>Close results (${list.length})</button>` : '';

  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  const scroll = body.scrollTop;
  body.innerHTML = state.view === 'groups' ? renderGroups(list) : renderWindows(list);
  body.scrollTop = scroll;
  highlightSelection();
}

let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await load();
    render();
  }, 50);
}

// ---------- actions ----------
async function switchTo(id) {
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;
  await browser.tabs.update(id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
  if (!IS_PAGE) window.close();
}

async function moveTabs(ids, target) {
  if (ids.length === 0) return;
  if (target === 'new') {
    // A new window takes focus and closes the popup, so the background does the moving.
    await browser.runtime.sendMessage({ type: 'move-to-new-window', ids }).catch(() => {});
    return;
  }
  await browser.tabs.move(ids, { windowId: target, index: -1 });
}

// Only the tabs the list shows: while searching, a group action applies to its results.
function groupTabIds(name, windowId = null) {
  return state.tabs
    .filter(tab => tab.group === name && matches(tab) && (windowId === null || tab.windowId === windowId))
    .map(tab => tab.id);
}

async function confirmClose(count) {
  if (count <= CONFIRM_ABOVE) return true;
  const dialog = $('#confirm');
  $('#confirm-text').textContent = `Close ${count} tabs? This cannot be undone from oh-my-tabs.`;
  dialog.showModal();
  await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  return dialog.returnValue === 'ok';
}

async function saveSetting(key, value) {
  state[key] = value;
  await browser.storage.local.set({ [key]: value });
}

// ---------- "Move to…" menu, shared by tab rows and group headers ----------
const moveMenu = $('#move-menu');
let moveIds = [];

function openMoveMenu(trigger, ids) {
  moveIds = ids;
  const from = new Set(state.tabs.filter(tab => ids.includes(tab.id)).map(tab => tab.windowId));
  const items = state.windows
    .filter(windowId => !(from.size === 1 && from.has(windowId)))
    .map(windowId => `<button type="button" role="menuitem" data-target="${windowId}">${windowLabel(windowId)}<span>${esc(windowName(windowId))}</span></button>`);
  moveMenu.innerHTML = `${items.join('')}${items.length ? '<hr>' : ''}<button type="button" role="menuitem" data-target="new">${icon('plus')}<span>New window</span></button>`;
  const rect = trigger.getBoundingClientRect();
  moveMenu.style.top = `${Math.min(rect.bottom + 4, innerHeight - 200)}px`;
  moveMenu.style.left = `${Math.max(8, rect.right - 300)}px`;
  moveMenu.showPopover();
  moveMenu.querySelector('button').focus();
}

moveMenu.addEventListener('click', event => {
  const item = event.target.closest('[data-target]');
  if (!item) return;
  moveMenu.hidePopover();
  moveTabs(moveIds, item.dataset.target === 'new' ? 'new' : Number(item.dataset.target));
});
moveMenu.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = [...moveMenu.querySelectorAll('button')];
  const current = items.indexOf(document.activeElement);
  const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  items[next].focus();
});

// ---------- list events ----------
body.addEventListener('click', async event => {
  const target = event.target;
  const closeGroupDups = target.closest('[data-close-group-dups]');
  if (closeGroupDups) {
    // Never asks: every keeper stays open, so no page is lost.
    event.preventDefault();
    const name = closeGroupDups.dataset.closeGroupDups;
    browser.tabs.remove(state.tabs.filter(tab => tab.group === name && tab.isDup && matches(tab)).map(tab => tab.id));
    return;
  }
  const closeGroup = target.closest('[data-close-group]');
  if (closeGroup) {
    event.preventDefault();
    const ids = groupTabIds(closeGroup.dataset.closeGroup);
    if (await confirmClose(ids.length)) browser.tabs.remove(ids);
    return;
  }
  const close = target.closest('[data-close]');
  if (close) {
    browser.tabs.remove(Number(close.dataset.close));
    return;
  }
  const moveTab = target.closest('[data-move-tab]');
  if (moveTab) {
    openMoveMenu(moveTab, [Number(moveTab.dataset.moveTab)]);
    return;
  }
  const moveGroup = target.closest('[data-move-group]');
  if (moveGroup) {
    event.preventDefault();
    openMoveMenu(moveGroup, groupTabIds(moveGroup.dataset.moveGroup));
    return;
  }
  const copies = target.closest('[data-copies]');
  if (copies) {
    const id = Number(copies.dataset.copies);
    if (state.openKeepers.has(id)) state.openKeepers.delete(id);
    else state.openKeepers.add(id);
    render();
    return;
  }
  const fav = target.closest('.stack.open [data-tab]');
  if (fav) {
    switchTo(Number(fav.dataset.tab));
    return;
  }
  const row = target.closest('.row');
  if (row) switchTo(Number(row.dataset.id));
});

body.addEventListener('toggle', event => {
  const details = event.target;
  if (state.query || !details.matches('details.group')) return;
  if (details.open) state.openGroups.add(details.dataset.group);
  else state.openGroups.delete(details.dataset.group);
}, true);

// ---------- search ----------
search.addEventListener('input', () => {
  state.query = search.value.trim();
  state.selected = state.query ? 0 : -1;
  render();
});
search.addEventListener('keydown', event => {
  const rows = [...body.querySelectorAll('.row')];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    state.selected = Math.min(rows.length - 1, Math.max(0, state.selected + step));
    highlightSelection();
  }
  if (event.key === 'Enter' && rows[state.selected]) switchTo(Number(rows[state.selected].dataset.id));
  if (event.key === 'Escape' && search.value) {
    event.preventDefault();
    search.value = '';
    search.dispatchEvent(new Event('input'));
  }
});

function highlightSelection() {
  const rows = [...body.querySelectorAll('.row')];
  rows.forEach((row, i) => row.classList.toggle('sel', i === state.selected));
  rows[state.selected]?.scrollIntoView({ block: 'nearest' });
}

$('#results-bar').addEventListener('click', async event => {
  const ids = state.tabs.filter(matches).map(tab => tab.id);
  if (event.target.id === 'move-results') await moveTabs(ids, 'new');
  if (event.target.id === 'close-results' && await confirmClose(ids.length)) await browser.tabs.remove(ids);
});

// Never asks: every keeper stays open, so no page is lost.
$('#close-dups').addEventListener('click', () => {
  browser.tabs.remove(state.tabs.filter(tab => tab.isDup).map(tab => tab.id));
});

// ---------- header and settings ----------
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', async () => {
    await saveSetting('view', button.dataset.view);
    render();
  });
}
$('#open-page').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('popup.html?page') });
  window.close();
});

// No CSS anchor positioning in Chrome or Firefox yet: place the settings panel under its button.
$('#settings').addEventListener('beforetoggle', event => {
  if (event.newState !== 'open') return;
  const rect = $('#settings-button').getBoundingClientRect();
  event.target.style.top = `${rect.bottom + 6}px`;
  event.target.style.left = `${Math.max(8, rect.right - 260)}px`;
});
$('#s-dev').addEventListener('change', async event => {
  await saveSetting('dev', event.target.checked);
  analyze();
  render();
});
for (const radio of document.querySelectorAll('[name="sort"]')) {
  radio.addEventListener('change', async () => {
    await saveSetting('sort', radio.value);
    render();
  });
}
$('#change-shortcuts').addEventListener('click', async () => {
  if (browser.commands.openShortcutSettings) await browser.commands.openShortcutSettings();
  else await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

async function renderShortcuts() {
  const labels = { '_execute_action': 'Open oh-my-tabs', 'close-duplicates': 'Close duplicates' };
  const commands = await browser.commands.getAll();
  $('#shortcuts').innerHTML = commands
    .filter(command => labels[command.name])
    .map(command => `<span>${command.shortcut ? `<kbd>${esc(command.shortcut)}</kbd>` : '<em>not set</em>'}</span><span>${labels[command.name]}</span>`)
    .join('');
}

// ---------- stacks: fan out on hover or keyboard focus (FLIP, transform only) ----------
function setStackOpen(stack, open) {
  if (stack.classList.contains('open') === open) return;
  const icons = [...stack.querySelectorAll('.fav')];
  const first = icons.map(icon => icon.getBoundingClientRect());
  icons.forEach(icon => icon.getAnimations().forEach(animation => animation.cancel()));
  // The panel's name line sits above the icons, so lift it to keep the icons where the stack was.
  stack.style.setProperty('--top', `${stack.offsetTop - 34}px`);
  stack.classList.toggle('open', open);
  if (reduceMotion.matches) return;
  icons.forEach((icon, i) => {
    const last = icon.getBoundingClientRect();
    const dx = first[i].left - last.left;
    const dy = first[i].top - last.top;
    if (!dx && !dy) return;
    icon.animate(
      [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
      { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', delay: open ? Math.min(i, 8) * 12 : 0, fill: 'backwards' },
    );
  });
}

// The open panel's bottom line names the favicon under the pointer, without the native tooltip's delay.
function showTabInfo(stack, tab) {
  const info = stack.querySelector('.panel-info');
  const duplicate = tab.isDup ? ' · <span class="pi-dup">duplicate</span>' : '';
  info.innerHTML = `<span class="pi-title">${esc(tab.title || tab.url)}</span>
    <span class="pi-url">${esc(shortUrl(tab.url))}${duplicate}</span>`;
}

body.addEventListener('pointerover', event => {
  const fav = event.target.closest('.stack.open [data-tab]');
  if (!fav) return;
  const tab = state.tabs.find(t => t.id === Number(fav.dataset.tab));
  if (tab) showTabInfo(fav.closest('.stack'), tab);
});

let hoverTimer;
body.addEventListener('pointerover', event => {
  if (!canHover.matches) return;
  const stack = event.target.closest('.stack');
  if (!stack || stack.classList.contains('open')) return;
  clearTimeout(hoverTimer);
  // A short delay so sweeping the pointer across a card does not open every stack on the way.
  hoverTimer = setTimeout(() => setStackOpen(stack, true), 60);
});
body.addEventListener('pointerout', event => {
  const stack = event.target.closest('.stack');
  if (!stack || stack.contains(event.relatedTarget)) return;
  clearTimeout(hoverTimer);
  if (!stack.contains(document.activeElement)) setStackOpen(stack, false);
});
body.addEventListener('focusin', event => {
  const stack = event.target.closest('.stack');
  if (stack) setStackOpen(stack, true);
});
body.addEventListener('focusout', event => {
  const stack = event.target.closest('.stack');
  if (stack && !stack.contains(event.relatedTarget)) setStackOpen(stack, false);
});
body.addEventListener('keydown', event => {
  const stack = event.target.closest('.stack');
  if (!stack || event.key !== 'Enter') return;
  const first = stack.querySelector('[data-tab]');
  if (first) switchTo(Number(first.dataset.tab));
});

// ---------- drag and drop between windows ----------
body.addEventListener('dragstart', event => {
  const fav = event.target.closest('[data-tab]');
  const stack = event.target.closest('.stack');
  let ids = [];
  // A single favicon drags only once its stack has spread out; otherwise the whole stack moves.
  if (fav && stack?.classList.contains('open')) ids = [Number(fav.dataset.tab)];
  else if (stack) ids = groupTabIds(stack.dataset.stackGroup, Number(stack.dataset.w));
  event.dataTransfer.setData('text/plain', ids.join(','));
  event.dataTransfer.effectAllowed = 'move';
});
body.addEventListener('dragover', event => {
  const win = event.target.closest('[data-drop-w]');
  if (!win) return;
  event.preventDefault();
  body.querySelectorAll('.drop').forEach(el => el !== win && el.classList.remove('drop'));
  win.classList.add('drop');
});
body.addEventListener('dragleave', event => {
  const win = event.target.closest('[data-drop-w]');
  if (win && !win.contains(event.relatedTarget)) win.classList.remove('drop');
});
body.addEventListener('drop', event => {
  const win = event.target.closest('[data-drop-w]');
  if (!win) return;
  event.preventDefault();
  win.classList.remove('drop');
  const ids = event.dataTransfer.getData('text/plain').split(',').filter(Boolean).map(Number);
  moveTabs(ids, win.dataset.dropW === 'new' ? 'new' : Number(win.dataset.dropW));
});

// ---------- start ----------
for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) {
  browser.tabs[event].addListener(refresh);
}
browser.windows.onCreated.addListener(refresh);
browser.windows.onRemoved.addListener(refresh);

async function start() {
  for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
  if (IS_PAGE) {
    document.documentElement.classList.add('page');
    state.ownTabId = (await browser.tabs.getCurrent())?.id ?? null;
  }
  Object.assign(state, await browser.storage.local.get(SETTINGS));
  $('#s-dev').checked = state.dev;
  document.querySelector(`[name="sort"][value="${state.sort}"]`).checked = true;

  await load();
  const active = state.tabs.find(tab => tab.windowId === state.currentWindow && tab.active);
  if (active) state.openGroups.add(active.group);
  render();
  search.focus();
  renderShortcuts();
}

start();
