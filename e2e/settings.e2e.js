// The settings window (1.3): sections, every option applying at once, the font kept on update, the toolbar
// badge and button, and the header's Close duplicates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, eventually, TABS, ALL_TABS } from './helpers.js';

async function start(t, options) {
  const app = await launch(options);
  t.after(() => app.close());
  await app.seed([ALL_TABS]);
  return app;
}

async function openSettings(page) {
  await page.locator('#settings-button').click();
  await eventually(async () => assert.equal(await page.locator('#settings').evaluate(el => el.open), true));
}

// The radios are drawn as a segmented switch, so a person clicks the option's label.
function choose(page, option) {
  return page.locator('#settings .radios label').getByText(option, { exact: true }).click();
}

function isOpen(page) {
  return page.locator('#settings').evaluate(el => el.open);
}

function focusedId(page) {
  return page.evaluate(() => document.activeElement.id);
}

function stored(app, key) {
  return app.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
}

// The look as the page draws it: Fira Code or not, the custom font, the text size step and a forced theme.
function look(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      fira: root.classList.contains('fira'),
      font: root.style.getPropertyValue('--ui-font'),
      step: root.style.getPropertyValue('--step'),
      scheme: getComputedStyle(root).colorScheme,
      size: getComputedStyle(document.body).fontSize,
    };
  });
}

test('⚙ opens the settings window; Esc and a click outside close it and focus goes back to ⚙', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await openSettings(page);
  assert.equal(await focusedId(page), 'tab-general');
  assert.equal(await page.locator('#settings-title').textContent(), 'General');

  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await isOpen(page), false));
  assert.equal(await focusedId(page), 'settings-button');

  await openSettings(page);
  // The backdrop: a corner of the popup, outside the centered window.
  await page.mouse.click(5, 5);
  await eventually(async () => assert.equal(await isOpen(page), false));
  assert.equal(await focusedId(page), 'settings-button');

  // A click inside, on a label, keeps it open.
  await openSettings(page);
  await page.locator('#settings').getByText('Developer mode').click();
  assert.equal(await isOpen(page), true);
});

test('sections change by click and by ↑/↓, and the window reopens on the last one', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await openSettings(page);
  await page.locator('#tab-appearance').click();
  assert.equal(await page.locator('#settings-title').textContent(), 'Appearance');
  assert.equal(await page.locator('#sec-appearance').isVisible(), true);
  assert.equal(await page.locator('#sec-general').isVisible(), false);

  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedId(page), 'tab-features');
  assert.equal(await page.locator('#tab-features').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#settings-title').textContent(), 'Features');
  // ↑ from the first section wraps to the last.
  await page.locator('#tab-general').click();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#settings-title').textContent(), 'About');

  await page.keyboard.press('Escape');
  await openSettings(page);
  assert.equal(await focusedId(page), 'tab-about');
  await eventually(async () => assert.equal(await stored(app, 'settingsSection'), 'about'));
  await page.reload();
  await openSettings(page);
  assert.equal(await page.locator('#settings-title').textContent(), 'About');
});

test('About shows the version and the links, with the store listing in Chrome', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await openSettings(page);
  await page.locator('#tab-about').click();
  const version = await app.worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(await page.locator('#sec-about .sp-about .hint-text').textContent(), `Version ${version}`);
  const links = await page.locator('#sec-about a').evaluateAll(as => as.map(a => `${a.textContent} ${a.href}`));
  assert.deepEqual(links, [
    'Chrome Web Store https://chromewebstore.google.com/detail/oh-my-tabs/dfjcphmoeaknnkihfpeojfggfniipaek',
    'Source on GitHub https://github.com/pkasarda/oh-my-tabs',
    'Privacy policy https://github.com/pkasarda/oh-my-tabs/blob/main/PRIVACY.md',
    'Send feedback https://github.com/pkasarda/oh-my-tabs/issues',
  ]);
});

