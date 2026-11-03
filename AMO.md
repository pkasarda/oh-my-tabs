# Firefox Add-ons (AMO) Listing — oh-my-tabs

> Last Updated: 2026-11-03

Upload `dist/oh-my-tabs-1.0.0-firefox.zip`, built by `npm run package`. It needs Firefox 137 or later, desktop only.

## Listing

**Name**: oh-my-tabs
**Add-on URL slug**: oh-my-tabs
**Summary** (≤ 250 characters):
Your tabs grouped by repo, Jira project or Linear team, with duplicates found even when the URLs differ. Search, move, suspend and close tabs across all windows.

**Description**: the detailed description in CHROMEWEBSTORE.md, with two changes. "Chrome's shortcut settings" becomes "Firefox's Manage Extension Shortcuts". After the duplicates section, add this paragraph:

```
Firefox containers are respected: the same page open in two different containers is never treated as a duplicate.
```

**Categories**: Tabs; Productivity
**Tags**: tabs, tab manager, duplicate tabs, developer, github
**Support site**: https://github.com/pkasarda/oh-my-tabs/issues
**Support email**: oh-my-tabs@pixelcherry.eu
**Homepage**: https://github.com/pkasarda/oh-my-tabs
**License**: MIT License (see LICENSE)
**Privacy policy**: the text of PRIVACY.md. AMO accepts it as text, so paste it in.
**Screenshots**: the files in store/, the same ones as for Chrome.

## Data collection

The manifest declares `data_collection_permissions: { required: ["none"] }`. The add-on collects and transmits no data.

## Notes to reviewer

```
No build tools, bundlers, minifiers or transpilers are used. The package holds the plain source files from https://github.com/pkasarda/oh-my-tabs. The only generated file is manifest.json: scripts/firefox.js copies the Chrome manifest and adds the Firefox keys (background.scripts, browser_specific_settings), then drops Chrome-only ones. Fonts: Fira Code, SIL Open Font License, see fonts/OFL.txt. To test: open many tabs, including the same page twice (for example with and without #anchor), click the toolbar icon, and use "Close duplicates".
```

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-03 | First release. | Draft |
