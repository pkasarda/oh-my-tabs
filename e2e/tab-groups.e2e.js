// The browser's tab groups (#31). Most tests load the extension with the tabGroups permission granted (helpers.js);
// the "off" state and the hint row use the extension as it ships, where the permission is optional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, TABS, ALL_TABS, titleOf } from './helpers.js';

async function start(t, windows, options = { tabGroups: true }) {
  const app = await launch(options);
  t.after(() => app.close());
  await app.seed(windows);
  return app;
}

async function windowOf(app, url) {
  return (await app.webTabs()).find(tab => tab.url === url).windowId;
}

// The direct children of a window card, as their data-key, in the order shown.
function windowParts(page, windowId) {
  return page.locator(`#win-${windowId} > .win-body > details.group`).evaluateAll(parts => parts.map(part => part.dataset.key));
}

function tabGroupCard(page, id) {
  return page.locator(`#body details.tg[data-key="tg:${id}"]`);
}

function menuItems(page) {
  return page.locator('#menu [role="menuitem"]').allTextContents();
}

test('off: the list is as before, and a hint row offers tab groups once some tab is in one', async t => {
  const app = await start(t, [ALL_TABS], {});
  const page = await app.openPopup();
  assert.equal(await page.locator('#results-bar').isHidden(), true);

  await app.makeTabGroup([TABS.jira1, TABS.jira2]);
  const hint = page.locator('#results-bar');
  await eventually(async () => assert.equal(await hint.locator('span').textContent(), 'You use tab groups. Show them here?'));
  assert.equal(await page.locator('#tab-groups-on').textContent(), 'Turn on');
  // Nothing of tab groups in either view.
  const headers = await page.locator('#body details.group > summary .g-name').allTextContents();
  assert.deepEqual(headers, ['acme/client', 'docs.example.org', 'Jira · WEB']);
  assert.equal(await page.locator('.tg-chip').count(), 0);
  await page.locator('[data-view="windows"]').click();
  await eventually(async () => assert.equal(await page.locator('#body details.win').count(), 1));
  assert.equal(await page.locator('#body details.tg').count(), 0);
  await page.locator('#settings-button').click();
  await page.locator('#tab-features').click();
  assert.equal(await page.locator('#s-tab-groups').isChecked(), false);
  await page.keyboard.press('Escape');

  // The dismiss is remembered.
  await page.locator('#tab-groups-hint-close').click();
  await eventually(async () => assert.equal(await hint.isHidden(), true));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.equal(await page.locator('#results-bar').isHidden(), true);
  assert.equal(await app.worker.evaluate(async () => (await chrome.storage.local.get('tabGroupHint')).tabGroupHint), false);
});

test('Turn on in the hint asks for the tabGroups permission and turns the switch on', async t => {
  const app = await start(t, [ALL_TABS], {});
  await app.makeTabGroup([TABS.jira1, TABS.jira2]);
  const page = await app.openPopup();
  // A headless browser never answers the permission prompt: answer it here and note what was asked.
  await page.evaluate(() => {
    chrome.permissions.request = async request => {
      window.asked = request;
      return true;
    };
  });
  await page.locator('#tab-groups-on').click();
  await eventually(async () => assert.equal(await page.locator('#results-bar').isHidden(), true));
  assert.deepEqual(await page.evaluate(() => window.asked), { permissions: ['tabGroups'] });
  assert.equal(await page.locator('#s-tab-groups').isChecked(), true);
});

