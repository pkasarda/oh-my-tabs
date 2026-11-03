# Chrome Web Store Listing — oh-my-tabs

> Last Updated: 2026-11-03

Upload `dist/oh-my-tabs-1.0.0-chrome.zip`, built by `npm run package`.

## Store Listing

**Extension Name**
oh-my-tabs

**Short Description** (101 of 132 characters)
Your tabs grouped by repo, Jira project or Linear team, with duplicates found even when the URLs differ.

**Detailed Description** (plain text, paste as is)

```
oh-my-tabs shows all your open tabs, from every window, sorted into groups you recognize. It finds duplicate tabs that other tools miss, and lets you close or tidy them in one click.

GROUPS THAT MATCH HOW YOU WORK
Tabs are grouped by site. With developer mode, which is on by default, they are grouped by project instead: one group per GitHub, GitLab or Bitbucket repository, per Jira or Confluence project, per Linear team. Groups are sorted by size, so the projects with the most tabs come first.

DUPLICATES, EVEN WHEN THE ADDRESS DIFFERS
The same page often hides behind different addresses. oh-my-tabs treats these as the same page:
- a #section anchor;
- tracking parameters such as utm_source;
- a trailing slash.
With developer mode it also recognizes:
- the Files, Commits and Checks pages of one pull request;
- a Jira issue opened from a board;
- a Figma file at a different frame;
- a Google Doc in edit or view mode.
The toolbar icon shows how many duplicates you have. "Close duplicates" keeps the tab you used most recently and closes the copies.

FIND AND MOVE TABS FAST
Search by title, address or group. Accents are ignored, so "cafe" finds "café". Move a tab or a whole group to another window or a new one. Suspend tabs you are not using to free memory. They reload when you come back to them.

A VIEW PER WINDOW
The Windows view shows each window as a card with its groups, the number of tabs and sites, and how long ago you used it. Drag tabs or groups between windows.

KEYBOARD FRIENDLY
Alt+Shift+O opens oh-my-tabs and Alt+Shift+D closes duplicates; you can change both in Chrome's shortcut settings. Type to search, then use the arrow keys and Enter to jump to a tab.

PRIVATE BY DESIGN
oh-my-tabs works entirely on your device. It reads the titles and addresses of your open tabs to group them. It never reads page content and never sends anything anywhere. It has no analytics and no accounts. Your settings stay in local browser storage.

FEEDBACK
Open source: https://github.com/pkasarda/oh-my-tabs. Report issues or ideas at https://github.com/pkasarda/oh-my-tabs/issues.
```

**Category**
Productivity → Tools

**Single Purpose**
Shows your open tabs grouped by site or project and closes duplicate tabs.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | 🟡 Placeholder ("ot"), see issue #12 | icons/icon-128.png |
| Screenshot 1 | 1280×800 | ✅ Ready | store/screenshot-1-groups.png |
| Screenshot 2 | 1280×800 | ✅ Ready | store/screenshot-2-duplicates.png |
| Screenshot 3 | 1280×800 | ✅ Ready | store/screenshot-3-windows.png |
| Screenshot 4 | 1280×800 | ✅ Ready | store/screenshot-4-menu.png |
| Small Promo Tile | 440×280 | ✅ Ready | store/promo-440x280.png |
| Marquee Promo Tile | 1400×560 | ⬜ Not needed | |

### Screenshot Notes

The screenshots use made-up tabs, and their icons are letter tiles, so no third-party logos appear.

1. Groups view: groups per repository and project, one group open.
2. Duplicates: a pull request open as Files, Changes and the PR itself, with the copies under the tab that stays.
3. Windows view: windows as cards with stats, opened into their groups.
4. The ⋯ menu on a tab: move to another window, suspend.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| tabs | permissions | Reads the address and title of open tabs. The extension groups tabs by them, detects duplicate tabs, shows tabs in its list, and switches, moves, closes or suspends the tab the user picks. Every feature depends on it. |
| storage | permissions | Saves the user's settings on the device: developer mode on or off, sort order, and the last view. Nothing else is stored. |
| contextMenus | permissions | Adds "Close duplicates" to the right-click menu of the extension's toolbar icon, so duplicates can be closed without opening the popup. |
| favicon | permissions | Shows each tab's site icon in the list from Chrome's local favicon cache, without fetching icons from the web. |

No host permissions, no content scripts, no remote code.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

Tab addresses and titles are read locally to build the list and are never stored or transmitted. In the dashboard, leave every data type unchecked:
- personally identifiable info;
- health info;
- financial info;
- authentication info;
- personal communications;
- location;
- web history;
- user activity;
- website content.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://github.com/pkasarda/oh-my-tabs/blob/main/PRIVACY.md (live once PR #1 is merged into `main`)

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: Peter Kasarda (to confirm)
**Contact Email**: to decide, shown publicly; the developer account email is used for Google's notices
**Support URL**: https://github.com/pkasarda/oh-my-tabs/issues
**Homepage URL**: https://github.com/pkasarda/oh-my-tabs

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-03 | First release: groups, duplicates, search, Windows view, move, suspend, badge, shortcuts. | Draft |

## Review Notes

### Known Issues / Limitations
- The active tab of a window cannot be suspended. The browser does not allow it, so those items are disabled.
- The Chrome package contains no Firefox-only manifest keys, so Chrome shows no manifest warnings. Firefox gets its own build.
- The description names GitHub, GitLab, Bitbucket, Jira, Confluence, Linear, Figma and Google Docs only to say which sites get project groups. These are nominative mentions, with no logos and no affiliation implied.

### Rejection History
None yet.
