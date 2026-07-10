import { DEFAULTS } from '../shared/defaults.js';
import { getSettings, setSettings, clearMemories } from '../shared/storage.js';

const fields = [
  'provider',
  'endpoint',
  'apiKey',
  'model',
  'temperature',
  'maxTokens',
  'maxPageChars',
  'systemPrompt',
  'includePageContext',
  'memoriesEnabled',
  'memoryAutoExtract',
  'memoryAutoAccept',
  'stream',
  'searxngUrl',
  'toolsEnabled',
  'maxToolRounds',
  'agentModeAllowed',
  'agentConfirmMutations',
  'maxAgentSteps',
  'newtabEnabled',
  'keyOpenrouter',
  'keyOpenai',
  'keyGroq',
  'keyAnthropic',
  'keyXai',
  'keyNvidia',
  'keyOpencodego',
  'keyExa',
  'keyParallel',
  'keyTinyfish',
  'searchProvider',
];

const form = document.getElementById('form');
const saved = document.getElementById('saved');
const dot = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const modelList = document.getElementById('model-list');
const btnTheme = document.getElementById('btn-theme');

init();

async function init() {
  initTheme();
  btnTheme.addEventListener('click', toggleTheme);

  const settings = await getSettings();
  for (const key of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key] ?? DEFAULTS[key] ?? '';
  }

  form.addEventListener('submit', onSave);
  document.getElementById('btn-test').addEventListener('click', testConnection);
  document.getElementById('btn-fetch-models').addEventListener('click', fetchModels);
  document.getElementById('btn-clear-memories').addEventListener('click', async () => {
    if (!confirm('Delete all local memories?')) return;
    await clearMemories();
    flash('Memories cleared');
    await refreshMemoryList();
  });
  document.getElementById('btn-refresh-memories')?.addEventListener('click', () => {
    refreshMemoryList().catch(() => {});
  });
  document.getElementById('agentModeAllowed')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      const ok = confirm(
        'Agent mode can open tabs, navigate, click, and type on your behalf.\n\n' +
          'Only enable if you understand the risk. Mutation actions still ask for confirmation by default.\n\n' +
          'Enable Agent mode?'
      );
      if (!ok) e.target.checked = false;
    }
  });

  // Search provider toggle
  const searchProvider = document.getElementById('searchProvider');
  if (searchProvider) {
    searchProvider.addEventListener('change', () => {
      const val = searchProvider.value;
      document.querySelectorAll('.search-provider-fields').forEach((el) => {
        el.hidden = el.id !== 'search-fields-' + val;
      });
    });
    // Apply initial state
    const initVal = searchProvider.value || 'searxng';
    document.querySelectorAll('.search-provider-fields').forEach((el) => {
      el.hidden = el.id !== 'search-fields-' + initVal;
    });
  }

  await refreshMemoryList();
  await testConnection();
}

async function refreshMemoryList() {
  const el = document.getElementById('memory-list');
  if (!el) return;
  el.innerHTML = '<p class="field-note">Loading…</p>';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'MEMORIES_LIST' });
    const list = (res?.ok && res.memories) || [];
    if (!list.length) {
      el.innerHTML = '<p class="field-note">No memories yet. Save one from chat or enable auto-extract.</p>';
      return;
    }
    el.innerHTML = '';
    for (const m of list) {
      const row = document.createElement('div');
      row.className = 'memory-row' + (m.status === 'pending' ? ' is-pending' : '');
      const title = m.title || (m.status === 'pending' ? 'Proposed' : 'Note');
      const meta = [m.status || 'active', m.source || 'user'].join(' · ');
      row.innerHTML = `
        <div class="memory-row-main">
          <div class="memory-row-title">${escapeHtml(title)}</div>
          <div class="memory-row-text">${escapeHtml(m.text || '')}</div>
          <div class="memory-row-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="memory-row-actions"></div>
      `;
      const actions = row.querySelector('.memory-row-actions');
      if (m.status === 'pending') {
        const acc = document.createElement('button');
        acc.type = 'button';
        acc.className = 'btn btn-secondary btn-tiny';
        acc.textContent = 'Accept';
        acc.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: 'MEMORY_CONFIRM', id: m.id });
          await refreshMemoryList();
        });
        actions.appendChild(acc);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-secondary btn-tiny btn-danger';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'MEMORY_DELETE', id: m.id });
        await refreshMemoryList();
      });
      actions.appendChild(del);
      el.appendChild(row);
    }
  } catch (err) {
    el.innerHTML = `<p class="field-note">${escapeHtml(err?.message || 'Could not load')}</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initTheme() {
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  btnTheme.setAttribute(
    'aria-label',
    t === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
  );
  btnTheme.title = t === 'light' ? 'Dark mode' : 'Light mode';
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('lantern-theme', next);
  } catch {
    /* ignore */
  }
  chrome.storage.local.set({ theme: next }).catch(() => {});
  initTheme();
}

async function onSave(e) {
  e.preventDefault();
  const partial = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    if (el.type === 'checkbox') partial[key] = el.checked;
    else if (el.type === 'number') partial[key] = Number(el.value);
    else partial[key] = el.value.trim();
  }
  partial.endpoint = partial.endpoint.replace(/\/+$/, '');
  if (partial.searxngUrl) partial.searxngUrl = partial.searxngUrl.replace(/\/+$/, '');
  await setSettings(partial);
  flash('Saved');
  await testConnection();
}

function flash(msg) {
  saved.hidden = false;
  saved.textContent = msg;
  setTimeout(() => {
    saved.hidden = true;
  }, 2000);
}

async function testConnection() {
  statusText.textContent = 'Checking…';
  dot.className = 'dot';
  // Persist current form values so HEALTH uses active provider
  const partial = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') partial[key] = el.checked;
    else if (el.type === 'number') partial[key] = Number(el.value);
    else partial[key] = el.value.trim();
  }
  if (partial.endpoint) partial.endpoint = partial.endpoint.replace(/\/+$/, '');
  await setSettings(partial);

  try {
    const res = await chrome.runtime.sendMessage({ type: 'HEALTH' });
    if (res?.ok && res.healthy) {
      dot.className = 'dot ok';
      const prov = partial.provider || 'local';
      statusText.textContent = 'Connected · ' + prov;
    } else {
      dot.className = 'dot err';
      statusText.textContent = res?.error || 'Unreachable';
    }
  } catch (err) {
    dot.className = 'dot err';
    statusText.textContent = (err && err.message) || 'Background offline';
  }
}

async function fetchModels() {
  await testConnection();
  try {
    const provider = document.getElementById('provider')?.value || 'local';
    const res = await chrome.runtime.sendMessage({
      type: 'LIST_MODELS',
      provider,
    });
    modelList.innerHTML = '';
    if (!res?.ok) {
      flash(res?.error || 'Could not list models');
      return;
    }
    const models = res.models || [];
    for (const m of models) {
      const id = m.id || m.name || m;
      if (!id) continue;
      const opt = document.createElement('option');
      opt.value = id;
      modelList.appendChild(opt);
    }
    flash(models.length ? `${models.length} model(s)` : 'No models returned');
  } catch (err) {
    flash((err && err.message) || 'Could not list models');
  }
}
