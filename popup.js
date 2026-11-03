import { groupChain, rollUp, findDuplicates, isWeb, duplicateKey, staleTabs, isNeverListed, neverEntry } from './rules.js';
import * as Library from './library.js';

globalThis.browser ??= chrome;

const SETTINGS = { dev: true, sort: 'recent', view: 'groups', stale: true, staleDays: 7, never: [] };
const DAY = 24 * 60 * 60 * 1000;
const IS_PAGE = new URLSearchParams(location.search).has('page');
const IS_FIREFOX = typeof browser.runtime.getBrowserInfo === 'function';
const CONFIRM_ABOVE = 10;

const state = {
  ...SETTINGS,
  query: '', selected: -1,
  tabs: [], windows: [], windowInfo: new Map(), windowNames: new Map(), currentWindow: null, ownTabId: null, duplicates: 0,
  openGroups: new Set(), openKeepers: new Set(),
  // Library: on while the bookmarks permission is granted; saved tabs and topics come from library.js.
  libraryOn: false, saved: [], topics: [], savedKeys: new Set(), topic: 'All',
  // Page only: the sidebar's choice within the view (a group name, a window id, a topic or '' for no topic),
  // the checked tab ids for the bulk bar, and the stale tab ids of the last render.
  pageItem: null, checked: new Set(), staleShown: new Set(),
};

const $ = selector => document.querySelector(selector);
const body = $('#body');
const search = $('#search');
const side = $('#side');

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
  save: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M12 7v6M9 10h6"/>',
  saved: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  open: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  newWindow: '<rect width="18" height="16" x="3" y="4" rx="2"/><path d="M3 9h18"/><path d="M12 12v5M9.5 14.5h5"/>',
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
  if (state.libraryOn) {
    const library = await Library.load().catch(() => ({ items: [], topics: [] }));
    if (token !== loadToken) return false;
    state.saved = library.items;
    state.topics = library.topics;
  }
  analyze();
  return true;
}

// Lone tabs roll up to their owner or site (rules.js rollUp), so five single repos of one org share a group.
function groupsFor(items) {
  return rollUp(items, item => groupChain(item.url, state.dev));
}

