# oh-my-tabs v1 spec

oh-my-tabs is a browser extension that shows every open tab sorted into groups and finds and closes duplicate tabs that a plain URL comparison misses. Terms used here are defined in [GLOSSARY.md](../GLOSSARY.md). Decisions behind the design are in [adr/](adr/).

## Platform

- Desktop Chrome 123+ and Firefox 140+ (Manifest V3). Chrome 123 is the floor for CSS `light-dark()`. Firefox 140 is the floor for `data_collection_permissions` in the manifest; it also covers `commands.openShortcutSettings` (137) and the Popover API (125). Firefox for Android is out of scope.
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
- Firefox manifest: `gecko.id` is `oh-my-tabs@pixelcherry.eu` (`oh-my-tabs@pkasarda` belonged to a deleted AMO listing and can never be reused) and `data_collection_permissions` is `{"required": ["none"]}`. The extension sends no data anywhere.
- Plain JS modules, hand-written CSS, no build step ([ADR 0002](adr/0002-vanilla-js-no-build.md)).
- It never touches the browser's native tab groups ([ADR 0001](adr/0001-groups-are-a-view-not-browser-tab-groups.md)).
- UI text is English. Light or dark follows `prefers-color-scheme`.

## Files

```
manifest.json
background.js        badge, tooltip, context menu, shortcut
popup.html/.js/.css  the UI: popup.html is the popup, page.html the full page; both run popup.js
page.html
rules.js             pure: URL → group name, URL → duplicate key, keeper choice
rules.test.js        node --test
package.json         "type": "module" for node, the test and firefox scripts
scripts/firefox.js   copies the extension to dist/firefox with a Firefox manifest
scripts/package.js   npm run package: the Chrome and Firefox zips for the stores
store/               store screenshots and promo tile
PRIVACY.md           privacy policy linked from both stores
fonts/               Fira Code (woff2), the developer-mode font
icons/               icon-* (default) and dev-* (developer mode), 16–128 px
```

## Rules (`rules.js`)

Everything here is a pure function of URLs, tab metadata and the developer-mode flag. `rules.test.js` covers every rule with real URLs.

### Generic rules (always on)

- **Group name**: the host without a leading `www.`. A non-default port stays, so `localhost:3000` and `localhost:5173` are separate groups.
- **Duplicate key**: the URL with these changes:
  - a `#hash` anchor removed (`#intro`, `#L10-L20`, `#issuecomment-1`). A hash that looks like an app route stays: one that starts with `#/` or `#!`, or contains `/`, such as Gmail's `#inbox/AAA`. Different routes are different pages;
  - `utm_*` query parameters removed;
  - the remaining query parameters sorted;
  - a trailing `/` removed from the path, except for the root path.
- Only `http:` and `https:` tabs get a duplicate key. System tabs go into one group named `Browser` and are never duplicates. A web URL that cannot be parsed is treated the same way.
- A tab that is still loading is judged by its `pendingUrl`.

### Site rules (developer mode only)

A site rule applies to a URL whose host matches it. It overrides the group name and/or the duplicate key for that URL. A URL that no site rule matches falls back to the generic rules. The generic duplicate-key changes still apply on top of every site rule.

