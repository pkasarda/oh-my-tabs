// Reminders (1.4): Remind me later in the menus and the bulk bar, the due group and the amber badge, the bell,
// the full page's Reminders section, the alarm, the catch-up at startup and Notify me.
// Nothing here waits for a real hour: a reminder is due because its time is written in the past, or a moment ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, eventually, titleOf, TABS, ALL_TABS } from './helpers.js';
import { reminderTimes } from '../rules.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const AMBER = [245, 158, 11, 255];
// A page with a reminder whose tab is not open.
const CLOSED = { url: 'https://docs.example.org/closed', title: 'A page closed since' };
// "Mon 16 Nov, 9:00"
const WHEN = /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2}$/;

async function start(t, options = {}) {
  const app = await launch(options);
  t.after(() => app.close());
  await app.seed([ALL_TABS]);
  return app;
}

function reminderOf(url, at) {
  return { url, title: titleOf(url), at };
}

async function reminders(app) {
  const stored = await app.worker.evaluate(() => chrome.storage.local.get({ reminders: [] }));
  return stored.reminders;
}

// As if set earlier: straight into storage, which the background and every open popup or page follow.
function setReminders(app, list) {
  return app.worker.evaluate(list => chrome.storage.local.set({ reminders: list }), list);
}

function badgeText(app) {
  return app.worker.evaluate(() => chrome.action.getBadgeText({}));
}

function badgeColor(app) {
  return app.worker.evaluate(() => chrome.action.getBadgeBackgroundColor({}));
}

function alarm(app) {
  return app.worker.evaluate(() => chrome.alarms.get('reminders'));
}

function group(page, key) {
  return page.locator(`#body details.group[data-key="${key}"]`);
}

async function rowOf(page, app, url) {
  const id = await app.tabIdOf(url);
  return page.locator(`#body .row[data-id="${id}"]`);
}

function reminderRow(page, url) {
  return page.locator(`#body .row.reminder[data-reminder="${url}"]`);
}

function menuItem(page, name) {
  return page.getByRole('menuitem', { name, exact: true });
}

function menuLabels(page) {
  return page.locator('#menu [role="menuitem"] > span:not(.hint)').allTextContents();
}

// The popup with one group opened, and the row of one of its tabs.
async function popupRow(app, groupName, url) {
  const page = await app.openPopup();
  await group(page, groupName).locator('summary').click();
  return { page, row: await rowOf(page, app, url) };
}

// ---------- setting one ----------
test('Remind me later in a tab menu offers the times; In 1 hour keeps the address, the title and the time', async t => {
  const app = await start(t);
  const { page, row } = await popupRow(app, 'Jira · WEB', TABS.jira1);
  await row.locator('[data-menu="row"]').click();
  await menuItem(page, 'Remind me later').click();
  assert.deepEqual(await menuLabels(page), ['Back', 'In 1 hour', 'In 3 hours', 'Tomorrow 9:00', 'Next Monday 9:00', 'Custom…']);

  const before = Date.now();
  await menuItem(page, 'In 1 hour').click();
  await eventually(async () => assert.equal((await reminders(app)).length, 1));
  const [reminder] = await reminders(app);
  assert.equal(reminder.url, TABS.jira1);
  assert.equal(reminder.title, titleOf(TABS.jira1));
  assert.ok(reminder.at >= before + HOUR && reminder.at <= Date.now() + HOUR, `in an hour, got ${new Date(reminder.at)}`);
  assert.deepEqual(Object.keys(reminder).sort(), ['at', 'title', 'url']);
  assert.match(await page.locator('#undo-text').textContent(), /^Reminder set for /);

  // Before it is due: a quiet bell on the tab's row, no group in the popup, and the badge as it was.
  await eventually(async () => assert.equal(await row.locator('.bell').count(), 1));
  assert.equal(await row.locator('.bell.due').count(), 0);
  const tip = await row.locator('.bell').getAttribute('data-tip');
  assert.match(tip.replace('Reminder: ', ''), WHEN);
  assert.equal(await page.locator('#body details.reminders').count(), 0);
  assert.notDeepEqual(await badgeColor(app), AMBER);
  // The timer is one alarm, set to that time.
  await eventually(async () => assert.equal((await alarm(app))?.scheduledTime, reminder.at));
});

