// The full page's 1.3 additions: the command palette, the details pane, the tree toolbar, the status bar, the
// collapsible sidebar, right click and Shift+click. Right click is tested in the popup too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, TABS, ALL_TABS } from './helpers.js';

async function start(t, { windows = [ALL_TABS], ...options } = {}) {
  const app = await launch(options);
  t.after(() => app.close());
  await app.seed(windows);
  return app;
}

async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
}

// What has focus, as "group <key>" for a header, "row <tab id>" for a tab row, or the element's id.
function focused(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element.matches('summary')) return `group ${element.parentElement.dataset.key}`;
    if (element.matches('.row-main')) return `row ${element.dataset.switch}`;
    return element.id || element.tagName;
  });
}

async function isActive(app, id) {
  return (await app.tabs()).find(tab => tab.id === id).active;
}

// A tab's id is in its row's dataset; the row itself is found by its address.
async function rowOf(page, app, url) {
  const id = await app.tabIdOf(url);
  return { id, row: page.locator(`#body .row[data-id="${id}"]`) };
}

// ---------- command palette ----------
function palette(page) {
  return page.locator('#palette');
}

async function paletteOpen(page) {
  return palette(page).evaluate(dialog => dialog.open);
}

// The palette's items by section, as the visible labels.
function paletteSections(page) {
  return page.locator('#palette-list [role="group"]').evaluateAll(groups => Object.fromEntries(
    groups.map(group => [group.getAttribute('aria-label'), [...group.querySelectorAll('[role="option"] .tt')].map(el => el.textContent)]),
  ));
}

async function openPalette(page) {
  await page.keyboard.press('ControlOrMeta+k');
  await eventually(async () => assert.equal(await paletteOpen(page), true));
}

// ↓ until the current item has this label, then Enter.
async function runInPalette(page, label) {
  for (let i = 0; i < 40; i++) {
    const current = await page.locator('#palette-list [aria-selected="true"] .tt').textContent();
    if (current === label) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`No palette item ${label}`);
}

test('the palette opens with its key and its button, Esc closes it, and focus goes back', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('#search').focus();
  await openPalette(page);
  assert.equal(await focused(page), 'palette-field');
  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await paletteOpen(page), false));
  assert.equal(await focused(page), 'search');

  await page.locator('#open-palette').click();
  await eventually(async () => assert.equal(await paletteOpen(page), true));
  assert.equal(await focused(page), 'palette-field');
  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await focused(page), 'open-palette'));
});

test('the palette lists actions and places, then tabs as you type, ignoring case and accents', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await openPalette(page);
  const sections = await paletteSections(page);
  // The Library is off: Save & close stale tabs cannot run, so it is not there.
  assert.deepEqual(sections.Actions, ['Close duplicates', 'Open settings', 'Collapse all', 'Expand all', 'Reveal last used tab', 'Toggle sidebar', 'Toggle details']);
  assert.deepEqual(sections.Places, ['Groups', 'Windows', 'acme/client & 2 more']);
  assert.equal(sections.Tabs, undefined);

  await page.keyboard.type('CESTOVNE');
  assert.deepEqual(await paletteSections(page), { Tabs: ['Cestovné náhrady · Guide', 'Cestovné náhrady · Guide'] });
  // The field keeps the focus and names the current item for a screen reader.
  const current = await page.locator('#palette-field').getAttribute('aria-activedescendant');
  assert.equal(await page.locator(`#${current}`).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await page.locator('#palette-field').getAttribute('aria-activedescendant'), current);
  assert.equal(await focused(page), 'palette-field');

  await page.locator('#palette-field').fill('expand');
  assert.deepEqual(await paletteSections(page), { Actions: ['Expand all'] });
});

test('an action that cannot run is not listed: no duplicates, no Close duplicates', async t => {
  const app = await start(t, { windows: [[TABS.pr, TABS.issue]] });
  const page = await app.openPage();
  await openPalette(page);
  const { Actions } = await paletteSections(page);
  assert.equal(Actions.includes('Close duplicates'), false);
  assert.equal(Actions.includes('Open settings'), true);
});

