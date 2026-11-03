// Writes the store uploads: dist/oh-my-tabs-<version>-chrome.zip and dist/oh-my-tabs-<version>-firefox.zip.
// Both hold the same files; only manifest.json differs (see scripts/firefox.js).
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
execFileSync('node', ['scripts/firefox.js'], { stdio: 'inherit' });

// The Chrome build is the Firefox one with the Chrome manifest put back.
rmSync('dist/chrome', { recursive: true, force: true });
cpSync('dist/firefox', 'dist/chrome', { recursive: true });
cpSync('manifest.json', 'dist/chrome/manifest.json');

for (const target of ['chrome', 'firefox']) {
  const zip = `oh-my-tabs-${version}-${target}.zip`;
  rmSync(`dist/${zip}`, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', `../${zip}`, '.', '-x', '*.DS_Store'], { cwd: `dist/${target}` });
  console.log(`Packaged dist/${zip}`);
}
