// Shared setup for the end-to-end tests: the unpacked extension in Chromium, driven by Playwright.
// Every launch gets a fresh temporary profile, so no test sees another one's tabs, settings or bookmarks.
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// What the extension is made of, as scripts/firefox.js copies it.
const EXTENSION_FILES = ['manifest.json', 'appearance.js', 'background.js', 'rules.js', 'library.js', 'popup.html', 'page.html', 'popup.css', 'popup.js', 'fonts', 'icons'];

// Neutral addresses and the titles their pages get. Nothing is fetched: every request is answered here.
export const TABS = {
  pr: 'https://github.com/acme/client/pull/12',
  prFiles: 'https://github.com/acme/client/pull/12/files',
  issue: 'https://github.com/acme/client/issues/3',
  jira1: 'https://acme.atlassian.net/browse/WEB-1',
  jira2: 'https://acme.atlassian.net/browse/WEB-2',
  guide: 'https://docs.example.org/guide',
  guideIntro: 'https://docs.example.org/guide#intro',
  api: 'https://docs.example.org/api',
};

const TITLES = {
  'https://github.com/acme/client/pull/12': 'Fix login redirect · Pull Request #12 · acme/client',
  'https://github.com/acme/client/pull/12/files': 'Files changed · Pull Request #12 · acme/client',
  'https://github.com/acme/client/issues/3': 'Sidebar loses focus · Issue #3 · acme/client',
  'https://acme.atlassian.net/browse/WEB-1': '[WEB-1] Checkout button - Jira',
  'https://acme.atlassian.net/browse/WEB-2': '[WEB-2] Footer links - Jira',
  'https://docs.example.org/guide': 'Cestovné náhrady · Guide',
  'https://docs.example.org/api': 'API reference',
};

// One window of everything: with developer mode on that is acme/client (3, one duplicate),
// docs.example.org (3, one duplicate) and Jira · WEB (2).
export const ALL_TABS = Object.values(TABS);

export function titleOf(url) {
  return TITLES[url.split('#')[0]];
}

function pageFor(url) {
  const title = titleOf(url) ?? new URL(url).pathname;
  return `<!doctype html><title>${title}</title><h1>${title}</h1>`;
}

// The Library and tab groups need optional permissions, which Chrome grants only after a prompt that a headless
// browser never answers. So their tests load a copy whose manifest has them as required permissions.
function extensionWith(permissions) {
  const dir = mkdtempSync(join(tmpdir(), 'omt-ext-'));
  for (const file of EXTENSION_FILES) cpSync(join(ROOT, file), join(dir, file), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  manifest.permissions.push(...permissions);
  manifest.optional_permissions = manifest.optional_permissions.filter(permission => !permissions.includes(permission));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

// Retries an assertion until it passes or the time is up, then throws its last error.
export async function eventually(check, { timeout = 5000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

// library, tabGroups: load the extension with the bookmarks or tabGroups permission granted.
// settings: storage.local before any page opens.
// profile: a profile directory to reuse (a browser restart), which close() then leaves for the caller to remove.
export async function launch({ library = false, tabGroups = false, settings = null, profile: reused = null } = {}) {
  const profile = reused ?? mkdtempSync(join(tmpdir(), 'omt-profile-'));
  const permissions = [...(library ? ['bookmarks'] : []), ...(tabGroups ? ['tabGroups'] : [])];
  const extension = permissions.length ? extensionWith(permissions) : ROOT;
  const context = await chromium.launchPersistentContext(profile, {
    // The bundled Chromium: its new headless mode runs extensions, Chrome Headless Shell does not.
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      // A request that slips past the route below fails instead of reaching the network.
      '--host-resolver-rules=MAP * ~NOTFOUND',
    ],
  });
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url.endsWith('/favicon.ico')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: pageFor(url) });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  if (settings) await worker.evaluate(values => chrome.storage.local.set(values), settings);

  const app = {
    context,
    worker,
    extensionId,

    url(file) {
      return `chrome-extension://${extensionId}/${file}`;
    },

    // windows: one list of addresses per window. The tabs load through Playwright, so the route above answers
    // them, then the background moves them into their windows. The blank start tab is closed.
    async seed(windows) {
      const blank = context.pages();
      const ids = [];
      for (const urls of windows) {
        const windowIds = [];
        for (const url of urls) {
          const page = await context.newPage();
          await page.goto(url);
          windowIds.push(await app.tabIdOf(url));
        }
        ids.push(windowIds);
      }
      for (const page of blank) await page.close();
      for (const windowIds of ids.slice(1)) {
        await worker.evaluate(async ([first, ...rest]) => {
          const created = await chrome.windows.create({ tabId: first });
          if (rest.length > 0) await chrome.tabs.move(rest, { windowId: created.id, index: -1 });
        }, windowIds);
      }
      return ids;
    },

    // Puts the tabs of these addresses into one tab group, as a person would in the tab strip, and returns its id.
    // properties (title, color, collapsed) need the tabGroups permission; without it the tab group is plain.
    async makeTabGroup(urls, properties = null) {
      const tabIds = [];
      for (const url of urls) tabIds.push(await app.tabIdOf(url));
      return worker.evaluate(async ([tabIds, properties]) => {
        const { windowId } = await chrome.tabs.get(tabIds[0]);
        const tabGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        if (properties) await chrome.tabGroups.update(tabGroupId, properties);
        return tabGroupId;
      }, [tabIds, properties]);
    },

    async tabGroup(id) {
      return worker.evaluate(id => chrome.tabGroups.get(id), id);
    },

    async tabs() {
      return worker.evaluate(() => chrome.tabs.query({}));
    },

    async webTabs() {
      const all = await app.tabs();
      return all.filter(tab => tab.url.startsWith('http'));
    },

    async webUrls() {
      const tabs = await app.webTabs();
      return tabs.map(tab => tab.url).sort();
    },

    async tabIdOf(url) {
      const tabs = await app.tabs();
      const tab = tabs.find(t => t.url === url);
      if (!tab) throw new Error(`No tab for ${url}`);
      return tab.id;
    },

    // popup.html and page.html open as ordinary tabs. Resolves once the list has rendered.
    async openPopup(suffix = '') {
      return app.open(`popup.html${suffix}`);
    },

    async openPage(suffix = '') {
      return app.open(`page.html${suffix}`);
    },

    async open(file) {
      const page = await context.newPage();
      await page.goto(app.url(file));
      await page.waitForFunction(() => document.querySelector('#body')?.children.length > 0);
      return page;
    },

    async close() {
      await context.close();
      if (!reused) rmSync(profile, { recursive: true, force: true });
      if (extension !== ROOT) rmSync(extension, { recursive: true, force: true });
    },
  };
  return app;
}