test('Enter in the palette switches to a tab, shows a place or runs an action', async t => {
  const app = await start(t);
  const page = await app.openPage();
  const api = await app.tabIdOf(TABS.api);
  const jira = await app.tabIdOf(TABS.jira1);

  await openPalette(page);
  await page.keyboard.type('WEB-1');
  await page.keyboard.press('Enter');
  await eventually(async () => assert.equal(await isActive(app, jira), true));
  assert.equal(await paletteOpen(page), false);

  await page.bringToFront();
  await openPalette(page);
  await page.keyboard.type('windows');
  await runInPalette(page, 'Windows');
  await eventually(async () => assert.equal(await page.evaluate(() => location.hash), '#windows'));
  assert.equal(await page.locator('#main-head h2').textContent(), 'Windows');
  assert.equal(await page.locator('#side [data-section="windows"]:not([data-item])').getAttribute('aria-current'), 'true');

  await openPalette(page);
  await runInPalette(page, 'Close duplicates');
  // The two copies close; the keepers stay.
  await eventually(async () => assert.equal((await app.webUrls()).length, ALL_TABS.length - 2));
  assert.equal(await isActive(app, api), false);
});

// ---------- details pane ----------
test('the details pane toggles, is kept across a reload, and is not shown below 1000 px', async t => {
  const app = await start(t);
  const page = await app.openPage();
  const pane = page.locator('#details');
  const toggle = page.locator('#toggle-details');
  assert.equal(await pane.isVisible(), false);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');

  await toggle.click();
  assert.equal(await pane.isVisible(), true);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await pane.textContent(), 'Select a tab to see its details.');
  await eventually(async () => {
    const stored = await app.worker.evaluate(() => chrome.storage.local.get('detailsShown'));
    assert.equal(stored.detailsShown, true);
  });

  // Applied before the first paint, from the copy appearance.js reads.
  await app.context.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      observer.disconnect();
      window.firstFrame = document.documentElement.classList.contains('details-on');
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await reload(page);
  assert.equal(await page.evaluate(() => window.firstFrame), true);
  assert.equal(await pane.isVisible(), true);

  await page.setViewportSize({ width: 900, height: 700 });
  await eventually(async () => assert.equal(await pane.isVisible(), false));
  assert.equal(await toggle.isVisible(), false);
});

test('the details pane describes the focused tab, follows ↑/↓ and counts its duplicates', async t => {
  const app = await start(t, { tabGroups: true, settings: { detailsShown: true } });
  await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'green' });
  const page = await app.openPage();
  const pane = page.locator('#details');
  const field = name => pane.locator(`dt:text-is("${name}") + dd`).textContent();

  const { row } = await rowOf(page, app, TABS.api);
  await page.locator('#body details.group[data-key="docs.example.org"] > summary').click();
  await row.locator('.row-main').click();
  assert.equal(await pane.locator('h3').textContent(), 'API reference');
  assert.equal(await pane.locator('.details-url').textContent(), TABS.api);
  assert.equal(await field('Group'), 'docs.example.org');
  assert.equal(await field('Duplicates'), 'None');
  assert.equal(await field('Tab group'), 'None');
  assert.equal(await field('Last used'), 'just now');
  assert.match(await field('Window'), /acme\/client & 2 more/);
  // The Library is off: no Saved row and no Save & close.
  assert.equal(await pane.locator('dt:text-is("Saved")').count(), 0);
  assert.deepEqual(await pane.locator('button').allTextContents(), ['Switch to tab', 'Close']);

  // ↑/↓ in the tree: the pane follows and the focus stays in the list. The guide's copy is the other tab.
  await page.keyboard.press('ArrowDown');
  assert.match(await focused(page), /^row /);
  assert.equal(await pane.locator('h3').textContent(), 'Cestovné náhrady · Guide');
  assert.equal(await field('Duplicates'), '1');

  await page.locator('#body details.group[data-key="Jira · WEB"] > summary').focus();
  assert.equal(await pane.textContent(), 'Select a tab to see its details.');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await field('Tab group'), 'Sprint');
});

test('with the details pane a click focuses a tab; a double click, Enter or Switch to tab switches', async t => {
  const app = await start(t, { settings: { detailsShown: true } });
  const page = await app.openPage();
  await page.locator('#body details.group[data-key="Jira · WEB"] > summary').click();
  const { id, row } = await rowOf(page, app, TABS.jira1);

  await row.locator('.title').click();
  assert.equal(await focused(page), `row ${id}`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await isActive(app, id), false);

  await page.keyboard.press('Enter');
  await eventually(async () => assert.equal(await isActive(app, id), true));

  const other = await rowOf(page, app, TABS.jira2);
  await page.bringToFront();
  await other.row.locator('.title').dblclick();
  await eventually(async () => assert.equal(await isActive(app, other.id), true));

  await page.bringToFront();
  await row.locator('.title').click();
  await page.locator('#details [data-detail="switch"]').click();
  await eventually(async () => assert.equal(await isActive(app, id), true));
});

