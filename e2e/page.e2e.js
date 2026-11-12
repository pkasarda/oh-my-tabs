// The full page (page.html): sidebar, address hash, keyboard tree, checkboxes and the sidebar's width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, TABS, ALL_TABS } from './helpers.js';

async function start(t) {
  const app = await launch();
  t.after(() => app.close());
  await app.seed([ALL_TABS]);
  return app;
}

async function shownGroups(page) {
  return page.locator('#body details.group > summary .g-name').allTextContents();
}

function sideItem(page, view, item) {
  return page.locator(`#side [data-section="${view}"][data-item="${item}"]`);
}

function hashOf(page) {
  return page.evaluate(() => location.hash);
}

// What has focus, as "group <key>" for a header or "row <tab id>" for a tab row.
function focused(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element.matches('summary')) return `group ${element.parentElement.dataset.key}`;
    if (element.matches('.row-main')) return `row ${element.dataset.switch}`;
    return element.tagName;
  });
}

// The page records an opened group in its 'toggle' listener, which the browser runs a moment after
// details.open changes. A re-render before that (Space does one) would close the group again, so the tests wait
// for the event the way a person's next key press comes later.
async function pressAndAwaitToggle(page, key) {
  const toggled = page.evaluate(() => new Promise(resolve => {
    document.querySelector('#body').addEventListener('toggle', resolve, { once: true, capture: true });
  }));
  await page.keyboard.press(key);
  await toggled;
}

test('an old popup.html?page address moves to page.html and keeps the hash', async t => {
  const app = await start(t);
  const page = await app.context.newPage();
  await page.goto(app.url('popup.html?page#windows'));
  await page.waitForURL(app.url('page.html#windows'));
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.equal(await page.locator('#main-head h2').textContent(), 'Windows');
});

test('a sidebar item shows only its group, and the hash keeps it across a reload', async t => {
  const app = await start(t);
  const page = await app.openPage();
  assert.deepEqual(await shownGroups(page), ['acme/client', 'docs.example.org', 'Jira · WEB']);

  await sideItem(page, 'groups', 'Jira · WEB').click();
  await eventually(async () => assert.deepEqual(await shownGroups(page), ['Jira · WEB']));
  assert.equal(await hashOf(page), '#groups/Jira%20%C2%B7%20WEB');
  assert.equal(await page.locator('#main-head h2').textContent(), 'Jira · WEB');
  assert.equal(await sideItem(page, 'groups', 'Jira · WEB').getAttribute('aria-current'), 'true');

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.deepEqual(await shownGroups(page), ['Jira · WEB']);
  assert.equal(await hashOf(page), '#groups/Jira%20%C2%B7%20WEB');
});

test('a window item shows only that window', async t => {
  const app = await launch();
  t.after(() => app.close());
  await app.seed([[TABS.pr, TABS.prFiles], [TABS.jira1, TABS.jira2]]);
  const jiraWindow = (await app.webTabs()).find(tab => tab.url === TABS.jira1).windowId;
  const page = await app.openPage(`#windows/${jiraWindow}`);
  const cards = page.locator('#body details.win');
  assert.equal(await cards.count(), 1);
  assert.equal(await cards.getAttribute('id'), `win-${jiraWindow}`);
});

test('a name in the hash that does not exist falls back to the whole section', async t => {
  const app = await start(t);
  const page = await app.openPage('#groups/no-such-group');
  assert.equal(await hashOf(page), '#groups');
  assert.equal(await page.locator('#main-head h2').textContent(), 'Groups');
  assert.deepEqual(await shownGroups(page), ['acme/client', 'docs.example.org', 'Jira · WEB']);
});