function analyze() {
  const groups = groupsFor(state.tabs);
  for (const tab of state.tabs) {
    tab.group = groups.get(tab);
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
  const savedGroups = groupsFor(state.saved);
  for (const item of state.saved) item.group = savedGroups.get(item);
  state.savedKeys = new Set(state.saved.map(item => duplicateKey(item.url, state.dev)).filter(Boolean));
  const open = new Set(state.tabs.map(tab => tab.id));
  for (const id of state.checked) {
    if (!open.has(id)) state.checked.delete(id);
  }
}

function isSaved(tab) {
  return state.savedKeys.has(duplicateKey(tab.url, state.dev));
}

function savedMatches(item) {
  if (state.topic !== 'All' && item.topic !== state.topic) return false;
  // A topic picked in the page's sidebar; '' is "No topic".
  if (IS_PAGE && state.view === 'library' && state.pageItem !== null && (item.topic ?? '') !== state.pageItem) return false;
  if (!state.query) return true;
  const query = fold(state.query);
  return [item.title, item.url, item.group, item.topic].some(text => fold(text ?? '').includes(query));
}

function staleIds() {
  return staleTabs(state.tabs, Date.now(), state.staleDays, state.never).map(tab => tab.id);
}

// On the page the sidebar narrows the list to one group or window, or to the stale tabs.
function inPageSelection(tab) {
  if (!IS_PAGE) return true;
  if (state.view === 'stale') return state.staleShown.has(tab.id);
  if (state.pageItem === null) return true;
  if (state.view === 'groups') return tab.group === state.pageItem;
  if (state.view === 'windows') return String(tab.windowId) === state.pageItem;
  return true;
}

// Group actions, results and the bulk bar all go through here, so they act on exactly what the list shows.
function matches(tab) {
  if (!inPageSelection(tab)) return false;
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

// A suspended tab says so on its favicon: a small zZz in the corner.
function rowFavicon(tab) {
  if (!tab.discarded) return favicon(tab);
  return `<span class="fav-wrap" data-tip="Suspended: reloads when you switch to it">${favicon(tab)}<span class="zzz" aria-hidden="true">zZz</span></span>`;
}

// Save & close; filled when the page is already in the library, so the tab is safe to close.
function saveButton(tab) {
  if (!state.libraryOn || !isWeb(tab.url)) return '';
  const saved = isSaved(tab);
  const label = saved ? 'Already saved: close it, it stays in your Library' : 'Save & close';
  return `<button type="button" class="icon-btn${saved ? ' saved' : ''}" data-save="${tab.id}" data-tip="${label}" aria-label="${label}">${icon(saved ? 'saved' : 'save')}</button>`;
}

// One click to give a group a window of its own (the ⋯ menu has the same as "Move group to › New window").
function groupNewWindowButton(name, windowId = null) {
  const w = windowId === null ? '' : ` data-w="${windowId}"`;
  return `<button type="button" class="icon-btn" data-group-new-window="${esc(name)}"${w} data-tip="Move group to a new window" aria-label="Move group to a new window">${icon('newWindow')}</button>`;
}

function groupSaveButton(name, windowId = null) {
  if (!state.libraryOn) return '';
  const w = windowId === null ? '' : ` data-w="${windowId}"`;
  return `<button type="button" class="icon-btn" data-save-group="${esc(name)}"${w} data-tip="Save & close group" aria-label="Save & close group">${icon('save')}</button>`;
}

// Page only: checkboxes for the bulk bar, on tab rows and on group headers (all its shown tabs).
function pickBox(tab) {
  if (!IS_PAGE) return '';
  const checked = state.checked.has(tab.id) ? ' checked' : '';
  return `<input type="checkbox" class="pick" data-pick="${tab.id}" aria-label="Select ${esc(tab.title || tab.url)}"${checked}>`;
}

function groupPickBox(name, windowId = null) {
  if (!IS_PAGE) return '';
  const ids = groupTabIds(name, windowId);
  const picked = ids.filter(id => state.checked.has(id)).length;
  const w = windowId === null ? '' : ` data-w="${windowId}"`;
  const checked = picked > 0 && picked === ids.length ? ' checked' : '';
  // render() turns the partial class into the indeterminate state, which has no HTML attribute.
  // A class, not a data-* attribute: focusKey reads the dataset, and focus must survive the change.
  const partial = picked > 0 && picked < ids.length ? ' partial' : '';
  return `<input type="checkbox" class="pick${partial}" data-pick-group="${esc(name)}"${w} aria-label="Select all tabs in ${esc(name)}"${checked}>`;
}

function rowHtml(tab, nested = false, list = []) {
  const age = Date.now() - tab.lastAccessed > DAY ? `<span class="age">used ${ago(tab.lastAccessed)}</span>` : '';
  return `<li class="row${nested ? ' nested' : ''}${tab.discarded ? ' suspended' : ''}" data-id="${tab.id}">
    ${pickBox(tab)}
    <button type="button" class="row-main" data-switch="${tab.id}">
      ${rowFavicon(tab)}
      <span class="t"><span class="title">${esc(tab.title || tab.url)}</span><span class="url">${esc(shortUrl(tab.url))}</span></span>
    </button>
    ${age}
    ${nested ? '' : copiesButton(tab, list)}
    ${windowLabel(tab.windowId, { interactive: true })}
    <span class="actions">
      ${saveButton(tab)}
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

// A group with one tab is one click too many: such tabs are listed as plain rows under "1-tab sites".
function splitSingles(groups) {
  return {
    multi: groups.filter(([, members]) => members.length > 1),
    singles: groups.filter(([, members]) => members.length === 1).map(([, [only]]) => only),
  };
}

function singlesHtml(singles, row) {
  if (singles.length === 0) return '';
  return `<div class="singles-head">1-tab sites · ${singles.length}</div><ul class="rows singles">${singles.map(row).join('')}</ul>`;
}

function renderGroups(list) {
  const groups = groupsOf(list);
  if (groups.length === 0) return '<div class="empty">No tabs match.</div>';
  const { multi, singles } = splitSingles(groups);
  const html = multi.map(([name, members]) => {
    const open = state.query || state.openGroups.has(name);
    const dups = members.filter(tab => tab.isDup).length;
    // On the page a group header drags onto a window or a topic in the sidebar.
    const drag = IS_PAGE ? ` draggable="true" data-drag-group="${esc(name)}"` : '';
    return `<details class="group" data-key="${esc(name)}" ${open ? 'open' : ''}>
      <summary${drag}>
        <span class="chev">${icon('chevron')}</span>
        ${groupPickBox(name)}
        <span class="mini-stack">${distinctFavicons(members)}</span>
        <span class="g-name">${esc(name)}</span>
        <span class="g-meta">${members.length}</span>
        ${dups ? `<span class="dup-count">${dups} dup${dups === 1 ? '' : 's'}</span>` : ''}
        <span class="g-spacer"></span>
        ${dups ? `<button type="button" class="icon-btn" data-close-group-dups="${esc(name)}" data-tip="Close duplicates in group" aria-label="Close duplicates in group">${icon('closeCopies')}</button>` : ''}
        ${groupNewWindowButton(name)}
        ${groupSaveButton(name)}
        ${moreButton('group', `data-group="${esc(name)}"`, 'More group actions')}
      </summary>
      <ul class="rows">${groupRows(sortTabs(members))}</ul>
    </details>`;
  }).join('');
  const rows = singlesHtml(sortTabs(singles), tab => rowHtml(tab, false, singles));
  // On the page the stale tabs have a sidebar section of their own.
  const stale = state.query || IS_PAGE ? '' : staleGroupHtml();
  return `<div class="groups">${stale}${html}${rows}</div>`;
}

// Open, unpinned tabs not used for a while, oldest first, in a group of their own (collapsed by default).
function staleGroupHtml(list = state.tabs, { open = state.openGroups.has('stale') } = {}) {
  if (!state.stale) return '';
  const stale = staleTabs(list, Date.now(), state.staleDays, state.never).sort((a, b) => a.lastAccessed - b.lastAccessed);
  if (stale.length === 0) return '';
  const save = state.libraryOn ? `<button type="button" class="icon-btn" data-save-stale data-tip="Save & close all" aria-label="Save & close all stale tabs">${icon('save')}</button>` : '';
  return `<details class="group stale" data-key="stale" ${open ? 'open' : ''}>
    <summary>
      <span class="chev">${icon('chevron')}</span>
      <span class="stale-icon">${icon('clock')}</span>
      <span class="g-name">Not used for ${state.staleDays}+ days</span>
      <span class="g-meta">${stale.length}</span>
      <span class="g-spacer"></span>
      ${save}
      ${moreButton('stale', '', 'More stale tab actions')}
    </summary>
    <ul class="rows">${stale.map(tab => rowHtml(tab)).join('')}</ul>
  </details>`;
}

// Library view: saved tabs by topic chip and by the usual groups, newest first.
function savedRowHtml(item) {
  return `<li class="row" data-saved="${esc(item.id)}">
    <button type="button" class="row-main" data-open-saved="${esc(item.id)}">
      ${favicon(item)}
      <span class="t"><span class="title">${esc(item.title || item.url)}</span><span class="url">${esc(shortUrl(item.url))}</span></span>
    </button>
    ${item.topic ? `<span class="topic-pill">${esc(item.topic)}</span>` : ''}
    <span class="age">saved ${ago(item.dateAdded)}</span>
    <span class="actions">
      <button type="button" class="icon-btn" data-open-saved-bg="${esc(item.id)}" data-tip="Open in the background" aria-label="Open in the background">${icon('open')}</button>
      <button type="button" class="icon-btn" data-remove-saved="${esc(item.id)}" data-tip="Remove from library" aria-label="Remove from library">${icon('close')}</button>
      ${moreButton('saved', `data-id="${esc(item.id)}"`, 'More saved tab actions')}
    </span>
  </li>`;
}

function renderLibrary(list) {
  const count = topic => state.saved.filter(item => topic === 'All' || item.topic === topic).length;
  const chips = ['All', ...state.topics.map(topic => topic.title)]
    .map(topic => `<button type="button" class="chip" data-topic="${esc(topic)}" aria-pressed="${topic === state.topic}">${esc(topic)} · ${count(topic)}</button>`)
    .join('');
  const filters = `<div class="filters">${chips}<button type="button" class="chip add" data-new-topic>${icon('plus')} New topic</button></div>`;
  if (state.saved.length === 0) {
    return `${filters}<div class="empty">Nothing saved yet. Use the bookmark icon on a tab, a group or the stale tabs to save them and close them.</div>`;
  }
  const groups = groupsOf(list);
  if (groups.length === 0) return `${filters}<div class="empty">No saved tabs match.</div>`;
  const { multi, singles } = splitSingles(groups);
  const html = multi.map(([name, members]) => {
    const key = `lib:${name}`;
    const open = state.query || state.topic !== 'All' || state.openGroups.has(key);
    members.sort((a, b) => b.dateAdded - a.dateAdded);
    return `<details class="group" data-key="${esc(key)}" ${open ? 'open' : ''}>
      <summary>
        <span class="chev">${icon('chevron')}</span>
        <span class="mini-stack">${distinctFavicons(members)}</span>
        <span class="g-name">${esc(name)}</span>
        <span class="g-meta">${members.length}</span>
        <span class="g-spacer"></span>
        <button type="button" class="icon-btn" data-open-saved-group="${esc(name)}" data-tip="Open all" aria-label="Open all saved tabs in this group">${icon('open')}</button>
        ${moreButton('saved-group', `data-group="${esc(name)}"`, 'More library group actions')}
      </summary>
      <ul class="rows">${members.map(savedRowHtml).join('')}</ul>
    </details>`;
  }).join('');
  const rows = singlesHtml(singles.sort((a, b) => b.dateAdded - a.dateAdded), savedRowHtml);
  return `${filters}<div class="groups">${html}${rows}</div>`;
}

// The page shows the Library as a board: "No topic" first, then a column per topic. A card dragged to another
// column moves to that topic. A topic picked in the sidebar shows only its column.
function renderBoard(list) {
  const columns = [['', 'No topic'], ...state.topics.map(topic => [topic.title, topic.title])]
    .filter(([key]) => state.pageItem === null || state.pageItem === key)
    .map(([key, label]) => {
      const cards = list.filter(item => (item.topic ?? '') === key).sort((a, b) => b.dateAdded - a.dateAdded);
      const empty = `<li class="col-empty">${state.query ? 'No saved tabs match.' : 'Drop saved tabs here'}</li>`;
      return `<section class="col" data-drop-topic="${esc(key)}" aria-label="${esc(label)}">
        <header class="col-head"><span class="g-name">${esc(label)}</span><span class="g-meta">${cards.length}</span></header>
        <ul class="rows col-body">${cards.map(savedRowHtml).join('') || empty}</ul>
      </section>`;
    }).join('');
  const add = state.pageItem === null ? `<button type="button" class="col col-new" data-new-topic>${icon('plus')} New topic</button>` : '';
  return `<div class="board">${columns}${add}</div>`;
}

// Page only: the stale group on its own, open.
function renderStale(list) {
  return `<div class="groups">${staleGroupHtml(list, { open: true }) || '<div class="empty">No stale tabs match.</div>'}</div>`;
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
      ${groupPickBox(name, windowId)}
      <span class="mini-stack">${distinctFavicons(members)}</span>
      <span class="g-name">${esc(name)}</span>
      <span class="g-meta">${members.length}</span>
      ${dups ? `<span class="dup-count">${dups} dup${dups === 1 ? '' : 's'}</span>` : ''}
      <span class="g-spacer"></span>
      ${groupNewWindowButton(name, windowId)}
      ${groupSaveButton(name, windowId)}
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
    const { multi, singles } = splitSingles(groups);
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
        ${singlesHtml(sortTabs(singles), tab => rowHtml(tab, false, singles))}
      </div>
    </details>`;
  }).join('');
  if (!cards.trim()) return '<div class="empty">No tabs match.</div>';
  return `<div class="windows">${cards}<div class="win-new" data-drop-w="new">${icon('plus')} Drop here for a new window</div></div>`;
}

