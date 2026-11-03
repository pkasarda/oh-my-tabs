# oh-my-tabs

A browser extension that shows all open tabs sorted into groups and finds and closes duplicate tabs, including duplicates that a plain URL comparison misses.

## Grouping

**Group**:
A set of open tabs that oh-my-tabs shows together under one heading, such as `acme/oh-my-tabs` or `google.com`. It exists only inside oh-my-tabs.
_Avoid_: tab group (that is the browser's own feature, which oh-my-tabs does not touch), cluster, bucket

**Group name**:
The heading that identifies a group: the hostname by default, or a more specific name from a site rule (`owner/repo`, a Jira project key).
_Avoid_: group key, label

**Groups view**:
The main view: groups and their tabs from all windows together. Each tab carries its window label.
_Avoid_: list view, tab view

**Windows view**:
The secondary view: one card per browser window, each holding that window's groups as stacks.
_Avoid_: window manager, overview

**Stack**:
The compact picture of one group: the favicons of its tabs laid over each other, spreading out side by side when pointed at or focused.
_Avoid_: deck, pile, cluster

**Window name**:
A name oh-my-tabs makes up for a browser window from the groups it holds, because browsers do not name their windows.
_Avoid_: window title

**Window label**:
A short marker on a tab in the groups view telling which browser window the tab is in.
_Avoid_: window number, window badge

## Duplicates

**Duplicate key**:
What remains of a tab's URL after removing the parts that do not change which page it is, such as `#hash`, `utm_*` parameters or `/files` under a pull request. Tabs with the same duplicate key show the same thing.
_Avoid_: canonical URL, normalized URL

**Duplicate set**:
All open tabs that share one duplicate key, when there are two or more of them.

**Keeper**:
The one tab of a duplicate set that stays open when duplicates are closed.
_Avoid_: original, primary, master

**Duplicate**:
Any tab in a duplicate set other than its keeper. "Close duplicates" closes exactly these.
_Avoid_: dupe, copy

**System tab**:
A tab whose page is not a website (`chrome://`, `about:`, `file://`, extension pages). It belongs to a group but is never a duplicate.
_Avoid_: internal tab, special tab

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
