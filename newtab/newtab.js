const form = document.getElementById('form');
const query = document.getElementById('query');
const greeting = document.getElementById('greeting');
const endpointLabel = document.getElementById('endpoint-label');
const bookmarksGrid = document.getElementById('bookmarks-grid');
const pinPopover = document.getElementById('pin-popover');
const pinAddForm = document.getElementById('pin-add-form');
const pinTitle = document.getElementById('pin-title');
const pinUrl = document.getElementById('pin-url');
const btnCancelPin = document.getElementById('btn-cancel-pin');
const btnImportBrowser = document.getElementById('btn-import-browser');
const btnTheme = document.getElementById('btn-theme');
const recentChats = document.getElementById('recent-chats');
const recentList = document.getElementById('recent-list');
const goBtn = document.getElementById('go-btn');
const searchShell = document.getElementById('search-shell');
const modeRow = document.getElementById('mode-row');
const modeIndicator = document.querySelector('.mode-indicator');
const modeTabs = document.querySelectorAll('.mode-tab');
const suggestDropdown = document.getElementById('suggest-dropdown');
const btnAttach = document.getElementById('btn-attach');
const fileInput = document.getElementById('file-input');
// Model picker
const mpTriggerNt = document.getElementById('mp-trigger-nt');
const mpPanelNt = document.getElementById('mp-panel-nt');
const mpValueNt = document.getElementById('mp-value-nt');
const mpProviderListNt = document.getElementById('mp-provider-list-nt');
const mpModelListNt = document.getElementById('mp-model-list-nt');
const mpViewProvidersNt = document.getElementById('mp-view-providers-nt');
const mpViewModelsNt = document.getElementById('mp-view-models-nt');
const mpBackNt = document.getElementById('mp-back-nt');
const contextTabs = document.getElementById('context-tabs');
const contextList = document.getElementById('context-list');
const contextCount = document.getElementById('context-count');

/** Mode definitions: id → { label, icon, placeholder, hint, color } */
const MODES = {
  search: {
    label: 'Search',
    icon: 'search',
    placeholder: 'Search the web…',
    hintVerb: 'search',
    color: 'var(--accent-text)',
    btnBg: 'var(--accent-solid)',
    btnFg: 'var(--on-accent)',
  },
  chat: {
    label: 'Chat',
    icon: 'chat',
    placeholder: 'Ask anything…',
    hintVerb: 'ask',
    color: '#8b9ed4',
    btnBg: '#5b6fb0',
    btnFg: '#f0f2fa',
  },
  agent: {
    label: 'Agent',
    icon: 'agent',
    placeholder: 'Tell the agent what to do…',
    hintVerb: 'run',
    color: '#daa45a',
    btnBg: '#c4843e',
    btnFg: '#fdf6ed',
  },
};
const MODE_ORDER = ['search', 'chat', 'agent'];

let settings = null;
let chatMode = 'search';
let agentModeAllowed = false;
/** @type {{ dataUrl: string, name: string }[]} */
let attachedImages = [];
/** @type {{ id: number, title: string, url: string, favIconUrl: string }[]} */
let allTabs = [];
/** Set of selected tab IDs for context */
let selectedContextTabs = new Set();
/** Selected model from picker */
let selectedModel = '';
let selectedProvider = 'local';
/** Lantern-only pins (not browser bookmarks) */
let allPins = [];
let ghostPinEl = null;

init();

