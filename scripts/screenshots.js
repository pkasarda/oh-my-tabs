// Writes the store screenshots (store/screenshot-*.png, 1280×800) from the real extension in Playwright's
// Chromium, with made-up tabs. Run it after a change to the look: npm run screenshots.
// Nothing is fetched: every page is answered here, and the icons are letter tiles, so no site's logo appears.
// The full page fills the picture; the popup keeps its real size (780×580) on a plain backdrop with a caption.
import { launch } from '../e2e/helpers.js';

const OUT = new URL('../store/', import.meta.url).pathname;
const SIZE = { width: 1280, height: 800 };
const POPUP = { width: 780, height: 580 };
const HOUR = 60 * 60 * 1000;

// address → title. Window 1 is the working window, window 2 the reading one.
const WORK = {
  'https://github.com/acme/webapp/pull/42': 'Add a dark mode toggle · Pull Request #42 · acme/webapp',
  'https://github.com/acme/webapp/pull/42/files': 'Add a dark mode toggle · Files changed · Pull Request #42',
  'https://github.com/acme/webapp/pull/42/commits': 'Add a dark mode toggle · Commits · Pull Request #42',
  'https://github.com/acme/webapp/issues/7': 'Keyboard shortcuts for the sidebar · Issue #7 · acme/webapp',
  'https://github.com/acme/webapp': 'acme/webapp: the web app',
  'https://github.com/acme/api/pull/118': 'Retry failed webhooks · Pull Request #118 · acme/api',
  'https://github.com/acme/api/pull/118/checks': 'Retry failed webhooks · Checks · Pull Request #118',
  'https://github.com/acme/api/issues/64': 'Rate limit per customer · Issue #64 · acme/api',
  'https://acme.atlassian.net/browse/PAY-1388': '[PAY-1388] Retry webhook deliveries - Jira',
  'https://acme.atlassian.net/browse/PAY-1421': '[PAY-1421] Refund by bank transfer - Jira',
  'https://acme.atlassian.net/jira/software/projects/PAY/boards/12?selectedIssue=PAY-1421': 'PAY board - Jira',
  'https://linear.app/acme/issue/WEB-204/checkout-button-on-mobile': 'WEB-204 Checkout button on mobile',
  'https://linear.app/acme/issue/WEB-198/footer-links': 'WEB-198 Footer links',
  'https://www.figma.com/design/Qx81/Checkout-flow?node-id=1-2': 'Checkout flow – Figma',
  'https://www.figma.com/design/Qx81/Checkout-flow?node-id=4-8': 'Checkout flow – Figma',
};
const READING = {
  'https://developer.mozilla.org/en-US/docs/Web/API/Popover_API': 'Popover API - Web APIs | MDN',
  'https://developer.mozilla.org/en-US/docs/Web/API/Popover_API#examples': 'Popover API - Web APIs | MDN',
  'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog': '<dialog>: The Dialog element | MDN',
  'https://web.dev/articles/inp': 'Interaction to Next Paint (INP)',
  'https://docs.example.org/handbook/release-checklist': 'Release checklist · Handbook',
  'https://docs.example.org/handbook/on-call': 'On-call guide · Handbook',
};
const TITLES = { ...WORK, ...READING };

