# The library is stored as browser bookmarks

Saved tabs are bookmarks in an `oh-my-tabs` folder, and topics are its subfolders.

We chose this over `storage.local`, IndexedDB or a backend such as Cloudflare Workers + D1:
- The browser's own sync (Chrome Sync, Firefox Sync) carries the library to every device, with no server, account or data leaving the extension.
- The saved tabs survive uninstalling oh-my-tabs.
- They stay visible in the browser's bookmark manager.

The cost is that a saved tab can hold only a title, a URL and `dateAdded`. That is why a tab has one topic, not tags, and why the on-device AI summaries were dropped for now. If richer metadata is ever needed, a local side index keyed by bookmark id can sit next to the folder, but it would not sync.