// Back to Groups when the view in use went away; on the page through setPage, so the hash follows.
function leaveView() {
  if (IS_PAGE) setPage('groups', null);
  else state.view = 'groups';
}

function render() {
  if (state.view === 'library' && !state.libraryOn) leaveView();
  if (state.view === 'stale' && !state.stale) leaveView();
  if (IS_PAGE) {
    state.staleShown = new Set(state.stale ? staleIds() : []);
    // The last stale tab was closed or used: its sidebar entry is gone too.
    if (state.view === 'stale' && state.staleShown.size === 0) leaveView();
    if (!pageItemExists()) setPage(state.view, null);
  }
  const inLibrary = state.view === 'library';
  const list = inLibrary ? state.saved.filter(savedMatches) : state.tabs.filter(matches);
  document.documentElement.classList.toggle('mono', state.dev);
  $('[data-view="library"]').hidden = !state.libraryOn;
  search.placeholder = inLibrary ? 'Search saved tabs…' : 'Search tabs, URLs, groups…';

  const closeDups = $('#close-dups');
  closeDups.textContent = `Close duplicates (${state.duplicates})`;
  closeDups.disabled = state.duplicates === 0;
  // Duplicates are about open tabs; the Library view has none.
  closeDups.hidden = inLibrary;

  const none = list.length ? '' : 'disabled';
  const actions = inLibrary
    ? `<button type="button" class="btn" id="open-results" ${none}>Open results (${list.length})</button>`
    : `${state.libraryOn ? `<button type="button" class="btn" id="save-results" ${none}>Save &amp; close results (${list.length})</button>` : ''}
      <button type="button" class="btn" id="move-results" ${none}>Move results (${list.length}) to new window</button>
      <button type="button" class="btn danger" id="close-results" ${none}>Close results (${list.length})</button>`;
  $('#results-bar').innerHTML = state.query ? `<span role="status">${plural(list.length, 'result')}</span>${actions}` : '';

  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  const scroll = body.scrollTop;
  const focused = focusKey(document.activeElement);
  const views = { groups: renderGroups, windows: renderWindows, library: IS_PAGE ? renderBoard : renderLibrary, stale: renderStale };
  body.innerHTML = views[state.view](list);
  // In the Windows view a tab row can be dragged onto another window; on the page every row can be dragged,
  // onto a window or a topic in the sidebar, and a saved card onto another topic.
  for (const row of body.querySelectorAll(IS_PAGE ? '.row' : '.windows .row')) row.draggable = true;
  for (const box of body.querySelectorAll('.pick.partial')) box.indeterminate = true;
  body.scrollTop = scroll;
  if (focused) [...body.querySelectorAll('button, summary, input')].find(el => focusKey(el) === focused)?.focus({ preventScroll: true });
  highlightSelection();
  if (IS_PAGE) {
    renderSidebar();
    renderBulkBar();
  }
}