async function init() {
  setGreeting();
  initTheme();
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  settings = res?.settings || {};
  agentModeAllowed = !!settings.agentModeAllowed;

  // Restore saved mode from storage (or localStorage fallback)
  chatMode = await loadSavedMode();

  if (settings.newtabEnabled === false) {
    // Minimal mode: show search + pins, hide Lantern branding
    document.title = 'New Tab';
    document.body.classList.add('minimal');
    query.placeholder = 'Search the web…';
    updateEndpointLabel();
    await loadPins();
    applyMode();
    form.addEventListener('submit', onSubmit);
    query.addEventListener('keydown', onKeyDown);
    query.addEventListener('input', onQueryInput);
    query.addEventListener('blur', () => setTimeout(closeSuggest, 150));
    claimSearchFocus();
    return;
  }
  updateEndpointLabel();
  await loadPins();
  loadRecentChats().catch((err) => console.warn('[Lantern] recent chats', err));

  // Browser omnibox steals focus on NTP — reclaim it for our search box
  claimSearchFocus();

  applyMode();
  form.addEventListener('submit', onSubmit);
  query.addEventListener('keydown', onKeyDown);
  query.addEventListener('input', onQueryInput);
  query.addEventListener('blur', () => setTimeout(closeSuggest, 150));
  btnTheme.addEventListener('click', toggleTheme);

  // Attach button
  btnAttach?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', onFilesSelected);

  // Model picker
  loadModelPicker().catch(() => {});

  // Model picker
  mpTriggerNt?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = mpTriggerNt.getAttribute('aria-expanded') === 'true';
    if (open) closeModelPicker();
    else { loadModelPicker().then(() => openModelPicker()); }
  });
  mpBackNt?.addEventListener('click', (e) => {
    e.stopPropagation();
    showProviderView();
  });
  document.addEventListener('click', (e) => {
    if (mpPanelNt && !mpPanelNt.hidden && !mpPanelNt.contains(e.target) && e.target !== mpTriggerNt) {
      closeModelPicker();
    }
  });

  // Context tabs
  loadContextTabs();
  chrome.tabs.onUpdated.addListener(loadContextTabs);
  chrome.tabs.onRemoved.addListener(loadContextTabs);

  // Mode tab clicks
  for (const tab of modeTabs) {
    tab.addEventListener('click', () => {
      const m = tab.dataset.mode;
      if (m === 'agent' && !agentModeAllowed) {
        chrome.runtime.openOptionsPage();
        return;
      }
      setMode(m);
      saveMode(m);
    });
  }

  // Keep indicator positioned on resize
  window.addEventListener('resize', () => {
    if (modeIndicator) positionIndicator();
  });

  btnCancelPin.addEventListener('click', closePinPopover);
  pinAddForm.addEventListener('submit', onAddPin);
  btnImportBrowser.addEventListener('click', onImportBrowser);

  // Close popover on outside click / Escape
  document.addEventListener('mousedown', (e) => {
    if (pinPopover.hidden) return;
    if (pinPopover.contains(e.target)) return;
    if (ghostPinEl && ghostPinEl.contains(e.target)) return;
    closePinPopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pinPopover.hidden) {
      e.preventDefault();
      closePinPopover();
    }
  });

}

// ── Mode management ──────────────────────────────────────────────────

async function loadSavedMode() {
  try {
    const stored = await chrome.storage.local.get('newtabMode');
    if (stored.newtabMode && MODE_ORDER.includes(stored.newtabMode)) {
      return stored.newtabMode;
    }
  } catch { /* ignore */ }
  try {
    const ls = localStorage.getItem('lantern-newtab-mode');
    if (ls && MODE_ORDER.includes(ls)) return ls;
  } catch { /* ignore */ }
  return 'search';
}

async function saveMode(mode) {
  try {
    await chrome.storage.local.set({ newtabMode: mode });
  } catch { /* ignore */ }
  try {
    localStorage.setItem('lantern-newtab-mode', mode);
  } catch { /* ignore */ }
}

/** Return the list of mode ids currently enabled (agent only if allowed). */
function getEnabledModes() {
  return MODE_ORDER.filter((m) => m !== 'agent' || agentModeAllowed);
}

/** Cycle to the next enabled mode. */
function cycleMode() {
  const enabled = getEnabledModes();
  const idx = enabled.indexOf(chatMode);
  const next = enabled[(idx + 1) % enabled.length];
  setMode(next);
  saveMode(next);
  // Brief pulse animation on the go button
  goBtn.classList.remove('mode-just-switched');
  void goBtn.offsetWidth; // reflow
  goBtn.classList.add('mode-just-switched');
}

/** Apply mode to all UI elements. */
function applyMode() {
  setMode(chatMode);
}

function setMode(mode) {
  if (!MODE_ORDER.includes(mode)) return;
  if (mode === 'agent' && !agentModeAllowed) mode = 'search';
  chatMode = mode;
  const def = MODES[mode];
  const nextModes = getEnabledModes();
  const idx = nextModes.indexOf(mode);
  const nextMode = nextModes[(idx + 1) % nextModes.length];

  // Go button
  goBtn.setAttribute('data-mode', mode);
  goBtn.setAttribute('aria-label', def.label);
  goBtn.title = `Enter · ${def.hintVerb}`;

  // Search shell focus ring
  searchShell.setAttribute('data-mode', mode);

  // Mode row
  modeRow.setAttribute('data-mode', mode);
  for (const tab of modeTabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.hidden = tab.dataset.mode === 'agent' && !agentModeAllowed;
  }

  // Position the sliding indicator
  requestAnimationFrame(() => positionIndicator());

  // Placeholder
  if (!document.body.classList.contains('minimal')) {
    query.placeholder = def.placeholder;
  }

  // Refresh context tabs when switching mode
  loadContextTabs();
}

