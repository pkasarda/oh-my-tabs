# Firefox Add-ons (AMO) Listing — oh-my-tabs

> Last Updated: 2026-11-03

Upload `dist/oh-my-tabs-1.0.0-firefox.zip`, built by `npm run package`. It needs Firefox 140 or later, desktop only. On upload, select Firefox only: leave **Firefox for Android unchecked**, because Android has no windows API.

## Listing

**Name**: oh-my-tabs
**Add-on URL slug**: oh-my-tabs
**Summary** (≤ 250 characters):
Your tabs grouped by repo, Jira project or Linear team, with duplicates found even when the URLs differ. Search, move, suspend and close tabs across all windows.

**Description** (AMO supports some Markdown, no headings):

```
**oh-my-tabs shows all your open tabs, from every window, grouped by site or project, and finds the duplicate tabs other tools miss.**

**Groups that match how you work:** with developer mode (on by default), tabs are grouped per GitHub, GitLab or Bitbucket repository, per Jira or Confluence project and per Linear team. Without it, by site. The biggest groups come first.

**Duplicates, even when the address differs:**

- #anchors, utm_ tracking parameters and trailing slashes are ignored
- in developer mode also: the Files, Commits and Checks pages of one pull request, a Jira issue opened from a board, a Figma file at another frame, a Google Doc in edit or view mode
- Firefox containers are respected: the same page in two containers is never a duplicate

The toolbar badge counts your duplicates, and "Close duplicates" keeps the tab you used last.

**Find, move, suspend:** search titles, addresses and groups (accents are ignored), move a tab or a whole group to another window, and suspend tabs to free memory.

**Windows view:** every window as a card with its groups, how many tabs and sites it holds, and when you last used it.

**Keyboard:** Alt+Shift+O opens oh-my-tabs and Alt+Shift+D closes duplicates. You can change both in Manage Extension Shortcuts.

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

## Notes to reviewer

```
No build tools, bundlers, minifiers or transpilers are used. The package holds the plain source files from https://github.com/pkasarda/oh-my-tabs. The only generated file is manifest.json: scripts/firefox.js copies the Chrome manifest and adds the Firefox keys (background.scripts, browser_specific_settings), then drops Chrome-only ones. Fonts: Fira Code, SIL Open Font License, see fonts/OFL.txt. To test: open many tabs, including the same page twice (for example with and without #anchor), click the toolbar icon, and use "Close duplicates".

About the innerHTML warnings in popup.js (render, results bar, menu, shortcuts): the HTML is built only from the extension's own template strings. Every value that comes from a tab or from the user (titles, URLs, group and window names, shortcut labels) passes through esc() in popup.js, which escapes & < > ". Attributes are always double-quoted, and tooltips use textContent. No remote content and no eval.
```

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-03 | First release. | Draft |
