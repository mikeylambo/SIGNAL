import fs from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

const files = await walk(DIST);
const htmlFiles = files.filter((file) => file.endsWith('.html'));

if (!htmlFiles.some((file) => path.basename(file) === 'index.html')) {
  throw new Error('[SIGNAL itch] dist/index.html is missing.');
}

for (const file of htmlFiles) {
  let html = await fs.readFile(file, 'utf8');

  // The normal PWA manifest is intentionally root-scoped for signalcc.app.
  // itch.io embeds the game under a project subdirectory, so advertising that
  // manifest there would offer a broken install target. The game itself remains
  // fully playable; only the itch copy omits PWA installation metadata.
  if (path.basename(file) === 'index.html') {
    html = html.replace(/\s*<link\b[^>]*\brel=["']manifest["'][^>]*>\s*/gi, '\n');
  }

  // Public policy pages and inline font/icon references are copied by Vite and
  // can contain root-absolute links. Normalize local HTML/CSS references to the
  // current itch subdirectory while leaving https:// URLs untouched.
  html = html
    .replace(/\b(href|src)=(["'])\/(?!\/)/gi, '$1=$2./')
    .replace(/url\((["'])\/(?!\/)/gi, 'url($1./');

  await fs.writeFile(file, html);
}

// These files describe/register the root-domain PWA and are deliberately not
// shipped in the itch artifact. src/main.ts also compiles out registration when
// VITE_ITCH_BUILD=1, so deleting them cannot create a runtime fetch failure.
await fs.rm(path.join(DIST, 'manifest.webmanifest'), { force: true });
await fs.rm(path.join(DIST, 'sw.js'), { force: true });

const refreshed = await walk(DIST);
const textFiles = refreshed.filter((file) => /\.(?:html|css|js)$/i.test(file));
const forbidden = [
  /\b(?:href|src)=["']\/(?!\/)/i,
  /url\(["']\/(?!\/)/i,
  /serviceWorker\.register\(["']\/sw\.js["']\)/i,
];

for (const file of textFiles) {
  const text = await fs.readFile(file, 'utf8');
  const hit = forbidden.find((pattern) => pattern.test(text));
  if (hit) {
    throw new Error(`[SIGNAL itch] Root-absolute runtime reference remains in ${path.relative(DIST, file)}: ${hit}`);
  }
}

console.log('[SIGNAL itch] Prepared subdirectory-safe HTML5 build in dist/.');