/** Snap the indicator pill to the active mode tab. */
function positionIndicator() {
  const active = modeRow.querySelector('.mode-tab[aria-selected="true"]');
  if (!active || !modeIndicator) return;
  const rowRect = modeRow.getBoundingClientRect();
  const tabRect = active.getBoundingClientRect();
  const left = tabRect.left - rowRect.left;
  const width = tabRect.width;
  modeIndicator.style.left = `${left}px`;
  modeIndicator.style.width = `${width}px`;
}

// ── Autocomplete (search mode only) ──────────────────────────────────

let suggestTimer = 0;
let suggestIndex = -1;
let suggestItems = [];

/** Debounced input → fetch suggestions + auto-resize */
function onQueryInput() {
  autoResize();
  clearTimeout(suggestTimer);
  if (chatMode !== 'search') { closeSuggest(); return; }
  const q = query.value.trim();
  if (!q || q.length < 2) { closeSuggest(); return; }
  suggestTimer = setTimeout(() => fetchSuggestions(q), 150);
}

function autoResize() {
  if (chatMode === 'search') return;
  query.style.height = 'auto';
  query.style.height = Math.min(query.scrollHeight, 320) + 'px';
}

async function fetchSuggestions(q) {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const json = await res.json();
    const list = (json && json[1]) || [];
    suggestItems = list.slice(0, 8);
    if (!suggestItems.length) { closeSuggest(); return; }
    renderSuggestions();
    suggestDropdown.hidden = false;
    suggestIndex = -1;
  } catch {
    closeSuggest();
  }
}

function renderSuggestions() {
  suggestDropdown.innerHTML = '';
  suggestItems.forEach((text, i) => {
    const div = document.createElement('div');
    div.className = 'suggest-item';
    div.dataset.index = i;
    div.innerHTML = `
      <span class="suggest-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" />
        </svg>
      </span>
      <span class="suggest-text">${escapeHtml(text)}</span>
    `;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSuggestion(i);
    });
    suggestDropdown.appendChild(div);
  });
}

function selectSuggestion(index) {
  const text = suggestItems[index];
  if (!text) return;
  query.value = text;
  closeSuggest();
  doWebSearch(text);
}

function highlightSuggestion(index) {
  const items = suggestDropdown.querySelectorAll('.suggest-item');
  items.forEach((el, i) => el.classList.toggle('is-active', i === index));
  if (index >= 0) {
    const active = items[index];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
}

function closeSuggest() {
  suggestDropdown.hidden = true;
  suggestDropdown.innerHTML = '';
  suggestItems = [];
  suggestIndex = -1;
}

// ── Attachments ──

function onFilesSelected() {
  const files = Array.from(fileInput?.files || []);
  if (fileInput) fileInput.value = '';
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = () => {
      attachedImages.push({ dataUrl: reader.result, name: file.name });
      renderImagePreviews();
      btnAttach?.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  }
}

function renderImagePreviews() {
  let wrap = searchShell.querySelector('.image-previews');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'image-previews';
    searchShell.insertBefore(wrap, searchShell.querySelector('.composer-bar'));
  }
  wrap.innerHTML = '';
  attachedImages.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'image-preview';
    div.innerHTML = `<img src="${img.dataUrl}" alt="${img.name}" />`;
    const rm = document.createElement('button');
    rm.className = 'image-preview-remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      attachedImages.splice(i, 1);
      renderImagePreviews();
      if (!attachedImages.length) btnAttach?.classList.remove('has-image');
    });
    div.appendChild(rm);
    wrap.appendChild(div);
  });
  if (!attachedImages.length && wrap) wrap.remove();
}

function clearAttachments() {
  attachedImages = [];
  const wrap = searchShell.querySelector('.image-previews');
  if (wrap) wrap.remove();
  btnAttach?.classList.remove('has-image');
}

// ── Model picker ──

let mpOpenNt = false;
let modelProvidersNt = [];
let activeProviderIdNt = '';

