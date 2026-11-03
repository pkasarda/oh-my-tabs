import { groupName, findDuplicates, isWeb } from './rules.js';

globalThis.browser ??= chrome;

const SETTINGS = { dev: true, sort: 'recent', view: 'groups' };
const IS_PAGE = new URLSearchParams(location.search).has('page');
const IS_FIREFOX = typeof browser.runtime.getBrowserInfo === 'function';
const CONFIRM_ABOVE = 10;

const state = {
  ...SETTINGS,
  query: '', selected: -1,
  tabs: [], windows: [], windowInfo: new Map(), windowNames: new Map(), currentWindow: null, ownTabId: null, duplicates: 0,
  openGroups: new Set(), openKeepers: new Set(),
};

const $ = selector => document.querySelector(selector);
const body = $('#body');
const search = $('#search');

// Stroke icons drawn from Lucide (ISC license). Text glyphs like ⚙ render tiny and differ per font.
const ICONS = {
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  page: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  move: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  closeCopies: '<path d="m12 12 6 6"/><path d="m12 18 6-6"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minimize: '<path d="M5 12h14"/>',
  restore: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M2 8h20"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  suspend: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
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
// Returns false when a newer load started meanwhile; only the latest one updates the state.
let loadToken = 0;
async function load() {
  const token = ++loadToken;
  const [windows, current] = await Promise.all([
    browser.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    browser.windows.getCurrent(),
  ]);
  if (token !== loadToken) return false;
  windows.sort((a, b) => a.id - b.id);
  state.windows = windows.map(w => w.id);
  state.windowInfo = new Map(windows.map(w => [w.id, { state: w.state, width: w.width, height: w.height }]));
  state.currentWindow = current.id;
  state.tabs = windows.flatMap(w => w.tabs).filter(tab => tab.id !== state.ownTabId);
  for (const tab of state.tabs) tab.url ||= tab.pendingUrl ?? '';
  analyze();
  return true;
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
  // Computed once here: every row's window label needs its window's name.
  state.windowNames = new Map(state.windows.map(windowId => [windowId, nameFor(windowId)]));
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
function nameFor(windowId) {
  const groups = groupsOf(tabsIn(windowId));
  if (groups.length === 0) return 'Empty window';
  const rest = groups.length - 1;
  return rest > 0 ? `${groups[0][0]} & ${rest} more` : groups[0][0];
}

function windowName(windowId) {
  return state.windowNames.get(windowId) ?? nameFor(windowId);
}

// "5 h ago", "4 wk ago": short enough for the window stats line.
function ago(timestamp) {
  const seconds = (Date.now() - timestamp) / 1000;
  if (seconds < 60) return 'just now';
  const units = [[60, 'min'], [24, 'h'], [7, 'd'], [4.35, 'wk'], [12, 'mo'], [Infinity, 'y']];
  let value = seconds / 60;
  for (const [size, unit] of units) {
    if (value < size) return `${Math.floor(value)} ${unit} ago`;
    value /= size;
  }
  return '';
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function windowStats(windowId) {
  const tabs = tabsIn(windowId);
  const sites = new Set(tabs.filter(tab => isWeb(tab.url)).map(tab => new URL(tab.url).hostname.replace(/^www\./, '')));
  const dups = tabs.filter(tab => tab.isDup).length;
  const used = tabs.map(tab => tab.lastAccessed).filter(Number.isFinite);
  const parts = [plural(tabs.length, 'tab'), plural(sites.size, 'site')];
  if (dups) parts.push(`<span class="dup-count">${plural(dups, 'dup')}</span>`);
  const suspended = tabs.filter(tab => tab.discarded).length;
  if (suspended) parts.push(`${suspended} suspended`);
  if (used.length) parts.push(`active ${ago(Math.max(...used))}`, `oldest used ${ago(Math.min(...used))}`);
  const info = state.windowInfo.get(windowId);
  const shape = `${info.state} · ${info.width}×${info.height}`;
  return `${parts.join(' · ')} <span class="win-shape" data-tip="${esc(shape)}" aria-label="${esc(shape)}">${icon('monitor')}</span>`;
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

function favicon(tab) {
  return `<img class="fav" src="${esc(faviconSrc(tab))}" alt="" data-host="${esc(hostLabel(tab.url))}" draggable="false" loading="lazy">`;
}

// Header mini stacks show different favicons only: four GitHub icons in a row say nothing.
function distinctFavicons(tabs, max = 4) {
  const seen = new Set();
  const picked = [];
  for (const tab of tabs) {
    const host = hostLabel(tab.url);
    if (seen.has(host)) continue;
    seen.add(host);
    picked.push(favicon(tab));
    if (picked.length === max) break;
  }
  return picked.join('');
}

// A favicon that fails to load (privileged URL, no icon) becomes a letter tile.
document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav') || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = tileSrc(img.dataset.host ?? '?');
}, true);

// ---------- rendering ----------
// interactive: a button that shows the window in the Windows view (not inside the move menu's buttons).
function windowLabel(windowId, { interactive = false } = {}) {
  const n = state.windows.indexOf(windowId) + 1;
  const current = windowId === state.currentWindow;
  const title = `Window ${n}${current ? ' (this window)' : ''}: ${windowName(windowId)}`;
  const cls = `wl-icon${current ? ' cur' : ''}`;
  if (!interactive) return `<span class="${cls}" data-tip="${esc(title)}">${n}</span>`;
  return `<button type="button" class="${cls}" data-show-window="${windowId}" data-tip="${esc(title)} · show window" aria-label="Show window ${n}">${n}</button>`;
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

// The ⋯ button that opens a row, group or window menu; data-* says which and for what.
function moreButton(kind, attrs, label) {
  return `<button type="button" class="icon-btn" data-menu="${kind}" ${attrs} aria-haspopup="menu" aria-expanded="false" data-tip="${label}" aria-label="${label}">${icon('more')}</button>`;
}

// list: the rows rendered together, where the copies would nest.
function copiesButton(tab, list) {
  if (!tab.set) return '';
  // A copy shown on its own row: its keeper is not in this list (another window in the Windows view).
  if (tab.isDup) {
    const n = state.windows.indexOf(tab.set.keeper.windowId) + 1;
    return `<span class="copy-pill" data-tip="Copy of a tab in window ${n}">copy</span>`;
  }
  const copies = list.filter(t => t.isDup && t.set.keeper === tab).length;
  if (copies === 0) return '';
  const open = state.openKeepers.has(tab.id);
  return `<button type="button" class="copies" data-copies="${tab.id}" aria-expanded="${open}" data-tip="${open ? 'Hide' : 'Show'} copies">+${copies} ${copies === 1 ? 'copy' : 'copies'}</button>`;
}

function rowHtml(tab, nested = false, list = []) {
  const suspended = tab.discarded ? '<span class="zz-pill" data-tip="Suspended: reloads when you switch to it">zz</span>' : '';
  return `<li class="row${nested ? ' nested' : ''}${tab.discarded ? ' suspended' : ''}" data-id="${tab.id}">
    <button type="button" class="row-main" data-switch="${tab.id}">
      ${favicon(tab)}
      <span class="t"><span class="title">${esc(tab.title || tab.url)}</span><span class="url">${esc(shortUrl(tab.url))}</span></span>
    </button>
    ${suspended}
    ${nested ? '' : copiesButton(tab, list)}
    ${windowLabel(tab.windowId, { interactive: true })}
    <span class="actions">
      <button type="button" class="icon-btn" data-close="${tab.id}" data-tip="Close tab" aria-label="Close tab">${icon('close')}</button>
      ${moreButton('row', `data-id="${tab.id}"`, 'More tab actions')}
    </span>
  </li>`;
}

// Duplicates sit under their keeper and show only when the keeper's "+N copies" is opened.
function groupRows(list) {
  const shown = new Set(list);
  const html = [];
  for (const tab of list) {
    if (tab.isDup && shown.has(tab.set.keeper)) continue;
    html.push(rowHtml(tab, false, list));
    if (tab.set && !tab.isDup && state.openKeepers.has(tab.id)) {
      for (const copy of list.filter(t => t.isDup && t.set.keeper === tab)) html.push(rowHtml(copy, true, list));
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
    return `<details class="group" data-key="${esc(name)}" ${open ? 'open' : ''}>
      <summary>
        <span class="chev">${icon('chevron')}</span>
        <span class="mini-stack">${distinctFavicons(members)}</span>
        <span class="g-name">${esc(name)}</span>
        <span class="g-meta">${members.length}</span>
        ${dups ? `<span class="dup-count">${dups} dup${dups === 1 ? '' : 's'}</span>` : ''}
        <span class="g-spacer"></span>
        ${dups ? `<button type="button" class="icon-btn" data-close-group-dups="${esc(name)}" data-tip="Close duplicates in group" aria-label="Close duplicates in group">${icon('closeCopies')}</button>` : ''}
        ${moreButton('group', `data-group="${esc(name)}"`, 'More group actions')}
      </summary>
      <ul class="rows">${groupRows(sortTabs(members))}</ul>
    </details>`;
  }).join('');
  return `<div class="groups">${html}</div>`;
}

// Windows view (option E): a window looks like a group and opens into its groups, which open into tabs.
// Groups with one tab are plain tab rows under "1-tab sites".
function windowGroupHtml(windowId, name, members) {
  const key = `w:${windowId}:${name}`;
  const open = state.query || state.openGroups.has(key);
  const dups = members.filter(tab => tab.isDup).length;
  return `<details class="group" data-key="${esc(key)}" ${open ? 'open' : ''}>
    <summary draggable="true" data-drag-group="${esc(name)}" data-w="${windowId}">
      <span class="chev">${icon('chevron')}</span>
      <span class="mini-stack">${distinctFavicons(members)}</span>
      <span class="g-name">${esc(name)}</span>
      <span class="g-meta">${members.length}</span>
      ${dups ? `<span class="dup-count">${dups} dup${dups === 1 ? '' : 's'}</span>` : ''}
      <span class="g-spacer"></span>
      ${moreButton('group', `data-group="${esc(name)}" data-w="${windowId}"`, 'More group actions')}
    </summary>
    <ul class="rows">${groupRows(sortTabs(members))}</ul>
  </details>`;
}

function renderWindows(list) {
  const cards = state.windows.map(windowId => {
    const members = list.filter(tab => tab.windowId === windowId);
    if (members.length === 0) return '';
    const n = state.windows.indexOf(windowId) + 1;
    const groups = groupsOf(members);
    const multi = groups.filter(([, groupTabs]) => groupTabs.length > 1);
    const singles = groups.filter(([, groupTabs]) => groupTabs.length === 1).map(([, [tab]]) => tab);
    const current = windowId === state.currentWindow;
    const minimized = state.windowInfo.get(windowId).state === 'minimized';
    const key = `w:${windowId}`;
    const open = state.query || state.openGroups.has(key);
    return `<details class="group win${current ? ' cur' : ''}" id="win-${windowId}" data-key="${key}" data-drop-w="${windowId}" ${open ? 'open' : ''}>
      <summary>
        <span class="chev">${icon('chevron')}</span>
        <span class="mini-stack">${distinctFavicons(groups.map(([, [first]]) => first))}</span>
        <span class="win-title"><span class="g-name">${esc(windowName(windowId))}</span><span class="win-stats">${windowStats(windowId)}</span></span>
        <span class="g-spacer"></span>
        <button type="button" class="icon-btn" data-minimize="${windowId}" data-tip="${minimized ? 'Restore' : 'Minimize'} this window" aria-label="${minimized ? 'Restore' : 'Minimize'} this window">${icon(minimized ? 'restore' : 'minimize')}</button>
        ${moreButton('window', `data-w="${windowId}"`, 'More window actions')}
        <span class="win-count">${current ? 'This window' : `Window ${n}`}</span>
      </summary>
      <div class="win-body">
        ${multi.map(([name, groupTabs]) => windowGroupHtml(windowId, name, groupTabs)).join('')}
        ${singles.length ? `<div class="singles-head">1-tab sites · ${singles.length}</div><ul class="rows singles">${sortTabs(singles).map(tab => rowHtml(tab, false, singles)).join('')}</ul>` : ''}
      </div>
    </details>`;
  }).join('');
  if (!cards.trim()) return '<div class="empty">No tabs match.</div>';
  return `<div class="windows">${cards}<div class="win-new" data-drop-w="new">${icon('plus')} Drop here for a new window</div></div>`;
}

function render() {
  const list = state.tabs.filter(matches);
  document.documentElement.classList.toggle('mono', state.dev);

  const closeDups = $('#close-dups');
  closeDups.textContent = `Close duplicates (${state.duplicates})`;
  closeDups.disabled = state.duplicates === 0;

  $('#results-bar').innerHTML = state.query ? `<span role="status">${plural(list.length, 'result')}</span>
    <button type="button" class="btn" id="move-results" ${list.length ? '' : 'disabled'}>Move results (${list.length}) to new window</button>
    <button type="button" class="btn danger" id="close-results" ${list.length ? '' : 'disabled'}>Close results (${list.length})</button>` : '';

  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  const scroll = body.scrollTop;
  const focused = focusKey(document.activeElement);
  body.innerHTML = state.view === 'groups' ? renderGroups(list) : renderWindows(list);
  // In the Windows view a tab row can be dragged onto another window.
  for (const row of body.querySelectorAll('.windows .row')) row.draggable = true;
  body.scrollTop = scroll;
  if (focused) [...body.querySelectorAll('button, summary')].find(el => focusKey(el) === focused)?.focus({ preventScroll: true });
  highlightSelection();
}

// Identifies a focused control by what it acts on, so focus survives a re-render.
function focusKey(element) {
  if (!element || !body.contains(element)) return null;
  const owner = element.matches('summary') ? element.parentElement.dataset.key : '';
  return `${element.tagName}|${JSON.stringify({ ...element.dataset })}|${owner}`;
}

// While a menu or dialog is open a re-render would pull the list out from under it; refresh once it closes.
let refreshTimer;
let refreshPending = false;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if ($('#menu').matches(':popover-open') || $('#confirm').open) {
      refreshPending = true;
      return;
    }
    refreshPending = false;
    if (await load()) render();
  }, 50);
}