test('Custom… takes the time from the browser\'s own date and time field, and not one in the past', async t => {
  const app = await start(t);
  const { page, row } = await popupRow(app, 'Jira · WEB', TABS.jira1);
  const dialog = page.locator('#remind-dialog');
  const field = page.locator('#remind-time');
  const openCustom = async () => {
    await row.locator('[data-menu="row"]').click();
    await menuItem(page, 'Remind me later').click();
    await menuItem(page, 'Custom…').click();
    await eventually(async () => assert.equal(await dialog.evaluate(el => el.open), true));
  };

  await openCustom();
  assert.equal(await field.getAttribute('type'), 'datetime-local');
  // It starts at Tomorrow 9:00.
  const tomorrow = Object.fromEntries(reminderTimes(Date.now()))['Tomorrow 9:00'];
  assert.equal(await field.evaluate(el => new Date(el.value).getTime()), tomorrow);

  // A time that has passed does not go through: the field itself refuses it and the window stays.
  await field.fill('2020-01-01T10:00');
  await dialog.getByRole('button', { name: 'Set reminder' }).click();
  assert.equal(await dialog.evaluate(el => el.open), true);
  assert.equal(await field.evaluate(el => el.validity.rangeUnderflow), true);
  assert.deepEqual(await reminders(app), []);

  const year = new Date().getFullYear() + 1;
  await field.fill(`${year}-06-01T10:30`);
  await dialog.getByRole('button', { name: 'Set reminder' }).click();
  const at = new Date(year, 5, 1, 10, 30).getTime();
  await eventually(async () => assert.deepEqual(await reminders(app), [reminderOf(TABS.jira1, at)]));

  // Cancel changes nothing.
  await openCustom();
  await field.fill(`${year}-07-01T10:30`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await eventually(async () => assert.equal(await dialog.evaluate(el => el.open), false));
  assert.deepEqual(await reminders(app), [reminderOf(TABS.jira1, at)]);
});

test('Remind me later on a group sets one reminder per page: a duplicate shares its keeper\'s', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  // acme/client holds pull/12, its copy pull/12/files, and issues/3.
  await group(page, 'acme/client').locator('summary [data-menu="group"]').click();
  await menuItem(page, 'Remind me later').click();
  await menuItem(page, 'Tomorrow 9:00').click();
  await eventually(async () => assert.equal((await reminders(app)).length, 2));
  const list = await reminders(app);
  assert.ok(list.some(reminder => reminder.url === TABS.issue));
  assert.ok(list.some(reminder => reminder.url.startsWith(TABS.pr)));
  for (const reminder of list) {
    assert.equal(new Date(reminder.at).getHours(), 9);
    assert.ok(reminder.at > Date.now());
  }
  // Every tab of the group carries the bell, the copy too.
  await group(page, 'acme/client').locator('summary').click();
  await group(page, 'acme/client').locator('[data-copies]').click();
  await eventually(async () => assert.equal(await group(page, 'acme/client').locator('.row .bell').count(), 3));
});

test('a new time on a page that has a reminder replaces it', async t => {
  const app = await start(t);
  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + 5 * HOUR)]);
  const { page, row } = await popupRow(app, 'Jira · WEB', TABS.jira1);
  await row.locator('[data-menu="row"]').click();
  await menuItem(page, 'Remind me later').click();
  const before = Date.now();
  await menuItem(page, 'In 3 hours').click();
  await eventually(async () => {
    const list = await reminders(app);
    assert.equal(list.length, 1);
    assert.ok(list[0].at >= before + 3 * HOUR && list[0].at < before + 4 * HOUR);
  });
});