async function loadModelPicker() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'LIST_PROVIDERS' });
    if (res?.ok) {
      modelProvidersNt = res.providers || [];
      activeProviderIdNt = res.activeProvider || selectedProvider || 'local';
      if (res.activeModel) selectedModel = res.activeModel;
      selectedProvider = res.activeProvider || 'local';
    }
  } catch { /* fall back to defaults */ }
  updateModelTriggerLabel();
}

function updateModelTriggerLabel() {
  const label = selectedModel || 'Server default';
  mpValueNt.textContent = label.length > 16 ? label.slice(0, 14) + '…' : label;
  // Set provider icon in trigger
  const iconEl = document.getElementById('mp-trigger-icon-nt');
  if (iconEl) {
    const prov = modelProvidersNt.find((p) => p.id === selectedProvider);
    const iconFile = prov?.icon ? ((prov.icon.includes('.') ? prov.icon : prov.icon + '.svg')) : 'llamacpp.svg';
    iconEl.src = chrome.runtime.getURL('assets/providers/' + iconFile);
    iconEl.style.display = '';
  }
}

function openModelPicker() {
  mpOpenNt = true;
  mpPanelNt.hidden = false;
  mpTriggerNt.setAttribute('aria-expanded', 'true');
  showProviderView();
}

function closeModelPicker() {
  mpOpenNt = false;
  mpPanelNt.hidden = true;
  mpTriggerNt.setAttribute('aria-expanded', 'false');
}

function showProviderView() {
  mpViewProvidersNt.hidden = false;
  mpViewModelsNt.hidden = true;
  activeProviderIdNt = '';
  renderProviderList();
}

function renderProviderList() {
  mpProviderListNt.innerHTML = '';
  modelProvidersNt.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-item';
    if (p.id === selectedProvider) btn.classList.add('is-active');
    const iconFile = (p.icon || '').includes('.') ? p.icon : (p.icon || 'llamacpp') + '.svg';
    const iconUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('assets/providers/' + iconFile)
      : '../assets/providers/' + iconFile;
    const iconHtml = `<img src="${iconUrl}" alt="" width="18" height="18" style="border-radius:4px;flex-shrink:0" onerror="this.style.display='none'" />`;
    btn.innerHTML = `${iconHtml}<span>${p.label}</span>`;
    btn.addEventListener('click', () => selectProvider(p));
    mpProviderListNt.appendChild(btn);
  });
}

function selectProvider(prov) {
  selectedProvider = prov.id;
  updateModelTriggerLabel();
  if (!prov.models?.length) {
    selectedModel = '';
    updateModelTriggerLabel();
    closeModelPicker();
    return;
  }
  activeProviderIdNt = prov.id;
  mpViewProvidersNt.hidden = true;
  mpViewModelsNt.hidden = false;
  renderModelList(prov);
}

function renderModelList(prov) {
  mpModelListNt.innerHTML = '';
  (prov.models || []).forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-item';
    if (m.id === selectedModel && prov.id === selectedProvider) btn.classList.add('is-active');
    btn.innerHTML = `<span>${m.label || m.id}</span>`;
    btn.addEventListener('click', () => {
      selectedModel = m.id;
      updateModelTriggerLabel();
      closeModelPicker();
    });
    mpModelListNt.appendChild(btn);
  });
}

// ── Context tabs ──

async function loadContextTabs() {
  if (chatMode === 'search') { contextTabs.hidden = true; return; }
  try {
    const tabs = await chrome.tabs.query({});
    const ntUrl = location.href;
    allTabs = tabs
      .filter((t) => t.id && t.url && !t.url.startsWith('chrome://') && t.url !== ntUrl)
      .map((t) => ({ id: t.id, title: t.title || '', url: t.url, favIconUrl: t.favIconUrl || '' }));
    // Keep selected tabs that still exist
    const existing = new Set(allTabs.map((t) => t.id));
    selectedContextTabs = new Set([...selectedContextTabs].filter((id) => existing.has(id)));
    renderContextTabs();
  } catch { /* ignore */ }
}

