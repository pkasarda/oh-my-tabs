# oh-my-tabs

A browser extension that shows all open tabs sorted into groups and finds and closes duplicate tabs, including duplicates that a plain URL comparison misses.

## Grouping

**Group**:
A set of open tabs that oh-my-tabs shows together under one heading, such as `acme/oh-my-tabs` or `google.com`. It exists only inside oh-my-tabs.
_Avoid_: tab group (that is the browser's own feature, which oh-my-tabs does not touch), cluster, bucket

**Group name**:
The heading that identifies a group: the hostname by default, or a more specific name from a site rule (`owner/repo`, a Jira project key). A tab that would be alone under a specific name moves up to a broader one: its owner, then its site, then its domain (`acme.slack.com` → `slack.com`).
_Avoid_: group key, label

**Groups view**:
The main view: groups and their tabs from all windows together. Each tab carries its window label.
_Avoid_: list view, tab view

**Windows view**:
The secondary view: one collapsible card per browser window, which opens into that window's groups, which open into tabs.
_Avoid_: window manager, overview

**Window name**:
A name oh-my-tabs makes up for a browser window from the groups it holds, because browsers do not name their windows.
_Avoid_: window title

**Window label**:
A short marker on a tab in the groups view telling which browser window the tab is in.
_Avoid_: window number, window badge

## Duplicates

**Duplicate key**:
What remains of a tab's URL after removing the parts that do not change which page it is, such as a `#hash` anchor, `utm_*` parameters or `/files` under a pull request. Tabs with the same duplicate key show the same thing.
_Avoid_: canonical URL, normalized URL

**Duplicate set**:
All open tabs that share one duplicate key, when there are two or more of them.

**Keeper**:
The one tab of a duplicate set that stays open when duplicates are closed.
_Avoid_: original, primary, master

**Duplicate**:
Any tab in a duplicate set other than its keeper. "Close duplicates" closes exactly these.
_Avoid_: dupe, copy

**Suspended tab**:
An open tab whose page the browser has unloaded to free memory. It stays in the list and reloads when you switch to it.
_Avoid_: discarded tab, sleeping tab, hibernated tab

**System tab**:
A tab whose page is not a website (`chrome://`, `about:`, `file://`, extension pages). It belongs to a group but is never a duplicate.
_Avoid_: internal tab, special tab

## Library

**Library**:
The tabs you saved so you could close them, kept as browser bookmarks in the `oh-my-tabs` folder. An optional feature.
_Avoid_: bookmarks (the user's own, which oh-my-tabs leaves alone), read later, archive, sessions

**Saved tab**:
A tab kept in the library. It is not open, or no longer needs to be. It has a title, an address, the date it was saved and at most one topic.
_Avoid_: bookmark, saved item, entry

**Topic**:
A named shelf in the library that a saved tab can belong to, such as "Release 2.0". There is one at most per saved tab.
_Avoid_: tag, label, folder, category

**Library view**:
The third view: saved tabs by topic and group, the way the groups view shows open tabs.
_Avoid_: saved view, bookmarks view

**Stale tab**:
An open, unpinned tab you have not used for longer than the stale threshold (7 days by default). A tab playing sound, or on a site in the never list, is never stale.
_Avoid_: old tab, inactive tab, forgotten tab

**Never list**:
The sites oh-my-tabs never marks as stale and never suspends in bulk. An entry covers its subdomains.
_Avoid_: allowlist, whitelist, exceptions

## Full page

**Full page**:
oh-my-tabs in a tab of its own, opened with Open as page. It shows the same tabs as the popup with room for a sidebar and checkboxes.
_Avoid_: dashboard, options page, manager

**Sidebar**:
The full page's list of sections (groups, windows, topics, stale tabs) that picks what the main pane shows. It takes the place of the popup's view switch.
_Avoid_: left panel, navigation, menu

**Checked tab**:
A tab whose checkbox is ticked on the full page, so a bulk action can act on it. Checking a tab is not switching to it.
_Avoid_: selected tab, marked tab

**Board**:
The Library on the full page: one column per topic, with saved tabs as cards that drag between them.
_Avoid_: kanban

## Developer mode

**Developer mode**:
A setting that turns on site rules and the monospace look. With it off, every group name is a hostname and duplicate keys use only the generic rules.
_Avoid_: dev mode, advanced mode

**Site rule**:
The definition, for one tool such as GitHub or Linear, of how its URLs turn into a group name and a duplicate key.
_Avoid_: matcher, adapter, plugin, integration

## Search

**Results**:
The tabs that match the current search text. Bulk actions such as moving to a new window or closing apply to them.
_Avoid_: selection, filtered tabs