test('Remove reminder in a tab menu takes a scheduled reminder back', async t => {
  const app = await start(t);
  const { page, row } = await popupRow(app, 'Jira · WEB', TABS.jira1);
  // Without a reminder there is nothing to remove.
  await row.locator('[data-menu="row"]').click();
  assert.equal((await menuLabels(page)).includes('Remove reminder'), false);
  await page.keyboard.press('Escape');

  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + HOUR)]);
  await eventually(async () => assert.equal(await row.locator('.bell').count(), 1));
  await row.locator('[data-menu="row"]').click();
  await menuItem(page, 'Remove reminder').click();
  await eventually(async () => assert.deepEqual(await reminders(app), []));
  await eventually(async () => assert.equal(await row.locator('.bell').count(), 0));
  await eventually(async () => assert.equal(await alarm(app), undefined));
});

test('a browser page takes no reminder: Remind me later is disabled for it', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  // The popup's own tab is the only one in Browser, so it is a plain row.
  const own = (await app.tabs()).find(tab => tab.url.endsWith('/popup.html'));
  await page.locator(`#body .row[data-id="${own.id}"] [data-menu="row"]`).click();
  assert.equal(await menuItem(page, 'Remind me later').isDisabled(), true);
});

test('page: Remind me later in the bulk bar sets a reminder on each checked tab and clears the checks', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('[data-head="expand"]').click();
  const jira = await rowOf(page, app, TABS.jira1);
  const api = await rowOf(page, app, TABS.api);
  await jira.locator('.pick').click();
  await api.locator('.pick').click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '2 selected'));

  await page.locator('[data-bulk="remind"]').click();
  assert.deepEqual(await menuLabels(page), ['In 1 hour', 'In 3 hours', 'Tomorrow 9:00', 'Next Monday 9:00', 'Custom…']);
  await menuItem(page, 'Next Monday 9:00').click();
  await eventually(async () => assert.deepEqual((await reminders(app)).map(reminder => reminder.url).sort(), [TABS.jira1, TABS.api].sort()));
  const [first, second] = await reminders(app);
  assert.equal(first.at, second.at);
  assert.equal(new Date(first.at).getDay(), 1);
  await eventually(async () => assert.equal(await page.locator('#bulk-bar').isHidden(), true));
  assert.equal(await jira.locator('.bell').count(), 1);
  assert.equal(await api.locator('.bell').count(), 1);
});

// ---------- when it is due ----------
test('due reminders are a Reminders group at the top of the popup, and the badge turns amber with their count', async t => {
  const app = await start(t);
  const now = Date.now();
  await setReminders(app, [
    reminderOf(TABS.jira1, now - MINUTE),
    { ...CLOSED, at: now - 2 * HOUR },
    reminderOf(TABS.api, now + HOUR),
  ]);
  await eventually(async () => assert.equal(await badgeText(app), '2'));
  assert.deepEqual(await badgeColor(app), AMBER);
  const title = await app.worker.evaluate(() => chrome.action.getTitle({}));
  assert.equal(title.split('\n')[0], '2 reminders due');

  const page = await app.openPopup();
  const due = page.locator('#body details.reminders');
  assert.equal(await page.locator('#body > :first-child').getAttribute('data-key'), 'reminders');
  // Open from the start, the one due longest first; the scheduled one is not in it.
  assert.equal(await due.evaluate(el => el.open), true);
  assert.equal(await due.locator('summary .g-name').textContent(), 'Reminders');
  assert.equal(await due.locator('summary .g-meta').textContent(), '2');
  assert.deepEqual(await due.locator('.row .title').allTextContents(), [CLOSED.title, titleOf(TABS.jira1)]);
  assert.deepEqual(await due.locator('.row .age').allTextContents(), ['due 2 h ago', 'due 1 min ago']);
  for (const row of await due.locator('.row').all()) {
    assert.deepEqual(await row.locator('.actions button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Open', 'Done', 'Remind again']);
  }

  // The tab itself carries an amber bell now; the scheduled one a quiet bell.
  await group(page, 'Jira · WEB').locator('summary').click();
  assert.equal(await (await rowOf(page, app, TABS.jira1)).locator('.bell.due').count(), 1);
  await group(page, 'docs.example.org').locator('summary').click();
  const scheduled = (await rowOf(page, app, TABS.api)).locator('.bell');
  assert.equal(await scheduled.count(), 1);
  assert.equal(await scheduled.evaluate(el => el.classList.contains('due')), false);

  // The group leads the Windows view too, and steps aside for a search.
  await page.locator('[data-view="windows"]').click();
  await eventually(async () => assert.equal(await page.locator('#body > :first-child').getAttribute('data-key'), 'reminders'));
  await page.locator('#search').fill('api');
  await eventually(async () => assert.equal(await due.count(), 0));
});