| Tool | Host | Group name | Duplicate key collapses |
|---|---|---|---|
| GitHub | `github.com` | `owner/repo`. `owner` for `/owner` or `/orgs/owner/…`. `github.com` for reserved first segments (`settings`, `notifications`, `pulls`, `issues`, `search`, `marketplace`, `explore`, `login`, …) | `/owner/repo/pull/N/*` → `/owner/repo/pull/N` |
| GitLab | `gitlab.com` | path before `/-/` (`group/sub/project`) | `/-/merge_requests/N/*` → `/-/merge_requests/N` |
| Bitbucket | `bitbucket.org` | `workspace/repo` | `/pull-requests/N/*` → `/pull-requests/N` |
| Linear | `linear.app` | `Linear · TEAM` from `/ws/issue/TEAM-123` or `/ws/team/TEAM/…`, else `Linear · ws` | `/ws/issue/TEAM-123/slug` → `/ws/issue/TEAM-123` |
| Jira | `*.atlassian.net` (not `/wiki`), or a self-hosted `jira.*` host | `Jira · ABC` (keys are upper-cased) from `/browse/ABC-123`, `?selectedIssue=ABC-123` or `/projects/ABC/…` | `/browse/ABC-123?…`, `…?selectedIssue=ABC-123` and `/projects/ABC/issues/ABC-123` → `/browse/ABC-123` |
| Confluence | `*.atlassian.net/wiki` | `Confluence · KEY` from `/wiki/spaces/KEY/…` | `/wiki/spaces/KEY/pages/ID/slug` → `/wiki/spaces/KEY/pages/ID` |
| Figma | `figma.com` | generic | `/(design\|file\|board\|proto)/KEY/…?node-id=…` → `/<kind>/KEY` |
| Google Docs | `docs.google.com` | generic | `/(document\|spreadsheets\|presentation)/d/ID/…` (with `/edit`, `/view`, `?tab=`, `#gid`) → `/<kind>/d/ID` |
| Slite | `slite.com`, `*.slite.com` | generic | `/app/docs/ID/slug` → `/app/docs/ID` |

When developer mode is off, only the generic rules apply. The badge count can therefore change when the setting changes.

### Duplicates

- A duplicate set is every open tab, across all windows and including pinned tabs, that shares one duplicate key.
- Normal and private (incognito) tabs never match each other, nor do tabs in different Firefox containers (`cookieStoreId`).
- The keeper is the tab in the set with the highest `lastAccessed`.
- All other tabs in the set are duplicates. Counts everywhere (badge, group header, button) count duplicates only. Three identical tabs count as 2.

## Background (`background.js`)

- **Badge**: the number of duplicates in red. With none, the number of open tabs in a muted blue-gray, shown as `999+` above 999. The popup asks for a recompute when it opens, so the two never disagree.
  - Recomputed from the open tabs on `tabs.onCreated`, `onRemoved`, `onReplaced`, `onActivated`, on `onUpdated` when `changeInfo.url` is set, and when developer mode changes. Recomputes are debounced by 150 ms, so a burst of closes ends in one count. Tabs that were just removed are left out, because Firefox can still list them.
  - A full recompute is cheap at 400+ tabs.
- **Tooltip** (`action.setTitle`): `3 duplicates`, followed by up to 3 lines like `acme/oh-my-tabs #42 ×2`.
- **Icon**: `OMT` on indigo (`icons/icon-*.png`). While developer mode is on, the toolbar icon is `omt` at a green prompt (`icons/dev-*.png`). It is set on install, on browser start and when the setting changes. Stores and `chrome://extensions` always show the default icon.
- **Context menu on the toolbar icon**: `Close duplicates`.
- **Commands**:
  - `_execute_action`: `Alt+Shift+O`.
  - `close-duplicates`: `Alt+Shift+D`.
- **Close duplicates** closes every duplicate and keeps every keeper. It never asks for confirmation, because the same page stays open.

## UI (`popup.html`)

`popup.html` is the popup. `Open as page` opens `page.html`, the full page in a tab, which runs the same `popup.js` with a sidebar in place of the view switch and leaves its own tab out of the list. An old `popup.html?page` tab redirects to `page.html`. While open, the UI re-renders whenever a tab event fires.

- Tooltips are oh-my-tabs' own (`data-tip`), never native `title` attributes, whose tooltip shows only after about a second.
  - The first tooltip shows after 150 ms. Moving on to the next one within 400 ms shows it at once.
  - Tooltips also show on keyboard focus.
- Everything clickable has a pointer cursor.

### Header

- Search field, focused on open.
- View switch: **Groups** / **Windows**. The last choice is remembered and the default is Groups.
- `Close duplicates (N)` button, disabled at 0.
- `Open as page`.
- ⚙ menu (popover):
  - Developer mode toggle (default on), with a one-line explanation of what it changes.
  - Sort tabs: `Recent` (default) or `Tab order`.
  - `Suspend all other tabs`: every tab except each window's active tab. It asks for confirmation above 10 tabs.
  - Current shortcuts, read from `commands.getAll()`, with `not set` when a shortcut is unassigned.
  - `Change…`, which opens the browser's shortcut settings.
- Settings are stored in `storage.local`.

