# oh-my-tabs v1 spec

oh-my-tabs is a browser extension that shows every open tab sorted into groups and finds and closes duplicate tabs that a plain URL comparison misses. Terms used here are defined in [GLOSSARY.md](../GLOSSARY.md). Decisions behind the design are in [adr/](adr/).

## Platform

- Desktop Chrome 123+ and Firefox 125+ (Manifest V3). Chrome 123 is the floor for CSS `light-dark()` and Firefox 125 for the Popover API. Firefox for Android is out of scope.
- `manifest.json` is the Chrome manifest, with `background.service_worker`.
- `npm run firefox` writes `dist/firefox`: the same files with a Firefox manifest. That manifest has `background.scripts` and `browser_specific_settings`, and drops the Chrome-only keys. Chrome warns about those Firefox keys in an MV3 manifest, which is why there are two manifests.
- `browser.*` everywhere, with `globalThis.browser ??= chrome` at the top of each entry point.
- Permissions:
  - `tabs`, `storage`, `contextMenus` (Firefox treats `contextMenus` as an alias of `menus`).
  - `favicon` (Chrome only; Firefox ignores it with a warning). It lets Chrome serve favicons from its own cache through `/_favicon/`.
- Favicons:
  - Chrome serves them from its own cache through `/_favicon/`.
  - Firefox shows `tab.favIconUrl`.
  - A letter tile is shown when neither has an icon.
- Firefox manifest: `gecko.id` is `oh-my-tabs@pkasarda` and `data_collection_permissions` is `{"required": ["none"]}`. The extension sends no data anywhere.
- Plain JS modules, hand-written CSS, no build step ([ADR 0002](adr/0002-vanilla-js-no-build.md)).
- It never touches the browser's native tab groups ([ADR 0001](adr/0001-groups-are-a-view-not-browser-tab-groups.md)).
- UI text is English. Light or dark follows `prefers-color-scheme`.

## Files

```
manifest.json
background.js        badge, tooltip, context menu, shortcut
popup.html/.js/.css  the UI, shown both as the popup and as a full page
rules.js             pure: URL → group name, URL → duplicate key, keeper choice
rules.test.js        node --test
package.json         "type": "module" for node, the test and firefox scripts
scripts/firefox.js   copies the extension to dist/firefox with a Firefox manifest
fonts/               Fira Code (woff2), the developer-mode font
icons/               placeholder icon
```

## Rules (`rules.js`)

Everything here is a pure function of URLs, tab metadata and the developer-mode flag. `rules.test.js` covers every rule with real URLs.

### Generic rules (always on)

- **Group name**: the hostname, without a leading `www.`.
- **Duplicate key**: the URL with these changes:
  - the `#hash` removed;
  - `utm_*` query parameters removed;
  - the remaining query parameters sorted;
  - a trailing `/` removed from the path, except for the root path.
- Only `http:` and `https:` tabs get a duplicate key. System tabs go into one group named `Browser` and are never duplicates.

### Site rules (developer mode only)

A site rule applies to a URL whose host matches it. It overrides the group name and/or the duplicate key for that URL. A URL that no site rule matches falls back to the generic rules. The generic duplicate-key changes still apply on top of every site rule.

| Tool | Host | Group name | Duplicate key collapses |
|---|---|---|---|
| GitHub | `github.com` | `owner/repo`. `owner` for `/owner` or `/orgs/owner/…`. `github.com` for reserved first segments (`settings`, `notifications`, `pulls`, `issues`, `search`, `marketplace`, `explore`, `login`, …) | `/owner/repo/pull/N/*` → `/owner/repo/pull/N` |
| GitLab | `gitlab.com` | path before `/-/` (`group/sub/project`) | `/-/merge_requests/N/*` → `/-/merge_requests/N` |
| Bitbucket | `bitbucket.org` | `workspace/repo` | `/pull-requests/N/*` → `/pull-requests/N` |
| Linear | `linear.app` | `Linear · TEAM` from `/ws/issue/TEAM-123` or `/ws/team/TEAM/…`, else `Linear · ws` | `/ws/issue/TEAM-123/slug` → `/ws/issue/TEAM-123` |
| Jira | `*.atlassian.net` (not `/wiki`), or a self-hosted `jira.*` host | `Jira · ABC` from `/browse/ABC-123`, `?selectedIssue=ABC-123` or `/projects/ABC/…` | `/browse/ABC-123?…`, `…?selectedIssue=ABC-123` and `/projects/ABC/issues/ABC-123` → `/browse/ABC-123` |
| Confluence | `*.atlassian.net/wiki` | `Confluence · KEY` from `/wiki/spaces/KEY/…` | `/wiki/spaces/KEY/pages/ID/slug` → `/wiki/spaces/KEY/pages/ID` |
| Figma | `figma.com` | generic | `/(design\|file\|board\|proto)/KEY/…?node-id=…` → `/<kind>/KEY` |
| Google Docs | `docs.google.com` | generic | `/(document\|spreadsheets\|presentation)/d/ID/…` (with `/edit`, `/view`, `?tab=`, `#gid`) → `/<kind>/d/ID` |
| Slite | `slite.com`, `*.slite.com` | generic | `/app/docs/ID/slug` → `/app/docs/ID` |