test('the amber badge shows whatever the toolbar badge is set to count, and goes when nothing is due', async t => {
  const app = await start(t, { settings: { badge: 'off' } });
  await eventually(async () => assert.equal(await badgeText(app), ''));
  await setReminders(app, [reminderOf(TABS.jira1, Date.now() - MINUTE)]);
  await eventually(async () => assert.equal(await badgeText(app), '1'));
  assert.deepEqual(await badgeColor(app), AMBER);
  await setReminders(app, []);
  await eventually(async () => assert.equal(await badgeText(app), ''));
});

test('Done takes a reminder off; Remind again sets a new time and the page leaves the group until then', async t => {
  const app = await start(t);
  const now = Date.now();
  await setReminders(app, [reminderOf(TABS.jira1, now - MINUTE), { ...CLOSED, at: now - HOUR }]);
  const page = await app.openPopup();
  const due = page.locator('#body details.reminders');
  await eventually(async () => assert.equal(await due.locator('.row').count(), 2));

  await reminderRow(page, CLOSED.url).getByRole('button', { name: 'Done' }).click();
  await eventually(async () => assert.deepEqual(await reminders(app), [reminderOf(TABS.jira1, now - MINUTE)]));
  await eventually(async () => assert.equal(await due.locator('.row').count(), 1));
  await eventually(async () => assert.equal(await badgeText(app), '1'));

  await reminderRow(page, TABS.jira1).getByRole('button', { name: 'Remind again' }).click();
  assert.deepEqual(await menuLabels(page), ['In 1 hour', 'In 3 hours', 'Tomorrow 9:00', 'Next Monday 9:00', 'Custom…']);
  await menuItem(page, 'In 3 hours').click();
  await eventually(async () => assert.equal(await due.count(), 0));
  const [again] = await reminders(app);
  assert.equal(again.url, TABS.jira1);
  assert.ok(again.at >= now + 3 * HOUR);
  // Nothing is due any more: the badge counts duplicates again, in its own color.
  await eventually(async () => assert.notDeepEqual(await badgeColor(app), AMBER));
  assert.equal(await badgeText(app), '2');
});