function renderContextTabs() {
  contextList.innerHTML = '';
  if (!allTabs.length) { contextTabs.hidden = true; return; }
  contextTabs.hidden = false;
  allTabs.forEach((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-tab';
    if (selectedContextTabs.has(tab.id)) btn.classList.add('is-active');
    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.className = 'context-tab-fav';
      img.src = tab.favIconUrl;
      img.alt = '';
      img.addEventListener('error', () => { img.style.display = 'none'; });
      btn.appendChild(img);
    }
    const title = document.createElement('span');
    title.className = 'context-tab-title';
    title.textContent = tab.title || tab.url;
    btn.appendChild(title);
    btn.addEventListener('click', () => {
      if (selectedContextTabs.has(tab.id)) {
        selectedContextTabs.delete(tab.id);
        btn.classList.remove('is-active');
      } else {
        selectedContextTabs.add(tab.id);
        btn.classList.add('is-active');
      }
      contextCount.textContent = selectedContextTabs.size ? `${selectedContextTabs.size} selected` : '';
    });
    contextList.appendChild(btn);
  });
  contextCount.textContent = selectedContextTabs.size ? `${selectedContextTabs.size} selected` : '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Pin popover ──────────────────────────────────────────────────────

function openPinPopover(anchor) {
  pinUrl.value = '';
  pinTitle.value = '';
  const target = anchor || ghostPinEl;
  pinPopover.hidden = false;
  // Two frames: first paint for size, second for accurate rect after layout
  positionPinPopover(target);
  requestAnimationFrame(() => {
    positionPinPopover(target);
    requestAnimationFrame(() => {
      positionPinPopover(target);
      pinUrl.focus();
    });
  });
}

function closePinPopover() {
  pinPopover.hidden = true;
  pinPopover.style.top = '';
  pinPopover.style.left = '';
}

/** Position with position:fixed + viewport coords (anchor.getBoundingClientRect). */
function positionPinPopover(anchor) {
  if (!anchor || pinPopover.hidden) return;
  const rect = anchor.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  const pad = 8;
  const margin = 12;
  // Measure after visible (hidden=false)
  const pw = pinPopover.offsetWidth || 280;
  const ph = pinPopover.offsetHeight || 200;

  // Prefer directly under the + tile, left-aligned with it
  let top = rect.bottom + pad;
  let left = rect.left;

  // Flip above if it would overflow the bottom of the viewport
  if (top + ph > window.innerHeight - margin) {
    top = rect.top - ph - pad;
  }
  // Keep inside horizontal viewport
  if (left + pw > window.innerWidth - margin) {
    left = window.innerWidth - pw - margin;
  }
  if (left < margin) left = margin;
  if (top < margin) top = margin;

  pinPopover.style.top = `${Math.round(top)}px`;
  pinPopover.style.left = `${Math.round(left)}px`;
}

/**
 * Chrome/Helium always focus the omnibox on NTP. We race that and also
 * treat a click anywhere on empty page chrome as “focus search”.
 * (When the omnibox has focus, page keydown never fires — only reclaim + click help.)
 */
function claimSearchFocus() {
  if (!query) return;

  let fightUntil = performance.now() + 4000;
  let userChoseOther = false;
  let rafId = 0;

  function isProtectedTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el === query) return true;
    if (pinPopover && !pinPopover.hidden && pinPopover.contains(el)) return true;
    if (el.closest?.('.bm-tile')) return true;
    if (el.closest?.('.icon-btn')) return true;
    if (el.closest?.('.pin-popover')) return true;
    if (el.closest?.('.search-shell')) return true;
    if (el.closest?.('.recent-chats')) return true;
    if (el.closest?.('.section-link')) return true;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') return true;
    if (
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
      el !== query
    ) {
      return true;
    }
    return false;
  }

  function focusSearch() {
    if (userChoseOther) return false;
    if (pinPopover && !pinPopover.hidden) return false;

    const ae = document.activeElement;
    if (isProtectedTarget(ae) && ae !== query) return false;

    try {
      query.focus({ preventScroll: true });
    } catch {
      try {
        query.focus();
      } catch {
        /* ignore */
      }
    }
    return document.activeElement === query;
  }

  function fightLoop() {
    if (performance.now() > fightUntil) {
      rafId = 0;
      return;
    }
    focusSearch();
    rafId = requestAnimationFrame(fightLoop);
  }

  function startFight(ms) {
    fightUntil = Math.max(fightUntil, performance.now() + ms);
    userChoseOther = false;
    if (!rafId) fightLoop();
    // Extra discrete retries (omnibox often steals after layout)
    [0, 16, 32, 50, 80, 120, 200, 350, 500, 800, 1200, 1800, 2500, 3500].forEach((t) => {
      setTimeout(focusSearch, t);
    });
  }

  // Immediate + sustained fight
  startFight(4000);

  window.addEventListener('load', () => startFight(3000));
  window.addEventListener('pageshow', () => startFight(3000));
  window.addEventListener('focus', () => startFight(2000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startFight(2000);
  });

  // Omnibox steal often shows up as blur on our input with focus leaving the document
  query.addEventListener('blur', () => {
    if (performance.now() > fightUntil) return;
    if (userChoseOther) return;
    // activeElement becomes body when omnibox wins
    setTimeout(() => {
      const ae = document.activeElement;
      if (!ae || ae === document.body || ae === document.documentElement) {
        focusSearch();
      }
    }, 0);
  });

  // Click empty canvas → focus search (one click anywhere to type)
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target;
      if (isProtectedTarget(t) && t !== query && !t.closest?.('.search-shell')) {
        userChoseOther = true;
        return;
      }
      userChoseOther = false;
      // Defer so we win after browser default focus handling
      setTimeout(focusSearch, 0);
      setTimeout(focusSearch, 30);
    },
    true
  );

  // If a key somehow reaches the page without a focused field, grab it
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (pinPopover && !pinPopover.hidden) return;

      const ae = document.activeElement;
      if (ae === query || ae === pinUrl || ae === pinTitle) return;
      if (isProtectedTarget(ae) && ae !== query) return;

      focusSearch();
    },
    true
  );

  // Background can nudge us after tab complete
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'LANTERN_FOCUS_SEARCH') {
      startFight(2500);
    }
  });
}

