const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

try {
  new Function(src);
  console.log('Function parse: OK');
} catch (e) {
  console.log('Function parse FAIL:', e.message);
}

const patterns = [
  [/\?\./g, 'optional chaining'],
  [/\?\?/g, 'nullish'],
  [/\basync function\b/g, 'async function'],
  [/\bawait\b/g, 'await'],
  [/`/g, 'template literal'],
  [/=>/g, 'arrow'],
  [/\bconst\b/g, 'const'],
  [/\blet\b/g, 'let'],
  [/catch\s*\{/g, 'optional catch'],
];
for (const [re, name] of patterns) {
  const m = src.match(re);
  if (m) console.log(name + ':', m.length);
}

// Simulate chrome APIs and evaluate top-level
const calls = [];
const chrome = {
  storage: {
    sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    session: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
  },
  runtime: {
    onInstalled: { addListener: (fn) => calls.push(['onInstalled', fn]) },
    onMessage: { addListener: (fn) => calls.push(['onMessage', fn]) },
    sendMessage: () => Promise.resolve(),
  },
  contextMenus: {
    removeAll: (cb) => cb && cb(),
    create: () => {},
    onClicked: { addListener: (fn) => calls.push(['onClicked', fn]) },
  },
  sidePanel: {
    setPanelBehavior: () => Promise.resolve(),
    open: () => Promise.resolve(),
  },
  tabs: { get: () => Promise.resolve({ url: '', title: '' }) },
  scripting: { executeScript: () => Promise.resolve([{ result: {} }]) },
};

try {
  const fn = new Function('chrome', 'console', src + '\n// end');
  fn(chrome, console);
  console.log('Eval with mock chrome: OK, listeners:', calls.map((c) => c[0]).join(', '));
} catch (e) {
  console.log('Eval with mock chrome FAIL:', e.message);
  console.log(e.stack);
}
