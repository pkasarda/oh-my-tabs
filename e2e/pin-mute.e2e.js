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