function faviconFor(pageUrl) {
  try {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', '32');
    return u.toString();
  } catch {
    return '';
  }
}

async function loadPins() {
  const res = await chrome.runtime.sendMessage({ type: 'PINS_LIST' });
  allPins = res?.ok ? res.pins || [] : [];
  renderPins();
}

function renderPins() {
  const list = allPins;
  bookmarksGrid.innerHTML = '';

  for (const b of list) {
    const a = document.createElement('a');
    a.className = 'bm-tile';
    a.href = b.url;
    a.title = b.url;
    a.draggable = true;
    a.dataset.id = b.id;

    a.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/pin-id', b.id);
      a.classList.add('dragging');
    });
    a.addEventListener('dragend', () => a.classList.remove('dragging'));
    a.addEventListener('dragover', (e) => {
      e.preventDefault();
      a.classList.add('drag-over');
    });
    a.addEventListener('dragleave', () => a.classList.remove('drag-over'));
    a.addEventListener('drop', async (e) => {
      e.preventDefault();
      a.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/pin-id');
      const toId = b.id;
      if (!fromId || fromId === toId) return;
      await reorderPins(fromId, toId);
    });

    const iconUrl = faviconFor(b.url);
    if (iconUrl) {
      const img = document.createElement('img');
      img.className = 'bm-icon';
      img.src = iconUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.replaceWith(letterIcon(b.title || b.url));
      });
      a.appendChild(img);
    } else {
      a.appendChild(letterIcon(b.title || b.url));
    }

    const title = document.createElement('span');
    title.className = 'bm-title';
    title.textContent = b.title || b.url;
    title.title = 'Double-click to rename';
    title.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startRename(b, title);
    });
    a.appendChild(title);

    const host = document.createElement('span');
    host.className = 'bm-folder';
    try {
      host.textContent = new URL(b.url).hostname.replace(/^www\./, '');
    } catch {
      host.textContent = b.url;
    }
    a.appendChild(host);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'bm-remove';
    remove.title = 'Remove pin';
    remove.setAttribute('aria-label', 'Remove pin');
    remove.textContent = '×';
    remove.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await chrome.runtime.sendMessage({ type: 'PINS_REMOVE', id: b.id });
      await loadPins();
    });
    a.appendChild(remove);

    bookmarksGrid.appendChild(a);
  }

  // Ghost “add pin” tile — always last
  ghostPinEl = document.createElement('button');
  ghostPinEl.type = 'button';
  ghostPinEl.className = 'bm-tile bm-ghost';
  ghostPinEl.setAttribute('aria-label', 'Add pin');
  ghostPinEl.innerHTML = `
    <span class="bm-ghost-plus" aria-hidden="true">+</span>
    <span class="bm-title">Add pin</span>
  `;
  ghostPinEl.addEventListener('click', (e) => {
    e.preventDefault();
    if (!pinPopover.hidden) closePinPopover();
    else openPinPopover(ghostPinEl);
  });
  bookmarksGrid.appendChild(ghostPinEl);
}