function refreshIfPending() {
  if (refreshPending) refresh();
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

// Asks before acting on many tabs at once; verb is "Close" or "Suspend".
async function confirmMany(count, verb = 'Close') {
  if (count <= CONFIRM_ABOVE) return true;
  const dialog = $('#confirm');
  const consequence = verb === 'Close' ? 'This cannot be undone from oh-my-tabs.' : 'They reload when you switch to them.';
  $('#confirm-text').textContent = `${verb} ${count} tabs? ${consequence}`;
  $('#confirm-ok').textContent = `${verb} tabs`;
  // Esc closes without a value, which would otherwise leave the previous "ok" in place.
  dialog.returnValue = '';
  dialog.showModal();
  await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  return dialog.returnValue === 'ok';
}

// Browsers cannot suspend the active tab of a window; those and already suspended tabs are skipped.
function suspendable(ids) {
  return state.tabs.filter(tab => ids.includes(tab.id) && !tab.active && !tab.discarded).map(tab => tab.id);
}

async function suspendTabs(ids) {
  await load();
  const targets = suspendable(ids);
  if (!(await confirmMany(targets.length, 'Suspend'))) return;
  // One at a time: Chrome's tabs.discard takes a single tab.
  for (const id of targets) await browser.tabs.discard(id).catch(() => {});
  refresh();
}

// Recomputes duplicates from the current tabs first: a copy may have navigated away since the last render.
// Never asks: every keeper stays open, so no page is lost.
async function closeDuplicates(filter = () => true) {
  await load();
  const ids = state.tabs.filter(tab => tab.isDup && filter(tab)).map(tab => tab.id);
  if (ids.length > 0) await browser.tabs.remove(ids);
}

async function saveSetting(key, value) {
  state[key] = value;
  await browser.storage.local.set({ [key]: value });
}

// ---------- ⋯ menus for rows, groups and windows ----------
// One popover. An item runs an action or opens a submenu in place: → or Enter opens it, ← or Esc goes back.
const menu = $('#menu');
let menuTrigger = null;
let menuLevels = [];

function moveItems(ids) {
  const from = new Set(state.tabs.filter(tab => ids.includes(tab.id)).map(tab => tab.windowId));
  const windows = state.windows
    .filter(windowId => !(from.size === 1 && from.has(windowId)))
    .map(windowId => ({ lead: windowLabel(windowId), label: windowName(windowId), run: () => moveTabs(ids, windowId) }));
  return [...windows, ...(windows.length ? ['-'] : []), { icon: 'plus', label: 'New window', run: () => moveTabs(ids, 'new') }];
}

function suspendItem(label, ids) {
  const count = suspendable(ids).length;
  return { icon: 'suspend', label: count > 1 ? `${label} · ${count}` : label, disabled: count === 0, run: () => suspendTabs(ids) };
}

function rowMenu(tab) {
  // In the Windows view a group lives inside one window, so "other tabs in this group" stays there too.
  const windowId = state.view === 'windows' ? tab.windowId : null;
  const others = groupTabIds(tab.group, windowId).filter(id => id !== tab.id);
  return [
    { icon: 'move', label: 'Move to window', items: moveItems([tab.id]) },
    '-',
    tab.active
      ? { icon: 'suspend', label: 'Suspend this tab (it is active)', disabled: true }
      : suspendItem('Suspend this tab', [tab.id]),
    suspendItem('Suspend other tabs in this group', others),
  ];
}

function groupMenu(name, windowId) {
  const ids = groupTabIds(name, windowId);
  return [
    { icon: 'move', label: 'Move group to', items: moveItems(ids) },
    suspendItem('Suspend group', ids),
    '-',
    { icon: 'close', label: 'Close group', danger: true, run: async () => { if (await confirmMany(ids.length)) await browser.tabs.remove(ids); } },
  ];
}

function windowMenu(windowId) {
  const ids = tabsIn(windowId).map(tab => tab.id);
  return [
    { icon: 'page', label: 'Bring to front', run: async () => { await browser.windows.update(windowId, { focused: true }); if (!IS_PAGE) window.close(); } },
    { icon: 'plus', label: 'New tab', run: () => browser.tabs.create({ windowId }) },
    suspendItem('Suspend window', ids),
    '-',
    { icon: 'close', label: 'Close window', danger: true, run: async () => { if (await confirmMany(ids.length)) await browser.windows.remove(windowId); } },
  ];
}

function renderMenu() {
  const items = menuLevels.at(-1);
  const back = menuLevels.length > 1 ? `<button type="button" role="menuitem" data-back>${icon('back')}<span>Back</span></button><hr>` : '';
  menu.innerHTML = back + items.map((item, i) => {
    if (item === '-') return '<hr>';
    const lead = item.lead ?? icon(item.icon);
    const sub = item.items ? ' aria-haspopup="menu"' : '';
    const disabled = item.disabled ? ' disabled' : '';
    const hint = item.items ? '<span class="hint" aria-hidden="true">›</span>' : '';
    return `<button type="button" role="menuitem" data-i="${i}" class="${item.danger ? 'danger' : ''}"${sub}${disabled}>${lead}<span>${esc(item.label)}</span>${hint}</button>`;
  }).join('');
  menu.querySelector('button:not(:disabled)')?.focus();
}

function placeMenu() {
  const anchor = menuTrigger.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  let top = anchor.bottom + 4;
  if (top + box.height > innerHeight - 8) top = Math.max(8, anchor.top - box.height - 4);
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, anchor.right - box.width)}px`;
}

function openMenu(trigger, items) {
  menuTrigger = trigger;
  menuLevels = [items];
  menu.showPopover();
  renderMenu();
  placeMenu();
  trigger.setAttribute('aria-expanded', 'true');
}

function menuFor(trigger) {
  const kind = trigger.dataset.menu;
  if (kind === 'row') return rowMenu(state.tabs.find(tab => tab.id === Number(trigger.dataset.id)));
  if (kind === 'group') return groupMenu(trigger.dataset.group, trigger.dataset.w ? Number(trigger.dataset.w) : null);
  return windowMenu(Number(trigger.dataset.w));
}

function openSubmenu(button) {
  menuLevels.push(menuLevels.at(-1)[Number(button.dataset.i)].items);
  renderMenu();
  placeMenu();
}

function closeSubmenu() {
  menuLevels.pop();
  renderMenu();
  placeMenu();
}

menu.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.hasAttribute('data-back')) return closeSubmenu();
  const item = menuLevels.at(-1)[Number(button.dataset.i)];
  if (item.items) return openSubmenu(button);
  menu.hidePopover();
  item.run();
});

menu.addEventListener('keydown', event => {
  const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
  const current = buttons.indexOf(document.activeElement);
  const moves = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: buttons.length - 1 };
  if (event.key in moves) {
    event.preventDefault();
    buttons[(moves[event.key] + buttons.length) % buttons.length].focus();
    return;
  }
  if (event.key === 'ArrowRight' && document.activeElement.hasAttribute('aria-haspopup')) {
    event.preventDefault();
    openSubmenu(document.activeElement);
    return;
  }
  // In a submenu ← and Esc go back one level instead of closing the menu.
  if ((event.key === 'ArrowLeft' || event.key === 'Escape') && menuLevels.length > 1) {
    event.preventDefault();
    event.stopPropagation();
    closeSubmenu();
  }
});

menu.addEventListener('toggle', event => {
  if (event.newState !== 'closed' || !menuTrigger) return;
  menuTrigger.setAttribute('aria-expanded', 'false');
  if (menu.contains(document.activeElement) || document.activeElement === document.body) menuTrigger.focus({ focusVisible: false });
  menuTrigger = null;
  refreshIfPending();
});
$('#confirm').addEventListener('close', refreshIfPending);

// ---------- list events ----------
// Window actions in the Windows view, and the window glyph that leads there.
async function handleWindowClick(target, event) {
  const show = target.closest('[data-show-window]');
  if (show) {
    await saveSetting('view', 'windows');
    state.openGroups.add(`w:${show.dataset.showWindow}`);
    render();
    const card = document.getElementById(`win-${show.dataset.showWindow}`);
    card?.scrollIntoView({ block: 'start' });
    card?.querySelector('summary').focus();
    return true;
  }
  const minimize = target.closest('[data-minimize]');
  if (minimize) {
    event.preventDefault();
    const windowId = Number(minimize.dataset.minimize);
    // Focusing a minimized window restores it to its previous state.
    if (state.windowInfo.get(windowId).state === 'minimized') await browser.windows.update(windowId, { focused: true });
    else await browser.windows.update(windowId, { state: 'minimized' });
    refresh();
    return true;
  }
  return false;
}

body.addEventListener('click', async event => {
  const target = event.target;
  if (await handleWindowClick(target, event)) return;
  const more = target.closest('[data-menu]');
  if (more) {
    // Inside a <summary> the button must not also toggle the group.
    event.preventDefault();
    openMenu(more, menuFor(more));
    return;
  }
  const closeGroupDups = target.closest('[data-close-group-dups]');
  if (closeGroupDups) {
    event.preventDefault();
    const name = closeGroupDups.dataset.closeGroupDups;
    closeDuplicates(tab => tab.group === name && matches(tab));
    return;
  }
  const close = target.closest('[data-close]');
  if (close) {
    browser.tabs.remove(Number(close.dataset.close));
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
  const row = target.closest('.row');
  if (row) switchTo(Number(row.dataset.id));
});

body.addEventListener('toggle', event => {
  const details = event.target;
  if (state.query || !details.matches('details[data-key]')) return;
  if (details.open) state.openGroups.add(details.dataset.key);
  else state.openGroups.delete(details.dataset.key);
}, true);

// ---------- search ----------
search.addEventListener('input', () => {
  state.query = search.value.trim();
  state.selected = state.query ? 0 : -1;
  render();
});
// Rows inside collapsed groups are in the DOM but not on screen.
function visibleRows() {
  return [...body.querySelectorAll('.row')].filter(row => row.checkVisibility());
}

search.addEventListener('keydown', event => {
  const rows = visibleRows();
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
  body.querySelector('.row.sel')?.classList.remove('sel');
  const rows = visibleRows();
  rows.forEach((row, i) => row.classList.toggle('sel', i === state.selected));
  rows[state.selected]?.scrollIntoView({ block: 'nearest' });
}

$('#results-bar').addEventListener('click', async event => {
  const ids = state.tabs.filter(matches).map(tab => tab.id);
  if (event.target.id === 'move-results') await moveTabs(ids, 'new');
  if (event.target.id === 'close-results' && await confirmMany(ids.length)) await browser.tabs.remove(ids);
});

$('#close-dups').addEventListener('click', () => closeDuplicates());

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
// Everything except each window's active tab, which browsers cannot suspend.
$('#suspend-others').addEventListener('click', async () => {
  $('#settings').hidePopover();
  await suspendTabs(state.tabs.map(tab => tab.id));
});
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

// ---------- drag and drop between windows ----------
// A type of our own, so text or links dropped from a page are never read as tab ids.
const DRAG_TYPE = 'application/x-oh-my-tabs';
body.addEventListener('dragstart', event => {
  const row = event.target.closest('.row');
  const group = event.target.closest('[data-drag-group]');
  let ids = [];
  if (row) ids = [Number(row.dataset.id)];
  else if (group) ids = groupTabIds(group.dataset.dragGroup, Number(group.dataset.w));
  event.dataTransfer.setData(DRAG_TYPE, ids.join(','));
  event.dataTransfer.effectAllowed = 'move';
});
body.addEventListener('dragover', event => {
  const win = event.target.closest('[data-drop-w]');
  if (!win || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
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
  const ids = event.dataTransfer.getData(DRAG_TYPE).split(',').filter(Boolean).map(Number);
  if (ids.length === 0 || ids.some(Number.isNaN)) return;
  moveTabs(ids, win.dataset.dropW === 'new' ? 'new' : Number(win.dataset.dropW));
});

// ---------- tooltips ----------
// Our own instead of title attributes, whose native tooltip shows only after about a second.
// The first one waits a moment; while moving from one to the next they show at once.
const tip = $('#tip');
const TIP_DELAY = 150;
const TIP_WARM = 400;
let tipFor = null;
let tipTimer;
let tipWarmUntil = 0;

function placeTip(target) {
  const anchor = target.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  let top = anchor.bottom + 6;
  if (top + box.height > innerHeight - 4) top = anchor.top - box.height - 6;
  const left = Math.min(Math.max(4, anchor.left + anchor.width / 2 - box.width / 2), innerWidth - box.width - 4);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipFor?.removeAttribute('aria-describedby');
  tipFor = null;
  if (!tip.matches(':popover-open')) return;
  tip.hidePopover();
  tipWarmUntil = Date.now() + TIP_WARM;
}

function tipTo(target) {
  if (target === tipFor) return;
  hideTip();
  if (!target) return;
  tipFor = target;
  const delay = Date.now() < tipWarmUntil ? 0 : TIP_DELAY;
  tipTimer = setTimeout(() => {
    if (!target.isConnected) return;
    tip.textContent = target.dataset.tip;
    target.setAttribute('aria-describedby', 'tip');
    tip.showPopover();
    placeTip(target);
  }, delay);
}

document.addEventListener('pointerover', event => tipTo(event.target.closest('[data-tip]')));
document.documentElement.addEventListener('pointerleave', hideTip);
document.addEventListener('focusin', event => {
  const target = event.target.closest('[data-tip]');
  if (target?.matches(':focus-visible')) tipTo(target);
});
document.addEventListener('focusout', hideTip);
for (const type of ['pointerdown', 'keydown', 'scroll', 'wheel']) document.addEventListener(type, hideTip, true);

// ---------- start ----------
for (const event of ['onCreated', 'onRemoved', 'onMoved', 'onAttached', 'onDetached', 'onReplaced', 'onActivated']) {
  browser.tabs[event].addListener(refresh);
}
// Only changes the list shows; loading progress and the like would re-render for nothing.
const SHOWN_CHANGES = ['url', 'title', 'favIconUrl', 'discarded', 'pinned'];
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (SHOWN_CHANGES.some(key => key in changeInfo)) refresh();
});
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
  state.openGroups.add(`w:${state.currentWindow}`);
  render();
  search.focus();
  renderShortcuts();
}

start();
