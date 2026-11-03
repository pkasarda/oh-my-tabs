import { findDuplicates } from './rules.js';

globalThis.browser ??= chrome;

const SETTINGS = { dev: true };
const MENU_CLOSE_DUPLICATES = 'close-duplicates';

// Everything is recomputed from the open tabs on each event: the worker keeps no state.
async function duplicateSets() {
  const { dev } = await browser.storage.local.get(SETTINGS);
  const windows = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
  return findDuplicates(windows.flatMap(w => w.tabs), dev);
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

async function updateBadge() {
  const sets = await duplicateSets();
  const count = sets.reduce((sum, set) => sum + set.copies.length, 0);
  await browser.action.setBadgeText({ text: count ? String(count) : '' });
  await browser.action.setBadgeBackgroundColor({ color: '#d4483b' });

  if (count === 0) {
    await browser.action.setTitle({ title: 'oh-my-tabs' });
    return;
  }
  const lines = sets.slice(0, 3).map(set => `${truncate(set.keeper.title, 48)} ×${set.copies.length + 1}`);
  await browser.action.setTitle({ title: [`${count} duplicate${count === 1 ? '' : 's'}`, ...lines].join('\n') });
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

function refresh() {
  updateBadge().catch(error => console.error('oh-my-tabs: badge update failed', error));
}

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({ id: MENU_CLOSE_DUPLICATES, title: 'Close duplicates', contexts: ['action'] });
  refresh();
});
browser.runtime.onStartup.addListener(refresh);

browser.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === MENU_CLOSE_DUPLICATES) closeDuplicates();
});
browser.runtime.onMessage.addListener(message => {
  if (message.type === 'move-to-new-window') {
    moveToNewWindow(message.ids).catch(error => console.error('oh-my-tabs: move failed', error));
  }
});
browser.commands.onCommand.addListener(command => {
  if (command === 'close-duplicates') closeDuplicates();
});

browser.tabs.onCreated.addListener(refresh);
browser.tabs.onRemoved.addListener(refresh);
browser.tabs.onReplaced.addListener(refresh);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) refresh();
});
// lastAccessed decides the keeper, which the tooltip names.
browser.tabs.onActivated.addListener(refresh);
browser.storage.onChanged.addListener(changes => {
  if (changes.dev) refresh();
});
