import { findDuplicates, duplicateKey } from './rules.js';

globalThis.browser ??= chrome;

const SETTINGS = { dev: true, badge: 'all', button: 'popup' };
const MENU_CLOSE_DUPLICATES = 'close-duplicates';
// One alarm, set to the next scheduled reminder; when it fires the next one takes its place.
const REMINDER_ALARM = 'reminders';
// remindersNotified: the time up to which due reminders have been announced, so each is announced once.
const REMINDERS = { reminders: [], remindersNotified: 0 };

// Firefox can still list a tab in windows.getAll while its onRemoved runs; skip those.
// Only lives for one burst of events, so the worker still keeps no state between them.
const justRemoved = new Set();

const ICON_SIZES = [16, 32, 48, 128];
const DUPLICATES_COLOR = '#d4483b';
const TABS_COLOR = '#5b6478';
const REMINDERS_COLOR = '#f59e0b';
// A notification's id says what a click on it opens: one reminder (by its time), or the Reminders section.
const NOTE_ONE = 'reminder:';
const NOTE_MANY = 'reminders';

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

// Duplicates in red; with none, the number of open tabs in a quiet color (badge 'all'), or nothing ('dups').
// Due reminders come before both, in amber, whatever the badge is set to count: each one was asked for.
async function updateBadge() {
  const tabs = await openTabs();
  const sets = await duplicateSets(tabs);
  const { badge, reminders } = await browser.storage.local.get({ ...SETTINGS, ...REMINDERS });
  const due = reminders.filter(reminder => reminder.at <= Date.now()).length;
  const count = sets.reduce((sum, set) => sum + set.copies.length, 0);
  let shown = count || tabs.length;
  if (badge === 'dups') shown = count;
  if (badge === 'off') shown = 0;
  let color = count ? DUPLICATES_COLOR : TABS_COLOR;
  if (due > 0) {
    shown = due;
    color = REMINDERS_COLOR;
  }
  let text = '';
  if (shown > 999) text = '999+';
  else if (shown > 0) text = String(shown);
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeTextColor?.({ color: due > 0 ? '#261a00' : '#ffffff' });

  const lines = [];
  if (due > 0) lines.push(`${due} reminder${due === 1 ? '' : 's'} due`);
  if (count === 0) {
    lines.push(`oh-my-tabs · ${tabs.length} tab${tabs.length === 1 ? '' : 's'}, no duplicates`);
  } else {
    lines.push(`${count} duplicate${count === 1 ? '' : 's'}`);
    lines.push(...sets.slice(0, 3).map(set => `${truncate(set.keeper.title, 48)} ×${set.copies.length + 1}`));
  }
  await browser.action.setTitle({ title: lines.join('\n') });
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

// The toolbar button opens the popup, or with an empty popup fires action.onClicked (a click or the open shortcut).
async function applyButton() {
  const { button } = await browser.storage.local.get(SETTINGS);
  await browser.action.setPopup({ popup: button === 'page' ? '' : 'popup.html' });
}

// Switches to the full page when one is open instead of opening a second one.
// hash: the section to show there ('#reminders'); the open page follows the change of its address.
async function openPage(hash = '') {
  const url = browser.runtime.getURL('page.html');
  const tabs = await browser.tabs.query({});
  const open = tabs.find(tab => tab.url?.startsWith(url));
  if (!open) {
    await browser.tabs.create({ url: url + hash });
    return;
  }
  await browser.tabs.update(open.id, hash ? { active: true, url: url + hash } : { active: true });
  await browser.windows.update(open.windowId, { focused: true });
}

// ---------- reminders ----------
// Storage holds the reminders; the alarm is rebuilt from it on every start of the worker, when it fires and
// when the reminders change. So nothing is lost when Firefox drops its alarms on exit, and a reminder that
// came due while the browser was closed is found at the next start.
async function syncReminders() {
  const { reminders, remindersNotified } = await browser.storage.local.get(REMINDERS);
  const now = Date.now();
  const scheduled = reminders.map(reminder => reminder.at).filter(at => at > now);
  if (scheduled.length > 0) await browser.alarms.create(REMINDER_ALARM, { when: Math.min(...scheduled) });
  else await browser.alarms.clear(REMINDER_ALARM);
  refresh();

  const fresh = reminders.filter(reminder => reminder.at > remindersNotified && reminder.at <= now);
  if (fresh.length === 0) return;
  await browser.storage.local.set({ remindersNotified: now });
  // An open popup or page lists them as due now.
  browser.runtime.sendMessage({ type: 'reminders-due' }).catch(() => {});
  await notify(fresh);
}

// One look at a time. The alarm wakes a sleeping worker, whose start and whose alarm listener both ask for
// one: side by side they would each find the same reminder newly due and announce it twice.
let syncing = Promise.resolve();
function refreshReminders() {
  syncing = syncing
    .then(syncReminders)
    .catch(error => console.error('oh-my-tabs: reminders update failed', error));
}

// Notify me: on while the optional notifications permission is granted, and without it there is no such API.
// One reminder gets a notification of its own; several at once (those that came due while the browser was
// closed) share one.
async function notify(due) {
  if (!browser.notifications) return;
  const iconUrl = browser.runtime.getURL('icons/icon-128.png');
  if (due.length === 1) {
    await browser.notifications.create(`${NOTE_ONE}${due[0].at}`, { type: 'basic', iconUrl, title: 'Reminder', message: due[0].title });
    return;
  }
  const titles = due.slice(0, 3).map(reminder => truncate(reminder.title, 48));
  await browser.notifications.create(NOTE_MANY, { type: 'basic', iconUrl, title: `${due.length} reminders are due`, message: titles.join('\n') });
}

// A click does Open for the one reminder; for several it shows them, in the full page's Reminders section.
async function openNotified(id) {
  await browser.notifications.clear(id);
  const { reminders } = await browser.storage.local.get(REMINDERS);
  const reminder = reminders.find(item => id === `${NOTE_ONE}${item.at}`);
  if (reminder) await openReminder(reminder.url);
  else await openPage('#reminders');
}

function notificationClicked(id) {
  openNotified(id).catch(error => console.error('oh-my-tabs: open reminder failed', error));
}

// The permission can come while the worker runs, and the API object with it. Adding the same listener
// again does nothing.
function listenToNotifications() {
  browser.notifications?.onClicked.addListener(notificationClicked);
}

// Open: switches to the page's tab (the one used last, if it is open more than once), or opens the page again
// if it was closed. A due reminder is done once its page is opened; a scheduled one stays for its time.
async function openReminder(url) {
  const { dev } = await browser.storage.local.get(SETTINGS);
  const key = duplicateKey(url, dev);
  const open = (await openTabs())
    .filter(tab => duplicateKey(tab.url || tab.pendingUrl || '', dev) === key)
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  let [tab] = open;
  if (tab) {
    await browser.tabs.update(tab.id, { active: true });
  } else {
    // With no window open (the browser still runs on macOS) there is nowhere to add a tab: a new window then.
    tab = await browser.tabs.create({ url }).catch(async () => (await browser.windows.create({ url })).tabs[0]);
  }
  // Read only now, after the tab is there: a reminder marked done meanwhile must not come back with this write.
  const { reminders } = await browser.storage.local.get(REMINDERS);
  const now = Date.now();
  const kept = reminders.filter(reminder => reminder.at > now || duplicateKey(reminder.url, dev) !== key);
  if (kept.length < reminders.length) await browser.storage.local.set({ reminders: kept });
  await browser.windows.update(tab.windowId, { focused: true });
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

// A whole tab group moves as one, keeping its name and color. The new window's own blank tab goes after.
// A tab group gone meanwhile (or no tabGroups API here) makes no window; a failed move takes its window away.
async function moveTabGroupToNewWindow(id) {
  await browser.tabGroups.get(id);
  const created = await browser.windows.create({});
  try {
    await browser.tabGroups.move(id, { windowId: created.id, index: -1 });
  } catch (error) {
    await browser.windows.remove(created.id).catch(() => {});
    throw error;
  }
  await browser.tabs.remove(created.tabs.map(tab => tab.id));
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

// Every start of the worker, so the button follows the setting after an update or a browser restart too.
applyButton().catch(error => console.error('oh-my-tabs: toolbar button update failed', error));
browser.action.onClicked.addListener(() => {
  openPage().catch(error => console.error('oh-my-tabs: open page failed', error));
});

// Every start of the worker too: a browser start, an update, or the worker waking up for an event.
refreshReminders();
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REMINDER_ALARM) refreshReminders();
});
listenToNotifications();
browser.permissions.onAdded.addListener(listenToNotifications);

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
  if (message.type === 'open-page') openPage().catch(error => console.error('oh-my-tabs: open page failed', error));
  if (message.type === 'open-reminder') {
    openReminder(message.url).catch(error => console.error('oh-my-tabs: open reminder failed', error));
  }
  if (message.type === 'move-to-new-window') {
    moveToNewWindow(message.ids).catch(error => console.error('oh-my-tabs: move failed', error));
  }
  if (message.type === 'move-tab-group-to-new-window') {
    moveTabGroupToNewWindow(message.id).catch(error => console.error('oh-my-tabs: move failed', error));
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
  if (changes.dev || changes.badge) refresh();
  if (changes.reminders) refreshReminders();
  if (changes.dev) refreshIcon();
  if (changes.button) applyButton();
});
