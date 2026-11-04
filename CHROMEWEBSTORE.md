# Chrome Web Store Listing — oh-my-tabs

> Last Updated: 2026-11-03

Upload `dist/oh-my-tabs-1.0.0-chrome.zip`, built by `npm run package`.

## Store Listing

**Extension Name**
oh-my-tabs

**Short Description** (113 of 132 characters)
Your tabs grouped by repo, project or site, with smart duplicate cleanup. No account, nothing leaves your device.

**Detailed Description** (plain text, paste as is)

```
No account, no cloud, nothing leaves your device: oh-my-tabs works entirely in your browser.

oh-my-tabs shows all your open tabs, from every window, sorted into groups you recognize. It finds duplicate tabs that other tools miss, and lets you close or tidy them in one click. Closed a group by mistake? Undo brings it back.

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

SAVE TABS FOR LATER (OPTIONAL)
Turn on the Library to save & close tabs, a group or every tab you have not used for a week, and find them again later. Saved tabs are kept as bookmarks in an "oh-my-tabs" folder, so your browser syncs them to your other devices. Sort them into topics. Opening a saved tab that is already open switches to it instead of opening it twice.

A FULL PAGE FOR BIG CLEANUPS
Open oh-my-tabs as a page to see everything at once: a sidebar of groups, windows, topics and stale tabs, and one tree of all your tabs. Tick tabs to save, move, suspend or close them together, drag tabs onto a window or a topic, and drag saved tabs between topics.

STALE TABS
A group at the top lists the tabs you have not used for 7 days or more (you can choose 3, 7, 14 or 30), so you can save or close them in one go. Tabs playing sound, pinned tabs and the sites on your "never" list are always left alone.

PRIVATE BY DESIGN
oh-my-tabs works entirely on your device. It reads the titles and addresses of your open tabs to group them. It never reads page content and never sends anything anywhere. It has no analytics and no accounts. Your settings stay in local browser storage.

FEEDBACK
Open source: https://github.com/pkasarda/oh-my-tabs. Report issues or ideas at https://github.com/pkasarda/oh-my-tabs/issues or write to oh-my-tabs@pixelcherry.eu.
```

**Category**
Productivity → Tools

**Single Purpose** (one purpose, tab management; grouping and duplicates are how it serves it)
oh-my-tabs is a tab manager: it shows all of the user's open tabs in one list, grouped by site or project, so they can find a tab and switch to, move, suspend or close it, including duplicate tabs.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready ("OMT"; the toolbar shows "omt" at a prompt while developer mode is on) | icons/icon-128.png |
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
| bookmarks | optional_permissions | Asked only when the user turns on the Library in the settings. Saved tabs are stored as bookmarks in an "oh-my-tabs" folder, with one subfolder per topic, so the user can close tabs and find them again; the browser's own sync carries them. The extension reads and changes only that folder. |

No host permissions, no content scripts, no remote code.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

Tab addresses and titles are read locally to build the list. With the Library on, saved tabs (title, address) are stored as bookmarks in the user's browser. Nothing is transmitted by the extension.

The Chrome Web Store counts data that is only handled locally as handled. From 1.1 on, check **Web history** (tab and saved-tab addresses), state that it is used only for the extension's single purpose, and certify the three statements below. Leave every other data type unchecked:
- personally identifiable info;
- health info;
- financial info;
- authentication info;
- personal communications;
- location;
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
**Contact Email**: oh-my-tabs@pixelcherry.eu (shown publicly; Google sends its notices to the developer account email)
**Support URL**: https://github.com/pkasarda/oh-my-tabs/issues
**Homepage URL**: https://github.com/pkasarda/oh-my-tabs

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.2.0 | 2026-11-04 | Full page in its own tab: sidebar (groups, windows, topics, stale), one tree with checkboxes and a bulk bar, Library board, drag onto windows and topics, resizable sidebar. Ships 1.1 too. No new permissions. | Ready to submit |
| 1.1.0 | 2026-11-04 | Library (optional, saved tabs as bookmarks with topics), stale-tabs group, "used … ago" in rows, zZz on suspended tabs, Move group to a new window icon. New optional permission: bookmarks. | Not submitted, shipped in 1.2.0 |
| 1.0.0 | 2026-11-03 | First release: groups, duplicates, search, Windows view, move, suspend, badge, shortcuts. | Submitted |

## Review Notes

### Known Issues / Limitations
- The active tab of a window cannot be suspended. The browser does not allow it, so those items are disabled.
- The Chrome package contains no Firefox-only manifest keys, so Chrome shows no manifest warnings. Firefox gets its own build.
- The description names GitHub, GitLab, Bitbucket, Jira, Confluence, Linear, Figma and Google Docs only to say which sites get project groups. These are nominative mentions, with no logos and no affiliation implied.

### Rejection History
None yet.
