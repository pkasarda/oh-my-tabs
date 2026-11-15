// Pin and mute (1.6): Pin tab / Unpin tab and Mute tab / Unmute tab in a row's ⋯ menu, the pin on a pinned
// tab's row and the speaker on a muted (or sounding) one, which unmutes it in one click. Headless Chromium plays
// no sound, so the speaker is checked on a muted tab; a sounding one takes the same path with audible set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, TABS, ALL_TABS } from './helpers.js';

async function start(t, options) {
  const app = await launch(options);
  t.after(() => app.close());
  await app.seed([ALL_TABS]);
  return app;
}

function tabOf(app, id) {
  return app.worker.evaluate(id => chrome.tabs.get(id), id);
}

// The popup with one group opened, and the row of one of its tabs.
async function popupRow(app, groupName, url) {
  const page = await app.openPopup();
  await page.locator(`#body details.group[data-key="${groupName}"] summary`).click();
  const id = await app.tabIdOf(url);
  return { page, id, row: page.locator(`#body .row[data-id="${id}"]`) };
}

async function chooseFromMenu(page, row, name) {
  await row.getByRole('button', { name: 'More tab actions' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('Pin tab in a row\'s menu pins the tab and puts a pin on its row; Unpin tab takes both back', async t => {
  const app = await start(t);
  const { page, id, row } = await popupRow(app, 'docs.example.org', TABS.api);
  assert.equal(await row.locator('.pin-mark').count(), 0);

  await chooseFromMenu(page, row, 'Pin tab');
  await eventually(async () => assert.equal((await tabOf(app, id)).pinned, true));
  await eventually(async () => assert.equal(await row.locator('.pin-mark').getAttribute('aria-label'), 'Pinned'));

  await chooseFromMenu(page, row, 'Unpin tab');
  await eventually(async () => assert.equal((await tabOf(app, id)).pinned, false));
  await eventually(async () => assert.equal(await row.locator('.pin-mark').count(), 0));
});

test('Mute tab in a row\'s menu mutes the tab; its speaker unmutes it in one click and goes away', async t => {
  const app = await start(t);
  const { page, id, row } = await popupRow(app, 'docs.example.org', TABS.api);
  // A quiet tab has no speaker.
  assert.equal(await row.locator('.sound').count(), 0);

  await chooseFromMenu(page, row, 'Mute tab');
  await eventually(async () => assert.equal((await tabOf(app, id)).mutedInfo.muted, true));
  const speaker = row.locator('.sound');
  await eventually(async () => assert.equal(await speaker.getAttribute('aria-label'), 'Unmute tab'));
  assert.match(await speaker.getAttribute('class'), /\bmuted\b/);

  // The menu offers the way back too.
  await row.getByRole('button', { name: 'More tab actions' }).click();
  assert.equal(await page.getByRole('menuitem', { name: 'Unmute tab', exact: true }).count(), 1);
  await page.keyboard.press('Escape');

  await speaker.click();
  await eventually(async () => assert.equal((await tabOf(app, id)).mutedInfo.muted, false));
  await eventually(async () => assert.equal(await row.locator('.sound').count(), 0));
});

test('a tab muted in the tab strip shows its speaker in an open popup', async t => {
  const app = await start(t);
  const { row, id } = await popupRow(app, 'Jira · WEB', TABS.jira1);
  await app.worker.evaluate(id => chrome.tabs.update(id, { muted: true }), id);
  await eventually(async () => assert.equal(await row.locator('.sound').getAttribute('aria-label'), 'Unmute tab'));
});

test('Settings → Features says how to back up the Library with the browser\'s bookmark export', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await page.locator('#settings-button').click();
  await page.locator('#tab-features').click();
  assert.match(await page.locator('#s-library-hint').textContent(), /To back it up: Bookmark manager → ⋮ → Export bookmarks\.$/);
});

// Headless Chromium has no audio output, so no tab ever turns audible: the popup and page are told this one plays.
function playing(app, url) {
  return app.context.addInitScript(url => {
    if (!globalThis.chrome?.windows?.getAll) return;
    const getAll = chrome.windows.getAll.bind(chrome.windows);
    chrome.windows.getAll = async (...args) => {
      const windows = await getAll(...args);
      for (const tab of windows.flatMap(window => window.tabs ?? [])) if (tab.url === url) tab.audible = true;
      return windows;
    };
  }, url);
}

function focusedRow(page) {
  return page.evaluate(() => Number(document.activeElement.closest('.row')?.dataset.id));
}

test('a closed group holding a tab that plays sound has a speaker; a click opens it on that tab, whose speaker mutes it', async t => {
  const app = await start(t);
  await playing(app, TABS.api);
  const page = await app.openPopup();
  const id = await app.tabIdOf(TABS.api);
  const docs = page.locator('#body details.group[data-key="docs.example.org"]');
  assert.equal(await docs.evaluate(el => el.open), false);
  const header = docs.locator('summary .sound');
  assert.equal(await header.getAttribute('aria-label'), 'Playing sound: show the tab');
  // Only that group.
  assert.equal(await page.locator('#body details.group summary .sound').count(), 1);

  await header.click();
  assert.equal(await docs.evaluate(el => el.open), true);
  assert.equal(await focusedRow(page), id);
  const speaker = docs.locator(`.row[data-id="${id}"] .sound`);
  assert.equal(await speaker.getAttribute('aria-label'), 'Mute tab');
  assert.doesNotMatch(await speaker.getAttribute('class'), /\bmuted\b/);

  await speaker.click();
  await eventually(async () => assert.equal((await tabOf(app, id)).mutedInfo.muted, true));
  await eventually(async () => assert.equal(await docs.locator(`.row[data-id="${id}"] .sound`).getAttribute('aria-label'), 'Unmute tab'));
  // Muted, it no longer plays: the header's speaker is gone.
  assert.equal(await docs.locator('summary .sound').count(), 0);
});

test('the Windows view puts the speaker on the window and on the group', async t => {
  const app = await start(t);
  await playing(app, TABS.jira1);
  const page = await app.openPopup();
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  await eventually(async () => assert.equal(await page.locator('#body details.win > summary .sound').count(), 1));
  const id = await app.tabIdOf(TABS.jira1);
  await page.locator('#body details.win > summary .sound').click();
  assert.equal(await focusedRow(page), id);
  assert.equal(await page.locator('#body details.win details.group > summary .sound').count(), 1);
});

test('the page\'s palette has no Go to tab playing sound while nothing plays', async t => {
  const quiet = await start(t);
  const still = await quiet.openPage();
  await still.keyboard.press('ControlOrMeta+k');
  await eventually(async () => assert.equal(await still.locator('#palette').evaluate(dialog => dialog.open), true));
  assert.equal(await still.locator('#palette-list [role="option"] .tt', { hasText: 'Go to tab playing sound' }).count(), 0);
});

test('Go to tab playing sound opens the closed group and focuses the tab', async t => {
  const app = await start(t);
  await playing(app, TABS.jira1);
  const page = await app.openPage();
  const id = await app.tabIdOf(TABS.jira1);
  await page.locator('[data-head="collapse"]').click();
  await page.keyboard.press('ControlOrMeta+k');
  await eventually(async () => assert.equal(await page.locator('#palette').evaluate(dialog => dialog.open), true));
  await page.locator('#palette-field').fill('playing');
  await page.keyboard.press('Enter');
  await eventually(async () => assert.equal(await focusedRow(page), id));
  assert.equal(await page.locator(`#body .row[data-id="${id}"]`).isVisible(), true);
});
