# Groups are a view, not browser tab groups

oh-my-tabs groups tabs only inside its own popup and page. It never creates, changes or removes the browser's native tab groups (the `tabGroups` API), and moving tabs between windows leaves the tab strip's own grouping alone. The user wants a better tab list, not an extension that rearranges their tab strip. Leaving native groups alone also avoids Firefox's `tabs.group()` side effects: it unpins pinned tabs and moves tabs so they sit next to each other. It also drops the Firefox 139 minimum and the `tabGroups` permission.