test('Windows view: window, then its tab groups in tab strip order, then its groups', async t => {
  const urls = [TABS.pr, TABS.prFiles, TABS.issue, TABS.jira1, TABS.jira2, TABS.guide, TABS.guideIntro, TABS.api];
  const app = await start(t, [urls]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'blue' });
  const unnamed = await app.makeTabGroup([TABS.issue, TABS.guide, TABS.guideIntro, TABS.api], { color: 'green', collapsed: true });
  const windowId = await windowOf(app, TABS.pr);
  const page = await app.openPopup();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('[data-view="windows"]').click();

  const tabs = await app.webTabs();
  const firstIndex = id => Math.min(...tabs.filter(tab => tab.groupId === id).map(tab => tab.index));
  const order = [sprint, unnamed].sort((a, b) => firstIndex(a) - firstIndex(b)).map(id => `tg:${id}`);
  await eventually(async () => assert.deepEqual(await windowParts(page, windowId), [...order, `w:${windowId}:acme/client`]));

  // The header: a stripe in its color, its name and count. One without a name is named like a window.
  const card = tabGroupCard(page, sprint);
  assert.equal(await card.locator('.g-name').textContent(), 'Sprint');
  assert.equal(await card.locator('.g-meta').textContent(), '2');
  assert.equal(await card.locator('.tg-stripe').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(37, 99, 235)');
  const other = tabGroupCard(page, unnamed);
  assert.equal(await other.locator(':scope > summary .g-name').textContent(), 'docs.example.org & 1 more');
  assert.equal(await other.locator('.tg-stripe').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(22, 163, 74)');

  // Collapsed in the browser: collapsed here. Opening it here leaves the browser alone.
  assert.equal(await card.evaluate(el => el.open), true);
  assert.equal(await other.evaluate(el => el.open), false);
  await other.locator(':scope > summary').click();
  await eventually(async () => assert.equal(await other.evaluate(el => el.open), true));
  assert.equal((await app.tabGroup(unnamed)).collapsed, true);

  // Inside: its tabs in tab strip order, no groups, the copy nested under its keeper.
  assert.equal(await other.locator('details').count(), 0);
  const ids = await other.locator('.row:visible').evaluateAll(rows => rows.map(row => Number(row.dataset.id)));
  const inOrder = tabs.filter(tab => tab.groupId === unnamed && ids.includes(tab.id)).sort((a, b) => a.index - b.index).map(tab => tab.id);
  assert.deepEqual(ids, inOrder);
  assert.equal(ids.length, 3);
  assert.equal(await other.locator('.copies').textContent(), '+1 copy');

  await card.locator('[data-menu="tab-group"]').click();
  assert.deepEqual(await menuItems(page), ['Move to new window', 'Suspend · 2', 'Close']);
});

test('Groups view: a tab in a tab group carries its dot and name; search finds the name', async t => {
  const app = await start(t, [ALL_TABS]);
  await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'red' });
  const page = await app.openPopup();

  const headers = await page.locator('#body details.group > summary .g-name').allTextContents();
  assert.deepEqual(headers, ['acme/client', 'docs.example.org', 'Jira · WEB']);
  const chips = page.locator('#body details.group[data-key="Jira · WEB"] .tg-chip');
  assert.deepEqual(await chips.allTextContents(), ['Sprint', 'Sprint']);
  assert.equal(await page.locator('#body .tg-chip').count(), 2);

  await page.locator('#search').fill('sprint');
  await eventually(async () => assert.equal(await page.locator('#results-bar [role="status"]').textContent(), '2 results'));
  const titles = await page.locator('#body .row:visible .title').allTextContents();
  assert.deepEqual(titles.sort(), [titleOf(TABS.jira1), titleOf(TABS.jira2)].sort());
});

test('page: a window\'s tab groups are sidebar items; a gone tab group falls back to its window', async t => {
  const app = await start(t, [ALL_TABS]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'cyan' });
  const windowId = await windowOf(app, TABS.jira1);
  const page = await app.openPage('#windows');

  const item = page.locator(`#side [data-section="windows"][data-item="${windowId}:${sprint}"]`);
  assert.equal(await item.locator('.nm').textContent(), 'Sprint');
  assert.equal(await item.locator('.n').textContent(), '2');
  await item.click();
  await eventually(async () => assert.equal(await page.evaluate(() => location.hash), `#windows/${windowId}%3A${sprint}`));
  assert.equal(await page.locator('.main-title h2').textContent(), 'Sprint');
  const titles = await page.locator('#body .row .title').allTextContents();
  assert.deepEqual(titles.sort(), [titleOf(TABS.jira1), titleOf(TABS.jira2)].sort());

  // Its header's checkbox checks its tabs.
  await page.locator(`.pick[data-pick-tab-group="${sprint}"]`).click();
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '2 selected'));

  // Ungrouped in the browser: the tab group is gone and the page shows its window.
  await app.worker.evaluate(async ids => chrome.tabs.ungroup(ids), [await app.tabIdOf(TABS.jira1), await app.tabIdOf(TABS.jira2)]);
  await eventually(async () => assert.equal(await page.evaluate(() => location.hash), `#windows/${windowId}`));

  // A stale link does the same.
  const stale = await app.openPage(`#windows/${windowId}%3A99999`);
  assert.equal(await stale.evaluate(() => location.hash), `#windows/${windowId}`);
});