test('every option applies at once and survives a reload', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  assert.deepEqual(await look(page), { fira: true, font: '', step: '0', scheme: 'light dark', size: '13px' });
  const headers = () => page.locator('#body details.group > summary .g-name').allTextContents();
  assert.deepEqual(await headers(), ['acme/client', 'docs.example.org', 'Jira · WEB']);

  await openSettings(page);
  await page.locator('#s-dev').uncheck();
  await eventually(async () => assert.deepEqual(await headers(), ['docs.example.org', 'github.com', 'acme.atlassian.net']));
  // Developer mode no longer changes the font.
  assert.equal((await look(page)).fira, true);
  await choose(page, 'Tab order');
  await page.locator('#s-badge').selectOption('dups');
  await choose(page, 'Opens the full page');

  await page.locator('#tab-appearance').click();
  await choose(page, 'System');
  assert.equal((await look(page)).size, '14px');
  await choose(page, 'Large');
  await choose(page, 'Dark');
  const applied = { fira: false, font: '', step: '1', scheme: 'dark', size: '15px' };
  assert.deepEqual(await look(page), applied);

  const saved = { dev: false, sort: 'order', badge: 'dups', button: 'page', font: 'system', textSize: 'large', theme: 'dark' };
  await eventually(async () => {
    const values = await app.worker.evaluate(keys => chrome.storage.local.get(keys), Object.keys(saved));
    assert.deepEqual(values, saved);
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
  assert.deepEqual(await look(page), applied);
  assert.deepEqual(await headers(), ['docs.example.org', 'github.com', 'acme.atlassian.net']);
  const checked = await page.locator('#settings input[type="radio"]:checked').evaluateAll(radios => radios.map(radio => `${radio.name}=${radio.value}`));
  assert.deepEqual(checked, ['sort=order', 'button=page', 'font=system', 'textSize=large', 'theme=dark']);
  assert.equal(await page.locator('#s-badge').inputValue(), 'dups');
  assert.equal(await page.locator('#s-dev').isChecked(), false);

  // Small is one pixel under Default; Fira Code is 13 px at Default.
  await openSettings(page);
  await choose(page, 'Small');
  await choose(page, 'Fira Code');
  assert.equal((await look(page)).size, '12px');
});

test('a look and the sort apply before their write to storage has finished', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  // A slow storage: every write takes a second.
  await page.evaluate(() => {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = values => new Promise(resolve => setTimeout(resolve, 1000)).then(() => set(values));
  });
  await openSettings(page);
  await page.locator('#tab-appearance').click();
  await choose(page, 'Dark');
  assert.equal((await look(page)).scheme, 'dark');
  await page.locator('#tab-general').click();
  await choose(page, 'Tab order');
  // Recent puts api, opened last, first; tab order puts it after the guide (its copy hides under it).
  const urls = await page.locator('#body details.group[data-key="docs.example.org"] .row .url').allTextContents();
  assert.deepEqual(urls, ['docs.example.org/guide#intro', 'docs.example.org/api']);
});

test('the look is there before the body is drawn, before the settings have loaded', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await openSettings(page);
  await page.locator('#tab-appearance').click();
  await choose(page, 'System');
  await choose(page, 'Large');
  await choose(page, 'Dark');

  // Recorded the moment <body> is parsed: nothing can have been painted yet, and storage.local has not answered.
  await app.context.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      observer.disconnect();
      const root = document.documentElement;
      window.firstFrame = { fira: root.classList.contains('fira'), step: root.style.getPropertyValue('--step'), scheme: getComputedStyle(root).colorScheme };
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  // The popup shares the copy with the page.
  const popup = await app.openPopup();
  for (const shown of [page, popup]) {
    await shown.waitForFunction(() => window.firstFrame);
    assert.deepEqual(await shown.evaluate(() => window.firstFrame), { fira: false, step: '1', scheme: 'dark' });
  }
});

test('on update the font stays: Fira Code with developer mode on, System with it off', async () => {
  for (const dev of [true, false]) {
    const app = await launch({ settings: { dev } });
    try {
      await app.seed([[TABS.pr]]);
      const page = await app.openPopup();
      const font = dev ? 'fira' : 'system';
      await eventually(async () => assert.equal(await stored(app, 'font'), font));
      assert.equal((await look(page)).fira, dev);
      // Stored once: turning developer mode over afterwards leaves the font alone.
      await openSettings(page);
      await page.locator('#s-dev').setChecked(!dev);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
      assert.equal((await look(page)).fira, dev);
      assert.equal(await stored(app, 'font'), font);
    } finally {
      await app.close();
    }
  }
});