// Saved earlier, for the Library in the sidebar: topic → pages.
const SAVED = {
  'Release 2.0': {
    'https://github.com/acme/webapp/milestone/4': 'Release 2.0 · Milestone · acme/webapp',
    'https://docs.example.org/handbook/changelog': 'Changelog · Handbook',
    'https://acme.atlassian.net/browse/PAY-1290': '[PAY-1290] Invoice numbering - Jira',
  },
  'Read later': {
    'https://web.dev/articles/view-transitions': 'Smooth transitions with the View Transition API',
    'https://developer.mozilla.org/en-US/docs/Web/CSS/anchor': 'anchor() - CSS | MDN',
  },
};

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// Chrome serves a globe for a page with no icon; the list's own fallback, a letter tile, is what the store shows.
// The popup opened as a tab lists itself, which a real popup never does: that row is taken out.
// Both are redone after every re-render, and the pointer is parked so no hover or tooltip is in the picture.
async function stage(page) {
  await page.evaluate(() => {
    if (window.staged) return;
    window.staged = true;
    const tidy = () => {
      for (const img of document.querySelectorAll('img.fav:not([data-fallback])')) img.dispatchEvent(new Event('error'));
      for (const row of document.querySelectorAll('#body .row')) {
        if (row.textContent.includes('/popup.html')) row.remove();
      }
    };
    new MutationObserver(tidy).observe(document.body, { childList: true, subtree: true });
    tidy();
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  await stage(page);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`store/${name}.png`);
}

async function framedShot(app, popup, name, caption) {
  await stage(popup);
  const image = (await popup.screenshot()).toString('base64');
  const frame = await app.context.newPage();
  await frame.setViewportSize(SIZE);
  await frame.setContent(`<!doctype html><style>
    body { margin: 0; height: 100vh; display: grid; grid-template-rows: 110px ${POPUP.height}px; justify-items: center; align-content: start;
      background: linear-gradient(160deg, #4f46e5, #7c3aed); color: white; font: 600 30px/1 system-ui, sans-serif; }
    h1 { margin: 0; font: inherit; align-self: center; }
    img { width: ${POPUP.width}px; height: ${POPUP.height}px; border-radius: 12px; box-shadow: 0 24px 60px rgb(0 0 0 / 0.35); }
  </style><h1>${escapeHtml(caption)}</h1><img alt="" src="data:image/png;base64,${image}">`);
  await frame.screenshot({ path: `${OUT}${name}.png` });
  await frame.close();
  console.log(`store/${name}.png`);
}

const app = await launch({ library: true, tabGroups: true, settings: { notifyHint: false } });
try {
  await app.context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url.endsWith('/favicon.ico')) return route.fulfill({ status: 404, body: '' });
    const title = escapeHtml(TITLES[url] ?? new URL(url).hostname);
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>${title}</title><h1>${title}</h1>` });
  });
  await app.seed([Object.keys(WORK), Object.keys(READING)]);
  await app.makeTabGroup(['https://github.com/acme/webapp/pull/42', 'https://github.com/acme/webapp/issues/7', 'https://www.figma.com/design/Qx81/Checkout-flow?node-id=1-2'], { title: 'Dark mode', color: 'blue' });
  await app.makeTabGroup(['https://acme.atlassian.net/browse/PAY-1388', 'https://github.com/acme/api/pull/118', 'https://github.com/acme/api/issues/64'], { title: 'Webhooks', color: 'green' });
  await app.worker.evaluate(async saved => {
    const root = await chrome.bookmarks.create({ parentId: '2', title: 'oh-my-tabs' });
    for (const [topic, pages] of Object.entries(saved)) {
      const folder = await chrome.bookmarks.create({ parentId: root.id, title: topic });
      for (const [url, title] of Object.entries(pages)) await chrome.bookmarks.create({ parentId: folder.id, url, title });
    }
  }, SAVED);

  // 1. The full page: sidebar, tree, details pane, status bar.
  const page = await app.openPage('#groups');
  await page.setViewportSize(SIZE);
  await page.locator('[data-head="collapse"]').click();
  await page.locator('#body details.group[data-key="acme/webapp"] > summary').click();
  await page.locator('#body details.group[data-key="Jira · PAY"] > summary').click();
  await page.click('#toggle-details');
  // The tab that stays of a pull request open three times: the pane counts its duplicates.
  await page.locator('#body details.group[data-key="acme/webapp"] .row-main').nth(2).click();
  await shot(page, 'screenshot-1-full-page');

  // 3. The Windows view with the browser's tab groups.
  await page.click('#toggle-details');
  await page.locator('#side [data-section="windows"]').first().click();
  await page.locator('[data-head="collapse"]').click();
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('#body details.win, #body details.tg')) details.open = true;
  });
  await shot(page, 'screenshot-3-windows-tab-groups');

  // 4. The command palette over the full page, dark: an action, places and tabs for one word.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#side [data-section="groups"]').first().click();
  await page.click('#open-palette');
  await page.fill('#palette-field', 're');
  await shot(page, 'screenshot-4-command-palette');
  await page.keyboard.press('Escape');
  await page.close();

  // 2. Duplicates in the popup, dark: one pull request open three times, the copies under the tab that stays.
  const popup = await app.openPopup();
  await popup.setViewportSize(POPUP);
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.locator('#body details.group[data-key="acme/webapp"] > summary').click();
  await popup.locator('#body details.group[data-key="acme/webapp"] [data-copies]').first().click();
  await framedShot(app, popup, 'screenshot-2-duplicates', 'Duplicates, even when the address differs');

  // 5. Reminders in the popup: two are due, and Remind me later is open on a tab.
  await popup.emulateMedia({ colorScheme: 'light' });
  const now = Date.now();
  await app.worker.evaluate(list => chrome.storage.local.set({ reminders: list }), [
    { url: 'https://github.com/acme/api/pull/118', title: TITLES['https://github.com/acme/api/pull/118'], at: now - 12 * 60 * 1000 },
    { url: 'https://docs.example.org/handbook/release-checklist', title: TITLES['https://docs.example.org/handbook/release-checklist'], at: now - HOUR },
    { url: 'https://github.com/acme/webapp/issues/7', title: TITLES['https://github.com/acme/webapp/issues/7'], at: now + 20 * HOUR },
  ]);
  await popup.waitForSelector('#body details.group.reminders');
  await popup.locator('#body details.group[data-key="acme/webapp"] [data-copies]').first().click();
  await popup.locator('#body details.group[data-key="acme/webapp"] .row [data-menu]').first().click();
  await popup.getByRole('menuitem', { name: /Remind me later/ }).click();
  await framedShot(app, popup, 'screenshot-5-reminders', 'Remind me later');
} finally {
  await app.close();
}