test('Open switches to the tab of an open page, opens a closed page again, and the reminder is done', async t => {
  const app = await start(t);
  const now = Date.now();
  await setReminders(app, [reminderOf(TABS.jira1, now - MINUTE), { ...CLOSED, at: now - HOUR }]);
  const page = await app.openPage('#reminders');
  const jiraId = await app.tabIdOf(TABS.jira1);
  const isActive = async id => (await app.tabs()).find(tab => tab.id === id).active;
  assert.equal(await isActive(jiraId), false);

  await reminderRow(page, TABS.jira1).getByRole('button', { name: 'Open' }).click();
  await eventually(async () => assert.equal(await isActive(jiraId), true));
  await eventually(async () => assert.deepEqual(await reminders(app), [{ ...CLOSED, at: now - HOUR }]));
  // No second tab for a page that was open.
  assert.equal((await app.webUrls()).filter(url => url === TABS.jira1).length, 1);

  // A click on the row itself is Open too.
  await reminderRow(page, CLOSED.url).locator('.row-main').click();
  await eventually(async () => {
    const tab = (await app.tabs()).find(tab => tab.url === CLOSED.url);
    assert.ok(tab, 'the closed page is open again');
    assert.equal(tab.active, true);
  });
  await eventually(async () => assert.deepEqual(await reminders(app), []));
  // With the last reminder gone the page leaves the section, which is gone from the sidebar too.
  await eventually(async () => assert.equal(await page.evaluate(() => location.hash), '#groups'));
  assert.equal(await page.locator('#side [data-section="reminders"]').count(), 0);
  await eventually(async () => assert.notDeepEqual(await badgeColor(app), AMBER));
});

test('Open on a scheduled reminder switches to the tab and keeps the reminder', async t => {
  const app = await start(t);
  const scheduled = reminderOf(TABS.jira1, Date.now() + HOUR);
  await setReminders(app, [scheduled]);
  const page = await app.openPage('#reminders');
  const jiraId = await app.tabIdOf(TABS.jira1);
  await reminderRow(page, TABS.jira1).getByRole('button', { name: 'Open' }).click();
  await eventually(async () => assert.equal((await app.tabs()).find(tab => tab.id === jiraId).active, true));
  assert.deepEqual(await reminders(app), [scheduled]);
});

// ---------- the full page ----------
test('page: the sidebar has Reminders, with the due and the scheduled ones, and the address keeps it', async t => {
  const app = await start(t);
  const now = Date.now();
  const page = await app.openPage();
  // None yet: no such item.
  const item = page.locator('#side [data-section="reminders"]');
  assert.equal(await item.count(), 0);

  await setReminders(app, [reminderOf(TABS.api, now + HOUR), reminderOf(TABS.jira1, now - MINUTE), { ...CLOSED, at: now + 2 * HOUR }]);
  await eventually(async () => assert.equal(await item.locator('.n').textContent(), '3'));
  assert.equal(await item.locator('.nm').textContent(), 'Reminders');
  assert.equal(await item.getAttribute('data-tip'), '1 due · 2 scheduled');
  assert.equal(await item.evaluate(el => el.classList.contains('due')), true);

  await item.click();
  assert.equal(await page.evaluate(() => location.hash), '#reminders');
  assert.equal(await page.locator('#main-head h2').textContent(), 'Reminders');
  assert.equal(await page.locator('#main-head .sub').textContent(), '3 reminders');
  assert.deepEqual(await page.locator('#body .singles-head').allTextContents(), ['Due · 1', 'Scheduled · 2']);
  // Due first, then the scheduled ones by time.
  assert.deepEqual(await page.locator('#body .row.reminder .title').allTextContents(), [titleOf(TABS.jira1), titleOf(TABS.api), CLOSED.title]);
  const times = await page.locator('#body .row.reminder .age').allTextContents();
  assert.equal(times[0], 'due 1 min ago');
  assert.match(times[1], WHEN);
  // No actions for all of them, no tree toolbar and no bulk bar here.
  assert.equal(await page.locator('#main-head button').count(), 0);

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.equal(await page.evaluate(() => location.hash), '#reminders');
  assert.equal(await page.locator('#body .row.reminder').count(), 3);

  // The search narrows them, by title or address.
  await page.locator('#search').fill('closed');
  await eventually(async () => assert.deepEqual(await page.locator('#body .row.reminder .title').allTextContents(), [CLOSED.title]));
  assert.equal(await page.locator('#results-bar button').count(), 0);
  await page.locator('#search').fill('');

  // Nothing due any more: the count is quiet again.
  await reminderRow(page, TABS.jira1).getByRole('button', { name: 'Done' }).click();
  await eventually(async () => assert.equal(await item.locator('.n').textContent(), '2'));
  assert.equal(await item.evaluate(el => el.classList.contains('due')), false);
});