When developer mode is off, only the generic rules apply. The badge count can therefore change when the setting changes.

### Duplicates

- A duplicate set is every open tab, across all windows and including pinned tabs, that shares one duplicate key.
- Normal and private (incognito) tabs never match each other.
- The keeper is the tab in the set with the highest `lastAccessed`.
- All other tabs in the set are duplicates. Counts everywhere (badge, group header, button) count duplicates only. Three identical tabs count as 2.

## Background (`background.js`)

- **Badge**: the number of duplicates, empty when there are none.
  - Recomputed from `tabs.query({})` on `tabs.onCreated`, `onRemoved`, `onReplaced`, on `onUpdated` when `changeInfo.url` is set, and when developer mode changes.
  - A full recompute is cheap at 400+ tabs.
- **Tooltip** (`action.setTitle`): `3 duplicates`, followed by up to 3 lines like `acme/oh-my-tabs #42 ×2`.
- **Context menu on the toolbar icon**: `Close duplicates`.
- **Commands**:
  - `_execute_action`: `Alt+Shift+O`.
  - `close-duplicates`: `Alt+Shift+D`.
- **Close duplicates** closes every duplicate and keeps every keeper. It never asks for confirmation, because the same page stays open.

## UI (`popup.html`)

`popup.html` serves as the popup and also as a full page in a tab (`Open as page`). The full page uses a wider layout and leaves its own tab out of the list. While open, the UI re-renders whenever a tab event fires.

### Header

- Search field, focused on open.
- View switch: **Groups** / **Windows**. The last choice is remembered and the default is Groups.
- `Close duplicates (N)` button, disabled at 0.
- `Open as page`.
- ⚙ menu (popover):
  - Developer mode toggle (default on).
  - Sort tabs: `Recent` (default) or `Tab order`.
  - Current shortcuts, read from `commands.getAll()`, with `not set` when a shortcut is unassigned.
  - `Change…`, which opens the browser's shortcut settings.
- Settings are stored in `storage.local`.

### Groups view (main)

- Groups are sorted by tab count, descending.
- Each group is a `<details>` element whose header reads like `acme/oh-my-tabs · 12 · 2 duplicates`, plus a `Move to…` menu for the whole group.
- Groups start collapsed, except the group holding the current tab.
- Tabs within a group are sorted by `Recent` (`lastAccessed`, descending) or by `Tab order` (window, then index).
- A tab row shows:
  - a 28 px favicon and the title;
  - a short URL;
  - its window label: a small window glyph with the window's number, highlighted for the current window. Its tooltip gives the window name;
  - `Move to…` (other windows plus `New window`) and `×`.
- Duplicates are nested under their keeper.
  - The keeper row shows `+N copies`. Clicking it expands the copies, indented beneath the keeper.
  - Each copy always shows its window label, because a copy can be in any window.
- Clicking a row switches to that tab and focuses its window.

### Windows view (secondary)

- Windows are stacked vertically, one full-width card each.
- A card shows the window name and the tab count.
  - The window name is the window's biggest group plus how many other groups it holds, e.g. `pkasarda/oh-my-tabs & 3 more`.
  - The current window is highlighted.
- Each group in a window is a stack showing up to 5 overlapping 32 px favicons plus `+N`, with the group name under it.
- On hover (after a 60 ms delay) or keyboard focus, the stack spreads out into a panel that lies over the card. The panel shows the group name and every favicon, wrapping onto more rows as needed. Nothing else in the window moves.
- The animation is a FLIP on `translate` only: 200 ms, `cubic-bezier(0.23, 1, 0.32, 1)`, a 12 ms stagger. With `prefers-reduced-motion` it opens without motion.
- Pointing at a favicon in an open stack shows, instantly, a line at the bottom of the panel with the tab's title, short URL and, for copies, `duplicate`. There is no native tooltip, which only appears after a delay. Clicking the favicon switches to that tab.
- Drag a favicon or a whole stack onto another window card or onto `+ New window` to move it (native drag and drop). `Move to…` remains as the keyboard way to do the same.

### Search

- Matches the tab title, the URL and the group name.
- Substring match that ignores case and diacritics (`cestovne` finds `cestovné`), via `normalize('NFD')` with combining marks stripped.
- Groups that hold results expand.
- Keyboard: `↑`/`↓` move between results, `Enter` switches to the selected tab, `Esc` closes.
- While the search field has text, a bar offers `Move results (N) to new window` and `Close results (N)`.
- Closing more than 10 results asks first in a `<dialog>`.

### Developer mode look

- With developer mode on, the whole UI uses bundled Fira Code (OFL, woff2) with ligatures off (`font-variant-ligatures: none`), so `->` in a title stays two characters.
- With developer mode off, the UI uses the system sans-serif font.

## Testing

- `node --test` runs `rules.test.js`.
- The UI is checked by loading the extension unpacked in both browsers.

## Out of v1 (roadmap issues)

- Tab actions: pin, discard, sort and mute.
- More site rules: Datadog, Sentry, Vercel, Stack Overflow, …
- Publishing to AMO and the Chrome Web Store.
- A real icon.
- Translations (i18n).