### Groups view (main)

- Groups are sorted by tab count, descending.
- Each group is a `<details>` element whose header reads like `acme/oh-my-tabs · 12 · 2 duplicates`.
- The group header has two inline actions:
  - `Close duplicates in group`, shown only when the group has duplicates. It never asks for confirmation.
  - `⋯`, which opens the group menu:
    - `Move group to ▸` (other windows plus `New window`);
    - `Suspend group`;
    - `Close group`. It asks for confirmation when it would close more than 10 tabs.
- While searching, group actions apply only to the group's results.
- Groups start collapsed, except the group holding the current tab.
- Header mini stacks show up to 4 *different* favicons.
- Tabs within a group are sorted by `Recent` (`lastAccessed`, descending) or by `Tab order` (window, then index).
- A tab row shows:
  - a 28 px favicon and the title, inside a button that switches to the tab, so the keyboard can reach it;
  - a short URL;
  - its window label: a small window glyph with the window's number, highlighted for the current window. Its tooltip gives the window name;
  - a small `zZz` on the corner of the favicon when the tab is suspended; its favicon and title are dimmed;
  - `×` (close) and `⋯`, which opens the tab menu:
    - `Move to window ▸`;
    - `Suspend this tab` (disabled for an active tab);
    - `Suspend other tabs in this group`.
- Duplicates are nested under their keeper.
  - The keeper row shows `+N copies` (`aria-expanded`). N counts only the copies in the same list, and the button is hidden at 0. Clicking it expands the copies, indented beneath the keeper.
  - Each copy always shows its window label, because a copy can be in any window.
- Clicking a row switches to that tab and focuses its window.

### Windows view (secondary)

The windows view uses the groups view's language one level up: window → group → tab, all collapsible cards ([preview](previews/windows.html), option E).

- Each window is a collapsible card, styled like a group. The current window is highlighted and starts open.
- The card header shows:
  - a mini stack of the first favicons of its biggest groups;
  - the window name: the window's biggest group plus how many other groups it holds, e.g. `pkasarda/oh-my-tabs & 3 more`;
  - a stats line, e.g. `59 tabs · 12 sites · 3 dups · active 5 h ago · oldest used 4 wk ago`;
  - the window actions;
  - `This window` or `Window N`.
- Stats line:
  - Sites are distinct web hostnames.
  - The times come from the tabs' `lastAccessed`.
  - A monitor icon's tooltip gives the window state and size, e.g. `maximized · 2560×985`.
- Window actions:
  - Inline: `Minimize`, which becomes `Restore` on a minimized window. Restoring focuses the window, which returns it to its previous state.
  - `⋯` opens the window menu: `Bring to front`, `New tab`, `Suspend window`, `Close window`. Closing asks for confirmation above 10 tabs.
- Group headers inside a window card have the same `⋯` group menu, scoped to that window.
- Open, the card lists the window's groups with two or more tabs as nested group cards that open into tab rows. Groups with a single tab are plain tab rows under `1-tab sites · N`.
- Tab rows inside a window card hide their window label, except copies nested under a keeper.
- A copy whose keeper is in another window cannot nest under it. It shows a `copy` marker, whose tooltip names the keeper's window.
- Drag a tab row or a group header onto another window card, or onto `Drop here for a new window`, to move it (native drag and drop, with its own data type `application/x-oh-my-tabs`, so text dropped from a page is ignored). `Move to window ▸` in the menus does the same from the keyboard.
- In the groups view, clicking a tab's window label switches to the windows view, opens that window and scrolls to it.

### Updates and safety

- The popup re-renders on tab events that change what it shows: created, removed, moved, attached, detached, replaced or activated tabs, and `url`, `title`, `favIconUrl`, `discarded` or `pinned` changes.
- Updates are debounced by 50 ms, and only the latest load is applied.
- While a menu or the confirm dialog is open, the refresh waits until it closes.
- Focus survives a re-render: the focused control is found again by what it acts on.
- `Close duplicates` and `Suspend` first reload the current tabs, so they never act on a copy that has since navigated away.
- The confirm dialog resets its result before opening, so Esc always cancels.
- Search keys `↑`/`↓` move only between visible rows. The result count is announced (`role="status"`).
- Tooltips link to their target with `aria-describedby`.

