# oh-my-tabs

Your tabs, grouped the way you think about them: by repo, by Jira project, by Linear team. oh-my-tabs also finds duplicates that plain URL matching misses, such as `/pull/42` and `/pull/42/files`, or the same doc open with different `#hash`es. It works in Chrome and Firefox.

See [docs/spec.md](docs/spec.md) for the full spec and [GLOSSARY.md](GLOSSARY.md) for the terms.

## Install (unpacked)

- **Chrome**: open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and choose this folder.
- **Firefox**: run `npm run firefox`, open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on…* and choose `dist/firefox/manifest.json`.

In Chrome, popup changes show the next time you open it. Changes to `background.js`, `rules.js` (the badge uses it) or `manifest.json` need the reload button on `chrome://extensions`.

## Test

```bash
node --test
```

## Release

```bash
npm run package
```

This writes `dist/oh-my-tabs-<version>-chrome.zip` and `dist/oh-my-tabs-<version>-firefox.zip`. The store listings, permission justifications and screenshots are in [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md), [AMO.md](AMO.md) and [store/](store/). The privacy policy is [PRIVACY.md](PRIVACY.md).