test('page: the command palette lists Reminders as a place while there are some', async t => {
  const app = await start(t);
  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + HOUR)]);
  const page = await app.openPage();
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('#palette-field').fill('remind');
  await eventually(async () => assert.deepEqual(await page.locator('#palette-list [role="option"] .tt').allTextContents(), ['Reminders']));
  await page.keyboard.press('Enter');
  await eventually(async () => assert.equal(await page.evaluate(() => location.hash), '#reminders'));
});

test('page: the details pane shows the tab\'s reminder', async t => {
  const app = await start(t, { settings: { detailsShown: true } });
  const now = Date.now();
  await setReminders(app, [reminderOf(TABS.jira1, now + HOUR), reminderOf(TABS.jira2, now - 3 * HOUR)]);
  const page = await app.openPage();
  await page.locator('[data-head="expand"]').click();
  const reminderField = () => page.locator('#details dt', { hasText: /^Reminder$/ }).locator('+ dd').textContent();

  await (await rowOf(page, app, TABS.jira1)).locator('.row-main').focus();
  await eventually(async () => assert.match(await reminderField(), WHEN));
  await (await rowOf(page, app, TABS.jira2)).locator('.row-main').focus();
  await eventually(async () => assert.equal(await reminderField(), 'Due 3 h ago'));
  await (await rowOf(page, app, TABS.api)).locator('.row-main').focus();
  await eventually(async () => assert.equal(await reminderField(), 'None'));
});

test('a tab with a scheduled reminder is not stale; once the reminder is due it can be again', async t => {
  // 0 days: every tab counts as not used for that long, without waiting a week.
  const app = await start(t, { settings: { staleDays: 0 } });
  const page = await app.openPage();
  const stale = async () => (await page.locator('#status-bar').textContent()).match(/(\d+) stale/)[1];
  await eventually(async () => assert.equal(await stale(), String(ALL_TABS.length)));

  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + HOUR)]);
  await eventually(async () => assert.equal(await stale(), String(ALL_TABS.length - 1)));
  await page.locator('#side [data-section="stale"]').click();
  assert.equal(await (await rowOf(page, app, TABS.jira1)).count(), 0);
  assert.equal(await (await rowOf(page, app, TABS.jira2)).count(), 1);

  await setReminders(app, [reminderOf(TABS.jira1, Date.now() - MINUTE)]);
  await eventually(async () => assert.equal(await stale(), String(ALL_TABS.length)));
});

// ---------- the timer ----------
test('a reminder that comes due while the popup is open: the alarm fires, the group appears, the badge turns amber', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  const at = Date.now() + 2000;
  await setReminders(app, [reminderOf(TABS.jira1, at)]);
  // Not due yet, so not listed. Only said when the look itself was over before the time came.
  const listed = await page.locator('#body details.reminders').count();
  if (Date.now() < at) assert.equal(listed, 0);

  // Two seconds from now, with room for a slow machine.
  await eventually(async () => assert.equal(await page.locator('#body details.reminders .row').count(), 1), { timeout: 20000 });
  await eventually(async () => assert.deepEqual(await badgeColor(app), AMBER));
  assert.equal(await badgeText(app), '1');
  // Nothing else is scheduled: the alarm is gone.
  await eventually(async () => assert.equal(await alarm(app), undefined));
});