### Menus and suspending

- Every `⋯` menu is the same popover, with menu roles.
  - A submenu opens in place. `→` or Enter opens it; `←`, Esc or `Back` returns.
  - `↑`/`↓`/Home/End move between items. Esc on the top level closes the menu and returns focus to `⋯`.
- Suspending uses `tabs.discard()` one tab at a time.
  - Browsers cannot suspend a window's active tab, so active and already suspended tabs are skipped.
  - Menu items show how many tabs they would suspend and are disabled at 0.
  - Suspending more than 10 tabs asks first.
- A suspended tab reloads when you switch to it. Window stats show `N suspended`.

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

## 1.1: Library and stale tabs

Goal: you can close tabs without losing them, so you stop keeping hundreds open "just in case". Design agreed in a grilling session. The look is in [previews/library.html](previews/library.html).

### Settings: Features

- ⚙ gets a **Features** section with two switches. Both are stored in `storage.local`:
  - **Library**, off by default.
  - **Stale tabs**, on by default, with a threshold of 3, 7, 14 or 30 days (default 7).
- Turning **Library** on requests the optional `bookmarks` permission (`optional_permissions`). The Library is on exactly while that permission is granted, so there is no separate setting to get out of sync, for example when Firefox closes the popup for the prompt.
  - The permission is never in `permissions`. Adding it there would make Chrome disable the published extension on update until the user accepts a new warning.
  - If the user declines, the switch stays off.
- Turning **Library** off hides everything Library-related: the Library view, the save icons and the saved markers. The bookmarks stay untouched.

### Library storage ([ADR 0003](adr/0003-library-is-browser-bookmarks.md))

- The library is a bookmarks folder named `oh-my-tabs` in Other Bookmarks. It is created on first save, and found again by name if its id is lost.
- Topics are subfolders of `oh-my-tabs`. A saved tab without a topic sits directly in `oh-my-tabs`. A saved tab has at most one topic.
- A saved tab is a bookmark: its title and its URL. "Saved X ago" comes from `dateAdded`. Nothing else is stored, so the browser's own sync carries the whole library.
- Duplicate keys apply. Saving a URL whose duplicate key is already in the library removes the old bookmark and creates a new one. The new one gets today's date and keeps the old topic. The library never holds two saved tabs with one duplicate key.
- Bookmarks outside the `oh-my-tabs` folder are never read or changed.

### Saving

- **Save & close** (bookmark-plus icon):
  - inline on every tab row and group header in the Groups and Windows views;
  - in the ⋯ menus of tabs, groups and windows;
  - as a results-bar action while searching.
  - It saves without a topic and needs one click.
- ⋯ menus also offer **Save** (keep the tab open) and **Save to topic ›**, a submenu of the topics plus `New topic…`.
- An open tab whose duplicate key is in the library shows a filled bookmark icon instead of the outline one: it is safe to close.
- Saving more than 10 tabs at once asks first, like closing.

### Library view

- **Library** is a third view in the view switch. It is shown only while the feature is on.
- Topic chips sit under the header: `All · N`, one per topic with its count, and `+ New topic`.
- The library is grouped by the usual group rules, so a saved GitHub PR sits under its `owner/repo`. Within a group, the newest saved tab comes first.
- A row shows:
  - the favicon, title and short URL;
  - its topic as a pill;
  - `saved 3 wk ago`;
  - `↗` (open in the background), `×` (remove from the library) and `⋯` (`Move to topic ›`).
- Clicking a row opens the tab in the current window and keeps it in the library. If a tab with the same duplicate key is already open, the click switches to it instead.
- A group header has `↗` to open all its saved tabs (asks above 10) and `⋯` with `Remove group from library`.
- Search covers only the view you are in: saved tabs in Library, open tabs in Groups and Windows.

### Stale tabs

- A stale tab is an open, unpinned tab whose `lastAccessed` is older than the threshold.
- While the feature is on, the Groups view starts with a collapsed group, `Not used for 7+ days · N`, in the usual card style with an amber clock icon.
- Its header has the save icon (Save & close all, only while Library is on) and `⋯`:
  - `Save & close all · N` and `Save all, keep open · N` (Library on);
  - `Close all without saving · N`.