function letterIcon(text) {
  const span = document.createElement('span');
  span.className = 'bm-letter';
  span.textContent = (text || '?').trim().charAt(0).toUpperCase() || '?';
  return span;
}

async function onAddPin(e) {
  e.preventDefault();
  let url = pinUrl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const title = pinTitle.value.trim() || url;
  const res = await chrome.runtime.sendMessage({
    type: 'PINS_ADD',
    url,
    title,
  });
  if (res?.ok) {
    closePinPopover();
    pinUrl.value = '';
    pinTitle.value = '';
    await loadPins();
  } else {
    alert(res?.error || 'Could not save pin');
  }
}

async function onImportBrowser() {
  if (
    !confirm(
      'Copy bookmarks from your browser into Lantern pins?\n\nThis does not change browser bookmarks. Existing pins are kept; duplicates are skipped.'
    )
  ) {
    return;
  }
  const res = await chrome.runtime.sendMessage({
    type: 'PINS_IMPORT_BROWSER',
    limit: 50,
  });
  if (res?.ok) {
    await loadPins();
    alert(res.added ? `Added ${res.added} pin(s).` : 'No new pins to import.');
  } else {
    alert(res?.error || 'Import failed — is the bookmarks permission granted?');
  }
}

function startRename(pin, titleEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bm-rename';
  input.value = pin.title || '';
  input.addEventListener('click', (e) => e.preventDefault());
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renderPins();
    }
  });
  input.addEventListener('blur', async () => {
    const next = input.value.trim();
    if (next && next !== pin.title) {
      await chrome.runtime.sendMessage({
        type: 'PINS_UPDATE',
        id: pin.id,
        title: next,
      });
    }
    await loadPins();
  });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

async function reorderPins(fromId, toId) {
  const ids = allPins.map((p) => p.id);
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, fromId);
  await chrome.runtime.sendMessage({ type: 'PINS_REORDER', ids });
  await loadPins();
}

function updateEndpointLabel() {
  if (!settings) return;
  const llm = (settings.endpoint || '').replace(/^https?:\/\//, '');
  endpointLabel.textContent = llm || 'local';
}

function setGreeting() {
  const h = new Date().getHours();
  if (h < 12) greeting.textContent = 'Good morning';
  else if (h < 18) greeting.textContent = 'Good afternoon';
  else greeting.textContent = 'Good evening';
}

function initTheme() {
  // Already applied from inline script + localStorage; sync button state
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  btnTheme.setAttribute('aria-label', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
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
  // Also persist for other extension pages if wanted
  chrome.storage.local.set({ theme: next }).catch(() => {});
  initTheme();
}

function onKeyDown(e) {
  // Dropdown navigation (Enter to select suggestion)
  if (!suggestDropdown.hidden) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestIndex = Math.min(suggestIndex + 1, suggestItems.length - 1);
      highlightSuggestion(suggestIndex);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestIndex = Math.max(suggestIndex - 1, -1);
      highlightSuggestion(suggestIndex);
      if (suggestIndex < 0) query.focus();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSuggest();
      return;
    }
    if (e.key === 'Enter' && suggestIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      selectSuggestion(suggestIndex);
      return;
    }
  }

  // Enter → submit (unless Shift for newline)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    return;
  }

  // Tab → cycle mode (Search → Chat → Agent → Search…)
  if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    closeSuggest();
    cycleMode();
    saveMode(chatMode);
    return;
  }
}

/** Open full chat page for multi-turn conversation (optional first message). */
async function openDedicatedChat(firstMessage) {
  const text = (firstMessage || '').trim();
  const base = chrome.runtime.getURL('chat/chat.html');
  const imageUrls = attachedImages.map((img) => img.dataUrl);
  clearAttachments();

  const contextTabInfo = await buildContextTabInfo();

  try {
    if (chrome.storage?.session) {
      const payload = { text, at: Date.now() };
      if (imageUrls.length) payload.images = imageUrls;
      if (selectedModel) payload.model = selectedModel;
      if (selectedProvider) payload.provider = selectedProvider;
      if (contextTabInfo) payload.contextTabs = contextTabInfo;
      await chrome.storage.session.set({ lanternPendingChat: payload });
    }
  } catch { /* ignore */ }

  try { await chrome.runtime.sendMessage({ type: 'HEALTH' }); } catch { /* ignore */ }

  const url = text ? `${base}?q=${encodeURIComponent(text)}` : base;
  try { await chrome.tabs.create({ url, active: true }); } catch { window.location.href = url; }
  if (text) query.value = '';
}