test('at startup a reminder that came due while the browser was closed is on the badge and in the group, and the next one is scheduled', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'omt-profile-'));
  try {
    const first = await launch({ profile });
    // Three seconds: room to write it, see it scheduled and close the browser before its time.
    const soon = Date.now() + 3000;
    const later = Date.now() + 5 * HOUR;
    await first.worker.evaluate(list => chrome.storage.local.set({ reminders: list }), [
      { url: TABS.jira1, title: titleOf(TABS.jira1), at: soon },
      { url: TABS.api, title: titleOf(TABS.api), at: later },
    ]);
    // Scheduled, not due: closed before its time.
    await eventually(async () => assert.equal((await first.worker.evaluate(() => chrome.alarms.get('reminders')))?.scheduledTime, soon));
    assert.notDeepEqual(await badgeColor(first), AMBER);
    await first.close();
    assert.ok(Date.now() < soon, 'the browser closed before the reminder was due');
    // At most those three seconds, until its time has passed with the browser closed.
    while (Date.now() <= soon) await new Promise(resolve => setTimeout(resolve, 50));

    const again = await launch({ profile });
    try {
      await eventually(async () => assert.equal(await badgeText(again), '1'));
      assert.deepEqual(await badgeColor(again), AMBER);
      await eventually(async () => assert.equal((await alarm(again))?.scheduledTime, later));
      const page = await again.openPopup();
      assert.deepEqual(await page.locator('#body details.reminders .row .title').allTextContents(), [titleOf(TABS.jira1)]);
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

// ---------- Notify me ----------
test('once a reminder is set a row offers Notify me; dismissed, it does not come back', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  const bar = page.locator('#results-bar');
  assert.equal(await bar.isHidden(), true);

  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + HOUR)]);
  await eventually(async () => assert.equal(await bar.locator('span').textContent(), 'Get a notification when a reminder is due?'));
  assert.equal(await bar.locator('#notify-on').textContent(), 'Notify me');

  await bar.locator('#notify-hint-close').click();
  await eventually(async () => assert.equal(await bar.isHidden(), true));
  assert.equal(await app.worker.evaluate(async () => (await chrome.storage.local.get('notifyHint')).notifyHint), false);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.equal(await bar.isHidden(), true);
});

test('Notify me in the offer asks for the notifications permission and turns the switch on', async t => {
  const app = await start(t);
  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + HOUR)]);
  const page = await app.openPopup();
  assert.equal(await page.locator('#s-notify').isChecked(), false);
  // A headless browser never answers the permission prompt: answer it here and note what was asked.
  await page.evaluate(() => {
    chrome.permissions.request = async request => {
      window.asked = request;
      return true;
    };
  });
  await page.locator('#notify-on').click();
  await eventually(async () => assert.equal(await page.locator('#results-bar').isHidden(), true));
  assert.deepEqual(await page.evaluate(() => window.asked), { permissions: ['notifications'] });
  assert.equal(await page.locator('#s-notify').isChecked(), true);
  assert.equal(await app.worker.evaluate(async () => (await chrome.storage.local.get('notifyHint')).notifyHint), false);
});

test('Notify me is a switch in Settings → Features, on while the permission is granted', async t => {
  const app = await start(t, { notifications: true });
  await setReminders(app, [reminderOf(TABS.jira1, Date.now() + HOUR)]);
  const page = await app.openPopup();
  // Already on: nothing to offer.
  assert.equal(await page.locator('#results-bar').isHidden(), true);
  await page.locator('#settings-button').click();
  await page.locator('#tab-features').click();
  const row = page.locator('#sec-features label.srow', { hasText: 'Notify me' });
  assert.equal(await row.locator('.hint-text').textContent(), 'A system notification when a reminder is due. Asks to display notifications.');
  assert.equal(await page.locator('#s-notify').isChecked(), true);
});