// ---------- the page: sidebar, hash and bulk bar ----------
const PAGE_VIEWS = ['groups', 'windows', 'library', 'stale'];

// The page's selection lives in the hash, so a reload keeps it: #groups, #windows/12, #library/Read%20later.
// "No topic" is the empty item: #library/.
function setPage(view, item) {
  state.view = view;
  state.pageItem = item;
  if (item !== null && view === 'groups') state.openGroups.add(item);
  if (item !== null && view === 'windows') state.openGroups.add(`w:${item}`);
  const hash = item === null ? view : `${view}/${encodeURIComponent(item)}`;
  history.replaceState(null, '', `#${hash}`);
}

function readHash() {
  const [view, item] = location.hash.slice(1).split('/');
  if (!PAGE_VIEWS.includes(view)) return;
  let decoded = null;
  try {
    if (item !== undefined) decoded = decodeURIComponent(item);
  } catch {
    // A hand-edited or cut-off hash such as #groups/%E0: show the whole view.
  }
  setPage(view, decoded);
}

function selectPage(view, item) {
  setPage(view, item);
  body.scrollTop = 0;
  render();
}

// A group, window or topic picked earlier can be gone since (closed, emptied, a stale link).
function pageItemExists() {
  const item = state.pageItem;
  if (item === null) return true;
  if (state.view === 'groups') return state.tabs.some(tab => tab.group === item);
  if (state.view === 'windows') return state.windows.some(windowId => String(windowId) === item);
  if (state.view === 'library') return item === '' || state.topics.some(topic => topic.title === item);
  return false;
}

// item null is the section heading, which shows the whole view. drop: the attribute that makes it a drop target.
function sideButton(view, item, label, count, { lead = '', drop = '', tip = '' } = {}) {
  const current = state.view === view && state.pageItem === item;
  const cls = item === null ? 'side-head' : 'side-item';
  const data = item === null ? '' : ` data-item="${esc(item)}"`;
  const tipAttr = tip ? ` data-tip="${esc(tip)}"` : '';
  return `<button type="button" class="${cls}" data-section="${view}"${data}${drop}${tipAttr} aria-current="${current}">${lead}<span class="nm">${esc(label)}</span><span class="n">${count}</span></button>`;
}

function renderSidebar() {
  const focused = side.contains(document.activeElement) ? document.activeElement.dataset : null;
  const groups = groupsOf(state.tabs);
  const parts = [
    sideButton('groups', null, 'Groups', groups.length),
    ...groups.map(([name, members]) => sideButton('groups', name, name, members.length, { lead: favicon(members[0]) })),
    sideButton('windows', null, 'Windows', state.windows.length),
    ...state.windows.map(windowId => sideButton('windows', String(windowId), windowName(windowId), tabsIn(windowId).length,
      { lead: windowLabel(windowId), drop: ` data-drop-w="${windowId}"` })),
  ];
  if (state.libraryOn) {
    const topicIcon = `<span class="topic-icon">${icon('save')}</span>`;
    const topics = [['', 'No topic'], ...state.topics.map(topic => [topic.title, topic.title])];
    parts.push(
      sideButton('library', null, 'Library', state.saved.length),
      ...topics.map(([key, label]) => sideButton('library', key, label, state.saved.filter(item => (item.topic ?? '') === key).length,
        { lead: topicIcon, drop: ` data-drop-topic="${esc(key)}"` })),
    );
  }
  if (state.staleShown.size > 0) {
    parts.push(sideButton('stale', null, 'Stale', state.staleShown.size, { tip: `Not used for ${state.staleDays}+ days` }));
  }
  side.innerHTML = parts.join('');
  if (!focused) return;
  const same = [...side.querySelectorAll('button')].find(el => el.dataset.section === focused.section && el.dataset.item === focused.item);
  same?.focus({ preventScroll: true });
}

// Checked tabs the list shows: a check hidden by the sidebar or the search stays, but is not acted on.
function checkedShown() {
  return state.tabs.filter(tab => state.checked.has(tab.id) && matches(tab)).map(tab => tab.id);
}

function renderBulkBar() {
  const count = checkedShown().length;
  $('#bulk-bar').hidden = count === 0 || state.view === 'library';
  // Only on a change: the count is a live region, and render() runs on every tab event.
  const text = `${count} selected`;
  if ($('#bulk-count').textContent !== text) $('#bulk-count').textContent = text;
  $('[data-bulk="save"]').hidden = !state.libraryOn;
}

function togglePick(box) {
  let ids = [Number(box.dataset.pick)];
  if (box.dataset.pickGroup !== undefined) ids = groupTabIds(box.dataset.pickGroup, box.dataset.w ? Number(box.dataset.w) : null);
  const all = ids.every(id => state.checked.has(id));
  for (const id of ids) {
    if (all) state.checked.delete(id);
    else state.checked.add(id);
  }
  render();
}

// The bar hides with the selection; focus that was on it goes to the search box instead of the page.
function clearPicks() {
  state.checked.clear();
  render();
  if (document.activeElement === document.body || $('#bulk-bar').contains(document.activeElement)) search.focus();
}