test('without the details pane, and below 1000 px, a click switches as before', async t => {
  const app = await start(t, { settings: { detailsShown: true } });
  const page = await app.openPage();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.locator('#body details.group[data-key="Jira · WEB"] > summary').click();
  const { id, row } = await rowOf(page, app, TABS.jira1);
  await row.locator('.title').click();
  await eventually(async () => assert.equal(await isActive(app, id), true));
});

test('Close in the details pane closes the tab and Undo brings it back', async t => {
  const app = await start(t, { settings: { detailsShown: true } });
  const page = await app.openPage();
  await page.locator('#body details.group[data-key="Jira · WEB"] > summary').click();
  const { row } = await rowOf(page, app, TABS.jira1);
  await row.locator('.title').click();
  await page.locator('#details [data-detail="close"]').click();
  await eventually(async () => assert.equal((await app.webUrls()).includes(TABS.jira1), false));
  assert.equal(await page.locator('#undo-text').textContent(), 'Closed 1 tab');
  await eventually(async () => assert.equal(await page.locator('#details').textContent(), 'Select a tab to see its details.'));
  await page.locator('#undo-button').click();
  await eventually(async () => assert.equal((await app.webUrls()).includes(TABS.jira1), true));
});

test('when the details pane hides with the focus in it, the focus goes to the row it described', async t => {
  const app = await start(t, { settings: { detailsShown: true } });
  const page = await app.openPage();
  await page.locator('#body details.group[data-key="Jira · WEB"] > summary').click();
  const { id, row } = await rowOf(page, app, TABS.jira1);
  await row.locator('.title').click();
  await page.locator('#details [data-detail="switch"]').focus();
  await openPalette(page);
  await page.keyboard.type('toggle details');
  await page.keyboard.press('Enter');
  await eventually(async () => assert.equal(await page.locator('#details').isVisible(), false));
  assert.equal(await focused(page), `row ${id}`);

  // A window made narrower than 1000 px hides it too.
  await page.locator('#toggle-details').click();
  await page.locator('#details [data-detail="switch"]').focus();
  await page.setViewportSize({ width: 900, height: 700 });
  await eventually(async () => assert.equal(await focused(page), `row ${id}`));
});

// ---------- tree toolbar ----------
function openKeys(page) {
  return page.locator('#body details[data-key]').evaluateAll(all => all.filter(details => details.open).map(details => details.dataset.key));
}

test('Collapse all and Expand all close and open every group, and stay so after a re-render', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('[data-head="expand"]').click();
  assert.deepEqual(await openKeys(page), ['acme/client', 'docs.example.org', 'Jira · WEB']);
  await page.locator('[data-head="collapse"]').click();
  assert.deepEqual(await openKeys(page), []);

  await page.locator('#side [data-section="windows"]:not([data-item])').click();
  await page.locator('[data-head="expand"]').click();
  assert.equal((await openKeys(page)).length, await page.locator('#body details[data-key]').count());
  // A tab event re-renders the list: the groups stay open.
  await app.worker.evaluate(() => chrome.tabs.create({ url: 'https://example.org/new', active: false }));
  await eventually(async () => assert.equal(await page.locator('#status-bar').textContent(), '9 tabs · 1 window · 2 duplicates · 0 stale · 0 suspended'));
  assert.equal((await openKeys(page)).length, await page.locator('#body details[data-key]').count());
});

test('Reveal last used tab clears a sidebar choice and a search that hide it, opens its group and focuses it', async t => {
  const app = await start(t);
  const page = await app.openPage();
  // The tab used last before the page opened.
  const web = await app.webTabs();
  const last = web.reduce((a, b) => (b.lastAccessed > a.lastAccessed ? b : a));
  await page.locator('#side [data-section="groups"][data-item="Jira · WEB"]').click();
  await page.locator('#search').fill('jira');
  await page.locator('[data-head="collapse"]').click();

  await page.locator('[data-head="reveal"]').click();
  assert.equal(await page.evaluate(() => location.hash), '#groups');
  assert.equal(await page.locator('#search').inputValue(), '');
  assert.equal(await focused(page), `row ${last.id}`);
  assert.equal(await page.locator(`#body .row[data-id="${last.id}"]`).isVisible(), true);
});

