// Writes dist/firefox: the same files with a Firefox manifest. It only copies files and
// rewrites manifest keys; there is no bundling or transpiling (see docs/adr/0002).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const OUT = 'dist/firefox';
const FILES = ['background.js', 'rules.js', 'library.js', 'popup.html', 'page.html', 'popup.css', 'popup.js', 'fonts', 'icons'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const file of FILES) cpSync(file, `${OUT}/${file}`, { recursive: true });

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
// Firefox runs MV3 backgrounds as event pages, not service workers.
manifest.background = { scripts: [manifest.background.service_worker], type: manifest.background.type };
// Chrome-only keys, which Firefox would warn about.
delete manifest.minimum_chrome_version;
manifest.permissions = manifest.permissions.filter(permission => permission !== 'favicon');
manifest.browser_specific_settings = {
  gecko: {
    id: 'oh-my-tabs@pixelcherry.eu',
    // 140: browser_specific_settings.gecko.data_collection_permissions (137 brought commands.openShortcutSettings).
    strict_min_version: '140.0',
    data_collection_permissions: { required: ['none'] },
  },
};
writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Firefox build written to ${OUT}`);
