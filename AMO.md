# Firefox Add-ons (AMO) Listing — oh-my-tabs

> Last Updated: 2026-11-12

Upload `dist/oh-my-tabs-1.3.1-firefox.zip`, built by `npm run package`. It needs Firefox 140 or later, desktop only. On upload, select Firefox only: leave **Firefox for Android unchecked**, because Android has no windows API.

## Listing

**Name**: oh-my-tabs
**Add-on URL slug**: oh-my-tabs
**Summary** (≤ 250 characters):
Your tabs grouped by repo, project or site, with smart duplicate cleanup and undo. Save tabs for later as bookmarks. No account, nothing leaves your device.

**Description** (AMO supports some Markdown, no headings):

```
**No account, no cloud, nothing leaves your device.** oh-my-tabs shows all your open tabs, from every window, grouped by site or project, and finds the duplicate tabs other tools miss. Closed a group by mistake? Undo brings it back.

**Groups that match how you work:** with developer mode (on by default), tabs are grouped per GitHub, GitLab or Bitbucket repository, per Jira or Confluence project and per Linear team. Without it, by site. The biggest groups come first.

**Duplicates, even when the address differs:**

- #anchors, utm_ tracking parameters and trailing slashes are ignored
- in developer mode also: the Files, Commits and Checks pages of one pull request, a Jira issue opened from a board, a Figma file at another frame, a Google Doc in edit or view mode
- Firefox containers are respected: the same page in two containers is never a duplicate

The toolbar badge counts your duplicates, and "Close duplicates" keeps the tab you used last.

**Find, move, suspend:** search titles, addresses and groups (accents are ignored), move a tab or a whole group to another window, and suspend tabs to free memory.

**Windows view:** every window as a card with its groups, how many tabs and sites it holds, and when you last used it.

**Keyboard:** Alt+Shift+O opens oh-my-tabs and Alt+Shift+D closes duplicates. You can change both in Manage Extension Shortcuts.

**Save tabs for later (optional):** turn on the Library to save & close tabs, a group or all stale tabs, then find them again by topic. They are kept as bookmarks in an "oh-my-tabs" folder, so Firefox Sync carries them.

**Full page:** open oh-my-tabs as a page for big cleanups: a sidebar of groups, windows, topics and stale tabs, one tree of all tabs with checkboxes to save, move, suspend or close many at once, and a board to drag saved tabs between topics. Ctrl+K (⌘K on a Mac) opens a command palette to run an action, go to a section or switch to a tab by typing, and a details pane describes the focused tab.

**Tab groups (optional):** turn them on to see Firefox's tab groups inside each window, with their names and colors. Moving a tab group keeps it together, and Undo puts closed tabs back into it.

**Make it yours:** choose the font, text size and a light or dark theme, what the toolbar badge counts, and whether the toolbar button opens the popup or the full page.

**Stale tabs:** a group at the top lists the tabs you have not used for a week or more, to save or close in one go.

**Private:** everything happens on your device. No data is collected or sent anywhere. Open source: https://github.com/pkasarda/oh-my-tabs
```

**Experimental**: no. **Requires payment**: no.
**Categories** (up to 3; there is no Productivity): Tabs; Web Development
**Tags**: tabs, tab manager, duplicate tabs, developer, github
**Support site**: https://github.com/pkasarda/oh-my-tabs/issues
**Support email**: oh-my-tabs@pixelcherry.eu
**Homepage**: https://github.com/pkasarda/oh-my-tabs
**License**: MIT License (see LICENSE)
**Privacy policy**: check "This add-on has a Privacy Policy" and paste the text of PRIVACY.md.
**Screenshots**: the files in store/, the same ones as for Chrome.

## Data collection

The manifest declares `data_collection_permissions: { required: ["none"] }`. The add-on collects and transmits no data.

## Permissions new in 1.4

- `alarms` (required, no prompt): one alarm at the time of the next reminder the user set with "Remind me later". Firefox drops alarms when it closes, so the add-on sets it again from `storage.local` each time its background starts, and lists the reminders that came due meanwhile.
- `notifications` (optional): asked only when the user turns on Notify me. A system notification with the page's title when a reminder is due; a click opens that page.

Reminders (the page's address, its title and the time) are kept in `storage.local` on the device, so `data_collection_permissions` stays `none`.

## Notes to reviewer

```
No build tools, bundlers, minifiers or transpilers are used. The package holds the plain source files from https://github.com/pkasarda/oh-my-tabs. The only generated file is manifest.json: scripts/firefox.js copies the Chrome manifest and adds the Firefox keys (background.scripts, browser_specific_settings), then drops Chrome-only ones. Fonts: Fira Code, SIL Open Font License, see fonts/OFL.txt. To test: open many tabs, including the same page twice (for example with and without #anchor), click the toolbar icon, and use "Close duplicates".

About the innerHTML warnings in popup.js (render, results bar, menu, shortcuts): the HTML is built only from the extension's own template strings. Every value that comes from a tab or from the user (titles, URLs, group and window names, shortcut labels) passes through esc() in popup.js, which escapes & < > ". Attributes are always double-quoted, and tooltips use textContent. No remote content and no eval.
```

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.3.1 | 2026-11-12 | The right-click menu stays open in Firefox on macOS and Linux. Ships 1.3.0 too. | Ready to submit |
| 1.3.0 | 2026-11-12 | Settings window; font, text size, theme; toolbar badge and button options; tab groups shown (optional tabGroups permission); full page: command palette, details pane, tree toolbar, status bar. | Not submitted, shipped in 1.3.1 |
| 1.2.1 | 2026-11-04 | Settings panel scrolls inside the popup; lists keep their width with a scrollbar. Ships 1.1 and 1.2 too. | Ready to submit |
| 1.2.0 | 2026-11-04 | Full page with sidebar, checkboxes and bulk bar, Library board, resizable sidebar. Ships 1.1 too. | Not submitted, shipped in 1.2.1 |
| 1.1.0 | 2026-11-04 | Library (optional bookmarks permission), stale tabs, zZz on suspended tabs. | Not submitted, shipped in 1.2.1 |
| 1.0.0 | 2026-11-03 | First release. | Submitted |