test('Move to new window moves the whole tab group, with its name and color, and no blank tab', async t => {
  const app = await start(t, [ALL_TABS]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'purple' });
  const before = await windowOf(app, TABS.pr);
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await tabGroupCard(page, sprint).locator('[data-menu="tab-group"]').click();
  await page.locator('#menu').getByRole('menuitem', { name: 'Move to new window' }).click();

  await eventually(async () => {
    const tabGroup = await app.tabGroup(sprint);
    assert.notEqual(tabGroup.windowId, before);
    assert.equal(tabGroup.title, 'Sprint');
    assert.equal(tabGroup.color, 'purple');
    const inWindow = (await app.tabs()).filter(tab => tab.windowId === tabGroup.windowId);
    assert.deepEqual(inWindow.map(tab => tab.url).sort(), [TABS.jira1, TABS.jira2]);
  });
});

test('a tab group header dropped on a window in the sidebar moves it as a tab group', async t => {
  const app = await start(t, [[TABS.pr, TABS.prFiles, TABS.jira1, TABS.jira2], [TABS.guide, TABS.api]]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'orange' });
  const target = await windowOf(app, TABS.guide);
  const page = await app.openPage(`#windows/${await windowOf(app, TABS.pr)}`);
  await page.locator(`summary[data-drag-tab-group="${sprint}"]`).dragTo(page.locator(`#side [data-section="windows"][data-item="${target}"]`));
  await eventually(async () => {
    const tabGroup = await app.tabGroup(sprint);
    assert.equal(tabGroup.windowId, target);
    assert.equal(tabGroup.title, 'Sprint');
    assert.equal(tabGroup.color, 'orange');
  });
});

test('a single tab moved to another window leaves its tab group, as the browser does', async t => {
  const app = await start(t, [[TABS.pr, TABS.jira1, TABS.jira2], [TABS.guide, TABS.api]]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'blue' });
  const target = await windowOf(app, TABS.guide);
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  const jira2 = await app.tabIdOf(TABS.jira2);
  // The popup opens in the last window; the tab group's window card starts closed.
  await page.locator(`#win-${await windowOf(app, TABS.pr)} > summary`).click();
  await page.locator(`.row[data-id="${jira2}"] [data-menu="row"]`).click();
  await page.locator('#menu').getByRole('menuitem', { name: 'Move to window' }).click();
  await page.locator('#menu [role="menuitem"]').filter({ hasText: 'docs.example.org' }).click();

  await eventually(async () => {
    const tab = (await app.tabs()).find(t => t.id === jira2);
    assert.equal(tab.windowId, target);
    assert.equal(tab.groupId, -1);
  });
  const left = (await app.tabs()).filter(tab => tab.groupId === sprint);
  assert.deepEqual(left.map(tab => tab.url), [TABS.jira1]);
});

test('Undo after closing a whole tab group brings it back with its name and color', async t => {
  const app = await start(t, [ALL_TABS]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'pink' });
  const windowId = await windowOf(app, TABS.jira1);
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await tabGroupCard(page, sprint).locator('[data-menu="tab-group"]').click();
  await page.locator('#menu').getByRole('menuitem', { name: 'Close', exact: true }).click();
  await eventually(async () => assert.equal((await app.webUrls()).length, ALL_TABS.length - 2));

  await page.locator('#undo-button').click();
  await eventually(async () => {
    const jira = (await app.tabs()).filter(tab => tab.url.includes('atlassian'));
    assert.equal(jira.length, 2);
    assert.notEqual(jira[0].groupId, -1);
    assert.equal(jira[0].groupId, jira[1].groupId);
    const tabGroup = await app.tabGroup(jira[0].groupId);
    assert.equal(tabGroup.title, 'Sprint');
    assert.equal(tabGroup.color, 'pink');
    assert.equal(tabGroup.windowId, windowId);
  });
});