test('Sort in the toolbar changes the order and the setting the settings window shows', async t => {
  const app = await start(t);
  const page = await app.openPage();
  const urls = () => page.locator('#body details.group[data-key="docs.example.org"] .row .url').allTextContents();
  assert.deepEqual(await urls(), ['docs.example.org/api', 'docs.example.org/guide#intro']);
  await page.locator('[data-head="sort"]').selectOption('order');
  await eventually(async () => assert.deepEqual(await urls(), ['docs.example.org/guide#intro', 'docs.example.org/api']));
  await eventually(async () => assert.equal(await app.worker.evaluate(async () => (await chrome.storage.local.get('sort')).sort), 'order'));
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#settings [name="sort"][value="order"]').isChecked(), true);
  // And the other way round.
  await page.locator('#settings label:has([name="sort"][value="recent"])').click();
  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await page.locator('[data-head="sort"]').inputValue(), 'recent'));
});

// ---------- status bar and sidebar ----------
test('the status bar counts everything open, whatever is shown, with singular and plural', async t => {
  const app = await start(t);
  const page = await app.openPage();
  const bar = page.locator('#status-bar');
  assert.equal(await bar.textContent(), '8 tabs · 1 window · 2 duplicates · 0 stale · 0 suspended');
  await page.locator('#side [data-section="groups"][data-item="Jira · WEB"]').click();
  await page.locator('#search').fill('WEB-1');
  assert.equal(await bar.textContent(), '8 tabs · 1 window · 2 duplicates · 0 stale · 0 suspended');
  assert.equal(await bar.getAttribute('role'), null);

  // Without stale tabs there is no stale count.
  await page.locator('#settings-button').click();
  await page.locator('#tab-features').click();
  await page.locator('#s-stale').click();
  await eventually(async () => assert.equal(await bar.textContent(), '8 tabs · 1 window · 2 duplicates · 0 suspended'));
  await page.keyboard.press('Escape');

  const keep = await app.tabIdOf(TABS.pr);
  const rest = (await app.webTabs()).map(tab => tab.id).filter(id => id !== keep);
  await app.worker.evaluate(ids => chrome.tabs.remove(ids), rest);
  await eventually(async () => assert.equal(await bar.textContent(), '1 tab · 1 window · 0 duplicates · 0 suspended'));
});

test('the sidebar hides and shows, and stays so across a reload', async t => {
  const app = await start(t);
  const page = await app.openPage();
  const toggle = page.locator('#toggle-side');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  const listWidth = () => page.locator('#body').evaluate(el => el.getBoundingClientRect().width);
  const before = await listWidth();

  await toggle.click();
  assert.equal(await page.locator('#side').isVisible(), false);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.ok(await listWidth() > before);
  assert.equal(await page.locator('#main-head h2').textContent(), 'Groups');
  await eventually(async () => assert.equal(await app.worker.evaluate(async () => (await chrome.storage.local.get('sideShown')).sideShown), false));

  await reload(page);
  assert.equal(await page.locator('#side').isVisible(), false);
  // The narrow strip hides too.
  await page.setViewportSize({ width: 600, height: 700 });
  assert.equal(await page.locator('#side').isVisible(), false);
  await toggle.click();
  assert.equal(await page.locator('#side').isVisible(), true);
});

test('another open page follows the sidebar and details pane shown or hidden', async t => {
  const app = await start(t);
  const first = await app.openPage();
  const second = await app.openPage();
  await second.locator('#toggle-side').click();
  await second.locator('#toggle-details').click();
  await eventually(async () => assert.equal(await first.locator('#side').isVisible(), false));
  await eventually(async () => assert.equal(await first.locator('#details').isVisible(), true));
  assert.equal(await first.locator('#toggle-side').getAttribute('aria-pressed'), 'false');

  // The first page's own toggle starts from the followed value, not a stale one.
  await first.locator('#toggle-side').click();
  assert.equal(await first.locator('#side').isVisible(), true);
  await eventually(async () => assert.equal(await second.locator('#side').isVisible(), true));
});

// ---------- right click and Shift+click ----------
async function rightClickMenu(page, locator) {
  await locator.click({ button: 'right' });
  await eventually(async () => assert.equal(await page.locator('#menu').evaluate(menu => menu.matches(':popover-open')), true));
  const items = await page.locator('#menu [role="menuitem"]').allTextContents();
  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await page.locator('#menu').evaluate(menu => menu.matches(':popover-open')), false));
  return items;
}

