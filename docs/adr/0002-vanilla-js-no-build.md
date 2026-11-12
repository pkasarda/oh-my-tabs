# Vanilla JS, no framework, no build step

The UI is plain JavaScript modules, hand-written CSS and the browser's own elements: `<details>`, `<dialog>`, the Popover API and native drag and drop. There is no React, Preact, Tailwind or bundler. The UI is a single popup that opens on every click, so its load time matters. The browser already has every component this UI needs. Shipping unbundled source also means Firefox AMO review does not require separate source code and build instructions. React + shadcn and Tailwind were considered and rejected because both need a build step. If UI state ever outgrows plain render functions, Preact + htm can be vendored as ES modules and still needs no build.

The one exception is `scripts/firefox.js`. It copies the same files to `dist/firefox` and rewrites Firefox-specific manifest keys. Chrome warns about `background.scripts` and `browser_specific_settings` in an MV3 manifest, and Firefox needs both, so each browser gets its own manifest. Code is never transformed.

The other exception is testing. The end-to-end checks in `e2e/` drive the unpacked extension with Playwright, a dev dependency. Earlier they lived outside the repo and were lost with the temporary folder they were in. Nothing from `node_modules` ships in the extension.