- Every action asks above 10 tabs.
- Tab rows show `used 2 wk ago` when the tab was last used more than a day ago.

### Undo and the never list (1.1)

- **Undo.** The last bulk close can be undone from a bar at the bottom of the popup, `Closed N tabs · Undo`, shown for 10 seconds.
  - Bulk closes are Close group, Close results, Close window, Close all stale and every Save & close.
  - Close duplicates has no undo, since every keeper stays open. A single × has none either; the browser's Reopen closed tab covers it.
  - Before closing, the popup remembers each tab's URL, window, index and pinned state. Undo reopens them in the background in their window, or in the current window if that one is gone. A closed window comes back as a new window.
  - More than 10 tabs reopen suspended: Firefox creates them discarded, Chrome discards them right after creating them.
  - Back/forward history is not kept, and no new permission is needed. Saved tabs stay in the Library after an undo.
  - Only the last bulk close is remembered, and only while the popup is open.
- **Never list.** Sites that are never stale and never suspended in bulk.
  - It is edited in ⚙ → Features (one site per line) and in a tab's ⋯ menu (`Never stale or suspend this site`, or `Allow stale and suspend for this site` when the site is listed).
  - `slack.com` covers slack.com and its subdomains; `app.slack.com` covers that subdomain and the ones below it. Typed or pasted URLs are cleaned to their host (`neverEntry` in rules.js).
  - It is stored in `storage.local`, not `storage.sync`, which would count as data sent off the device.
  - Tabs playing sound are treated like pinned tabs: never stale, never suspended in bulk. `Suspend this tab` still works on any single tab.
- **Store copy** leads with privacy: "Your tabs grouped by repo, project or site, with smart duplicate cleanup. No account, nothing leaves your device." That line is also the manifest description.

### Also in 1.1

- Group headers in the Groups and Windows views get an inline **Move group to a new window** icon.
- Lone tabs roll up before they become rows. Each tab has a group chain from the most specific group to its site:
  - GitHub, GitLab and Bitbucket: `owner/repo` → `owner` → host.
  - Linear: `Linear · TEAM` → `Linear · workspace` → `linear.app`.
  - Jira and Confluence: project or space → host → domain.
  - Other sites: host → domain.
  - The domain is the host's last two labels (`acme.slack.com` → `slack.com`), or three after a two-part suffix such as `co.uk`. A short list in rules.js covers these suffixes; it is not the full Public Suffix List. Hosting domains (`github.io`, `vercel.app`, `wordpress.com`, …), IP addresses, `localhost` and hosts with a port have no domain level.
  A tab that would be alone in its group moves one level up, repeatedly, until it shares a group or the chain ends. For example, `nrwl/nx` and `nrwl/nx-labs` with one tab each become one `nrwl` group, and lone repos of different owners meet in `github.com` (`rollUp` in rules.js, applied to open and saved tabs). Without developer mode a chain is host → domain.
- A group with a single tab after that is not a card: in the Groups and Library views, such tabs are plain rows under `1-tab sites · N`, after the groups, as in the Windows view.
- The Library view hides `Close duplicates`, which is about open tabs.

### Out of 1.1

- On-device AI summaries. Chrome's Summarizer API was considered and dropped: no Slovak, Chrome only, heavy hardware needs, and it would mean reading page content.
- Tags (more than one per saved tab).
- Importing existing bookmarks.
- Font as its own setting (#18).
- Themes (#19).

### Store impact

- `bookmarks` becomes an optional permission. PRIVACY.md and the Chrome Web Store disclosures must say that the extension reads and writes bookmarks in its own folder only, that they stay in the browser, and that the browser's own sync is what carries them.
- AMO stays `data_collection_permissions: none`, since nothing is transmitted by the extension.

## Testing

- `node --test` runs `rules.test.js`.
- The UI is checked by loading the extension unpacked in both browsers.

## Out of v1 (roadmap issues)

- Tab actions: pin, sort and mute.
- Window actions:
  - Save a window for later (sessions).
  - Name or color a window. Window ids change on browser restart, so names need a stable key.
- More site rules: Datadog, Sentry, Vercel, Stack Overflow, …
- Translations (i18n).