test('tree keys move, open, close and check', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('#body summary').first().focus();
  assert.equal(await focused(page), 'group acme/client');

  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'group docs.example.org');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'group acme/client');

  // → opens the group, a second → goes into it.
  const repo = page.locator('#body details.group[data-key="acme/client"]');
  await pressAndAwaitToggle(page, 'ArrowRight');
  assert.equal(await repo.evaluate(details => details.open), true);
  await page.keyboard.press('ArrowRight');
  const row = await focused(page);
  assert.match(row, /^row \d+$/);
  const tabId = row.split(' ')[1];

  // Space checks the focused row and does not switch to it.
  await page.keyboard.press('Space');
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '1 selected'));
  assert.equal(await page.locator(`.pick[data-pick="${tabId}"]`).isChecked(), true);
  assert.equal(await page.locator('#bulk-bar').isVisible(), true);
  assert.equal(await focused(page), row);

  // ← goes up to the header, a second ← closes the group.
  await page.keyboard.press('ArrowLeft');
  assert.equal(await focused(page), 'group acme/client');
  await pressAndAwaitToggle(page, 'ArrowLeft');
  assert.equal(await repo.evaluate(details => details.open), false);
});

test('Enter on a tab row switches to that tab', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('#body summary').first().focus();
  await pressAndAwaitToggle(page, 'ArrowRight');
  await page.keyboard.press('ArrowRight');
  const tabId = Number((await focused(page)).split(' ')[1]);
  await page.keyboard.press('Enter');
  await eventually(async () => {
    const tabs = await app.tabs();
    assert.equal(tabs.find(tab => tab.id === tabId).active, true);
  });
});

test('bulk Close closes the checked tabs and Undo brings them back', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('[data-pick-group="Jira · WEB"]').click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '2 selected'));

  await page.locator('[data-bulk="close"]').click();
  const rest = ALL_TABS.filter(url => !url.includes('atlassian')).sort();
  await eventually(async () => assert.deepEqual(await app.webUrls(), rest));
  assert.equal(await page.locator('#undo-text').textContent(), 'Closed 2 tabs');
  await eventually(async () => assert.equal(await page.locator('#bulk-bar').isHidden(), true));

  await page.locator('#undo-button').click();
  await eventually(async () => assert.deepEqual(await app.webUrls(), [...ALL_TABS].sort()));
});

test('a check hidden by the sidebar choice is kept but not acted on', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('[data-pick-group="Jira · WEB"]').click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '2 selected'));

  await sideItem(page, 'groups', 'acme/client').click();
  await eventually(async () => assert.equal(await page.locator('#bulk-bar').isHidden(), true));
  await page.locator('[data-pick-group="acme/client"]').click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '3 selected'));

  // Back on the whole section the hidden Jira checks are still there.
  const allGroups = page.locator('#side [data-section="groups"]:not([data-item])');
  await allGroups.click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '5 selected'));

  await sideItem(page, 'groups', 'acme/client').click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '3 selected'));
  await page.locator('[data-bulk="close"]').click();
  const rest = ALL_TABS.filter(url => !url.includes('github.com')).sort();
  await eventually(async () => assert.deepEqual(await app.webUrls(), rest));
});

test('the sidebar width follows the keyboard and a drag, within 180–480, and survives a reload', async t => {
  const app = await start(t);
  const page = await app.openPage();
  const handle = page.locator('#side-resize');
  const width = async () => Number(await handle.getAttribute('aria-valuenow'));
  const sideWidth = () => page.locator('#side').evaluate(side => Math.round(side.getBoundingClientRect().width));
  assert.equal(await width(), 240);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await width(), 272);
  assert.equal(await sideWidth(), 272);
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
  assert.equal(await width(), 180);

  const box = await handle.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(400, y, { steps: 5 });
  assert.equal(await width(), 400);
  await page.mouse.move(900, y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await width(), 480);
  assert.equal(await sideWidth(), 480);

  await eventually(async () => {
    const stored = await app.worker.evaluate(() => chrome.storage.local.get('sideWidth'));
    assert.equal(stored.sideWidth, 480);
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.equal(await width(), 480);
  assert.equal(await sideWidth(), 480);
});
