import { findDuplicates } from './rules.js';

globalThis.browser ??= chrome;

const SETTINGS = { dev: true };
const MENU_CLOSE_DUPLICATES = 'close-duplicates';

// Firefox can still list a tab in windows.getAll while its onRemoved runs; skip those.
// Only lives for one burst of events, so the worker still keeps no state between them.
const justRemoved = new Set();

const ICON_SIZES = [16, 32, 48, 128];
const DUPLICATES_COLOR = '#d4483b';
const TABS_COLOR = '#5b6478';

// Everything is recomputed from the open tabs on each event.
async function openTabs() {
  const windows = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
  return windows.flatMap(w => w.tabs).filter(tab => !justRemoved.has(tab.id));
}

async function duplicateSets(tabs) {
  const { dev } = await browser.storage.local.get(SETTINGS);
  return findDuplicates(tabs ?? await openTabs(), dev);
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

// Duplicates in red; with none, the number of open tabs in a quiet color.
async function updateBadge() {
  const tabs = await openTabs();
  const sets = await duplicateSets(tabs);
  const count = sets.reduce((sum, set) => sum + set.copies.length, 0);
  const shown = count || tabs.length;
  await browser.action.setBadgeText({ text: shown > 999 ? '999+' : String(shown) });
  await browser.action.setBadgeBackgroundColor({ color: count ? DUPLICATES_COLOR : TABS_COLOR });
  await browser.action.setBadgeTextColor?.({ color: '#ffffff' });

  if (count === 0) {
    await browser.action.setTitle({ title: `oh-my-tabs · ${tabs.length} tab${tabs.length === 1 ? '' : 's'}, no duplicates` });
    return;
  }
  const lines = sets.slice(0, 3).map(set => `${truncate(set.keeper.title, 48)} ×${set.copies.length + 1}`);
  await browser.action.setTitle({ title: [`${count} duplicate${count === 1 ? '' : 's'}`, ...lines].join('\n') });
}

// The toolbar icon says which mode is on: OMT normally, "omt" at a prompt in developer mode.
async function updateIcon() {
  const { dev } = await browser.storage.local.get(SETTINGS);
  const prefix = dev ? 'dev' : 'icon';
  await browser.action.setIcon({ path: Object.fromEntries(ICON_SIZES.map(size => [size, `icons/${prefix}-${size}.png`])) });
}

function refreshIcon() {
  updateIcon().catch(error => console.error('oh-my-tabs: icon update failed', error));
}

// Never asks: every keeper stays open, so no page is lost.
async function closeDuplicates() {
  const sets = await duplicateSets();
  const ids = sets.flatMap(set => set.copies.map(tab => tab.id));
  if (ids.length > 0) await browser.tabs.remove(ids);
}

// Runs here, not in the popup: the new window takes focus, which closes the popup mid-move.
async function moveToNewWindow(ids) {
  const [first, ...rest] = ids;
  const created = await browser.windows.create({ tabId: first });
  if (rest.length > 0) await browser.tabs.move(rest, { windowId: created.id, index: -1 });
}

// Closing 30 duplicates fires 30 events; one recompute after they settle avoids a stale count winning.
let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await updateBadge();
    } catch (error) {
      console.error('oh-my-tabs: badge update failed', error);
    }
    justRemoved.clear();
  }, 150);
}

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({ id: MENU_CLOSE_DUPLICATES, title: 'Close duplicates', contexts: ['action'] });
  refresh();
  refreshIcon();
});
browser.runtime.onStartup.addListener(() => {
  refresh();
  refreshIcon();
});

browser.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === MENU_CLOSE_DUPLICATES) closeDuplicates();
});
browser.runtime.onMessage.addListener(message => {
  // The popup asks on open, so the badge never lags behind what the popup shows.
  if (message.type === 'refresh-badge') refresh();
  if (message.type === 'move-to-new-window') {
    moveToNewWindow(message.ids).catch(error => console.error('oh-my-tabs: move failed', error));
  }
});
browser.commands.onCommand.addListener(command => {
  if (command === 'close-duplicates') closeDuplicates();
});

browser.tabs.onCreated.addListener(refresh);
browser.tabs.onRemoved.addListener(tabId => {
  justRemoved.add(tabId);
  refresh();
});
browser.tabs.onReplaced.addListener(refresh);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) refresh();
});
// lastAccessed decides the keeper, which the tooltip names.
browser.tabs.onActivated.addListener(refresh);
browser.storage.onChanged.addListener(changes => {
  if (!changes.dev) return;
  refresh();
  refreshIcon();
});