// Each action clears the selection once it ran; a cancelled confirmation keeps it.
// One at a time: a double click must not save or close the same tabs twice.
let bulkBusy = false;
async function bulkAction(button) {
  const ids = checkedShown();
  const action = button.dataset.bulk;
  if (action === 'clear') return clearPicks();
  if (action === 'move') {
    const items = moveItems(ids).map(item => item === '-' ? item : { ...item, run: async () => { await item.run(); clearPicks(); } });
    return openMenu(button, items);
  }
  if (bulkBusy) return;
  bulkBusy = true;
  try {
    let done = false;
    if (action === 'save') done = await saveTabs(ids);
    if (action === 'suspend') done = await suspendTabs(ids);
    if (action === 'close' && await confirmMany(ids.length)) {
      await closeWithUndo(ids);
      done = true;
    }
    if (done) clearPicks();
  } finally {
    bulkBusy = false;
  }
}

$('#bulk-bar').addEventListener('click', event => {
  const button = event.target.closest('[data-bulk]');
  if (button) bulkAction(button);
});

side.addEventListener('click', event => {
  const button = event.target.closest('[data-section]');
  if (!button) return;
  selectPage(button.dataset.section, button.dataset.item ?? null);
});

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
    if ($('#menu').matches(':popover-open') || $('#confirm').open || $('#topic-dialog').open) {
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

const CONSEQUENCES = {
  'Close': 'This cannot be undone from oh-my-tabs.',
  'Suspend': 'They reload when you switch to them.',
  'Save & close': 'They stay in your Library.',
  'Save': 'They go to your Library and stay open.',
  'Open': 'Each opens in a new tab.',
  'Remove': 'They are removed from your Library.',
};

// Asks before acting on many tabs at once.
async function confirmMany(count, verb = 'Close') {
  if (count <= CONFIRM_ABOVE) return true;
  const dialog = $('#confirm');
  const consequence = CONSEQUENCES[verb];
  $('#confirm-text').textContent = `${verb} ${count} tabs? ${consequence}`;
  $('#confirm-ok').textContent = `${verb} tabs`;
  // Esc closes without a value, which would otherwise leave the previous "ok" in place.
  dialog.returnValue = '';
  dialog.showModal();
  await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  return dialog.returnValue === 'ok';
}

// Browsers cannot suspend the active tab of a window; those and already suspended tabs are skipped.
// In bulk, tabs playing sound and never-listed sites are kept awake too; "Suspend this tab" still works on them.
function suspendable(ids, { bulk = true } = {}) {
  return state.tabs
    .filter(tab => ids.includes(tab.id) && !tab.active && !tab.discarded)
    .filter(tab => !bulk || (!tab.audible && !isNeverListed(tab.url, state.never)))
    .map(tab => tab.id);
}

// Returns false when the confirmation was cancelled.
async function suspendTabs(ids, { bulk = true } = {}) {
  await load();
  const targets = suspendable(ids, { bulk });
  if (!(await confirmMany(targets.length, 'Suspend'))) return false;
  // One at a time: Chrome's tabs.discard takes a single tab.
  for (const id of targets) await browser.tabs.discard(id).catch(() => {});
  refresh();
  return true;
}

// Recomputes duplicates from the current tabs first: a copy may have navigated away since the last render.
// Never asks: every keeper stays open, so no page is lost.
async function closeDuplicates(filter = () => true) {
  await load();
  const ids = state.tabs.filter(tab => tab.isDup && filter(tab)).map(tab => tab.id);
  if (ids.length > 0) await browser.tabs.remove(ids);
}

// Saves web tabs to the library and, with close, closes the ones it saved. Asks above 10.
// Returns false when there was nothing to save or the confirmation was cancelled.
async function saveTabs(ids, { close = true, topic = null } = {}) {
  const tabs = state.tabs.filter(tab => ids.includes(tab.id) && isWeb(tab.url));
  if (tabs.length === 0) return false;
  if (!(await confirmMany(tabs.length, close ? 'Save & close' : 'Save'))) return false;
  await Library.save(tabs, state.dev, topic);
  if (close) await closeWithUndo(tabs.map(tab => tab.id));
  refresh();
  return true;
}

// Opening a saved tab that is already open switches to it, so the Library never makes duplicates.
async function openSaved(item, { active }) {
  const key = duplicateKey(item.url, state.dev);
  const open = state.tabs.find(tab => duplicateKey(tab.url, state.dev) === key);
  if (open && active) return switchTo(open.id);
  if (open) return;
  await browser.tabs.create({ url: item.url, active, windowId: state.currentWindow });
  if (active && !IS_PAGE) window.close();
}

async function openSavedMany(items) {
  if (!(await confirmMany(items.length, 'Open'))) return;
  for (const item of items) await openSaved(item, { active: false });
}

async function removeSaved(ids) {
  if (!(await confirmMany(ids.length, 'Remove'))) return;
  await Library.remove(ids);
  refresh();
}

async function moveSaved(ids, topic) {
  await Library.moveToTopic(ids, topic);
  refresh();
}

// Returns the new topic's name, or null when cancelled.
async function askTopic() {
  const dialog = $('#topic-dialog');
  const input = $('#topic-name');
  input.value = '';
  dialog.returnValue = '';
  dialog.showModal();
  await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  const name = input.value.trim();
  return dialog.returnValue === 'ok' && name ? name : null;
}

function savedById(id) {
  return state.saved.find(item => item.id === id);
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

function suspendItem(label, ids, { bulk = true } = {}) {
  const count = suspendable(ids, { bulk }).length;
  return { icon: 'suspend', label: count > 1 ? `${label} · ${count}` : label, disabled: count === 0, run: () => suspendTabs(ids, { bulk }) };
}

// Adds the tab's site to the never list, or takes off every entry that covers it.
function neverItem(tab) {
  if (!isWeb(tab.url)) return null;
  if (isNeverListed(tab.url, state.never)) {
    const keep = state.never.filter(entry => !isNeverListed(tab.url, [entry]));
    return { icon: 'clock', label: 'Allow stale and suspend for this site', run: () => saveNever(keep) };
  }
  return { icon: 'clock', label: 'Never stale or suspend this site', run: () => saveNever([...state.never, neverEntry(tab.url)]) };
}

async function saveNever(entries) {
  const clean = [...new Set(entries.map(neverEntry).filter(Boolean))];
  await saveSetting('never', clean);
  $('#s-never').value = clean.join('\n');
  render();
}

// Strips separators left at the start or end, or doubled, when optional items are missing.
function tidy(items) {
  return items.filter((item, i) => item !== '-' || (i > 0 && i < items.length - 1 && items[i - 1] !== '-'));
}

function topicItems(run) {
  return tidy([
    ...state.topics.map(topic => ({ icon: 'save', label: topic.title, run: () => run(topic.title) })),
    '-',
    { icon: 'plus', label: 'New topic…', run: async () => { const name = await askTopic(); if (name) await run(name); } },
  ]);
}

// "Save & close", "Save, keep open" and "Save & close to topic ›" for tabs, groups and windows.
function saveItems(ids, what) {
  if (!state.libraryOn) return [];
  return [
    { icon: 'save', label: `Save & close${what}`, run: () => saveTabs(ids) },
    { icon: 'save', label: `Save${what}, keep open`, run: () => saveTabs(ids, { close: false }) },
    { icon: 'save', label: 'Save & close to topic', items: topicItems(topic => saveTabs(ids, { topic })) },
    '-',
  ];
}

function staleMenu() {
  const ids = staleIds();
  const n = ` · ${ids.length}`;
  return tidy([
    ...(state.libraryOn ? [
      { icon: 'save', label: `Save & close all${n}`, run: () => saveTabs(ids) },
      { icon: 'save', label: `Save all, keep open${n}`, run: () => saveTabs(ids, { close: false }) },
      '-',
    ] : []),
    { icon: 'close', label: `Close all without saving${n}`, danger: true, run: async () => { if (await confirmMany(ids.length)) await closeWithUndo(ids); } },
  ]);
}

function savedMenu(item) {
  const moves = tidy([
    ...state.topics.filter(topic => topic.title !== item.topic).map(topic => ({ icon: 'save', label: topic.title, run: () => moveSaved([item.id], topic.title) })),
    ...(item.topic ? [{ icon: 'close', label: 'No topic', run: () => moveSaved([item.id], null) }] : []),
    '-',
    { icon: 'plus', label: 'New topic…', run: async () => { const name = await askTopic(); if (name) await moveSaved([item.id], name); } },
  ]);
  return [
    { icon: 'move', label: 'Move to topic', items: moves },
    '-',
    { icon: 'close', label: 'Remove from library', danger: true, run: () => removeSaved([item.id]) },
  ];
}

function savedGroupMenu(name) {
  const ids = state.saved.filter(item => item.group === name && savedMatches(item)).map(item => item.id);
  return [{ icon: 'close', label: `Remove group from library · ${ids.length}`, danger: true, run: () => removeSaved(ids) }];
}

function rowMenu(tab) {
  // In the Windows view a group lives inside one window, so "other tabs in this group" stays there too.
  const windowId = state.view === 'windows' ? tab.windowId : null;
  const others = groupTabIds(tab.group, windowId).filter(id => id !== tab.id);
  return tidy([
    ...saveItems([tab.id], ''),
    { icon: 'move', label: 'Move to window', items: moveItems([tab.id]) },
    '-',
    tab.active
      ? { icon: 'suspend', label: 'Suspend this tab (it is active)', disabled: true }
      : suspendItem('Suspend this tab', [tab.id], { bulk: false }),
    suspendItem('Suspend other tabs in this group', others),
    '-',
    neverItem(tab),
  ].filter(Boolean));
}

function groupMenu(name, windowId) {
  const ids = groupTabIds(name, windowId);
  return [
    ...saveItems(ids, ' group'),
    { icon: 'move', label: 'Move group to', items: moveItems(ids) },
    suspendItem('Suspend group', ids),
    '-',
    { icon: 'close', label: 'Close group', danger: true, run: async () => { if (await confirmMany(ids.length)) await closeWithUndo(ids); } },
  ];
}

function windowMenu(windowId) {
  const ids = tabsIn(windowId).map(tab => tab.id);
  return [
    ...saveItems(ids, ' window'),
    { icon: 'page', label: 'Bring to front', run: async () => { await browser.windows.update(windowId, { focused: true }); if (!IS_PAGE) window.close(); } },
    { icon: 'plus', label: 'New tab', run: () => browser.tabs.create({ windowId }) },
    suspendItem('Suspend window', ids),
    '-',
    { icon: 'close', label: 'Close window', danger: true, run: async () => { if (await confirmMany(ids.length)) await closeWindowWithUndo(windowId); } },
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
  if (kind === 'stale') return staleMenu();
  if (kind === 'saved') return savedMenu(savedById(trigger.dataset.id));
  if (kind === 'saved-group') return savedGroupMenu(trigger.dataset.group);
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
$('#topic-dialog').addEventListener('close', refreshIfPending);

// ---------- list events ----------
// Window actions in the Windows view, and the window glyph that leads there.
async function handleWindowClick(target, event) {
  const show = target.closest('[data-show-window]');
  if (show) {
    // On the page the sidebar picks that window; the popup switches to the Windows view.
    if (IS_PAGE) selectPage('windows', show.dataset.showWindow);
    else {
      await saveSetting('view', 'windows');
      state.openGroups.add(`w:${show.dataset.showWindow}`);
      render();
    }
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
  const pick = target.closest('.pick');
  if (pick) {
    // The state decides, and inside a <summary> the click must not also toggle the group.
    event.preventDefault();
    togglePick(pick);
    return;
  }
  if (await handleWindowClick(target, event)) return;
  const more = target.closest('[data-menu]');
  if (more) {
    // Inside a <summary> the button must not also toggle the group.
    event.preventDefault();
    openMenu(more, menuFor(more));
    return;
  }
  const newWindow = target.closest('[data-group-new-window]');
  if (newWindow) {
    event.preventDefault();
    const windowId = newWindow.dataset.w ? Number(newWindow.dataset.w) : null;
    await moveTabs(groupTabIds(newWindow.dataset.groupNewWindow, windowId), 'new');
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
  if (await handleLibraryClick(target, event)) return;
  const copies = target.closest('[data-copies]');
  if (copies) {
    const id = Number(copies.dataset.copies);
    if (state.openKeepers.has(id)) state.openKeepers.delete(id);
    else state.openKeepers.add(id);
    render();
    return;
  }
  const row = target.closest('.row');
  if (row) activateRow(row);
});

// A tab row switches to its tab; a saved row opens (or switches to) its page.
function activateRow(row) {
  if (row.dataset.saved) openSaved(savedById(row.dataset.saved), { active: true });
  else switchTo(Number(row.dataset.id));
}

// Save icons, topic chips and the Library view's own buttons.
async function handleLibraryClick(target, event) {
  const button = target.closest('[data-save], [data-save-group], [data-save-stale], [data-topic], [data-new-topic], [data-open-saved-bg], [data-remove-saved], [data-open-saved-group], [data-open-saved]');
  if (!button) return false;
  // Several of these sit inside a <summary>: they must not also toggle the group.
  event.preventDefault();
  const data = button.dataset;
  if ('save' in data) await saveTabs([Number(data.save)]);
  else if ('saveGroup' in data) await saveTabs(groupTabIds(data.saveGroup, data.w ? Number(data.w) : null));
  else if ('saveStale' in data) await saveTabs(staleIds());
  else if ('topic' in data) {
    state.topic = data.topic;
    render();
  } else if ('newTopic' in data) {
    const name = await askTopic();
    if (name) {
      await Library.createTopic(name);
      refresh();
    }
  } else if ('openSavedBg' in data) await openSaved(savedById(data.openSavedBg), { active: false });
  else if ('removeSaved' in data) await removeSaved([data.removeSaved]);
  else if ('openSavedGroup' in data) await openSavedMany(state.saved.filter(item => item.group === data.openSavedGroup && savedMatches(item)));
  else if ('openSaved' in data) await openSaved(savedById(data.openSaved), { active: true });
  return true;
}

body.addEventListener('toggle', event => {
  const details = event.target;
  if (state.query || !details.matches('details[data-key]')) return;
  if (details.open) state.openGroups.add(details.dataset.key);
  else state.openGroups.delete(details.dataset.key);
}, true);

// On the page the list is a keyboard tree: ↑/↓ move between visible rows and group headers, → opens a group,
// ← closes it or goes up to the header it sits in, Space checks the tab or group. Enter keeps its meaning.
body.addEventListener('keydown', event => {
  const current = event.target;
  if (!IS_PAGE || !current.matches('summary, .row-main')) return;
  const isHeader = current.matches('summary');
  const details = isHeader ? current.parentElement : null;
  const stops = [...body.querySelectorAll('summary, .row-main')].filter(el => el.checkVisibility());
  const i = stops.indexOf(current);
  if (event.key === 'ArrowDown') stops[i + 1]?.focus();
  else if (event.key === 'ArrowUp') stops[i - 1]?.focus();
  else if (event.key === 'ArrowRight' && isHeader) {
    if (details.open) stops[i + 1]?.focus();
    else details.open = true;
  } else if (event.key === 'ArrowLeft') {
    if (isHeader && details.open) details.open = false;
    else (isHeader ? details.parentElement : current).closest('details')?.querySelector(':scope > summary').focus();
  } else if (event.key === ' ') {
    const box = pickFor(current);
    if (!box) return;
    togglePick(box);
  } else return;
  event.preventDefault();
});

// The checkbox Space toggles for a focused tab row or group header; saved rows have none.
function pickFor(element) {
  if (!IS_PAGE || !element.matches('summary, .row-main')) return null;
  if (element.matches('summary')) return element.querySelector(':scope > .pick');
  return element.closest('.row').querySelector('.pick');
}

// Browsers activate a button (and a summary) on Space's keyup; cancelling keydown alone may not stop that,
// which would also switch to the tab. Focus is still on the same element after the re-render.
body.addEventListener('keyup', event => {
  if (event.key === ' ' && pickFor(event.target)) event.preventDefault();
});

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
  if (event.key === 'Enter' && rows[state.selected]) activateRow(rows[state.selected]);
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
  if (event.target.id === 'open-results') return openSavedMany(state.saved.filter(savedMatches));
  const ids = state.tabs.filter(matches).map(tab => tab.id);
  if (event.target.id === 'save-results') await saveTabs(ids);
  if (event.target.id === 'move-results') await moveTabs(ids, 'new');
  if (event.target.id === 'close-results' && await confirmMany(ids.length)) await closeWithUndo(ids);
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
// Library is on exactly while the bookmarks permission is granted (library.js). The request comes first:
// browsers allow it only while handling the click.
$('#s-library').addEventListener('change', async event => {
  if (event.target.checked) {
    const granted = await browser.permissions.request(Library.PERMISSION).catch(() => false);
    await setLibrary(granted);
  } else {
    await browser.permissions.remove(Library.PERMISSION).catch(() => {});
    await setLibrary(false);
  }
});
// Firefox may close the popup for the permission prompt; another open page still hears about the change.
browser.permissions.onAdded?.addListener(change => { if (change.permissions?.includes('bookmarks')) setLibrary(true); });
browser.permissions.onRemoved?.addListener(change => { if (change.permissions?.includes('bookmarks')) setLibrary(false); });

async function setLibrary(on) {
  state.libraryOn = on;
  $('#s-library').checked = on;
  if (on) listenToBookmarks();
  if (!on) {
    state.saved = [];
    state.topics = [];
    if (state.view === 'library') await saveSetting('view', 'groups');
  }
  refresh();
}

let listeningToBookmarks = false;
function listenToBookmarks() {
  if (listeningToBookmarks || !browser.bookmarks) return;
  listeningToBookmarks = true;
  for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) browser.bookmarks[event].addListener(refresh);
}

$('#s-stale').addEventListener('change', async event => {
  await saveSetting('stale', event.target.checked);
  render();
});
$('#s-never').addEventListener('change', event => saveNever(event.target.value.split('\n')));
$('#s-stale-days').addEventListener('change', async event => {
  await saveSetting('staleDays', Number(event.target.value));
  render();
});

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

// ---------- drag and drop between windows (and, on the page, onto topics) ----------
// A type of our own, so text or links dropped from a page are never read as tab ids.
const DRAG_TYPE = 'application/x-oh-my-tabs';
// Saved cards on the page's board carry bookmark ids under a type of their own: they go to a topic, never a window.
const SAVED_DRAG_TYPE = 'application/x-oh-my-tabs-saved';
body.addEventListener('dragstart', event => {
  const card = event.target.closest('.row[data-saved]');
  if (card) {
    event.dataTransfer.setData(SAVED_DRAG_TYPE, card.dataset.saved);
    event.dataTransfer.effectAllowed = 'move';
    return;
  }
  const row = event.target.closest('.row');
  const group = event.target.closest('[data-drag-group]');
  let ids = [];
  if (row) ids = [Number(row.dataset.id)];
  else if (group) ids = groupTabIds(group.dataset.dragGroup, group.dataset.w ? Number(group.dataset.w) : null);
  event.dataTransfer.setData(DRAG_TYPE, ids.join(','));
  event.dataTransfer.effectAllowed = 'move';
});

// Tabs drop on a window (move) or a topic (save & close into it); saved cards only on a topic.
function dropZone(event) {
  const types = event.dataTransfer.types;
  if (types.includes(SAVED_DRAG_TYPE)) return event.target.closest('[data-drop-topic]');
  if (types.includes(DRAG_TYPE)) return event.target.closest('[data-drop-w], [data-drop-topic]');
  return null;
}

// The sidebar is outside the list, so both listen.
for (const area of [body, side]) {
  area.addEventListener('dragover', event => {
    const zone = dropZone(event);
    if (!zone) return;
    event.preventDefault();
    document.querySelectorAll('.drop').forEach(el => el !== zone && el.classList.remove('drop'));
    zone.classList.add('drop');
  });
  area.addEventListener('dragleave', event => {
    const zone = dropZone(event);
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('drop');
  });
  area.addEventListener('drop', event => {
    const zone = dropZone(event);
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('drop');
    const topic = zone.dataset.dropTopic;
    const saved = event.dataTransfer.getData(SAVED_DRAG_TYPE);
    if (saved) {
      moveSaved([saved], topic || null);
      return;
    }
    const ids = event.dataTransfer.getData(DRAG_TYPE).split(',').filter(Boolean).map(Number);
    if (ids.length === 0 || ids.some(Number.isNaN)) return;
    // "No topic" is the empty topic.
    if (topic !== undefined) saveTabs(ids, { topic: topic || null });
    else moveTabs(ids, zone.dataset.dropW === 'new' ? 'new' : Number(zone.dataset.dropW));
  });
}

// ---------- undo ----------
// The last bulk close (not Close duplicates, which loses nothing) can be undone while the popup stays open.
// Its tabs reopen in the background where they were; their back/forward history is not kept.
const UNDO_SECONDS = 10;
let undo = null;
let undoTimer;

function snapshotOf(ids) {
  return state.tabs
    .filter(tab => ids.includes(tab.id))
    .sort((a, b) => a.index - b.index)
    .map(tab => ({ url: tab.url, windowId: tab.windowId, index: tab.index, pinned: tab.pinned }));
}

function showBar(text, withUndo) {
  $('#undo-text').textContent = text;
  $('#undo-button').hidden = !withUndo;
  $('#undo-bar').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    $('#undo-bar').hidden = true;
    undo = null;
  }, (withUndo ? UNDO_SECONDS : 2) * 1000);
}

async function closeWithUndo(ids) {
  const tabs = snapshotOf(ids);
  if (tabs.length === 0) return;
  await browser.tabs.remove(ids);
  undo = { tabs, newWindow: false };
  showBar(`Closed ${plural(tabs.length, 'tab')}`, true);
}

// A closed window comes back as a new window.
async function closeWindowWithUndo(windowId) {
  const tabs = snapshotOf(tabsIn(windowId).map(tab => tab.id));
  await browser.windows.remove(windowId);
  undo = { tabs, newWindow: true };
  showBar(`Closed a window with ${plural(tabs.length, 'tab')}`, true);
}

async function reopen({ tabs, newWindow }) {
  if (newWindow) {
    await browser.windows.create({ url: tabs.map(tab => tab.url), focused: false });
    return;
  }
  const open = new Set((await browser.windows.getAll({ windowTypes: ['normal'] })).map(w => w.id));
  // More than a handful reopen suspended, so dozens of pages don't all load at once.
  const sleep = tabs.length > CONFIRM_ABOVE;
  for (const saved of tabs) {
    const options = { url: saved.url, index: saved.index, pinned: saved.pinned, active: false };
    options.windowId = open.has(saved.windowId) ? saved.windowId : state.currentWindow;
    if (sleep && IS_FIREFOX && !saved.pinned) options.discarded = true;
    const tab = await browser.tabs.create(options).catch(() => null);
    if (tab && sleep && !IS_FIREFOX && !saved.pinned) browser.tabs.discard(tab.id).catch(() => {});
  }
}

$('#undo-button').addEventListener('click', async () => {
  const last = undo;
  undo = null;
  if (!last) return;
  await reopen(last);
  showBar(`Reopened ${plural(last.tabs.length, 'tab')}`, false);
  refresh();
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
  if (IS_PAGE) {
    side.hidden = false;
    readHash();
  }
  $('#s-dev').checked = state.dev;
  document.querySelector(`[name="sort"][value="${state.sort}"]`).checked = true;
  $('#s-stale').checked = state.stale;
  $('#s-stale-days').value = String(state.staleDays);
  $('#s-never').value = state.never.join('\n');
  state.libraryOn = await Library.isEnabled().catch(() => false);
  $('#s-library').checked = state.libraryOn;
  if (state.libraryOn) listenToBookmarks();

  browser.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
  await load();
  const active = state.tabs.find(tab => tab.windowId === state.currentWindow && tab.active);
  if (active) state.openGroups.add(active.group);
  state.openGroups.add(`w:${state.currentWindow}`);
  render();
  search.focus();
  renderShortcuts();
}

start();
