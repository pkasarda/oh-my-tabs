// The popup (popup.html), opened as a tab. Each test starts a browser of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, TABS, ALL_TABS, titleOf } from './helpers.js';

async function start(t, options) {
  const app = await launch(options);
  t.after(() => app.close());
  await app.seed([ALL_TABS]);
  return app;
}

// Group cards (two or more tabs) as "name count", in the order shown.
async function groupHeaders(page) {
  return page.locator('#body details.group > summary').evaluateAll(summaries => summaries.map(summary => {
    const name = summary.querySelector('.g-name').textContent;
    const count = summary.querySelector('.g-meta').textContent;
    return `${name} ${count}`;
  }));
}

function group(page, name) {
  return page.locator(`#body details.group[data-key="${name}"]`);
}

test('developer mode groups tabs per repo and Jira project', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  assert.deepEqual(await groupHeaders(page), ['acme/client 3', 'docs.example.org 3', 'Jira · WEB 2']);
});

test('without developer mode tabs are grouped per hostname', async t => {
  const app = await start(t, { settings: { dev: false } });
  const page = await app.openPopup();
  assert.deepEqual(await groupHeaders(page), ['docs.example.org 3', 'github.com 3', 'acme.atlassian.net 2']);
  // pull/12 and pull/12/files are one page only to the GitHub rule.
  assert.equal(await page.locator('#close-dups').textContent(), 'Close duplicates (1)');
});

test('duplicates are counted and nested under their keeper', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  assert.equal(await page.locator('#close-dups').textContent(), 'Close duplicates (2)');
  const repo = group(page, 'acme/client');
  assert.equal(await repo.locator('summary .dup-count').textContent(), '1 dup');

  await repo.locator('summary').click();
  // The copy is hidden under its keeper until "+1 copy" opens it.
  assert.equal(await repo.locator('.row:visible').count(), 2);
  const copies = repo.locator('[data-copies]');
  assert.equal(await copies.textContent(), '+1 copy');
  await copies.click();
  await eventually(async () => assert.equal(await repo.locator('.row.nested').count(), 1));
  assert.equal(await repo.locator('[data-copies]').getAttribute('aria-expanded'), 'true');
});

test('Close duplicates closes every copy and keeps every keeper', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await page.locator('#close-dups').click();
  // The keeper is the copy used last; the seed opened pull/12/files and guide#intro last.
  const expected = ALL_TABS.filter(url => url !== TABS.pr && url !== TABS.guide).sort();
  await eventually(async () => assert.deepEqual(await app.webUrls(), expected));
  await eventually(async () => assert.equal(await page.locator('#close-dups').textContent(), 'Close duplicates (0)'));
  assert.equal(await page.locator('#close-dups').isDisabled(), true);
  // Nothing is lost, so there is nothing to undo.
  assert.equal(await page.locator('#undo-bar').isHidden(), true);
});

test('Close group can be undone', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await group(page, 'Jira · WEB').locator('[data-menu="group"]').click();
  await page.locator('#menu').getByRole('menuitem', { name: 'Close group' }).click();
  await eventually(async () => assert.equal((await app.webUrls()).length, ALL_TABS.length - 2));
  assert.equal(await page.locator('#undo-text').textContent(), 'Closed 2 tabs');

  await page.locator('#undo-button').click();
  await eventually(async () => assert.deepEqual(await app.webUrls(), [...ALL_TABS].sort()));
  await eventually(async () => assert.deepEqual(await groupHeaders(page), ['acme/client 3', 'docs.example.org 3', 'Jira · WEB 2']));
});

test('search narrows the list and ignores case and accents', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  // The search field has focus when the popup opens.
  await page.keyboard.type('CESTOVNE');
  await eventually(async () => assert.equal(await page.locator('#results-bar [role="status"]').textContent(), '2 results'));
  const titles = await page.locator('#body .row:visible .title').allTextContents();
  assert.deepEqual(titles, [titleOf(TABS.guide)]);

  await page.locator('#search').fill('web-2');
  await eventually(async () => {
    const shown = await page.locator('#body .row:visible .title').allTextContents();
    assert.deepEqual(shown, [titleOf(TABS.jira2)]);
  });
});

test('the Windows view lists each window with its groups', async t => {
  const app = await launch();
  t.after(() => app.close());
  await app.seed([[TABS.pr, TABS.prFiles, TABS.issue], [TABS.jira1, TABS.jira2]]);
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await eventually(async () => assert.equal(await page.locator('[data-view="windows"]').getAttribute('aria-pressed'), 'true'));

  const cards = page.locator('#body details.win');
  const names = await cards.locator(':scope > summary .g-name').allTextContents();
  // The popup's own tab is in one of the windows too.
  assert.equal(names.length, 2);
  assert.ok(names.some(name => name.startsWith('acme/client')), names.join(', '));
  assert.ok(names.some(name => name.startsWith('Jira · WEB')), names.join(', '));
  const stats = await cards.locator('.win-stats').allTextContents();
  assert.ok(stats.some(line => line.startsWith('3 tabs · 1 site · 1 dup')), stats.join(' | '));
});

test('a group moves to a new window', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  const before = await app.tabs();
  const firstWindow = before.find(tab => tab.url === TABS.pr).windowId;

  await group(page, 'Jira · WEB').locator('[data-group-new-window]').click();
  await eventually(async () => {
    const tabs = await app.webTabs();
    const jira = tabs.filter(tab => tab.url.includes('atlassian'));
    const others = tabs.filter(tab => !tab.url.includes('atlassian'));
    assert.equal(jira.length, 2);
    assert.notEqual(jira[0].windowId, firstWindow);
    assert.equal(jira[0].windowId, jira[1].windowId);
    assert.ok(others.every(tab => tab.windowId === firstWindow));
  });
});

// 1.2.1: a settings panel taller than the popup ran off its bottom edge.
test('the settings panel scrolls when it is taller than the popup', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await page.setViewportSize({ width: 780, height: 360 });
  await page.locator('#settings-button').click();
  const panel = page.locator('#settings');
  await eventually(async () => assert.equal(await panel.evaluate(el => el.matches(':popover-open')), true));

  const box = await panel.evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  assert.ok(box.bottom <= 360, `panel ends at ${box.bottom}`);
  assert.ok(box.scrollHeight > box.clientHeight, 'panel has more content than fits');

  // The last control is reachable inside the panel.
  const last = page.locator('#change-shortcuts');
  await last.scrollIntoViewIfNeeded();
  const lastBox = await last.boundingBox();
  assert.ok(lastBox.y + lastBox.height <= box.bottom, `Change… ends at ${lastBox.y + lastBox.height}`);
});