test('a right click opens the ⋯ menu of a tab row, a group, a window and a tab group on the page', async t => {
  const app = await start(t, { tabGroups: true });
  await app.makeTabGroup([TABS.jira1, TABS.jira2], { title: 'Sprint', color: 'green' });
  const page = await app.openPage('#windows');
  await page.locator('[data-head="expand"]').click();

  assert.ok((await rightClickMenu(page, page.locator('#body details.win > summary .g-name'))).includes('Close window'));
  assert.ok((await rightClickMenu(page, page.locator('#body details.tg > summary .g-name'))).includes('Move to new window'));
  assert.ok((await rightClickMenu(page, page.locator('#body .win-body > details.group:not(.tg) > summary .g-name').first())).includes('Close group'));
  const { row } = await rowOf(page, app, TABS.issue);
  const items = await rightClickMenu(page, row.locator('.title'));
  assert.ok(items.some(item => item.startsWith('Move to window')));

  // The menu opens at the pointer.
  const box = await row.locator('.title').boundingBox();
  await page.mouse.click(box.x + 5, box.y + 5, { button: 'right' });
  // Its left edge at the pointer, below it or, near the bottom, above it (after its short slide in).
  await eventually(async () => {
    const menu = await page.locator('#menu').boundingBox();
    assert.ok(Math.abs(menu.x - (box.x + 5)) < 2, `menu at x ${menu.x}, pointer at ${box.x + 5}`);
    const top = Math.abs(menu.y - (box.y + 5)) < 2 || Math.abs(menu.y + menu.height - (box.y + 5)) < 2;
    assert.ok(top, `menu at y ${menu.y}, pointer at ${box.y + 5}`);
  });
  await page.keyboard.press('Escape');

  // Elsewhere the browser keeps its own menu: the event is not cancelled.
  const cancelled = await page.evaluate(() => [document.querySelector('#search'), document.querySelector('.win-new')]
    .map(el => !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))));
  assert.deepEqual(cancelled, [false, false]);
});

test('a right click opens the ⋯ menu in the popup too', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  assert.ok((await rightClickMenu(page, page.locator('#body details.group[data-key="Jira · WEB"] > summary .g-name'))).includes('Close group'));
  await page.locator('#body details.group[data-key="Jira · WEB"] > summary').click();
  const { row } = await rowOf(page, app, TABS.jira1);
  assert.ok((await rightClickMenu(page, row.locator('.title'))).some(item => item.startsWith('Move to window')));
});

test('Shift+click checks every shown row between it and the checkbox clicked last', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('[data-head="expand"]').click();
  // The tab rows shown: acme/client 2, docs.example.org 2, Jira 2 (each copy hides under its keeper).
  const boxes = page.locator('#body .pick[data-pick]');
  assert.equal(await boxes.count(), 6);
  // Without a previous click a Shift+click is a plain click.
  await boxes.nth(1).click({ modifiers: ['Shift'] });
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '1 selected'));
  // From the second row to the fifth, across the docs.example.org header, which does not add its other rows.
  await boxes.nth(4).click({ modifiers: ['Shift'] });
  await eventually(async () => assert.equal(await page.locator('#bulk-count').textContent(), '4 selected'));
  const checked = await boxes.evaluateAll(all => all.map(box => box.checked));
  assert.deepEqual(checked, [false, true, true, true, true, false]);
});

test('Shift+click from a group header takes it only as a position; on a header it checks that header too', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.locator('[data-head="expand"]').click();
  const boxes = page.locator('#body .pick[data-pick]');
  const count = page.locator('#bulk-count');
  const docs = page.locator('[data-pick-group="docs.example.org"]');
  // Twice: its rows end unchecked, and it is the checkbox clicked last. Its 3 tabs include the hidden copy.
  await docs.click();
  await eventually(async () => assert.equal(await count.textContent(), '3 selected'));
  await docs.click();
  await eventually(async () => assert.equal(await page.locator('#bulk-bar').isHidden(), true));

  // Up to the first acme/client row: only the two acme rows lie between, not the docs rows under its header.
  await boxes.nth(0).click({ modifiers: ['Shift'] });
  await eventually(async () => assert.equal(await count.textContent(), '2 selected'));
  assert.deepEqual(await boxes.evaluateAll(all => all.map(box => box.checked)), [true, true, false, false, false, false]);

  // Down to the Jira header: the rows between and the Jira tabs.
  await page.locator('[data-pick-group="Jira · WEB"]').click({ modifiers: ['Shift'] });
  await eventually(async () => assert.equal(await count.textContent(), '6 selected'));
});