/** Open the dedicated chat page with agent mode pre-enabled. */
async function openAgentChat(firstMessage) {
  const text = (firstMessage || '').trim();
  const base = chrome.runtime.getURL('chat/chat.html');
  const imageUrls = attachedImages.map((img) => img.dataUrl);
  clearAttachments();

  const contextTabInfo = await buildContextTabInfo();

  try {
    if (chrome.storage?.session) {
      const payload = { text, mode: 'agent', at: Date.now() };
      if (imageUrls.length) payload.images = imageUrls;
      if (selectedModel) payload.model = selectedModel;
      if (selectedProvider) payload.provider = selectedProvider;
      if (contextTabInfo) payload.contextTabs = contextTabInfo;
      await chrome.storage.session.set({ lanternPendingChat: payload });
    }
  } catch { /* ignore */ }

  try { await chrome.runtime.sendMessage({ type: 'HEALTH' }); } catch { /* ignore */ }

  const params = new URLSearchParams();
  if (text) params.set('q', text);
  params.set('mode', 'agent');
  const url = `${base}?${params.toString()}`;
  try { await chrome.tabs.create({ url, active: true }); } catch { window.location.href = url; }
  if (text) query.value = '';
}

/** Scrape selected context tabs and return their page info. */
async function buildContextTabInfo() {
  if (!selectedContextTabs.size) return null;
  const tabIds = [...selectedContextTabs];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SCRAPE_TABS', tabIds });
    if (res?.ok) return { tabs: res.tabs };
  } catch { /* ignore */ }
  // Fallback: just pass URLs/titles
  return {
    tabs: tabIds.map((id) => {
      const t = allTabs.find((tb) => tb.id === id);
      return { title: t?.title || '', url: t?.url || '' };
    }),
  };
}

/** Open an existing conversation (no new thread). */
async function openExistingChat(conversationId) {
  const id = (conversationId || '').trim();
  if (!id) return;
  const base = chrome.runtime.getURL('chat/chat.html');
  const url = `${base}?c=${encodeURIComponent(id)}`;

  try {
    await chrome.storage?.session?.remove('lanternPendingChat');
  } catch {
    /* ignore */
  }
  try {
    await chrome.runtime.sendMessage({ type: 'HEALTH' });
  } catch {
    /* ignore */
  }

  try {
    await chrome.tabs.create({ url, active: true });
  } catch {
    window.location.href = url;
  }
}

async function loadRecentChats() {
  if (!recentList || !recentChats) return;
  let list = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CONVERSATIONS_LIST' });
    if (res?.ok && Array.isArray(res.conversations)) {
      list = res.conversations.slice(0, 3);
    }
  } catch {
    recentChats.hidden = true;
    return;
  }

  recentList.innerHTML = '';
  if (!list.length) {
    recentChats.hidden = true;
    return;
  }

  recentChats.hidden = false;
  for (const c of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-item';
    btn.dataset.id = c.id;

    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = c.title || 'New chat';

    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    const when = formatChatTime(c.updatedAt);
    const preview = (c.preview || '').trim();
    let host = '';
    if (c.source === 'page' && c.pageUrl) {
      try {
        host = new URL(c.pageUrl).hostname.replace(/^www\./, '');
      } catch {
        host = '';
      }
    }
    const bits = [when];
    if (host) bits.push(host);
    if (preview) bits.push(preview);
    meta.textContent = bits.filter(Boolean).join(' · ');

    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener('click', () => openExistingChat(c.id));
    recentList.appendChild(btn);
  }
}

function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function onSubmit(e) {
  e.preventDefault();
  const text = query.value.trim();
  if (!text) return;

  // Bare URL → open it (any mode)
  if (looksLikeUrl(text)) {
    openUrl(text);
    return;
  }

  // Dispatch based on current mode
  switch (chatMode) {
    case 'chat':
      openDedicatedChat(text);
      break;
    case 'agent':
      openAgentChat(text);
      break;
    default:
      doWebSearch(text);
  }
}

function doWebSearch(text) {
  const q = (text || '').trim();
  if (!q) return;
  // Human web search → Google (LLM tools still use SearXNG separately)
  window.location.href = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function looksLikeUrl(text) {
  if (/\s/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:].*)?$/i.test(text)) return true;
  return false;
}

function openUrl(text) {
  let url = text;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  window.location.href = url;
}