test('Undo after closing some tabs of a tab group puts them back into it', async t => {
  const app = await start(t, [ALL_TABS]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'yellow' });
  const page = await app.openPage('#windows');
  const jira2 = await app.tabIdOf(TABS.jira2);
  await page.locator(`.pick[data-pick="${jira2}"]`).click();
  await page.locator('[data-bulk="close"]').click();
  await eventually(async () => assert.equal((await app.webUrls()).includes(TABS.jira2), false));

  await page.locator('#undo-button').click();
  await eventually(async () => {
    const back = (await app.tabs()).find(tab => tab.url === TABS.jira2);
    assert.equal(back?.groupId, sprint);
  });
});

test('Save & close on a tab group offers its name as the topic', async t => {
  const app = await start(t, [ALL_TABS], { tabGroups: true, library: true });
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'grey' });
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await tabGroupCard(page, sprint).locator('[data-menu="tab-group"]').click();
  assert.deepEqual(await menuItems(page), ['Save & close', 'Move to new window', 'Suspend · 2', 'Close']);
  await page.locator('#menu').getByRole('menuitem', { name: 'Save & close' }).click();

  assert.equal(await page.locator('#topic-name').inputValue(), 'Sprint');
  assert.equal(await page.locator('#topic-label-text').textContent(), 'Save to topic');
  await page.locator('#topic-ok').click();
  await eventually(async () => assert.equal((await app.webUrls()).some(url => url.includes('atlassian')), false));
  const saved = await app.worker.evaluate(async () => {
    const [topic] = await chrome.bookmarks.search({ title: 'Sprint' });
    return (await chrome.bookmarks.getChildren(topic.id)).map(node => node.url).sort();
  });
  assert.deepEqual(saved, [TABS.jira1, TABS.jira2]);
});

test('Undo after closing a window brings its tab groups back with their names and colors', async t => {
  // The popup opens in the last window, so the first one is closed.
  const app = await start(t, [[TABS.jira1, TABS.jira2, TABS.guide], [TABS.pr]]);
  await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'cyan' });
  const closing = await windowOf(app, TABS.jira1);
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await page.locator(`#win-${closing} [data-menu="window"]`).click();
  await page.locator('#menu').getByRole('menuitem', { name: 'Close window' }).click();
  await eventually(async () => assert.deepEqual(await app.webUrls(), [TABS.pr]));

  await page.locator('#undo-button').click();
  await eventually(async () => {
    const tabs = await app.webTabs();
    const jira = tabs.filter(tab => tab.url.includes('atlassian'));
    assert.equal(jira.length, 2);
    assert.notEqual(jira[0].groupId, -1);
    assert.equal(jira[0].groupId, jira[1].groupId);
    const tabGroup = await app.tabGroup(jira[0].groupId);
    assert.equal(tabGroup.title, 'Sprint');
    assert.equal(tabGroup.color, 'cyan');
    assert.equal(tabs.find(tab => tab.url === TABS.guide).groupId, -1);
  });
});

test('a copy whose keeper is outside its tab group says where the keeper is, and nests under nothing', async t => {
  const app = await start(t, [[TABS.pr, TABS.jira1, TABS.guide, TABS.guideIntro, TABS.api]]);
  await app.makeTabGroup([TABS.jira1, TABS.guideIntro], { title: 'Login fix', color: 'red' });
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();

  // Both tabs show, one of them marked as the copy; no keeper counts a copy it does not hold.
  const pill = page.locator('#body .copy-pill');
  await eventually(async () => assert.equal(await pill.count(), 1));
  assert.equal(await page.locator('#body .copies').count(), 0);
  const ids = [await app.tabIdOf(TABS.guide), await app.tabIdOf(TABS.guideIntro)];
  for (const id of ids) assert.equal(await page.locator(`#body .row[data-id="${id}"]`).count(), 1);
  const copyInTabGroup = await pill.evaluate(el => Boolean(el.closest('details.tg')));
  const expected = copyInTabGroup ? 'Copy of a tab in this window, outside this tab group' : 'Copy of a tab in the tab group Login fix';
  assert.equal(await pill.getAttribute('data-tip'), expected);
});

