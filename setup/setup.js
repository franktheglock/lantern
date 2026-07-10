import { getSettings, setSettings } from '../shared/storage.js';
import { PROVIDERS } from '../shared/providers.js';

const cloudProviders = PROVIDERS.filter((p) => p.id !== 'local');

let selectedProviderId = '';
let selectedSearch = 'skip';
let step = 1;

const els = {
  step1: document.getElementById('step-1'),
  step2: document.getElementById('step-2'),
  step3: document.getElementById('step-3'),
  step4: document.getElementById('step-4'),
  providerCards: document.getElementById('provider-cards'),
  step1Next: document.getElementById('step1-next'),
  step2Desc: document.getElementById('step2-desc'),
  step2Key: document.getElementById('step2-key'),
  step2Paste: document.getElementById('step2-paste'),
  step2Back: document.getElementById('step2-back'),
  step2Next: document.getElementById('step2-next'),
  searchOptions: document.getElementById('search-options'),
  searchField: document.getElementById('search-field'),
  step3Key: document.getElementById('step3-key'),
  step3Back: document.getElementById('step3-back'),
  step3Skip: document.getElementById('step3-skip'),
  step3Next: document.getElementById('step3-next'),
  step4Desc: document.getElementById('step4-desc'),
  step4Done: document.getElementById('step4-done'),
};

async function init() {
  renderProviders();
  renderSearchOptions();
  bindEvents();
}

function renderProviders() {
  els.providerCards.innerHTML = '';
  for (const p of cloudProviders) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'prov-card';
    btn.dataset.id = p.id;
    const recommended = p.id === 'opencodego' ? '<span class="prov-card-recommended">Recommended</span>' : '';
    btn.innerHTML = `
      <span class="prov-card-body">
        <div class="prov-card-title">${esc(p.label)} ${recommended}</div>
        <div class="prov-card-meta">${esc(p.baseUrl || '')}</div>
      </span>
      <span class="prov-card-check">✓</span>
    `;
    btn.addEventListener('click', () => selectProvider(p.id));
    els.providerCards.appendChild(btn);
  }
}
}

function selectProvider(id) {
  selectedProviderId = id;
  els.providerCards.querySelectorAll('.prov-card').forEach((c) => c.classList.toggle('is-selected', c.dataset.id === id));
  els.step1Next.disabled = false;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSearchOptions() {
  const opts = [
    { id: 'skip', label: 'Skip', desc: 'No search for now' },
    { id: 'exa', label: 'Exa', desc: 'Neural search API' },
    { id: 'parallel', label: 'ParallelSearch', desc: 'AI-powered search' },
    { id: 'tinyfish', label: 'Tinyfish', desc: 'Lightweight search API' },
    { id: 'searxng', label: 'SearXNG', desc: 'Self-hosted (enter URL)' },
  ];
  els.searchOptions.innerHTML = '';
  for (const o of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-opt' + (o.id === 'skip' ? ' is-selected' : '');
    btn.textContent = o.label;
    btn.title = o.desc;
    btn.dataset.id = o.id;
    btn.addEventListener('click', () => selectSearch(o.id));
    els.searchOptions.appendChild(btn);
  }
}

function selectSearch(id) {
  selectedSearch = id;
  els.searchOptions.querySelectorAll('.search-opt').forEach((c) => c.classList.toggle('is-selected', c.dataset.id === id));
  const needsKey = id !== 'skip' && id !== 'searxng';
  els.searchField.hidden = !needsKey;
  if (id === 'skip') {
    els.step3Next.disabled = true;
    els.step3Skip.textContent = 'Finish';
  } else {
    els.step3Next.disabled = !needsKey;
    els.step3Skip.textContent = 'Skip';
  }
}

function goToStep(n) {
  [1, 2, 3, 4].forEach((i) => {
    const el = document.getElementById('step-' + i);
    if (el) el.hidden = i !== n;
  });
  step = n;
}

function bindEvents() {
  // Step 1: pick provider
  els.step1Next.addEventListener('click', () => {
    if (!selectedProviderId) return;
    const p = cloudProviders.find((x) => x.id === selectedProviderId);
    els.step2Desc.textContent = 'Paste your ' + (p?.label || selectedProviderId) + ' API key. You can find it in your provider\'s dashboard.';
    els.step2Key.value = '';
    els.step2Next.disabled = true;
    goToStep(2);
  });

  // Step 2: API key
  els.step2Key.addEventListener('input', () => {
    els.step2Next.disabled = !els.step2Key.value.trim();
  });
  els.step2Paste.addEventListener('click', async () => {
    try {
      els.step2Key.value = await navigator.clipboard.readText();
      els.step2Next.disabled = false;
    } catch { /* ignore */ }
  });
  els.step2Back.addEventListener('click', () => goToStep(1));
  els.step2Next.addEventListener('click', () => goToStep(3));

  // Step 3: search
  els.step3Key.addEventListener('input', () => {
    els.step3Next.disabled = !els.step3Key.value.trim();
  });
  els.step3Back.addEventListener('click', () => goToStep(2));
  els.step3Skip.addEventListener('click', () => finish());
  els.step3Next.addEventListener('click', () => finish());

  // Step 4: done
  els.step4Done.addEventListener('click', () => {
    window.location.href = '../sidepanel/sidepanel.html';
  });
}

async function finish() {
  const partial = {};
  const p = cloudProviders.find((x) => x.id === selectedProviderId);
  if (p) {
    partial.provider = selectedProviderId;
    partial[p.keyField] = els.step2Key.value.trim();
  }
  if (selectedSearch === 'searxng') {
    partial.searchProvider = 'searxng';
  } else if (selectedSearch !== 'skip') {
    partial.searchProvider = selectedSearch;
    partial['key' + selectedSearch.charAt(0).toUpperCase() + selectedSearch.slice(1)] = els.step3Key.value.trim();
  } else {
    partial.searchProvider = 'searxng';
  }
  // Enable tools by default
  partial.toolsEnabled = true;

  try {
    await setSettings(partial);
    const pn = p?.label || selectedProviderId;
    els.step4Desc.textContent = 'Connected to ' + pn + (selectedSearch !== 'skip' ? ' with ' + selectedSearch + ' search.' : '. You can add search anytime in Settings.');
    goToStep(4);
  } catch (err) {
    els.step4Desc.textContent = 'Error saving: ' + (err.message || err);
    goToStep(4);
  }
}

init();