test('a custom font that is not installed says so and falls back to System', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await openSettings(page);
  await page.locator('#tab-appearance').click();
  assert.equal(await page.locator('#s-font-custom').isVisible(), false);
  await choose(page, 'Custom');
  await page.locator('#s-font-custom').fill('Acme Made Up Sans');
  await eventually(async () => assert.equal(await page.locator('#s-font-missing').isVisible(), true));
  assert.equal(await page.locator('#s-font-missing').textContent(), 'Font not found');
  const drawn = await look(page);
  assert.equal(drawn.fira, false);
  assert.equal(drawn.size, '14px');
  // The name is tried first; the browser falls through to the system font.
  assert.match(drawn.font, /^"Acme Made Up Sans", var\(--sans\)$/);
  await eventually(async () => assert.equal(await stored(app, 'fontCustom'), 'Acme Made Up Sans'));

  await page.locator('#s-font-custom').fill('');
  assert.equal(await page.locator('#s-font-missing').isVisible(), false);
});

test('the toolbar badge shows the duplicates and tab count, only the duplicates, or nothing', async t => {
  const app = await launch();
  t.after(() => app.close());
  await app.seed([[TABS.pr, TABS.jira1]]);
  const badge = () => app.worker.evaluate(() => chrome.action.getBadgeText({}));
  const setBadge = value => app.worker.evaluate(value => chrome.storage.local.set({ badge: value }), value);
  const tabCount = String((await app.tabs()).length);

  await eventually(async () => assert.equal(await badge(), tabCount));
  await setBadge('dups');
  await eventually(async () => assert.equal(await badge(), ''));
  await setBadge('off');
  await eventually(async () => assert.equal(await badge(), ''));

  // pull/12/files is a copy of pull/12 with developer mode on.
  const extra = await app.context.newPage();
  await extra.goto(TABS.prFiles);
  await eventually(async () => assert.equal(await badge(), ''));
  await setBadge('dups');
  await eventually(async () => assert.equal(await badge(), '1'));
  await setBadge('all');
  await eventually(async () => assert.equal(await badge(), '1'));
});

// The same init script as above: what the root carries the moment <body> is parsed.
function recordFirstFrame(context) {
  return context.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      observer.disconnect();
      const root = document.documentElement;
      window.firstFrame = { fira: root.classList.contains('fira'), pending: root.classList.contains('look-pending') };
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

test('the first open after an update draws nothing until the look is known', async t => {
  const app = await launch({ settings: { dev: false } });
  t.after(() => app.close());
  await app.seed([[TABS.pr]]);
  await recordFirstFrame(app.context);
  const page = await app.openPopup();
  const first = await page.evaluate(() => window.firstFrame);
  // No copy of the look yet: hidden, not guessed as Fira Code.
  assert.deepEqual(first, { fira: false, pending: true });
  assert.equal((await look(page)).fira, false);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('look-pending')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).visibility), 'visible');
});

test('a look picked in one window shows in another open one, which keeps the shared copy right', async t => {
  const app = await start(t);
  const full = await app.openPage();
  const popup = await app.openPopup();
  await openSettings(popup);
  await popup.locator('#tab-appearance').click();
  await choose(popup, 'Dark');
  await eventually(async () => assert.equal((await look(full)).scheme, 'dark'));

  await full.bringToFront();
  await openSettings(full);
  await full.locator('#tab-appearance').click();
  // The page's own controls followed too.
  assert.equal(await full.locator('#settings input[name="theme"][value="dark"]').isChecked(), true);
  await choose(full, 'System');
  await eventually(async () => {
    const copy = await full.evaluate(() => JSON.parse(localStorage.getItem('appearance')));
    assert.deepEqual(copy, { font: 'system', fontCustom: '', textSize: 'default', theme: 'dark' });
  });
  await eventually(async () => assert.equal((await look(popup)).fira, false));
});