test('with only some of its tabs shown, Move to new window moves just those', async t => {
  const app = await start(t, [ALL_TABS]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'blue' });
  const before = await windowOf(app, TABS.jira1);
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await page.locator('#search').fill('WEB-1');
  await eventually(async () => assert.equal(await tabGroupCard(page, sprint).locator('.row').count(), 1));
  await tabGroupCard(page, sprint).locator('[data-menu="tab-group"]').click();
  await page.locator('#menu').getByRole('menuitem', { name: 'Move to new window' }).click();

  await eventually(async () => assert.notEqual(await windowOf(app, TABS.jira1), before));
  const jira2 = (await app.webTabs()).find(tab => tab.url === TABS.jira2);
  assert.equal(jira2.windowId, before);
  assert.equal(jira2.groupId, sprint);
});

test('search does not match the name made up for an unnamed tab group', async t => {
  const app = await start(t, [ALL_TABS]);
  await app.makeTabGroup([TABS.issue, TABS.guide], { color: 'green' });
  const page = await app.openPopup();
  await page.locator('[data-view="windows"]').click();
  await page.locator('#search').fill('more');
  await eventually(async () => assert.equal(await page.locator('#results-bar [role="status"]').textContent(), '0 results'));
});

test('moving a tab group that is gone meanwhile leaves no stray window', async t => {
  const app = await start(t, [ALL_TABS]);
  const sprint = await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'blue' });
  const page = await app.openPopup();
  const errors = [];
  page.on('pageerror', error => errors.push(error));
  await page.locator('[data-view="windows"]').click();
  await tabGroupCard(page, sprint).locator('[data-menu="tab-group"]').click();
  // While the menu is open the list does not re-render, so it still offers the tab group.
  await app.worker.evaluate(async ids => chrome.tabs.ungroup(ids), [await app.tabIdOf(TABS.jira1), await app.tabIdOf(TABS.jira2)]);
  await page.locator('#menu').getByRole('menuitem', { name: 'Move to new window' }).click();
  await new Promise(resolve => setTimeout(resolve, 500));
  const windows = await app.worker.evaluate(() => chrome.windows.getAll());
  assert.equal(windows.length, 1);
  assert.deepEqual(errors, []);
});

test('after a revoke and a new grant the list listens to the new tab groups API', async t => {
  const app = await start(t, [ALL_TABS]);
  const page = await app.openPopup();
  const added = await page.evaluate(async () => {
    const real = chrome.tabGroups;
    chrome.permissions.onRemoved.dispatch({ permissions: ['tabGroups'] });
    // The API a new grant brings, with events that note who listens.
    const listened = [];
    const event = name => ({ addListener: () => listened.push(name), removeListener() {} });
    const fresh = { query: options => real.query(options), get: id => real.get(id) };
    for (const name of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved']) fresh[name] = event(name);
    // popup.js uses `browser`, which this Chromium has as an object of its own beside `chrome`.
    for (const api of new Set([chrome, globalThis.browser])) Object.defineProperty(api, 'tabGroups', { value: fresh, configurable: true });
    chrome.permissions.onAdded.dispatch({ permissions: ['tabGroups'] });
    return listened;
  });
  assert.deepEqual(added, ['onCreated', 'onUpdated', 'onRemoved', 'onMoved']);
});

test('a long tab group name ends in an ellipsis', async t => {
  const app = await start(t, [ALL_TABS]);
  await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'A very long tab group name for the checkout and footer work', color: 'blue' });
  const page = await app.openPopup();
  const name = page.locator('#body .tg-chip .tg-name').first();
  await eventually(async () => assert.equal(await name.count(), 1));
  const style = await name.evaluate(el => ({ cut: el.scrollWidth > el.clientWidth, overflow: getComputedStyle(el).textOverflow }));
  assert.deepEqual(style, { cut: true, overflow: 'ellipsis' });
});