test('with Notify me on a due reminder shows a notification, and a click on it does Open', async t => {
  const app = await start(t, { notifications: true });
  const at = Date.now() - MINUTE;
  await setReminders(app, [reminderOf(TABS.jira1, at)]);
  const shown = () => app.worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));
  await eventually(async () => assert.deepEqual(await shown(), [`reminder:${at}`]));

  // Announced once. When a second one comes due, it alone is announced: were the first one announced again,
  // the two would share one notification with another id.
  await app.worker.evaluate(id => chrome.notifications.clear(id), `reminder:${at}`);
  const next = Date.now() - 1;
  await setReminders(app, [reminderOf(TABS.jira1, at), reminderOf(TABS.api, next)]);
  await eventually(async () => assert.deepEqual(await shown(), [`reminder:${next}`]));

  // A headless browser shows no notification to click: the click is sent to the extension's listener.
  const jiraId = await app.tabIdOf(TABS.jira1);
  await app.worker.evaluate(id => chrome.notifications.onClicked.dispatch(id), `reminder:${at}`);
  await eventually(async () => assert.equal((await app.tabs()).find(tab => tab.id === jiraId).active, true));
  await eventually(async () => assert.deepEqual((await reminders(app)).map(reminder => reminder.url), [TABS.api]));
});

test('a reminder is announced once when the background looks several times at once', async t => {
  // What happens when the alarm wakes a sleeping background: its start and the alarm both look.
  const app = await start(t, { notifications: true });
  await app.worker.evaluate(() => {
    globalThis.announced = [];
    const create = chrome.notifications.create.bind(chrome.notifications);
    chrome.notifications.create = (id, options) => {
      globalThis.announced.push(id);
      return create(id, options);
    };
  });
  const at = Date.now() + 1000;
  await setReminders(app, [reminderOf(TABS.jira1, at)]);
  // Without its alarm the reminder comes due unseen, so the looks below are the first to find it.
  await eventually(async () => assert.ok(await alarm(app)));
  await app.worker.evaluate(() => chrome.alarms.clear('reminders'));
  while (Date.now() <= at) await new Promise(resolve => setTimeout(resolve, 50));

  await app.worker.evaluate(() => {
    for (let i = 0; i < 3; i++) chrome.alarms.onAlarm.dispatch({ name: 'reminders' });
  });
  await eventually(async () => assert.deepEqual(await badgeColor(app), AMBER));
  // A moment for a second announcement, were there one.
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(await app.worker.evaluate(() => globalThis.announced), [`reminder:${at}`]);
});

test('reminders that came due together share one notification, which opens the Reminders section', async t => {
  const app = await start(t, { notifications: true });
  const now = Date.now();
  await setReminders(app, [reminderOf(TABS.jira1, now - MINUTE), reminderOf(TABS.api, now - HOUR)]);
  const shown = () => app.worker.evaluate(() => chrome.notifications.getAll());
  await eventually(async () => assert.deepEqual(Object.keys(await shown()), ['reminders']));

  await app.worker.evaluate(() => chrome.notifications.onClicked.dispatch('reminders'));
  await eventually(async () => {
    const tab = (await app.tabs()).find(tab => tab.url === app.url('page.html#reminders'));
    assert.ok(tab, 'the full page opened on its Reminders section');
    assert.equal(tab.active, true);
  });
  // Both are still due: showing them is not opening them.
  assert.equal((await reminders(app)).length, 2);

  // With the page open on another section, the next click sends it to Reminders.
  const page = app.context.pages().find(open => open.url() === app.url('page.html#reminders'));
  await page.locator('#side [data-section="groups"]:not([data-item])').click();
  assert.equal(await page.evaluate(() => location.hash), '#groups');
  // The same page follows its address: a mark left on it is still there, so it was not loaded anew.
  await page.evaluate(() => { window.sameLoad = true; });
  await app.worker.evaluate(() => chrome.notifications.onClicked.dispatch('reminders'));
  await eventually(async () => assert.equal(await page.locator('#main-head h2').textContent(), 'Reminders'));
  assert.equal(await page.evaluate(() => window.sameLoad), true);
  assert.equal((await app.tabs()).filter(tab => tab.url.startsWith(app.url('page.html'))).length, 1);
});