test('with the full page as the toolbar button a click opens the page once, then switches to it', async t => {
  const app = await start(t);
  const popup = () => app.worker.evaluate(() => chrome.action.getPopup({}));
  assert.match(await popup(), /\/popup\.html$/);
  const page = await app.openPopup();
  await openSettings(page);
  await choose(page, 'Opens the full page');
  await eventually(async () => assert.equal(await popup(), ''));

  // Playwright cannot click the toolbar; the worker fires the click event itself.
  const click = () => app.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    chrome.action.onClicked.dispatch(tab);
  });
  const pageTabs = async () => (await app.tabs()).filter(tab => tab.url.startsWith(app.url('page.html')));
  await click();
  await eventually(async () => assert.equal((await pageTabs()).length, 1));
  // Elsewhere, then the toolbar again: back to the same page, no second one.
  const [only] = await pageTabs();
  await app.worker.evaluate(async url => chrome.tabs.update((await chrome.tabs.query({ url }))[0].id, { active: true }), TABS.pr);
  await click();
  await eventually(async () => {
    const [active] = await app.worker.evaluate(id => chrome.tabs.query({ active: true, windowId: id }), only.windowId);
    assert.equal(active.id, only.id);
  });
  assert.equal((await pageTabs()).length, 1);

  // Open as page in the popup goes the same way.
  const opener = await app.openPopup();
  await opener.locator('#open-page').click();
  await eventually(async () => assert.equal((await pageTabs()).length, 1));

  await page.bringToFront();
  await choose(page, 'Opens the popup');
  await eventually(async () => assert.match(await popup(), /\/popup\.html$/));
});

test('the toolbar button setting survives a browser restart', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'omt-profile-'));
  try {
    const first = await launch({ profile, settings: { button: 'page' } });
    await eventually(async () => assert.equal(await first.worker.evaluate(() => chrome.action.getPopup({})), ''));
    await first.close();
    const again = await launch({ profile });
    try {
      await eventually(async () => assert.equal(await again.worker.evaluate(() => chrome.action.getPopup({})), ''));
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('focus goes back to ⚙ when the settings close, even if the click did not focus it', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  await page.locator('#search').focus();
  // A click that leaves focus where it was, as in Firefox on macOS.
  await page.locator('#settings-button').evaluate(button => button.click());
  await eventually(async () => assert.equal(await isOpen(page), true));
  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await isOpen(page), false));
  // The close event comes a moment after the dialog shut.
  await eventually(async () => assert.equal(await focusedId(page), 'settings-button'));
});

test('Change… on the full page leaves the page open', async t => {
  const app = await start(t);
  const page = await app.openPage();
  await page.evaluate(() => {
    window.closeCalls = 0;
    window.close = () => window.closeCalls++;
    // The browser's shortcuts page is not what is tested here.
    chrome.tabs.create = async () => {};
  });
  await openSettings(page);
  await page.locator('#tab-shortcuts').click();
  await page.locator('#change-shortcuts').click();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await page.evaluate(() => window.closeCalls), 0);
});

test('Suspend all other tabs is in a window menu and suspends that window but its active tab', async t => {
  const app = await start(t);
  const page = await app.openPopup();
  // tabs.discard tears a headless context down: record the calls instead.
  await page.evaluate(() => {
    window.discarded = [];
    chrome.tabs.discard = async id => {
      window.discarded.push(id);
    };
  });
  await page.locator('[data-view="windows"]').click();
  await page.locator('#body details.win [data-menu="window"]').click();
  const item = page.locator('#menu').getByRole('menuitem', { name: /^Suspend all other tabs/ });
  assert.equal(await item.textContent(), `Suspend all other tabs · ${ALL_TABS.length}`);
  await item.click();

  const webIds = (await app.webTabs()).map(tab => tab.id).sort((a, b) => a - b);
  await eventually(async () => {
    const ids = await page.evaluate(() => window.discarded);
    assert.deepEqual([...ids].sort((a, b) => a - b), webIds);
  });
  // The settings no longer have it.
  assert.equal(await page.locator('#settings').getByText('Suspend all other tabs').count(), 0);
});
