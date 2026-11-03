# oh-my-tabs

Your tabs, grouped the way you think about them: by repo, by Jira project, by Linear team. oh-my-tabs also finds duplicates that plain URL matching misses, such as `/pull/42` and `/pull/42/files`, or the same doc open with different `#hash`es. It works in Chrome and Firefox.

See [docs/spec.md](docs/spec.md) for the full spec and [GLOSSARY.md](GLOSSARY.md) for the terms.

## Install (unpacked)

- **Chrome**: open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and choose this folder.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on…* and choose `manifest.json`.

## Test

```bash
node --test
```
