// The Library: saved tabs kept as bookmarks. Loaded with the bookmarks permission already granted (helpers.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, TABS, ALL_TABS, titleOf } from './helpers.js';

async function start(t, windows) {
  const app = await launch({ library: true });
  t.after(() => app.close());
  await app.seed(windows);
  return app;
}

// The saved tabs in the Library's folder, as "topic: url" ('' for no topic).
function savedTabs(app) {
  return app.worker.evaluate(async () => {
    const [found] = await chrome.bookmarks.search({ title: 'oh-my-tabs' });
    if (!found) return [];
    const [root] = await chrome.bookmarks.getSubTree(found.id);
    const lines = [];
    for (const node of root.children) {
      if (node.url) lines.push(`: ${node.url}`);
      for (const child of node.children ?? []) lines.push(`${node.title}: ${child.url}`);
    }
    return lines.sort();
  });
}

// Fills the Library as library.js lays it out: a folder in Other Bookmarks, topics as its subfolders.
function seedLibrary(app, topics) {
  return app.worker.evaluate(async topics => {
    const [tree] = await chrome.bookmarks.getTree();
    const other = tree.children.find(node => node.folderType === 'other');
    const root = await chrome.bookmarks.create({ parentId: other.id, title: 'oh-my-tabs' });
    for (const [topic, urls] of Object.entries(topics)) {
      let parent = root;
      if (topic) parent = await chrome.bookmarks.create({ parentId: root.id, title: topic });
      for (const url of urls) await chrome.bookmarks.create({ parentId: parent.id, title: url, url });
    }
  }, topics);
}

test('Save & close saves a tab into the Library and closes it; opening it brings it back', async t => {
  const app = await start(t, [ALL_TABS]);
  const page = await app.openPopup();
  const apiId = await app.tabIdOf(TABS.api);

  await page.locator('#body details.group[data-key="docs.example.org"] > summary').click();
  await page.locator(`[data-save="${apiId}"]`).click();
  await eventually(async () => assert.deepEqual(await savedTabs(app), [`: ${TABS.api}`]));
  await eventually(async () => assert.equal((await app.webUrls()).includes(TABS.api), false));
  assert.equal(await page.locator('#undo-text').textContent(), 'Closed 1 tab');

  await page.locator('[data-view="library"]').click();
  const saved = page.locator('#body .row[data-saved]');
  await eventually(async () => assert.deepEqual(await saved.locator('.title').allTextContents(), [titleOf(TABS.api)]));

  await saved.locator('[data-open-saved]').click();
  await eventually(async () => assert.equal((await app.webUrls()).includes(TABS.api), true));
  // Opening keeps it in the Library.
  assert.deepEqual(await savedTabs(app), [`: ${TABS.api}`]);
});

test('on the page the Library is a board with a column per topic', async t => {
  const app = await start(t, [[TABS.api]]);
  await seedLibrary(app, { '': [TABS.guide], 'Read later': [TABS.jira1, TABS.jira2], 'Client': [TABS.pr] });
  const page = await app.openPage('#library');

  const columns = page.locator('#body .board > .col[data-drop-topic]');
  assert.deepEqual(await columns.evaluateAll(cols => cols.map(col => col.getAttribute('aria-label'))), ['No topic', 'Read later', 'Client']);
  assert.deepEqual(await columns.locator('.col-head .g-meta').allTextContents(), ['1', '2', '1']);
  assert.equal(await page.locator('#body .board > .col-new').count(), 1);

  // A topic in the sidebar shows only its column.
  await page.locator('#side [data-section="library"][data-item="Client"]').click();
  await eventually(async () => assert.equal(await columns.count(), 1));
  assert.equal(await columns.getAttribute('aria-label'), 'Client');
  assert.equal(await page.evaluate(() => location.hash), '#library/Client');
});

test('dragging a card to another column changes its topic', async t => {
  const app = await start(t, [[TABS.api]]);
  await seedLibrary(app, { '': [TABS.guide], 'Client': [TABS.pr] });
  const page = await app.openPage('#library');

  const card = page.locator('#body .col[data-drop-topic=""] .row[data-saved]');
  await card.dragTo(page.locator('#body .col[data-drop-topic="Client"]'));
  await eventually(async () => assert.deepEqual(await savedTabs(app), [`Client: ${TABS.guide}`, `Client: ${TABS.pr}`]));
  await eventually(async () => {
    const counts = await page.locator('#body .board > .col[data-drop-topic] .col-head .g-meta').allTextContents();
    assert.deepEqual(counts, ['0', '2']);
  });
});

test('Close duplicates stays in the header in every view, disabled in the Library, and the switch never moves', async t => {
  const app = await start(t, [ALL_TABS]);
  const page = await app.openPopup();
  const dups = page.locator('#close-dups');
  const switchX = async () => (await page.locator('.head .seg').boundingBox()).x;
  const x = await switchX();
  for (const [view, disabled] of [['windows', false], ['library', true], ['groups', false]]) {
    await page.locator(`[data-view="${view}"]`).click();
    await eventually(async () => assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('aria-pressed'), 'true'));
    assert.equal(await dups.isVisible(), true, view);
    assert.equal(await dups.isDisabled(), disabled, view);
    assert.equal(await dups.getAttribute('aria-label'), 'Close duplicates (2)', view);
    assert.equal(await switchX(), x, view);
  }

  // The full page has it too, disabled on the Library board.
  const full = await app.openPage();
  assert.equal(await full.locator('#close-dups').isDisabled(), false);
  await full.locator('#side [data-section="library"]:not([data-item])').click();
  await eventually(async () => assert.equal(await full.locator('#close-dups').isDisabled(), true));
});
