/**
 * Build Firefox-compatible extension from the Chrome source.
 * Usage: node build-firefox.mjs
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname);
const dist = resolve(__dirname, 'dist', 'firefox');

if (existsSync(dist)) rmSync(dist, { recursive: true });

const ignore = new Set(['node_modules', '.git', 'dist', 'lantern-mcp', 'build.mjs', 'build-firefox.mjs', 'package.json', 'package-lock.json']);
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    if (ignore.has(e)) continue;
    const s = join(from, e), d = join(to, e);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
copyDir(src, dist);

// ── Manifest ──
const mp = join(dist, 'manifest.json');
const m = JSON.parse(readFileSync(mp, 'utf8'));
m.manifest_version = 2;
m.sidebar_action = { default_panel: 'sidepanel/sidepanel.html', browser_style: true };
delete m.side_panel;
m.browser_action = m.action;
delete m.action;
delete m.chrome_url_overrides;
m.permissions = m.permissions.filter(p => !['sidePanel', 'favicon', 'scripting'].includes(p));
if (m.host_permissions) {
  m.permissions.push(...m.host_permissions.filter(p => !m.permissions.includes(p)));
  delete m.host_permissions;
}
m.background = { scripts: ['background.js'], persistent: false };
if (m.web_accessible_resources) {
  const flat = [];
  for (const e of m.web_accessible_resources) if (e.resources) flat.push(...e.resources);
  m.web_accessible_resources = [...new Set(flat)];
}
writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');

// ── Patch background.js for Firefox -- append overrides ──
const bg = join(dist, 'background.js');
let code = readFileSync(bg, 'utf8');
code += `
// Firefox overrides — only apply when sidePanel API missing
if (!chrome.sidePanel || !chrome.sidePanel.open) {
  var origOpen = openSidePanel;
  var origInit = initSidePanelBehavior;
  openSidePanel = function() { return Promise.resolve({ ok: true, opened: false }); };
  initSidePanelBehavior = function() {};
}
`;
writeFileSync(bg, code);

console.log('✓ Firefox build at', dist);
console.log('  Load in Firefox via about:debugging → This Firefox → Load Temporary Add-on');
