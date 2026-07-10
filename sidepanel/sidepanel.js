import { QUICK_ACTIONS } from '../shared/defaults.js';
import {
  createReplyThread,
  appendUserMessage,
  hydrateAssistantMessage,
} from '../shared/chat-ui.js';
import { modelIconKey } from '../shared/model-icons.js';

const els = {
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  send: document.getElementById('btn-send'),
  clear: document.getElementById('btn-clear'),
  settings: document.getElementById('btn-settings'),
  health: document.getElementById('btn-health'),
  bookmark: document.getElementById('btn-bookmark'),
  close: document.getElementById('btn-close'),
  theme: document.getElementById('btn-theme'),
  themeLabel: document.getElementById('theme-label'),
  healthLabel: document.getElementById('health-label'),
  menuWrap: document.getElementById('menu-wrap'),
  menuBtn: document.getElementById('btn-menu'),
  menu: document.getElementById('top-menu'),
  statusDot: document.getElementById('status-dot'),
  statusDotMenu: document.getElementById('status-dot-menu'),
  pageTitle: document.getElementById('page-title'),
  pageVisible: document.getElementById('page-visible'),
  pageChip: document.getElementById('page-chip'),
  quickActions: document.getElementById('quick-actions'),
  hint: document.getElementById('hint'),
  // Mode toggle
  modeChatBtn: document.getElementById('mode-chat'),
  modeAgentBtn: document.getElementById('mode-agent'),
  modeToggle: document.getElementById('mode-toggle'),
  // Model picker
  btnModel: document.getElementById('btn-model'),
  modelTriggerIcon: document.getElementById('model-trigger-icon'),
  mpSidebar: document.getElementById('mp-sidebar'),
  mpProviderList: document.getElementById('mp-provider-list'),
  mpModelList: document.getElementById('mp-model-list'),
  mpViewProviders: document.getElementById('mp-view-providers'),
  mpViewModels: document.getElementById('mp-view-models'),
  mpBack: document.getElementById('mp-back'),
  mpTooltip: document.getElementById('mp-tooltip'),
  // Agent
  agentWorkspace: document.getElementById('agent-workspace'),
  agentFeed: document.getElementById('agent-feed'),
};

let activeTabId = null;
let pageMeta = { title: '', url: '', hostname: '', allowed: true };
let streaming = false;
let currentRequestId = null;
/** @type {ReturnType<typeof createReplyThread> | null} */
let assistant = null;

// ---- Mode ----
let chatMode = 'chat'; // 'chat' | 'agent'
let agentModeAllowed = false;

// ---- Model picker ----
let selectedProvider = 'local';
let selectedModel = '';
let modelProviders = [];
let activeProviderId = '';
let mpOpen = false;
const iconSvgCache = new Map();

init();

async function init() {
  initTheme();
  renderQuickActions();
  bindEvents();
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // Fetch settings to determine if agent mode is allowed
  const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (settingsRes?.settings) {
    agentModeAllowed = !!settingsRes.settings.agentModeAllowed;
    if (els.modeAgentBtn) els.modeAgentBtn.classList.toggle('is-disabled', !agentModeAllowed);
  }

  await refreshActiveTab();
  await loadHistory();
  await loadModelPicker();
  await checkHealth();
  await consumePendingPrompt();

  setInterval(refreshActiveTab, 1500);
  window.addEventListener('focus', () => {
    consumePendingPrompt().catch(() => {});
  });
}

// ---- Theme ----
function initTheme() {
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  if (els.themeLabel) {
    els.themeLabel.textContent = t === 'light' ? 'Dark mode' : 'Light mode';
  }
  if (els.theme) {
    els.theme.setAttribute(
      'aria-label',
      t === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
    );
  }
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('lantern-theme', next); } catch { /* ignore */ }
  chrome.storage.local.set({ theme: next }).catch(() => {});
  initTheme();
}

// ---- Menu ----
function setMenuOpen(open) {
  if (!els.menu || !els.menuBtn) return;
  els.menu.hidden = !open;
  els.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function toggleMenu() {
  const open = els.menuBtn?.getAttribute('aria-expanded') === 'true';
  setMenuOpen(!open);
}
function closeMenu() {
  setMenuOpen(false);
}

// ---- Mode toggle ----
function setChatMode(mode) {
  if (mode === 'agent' && !agentModeAllowed) return;
  chatMode = mode === 'agent' ? 'agent' : 'chat';
  els.modeChatBtn?.classList.toggle('is-active', chatMode === 'chat');
  els.modeAgentBtn?.classList.toggle('is-active', chatMode === 'agent');
  els.modeAgentBtn?.classList.toggle('is-disabled', !agentModeAllowed);
  document.querySelector('.app')?.classList.toggle('agent-layout', chatMode === 'agent');
  els.input.placeholder =
    chatMode === 'agent'
      ? 'Tell the agent what to do…'
      : 'Ask about this page…';
}

// ---- Events ----
function bindEvents() {
  els.send.addEventListener('click', onSendClick);
  els.clear.addEventListener('click', clearChat);
  els.bookmark.addEventListener('click', toggleBookmark);
  els.close.addEventListener('click', () => window.close());

  // Mode toggle
  els.modeChatBtn?.addEventListener('click', () => setChatMode('chat'));
  els.modeAgentBtn?.addEventListener('click', () => {
    if (!agentModeAllowed) {
      chrome.runtime.openOptionsPage();
      return;
    }
    setChatMode('agent');
  });
  // Allow mode toggle from Settings update
  els.modeAgentBtn?.addEventListener('dblclick', () => {
    chrome.runtime.openOptionsPage();
  });

  // Model picker trigger
  els.btnModel?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (mpOpen) closeModelPicker();
    else {
      loadModelPicker().then(() => openModelPicker());
    }
  });

  // Model panel back button
  els.mpBack?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderProviderList();
    els.mpViewProviders.hidden = false;
    els.mpViewModels.hidden = true;
    activeProviderId = '';
  });

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    if (!mpOpen) return;
    if (!els.mpSidebar?.contains(e.target) && e.target !== els.btnModel && !els.btnModel?.contains(e.target)) {
      closeModelPicker();
    }
  });

  // Menu
  if (els.menuBtn) {
    els.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }
  if (els.theme) {
    els.theme.addEventListener('click', () => { toggleTheme(); closeMenu(); });
  }
  if (els.health) {
    els.health.addEventListener('click', async () => { await checkHealth(); });
  }
  if (els.settings) {
    els.settings.addEventListener('click', () => { closeMenu(); chrome.runtime.openOptionsPage(); });
  }
  document.addEventListener('click', (e) => {
    if (!els.menuWrap) return;
    if (!els.menuWrap.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); closeModelPicker(); }
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming) abortChat();
      else sendMessage(els.input.value);
    }
  });
  els.input.addEventListener('input', autoResize);

  els.pageVisible.addEventListener('change', async () => {
    if (!pageMeta.hostname) return;
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_SITE',
      hostname: pageMeta.hostname,
      allowed: els.pageVisible.checked,
    });
    await refreshPageContext();
  });
}

// ---- Model picker ----
function openModelPicker() {
  mpOpen = true;
  els.mpSidebar.hidden = false;
  els.mpViewProviders.hidden = false;
  els.mpViewModels.hidden = true;
  activeProviderId = '';
  renderProviderList();
}

function closeModelPicker() {
  mpOpen = false;
  els.mpSidebar.hidden = true;
  activeProviderId = '';
}

function escapePicker(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function initials(s) {
  return String(s ?? '').replace(/\s+/g, '').slice(0, 2).toUpperCase();
}

async function loadIconSvg(key) {
  key = String(key || '').replace(/\.svg$/i, '');
  if (key === 'local') key = 'llamacpp';
  if (key === 'opencodego') key = 'opencode';
  if (iconSvgCache.has(key)) return iconSvgCache.get(key);
  let url = `../assets/providers/${key}.svg`;
  try {
    if (chrome?.runtime?.getURL) {
      url = chrome.runtime.getURL(`assets/providers/${key}.svg`);
    }
  } catch { /* ignore */ }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    let svg = await res.text();
    svg = svg.replace(/<\?xml[^?]*\?>/gi, '').trim();
    svg = svg.replace(/<!--[\s\S]*?-->/g, '');
    svg = svg.replace(/<title>[\s\S]*?<\/title>/gi, '');
    svg = svg.replace(/\sfill="(?!none)[^"]*"/gi, ' fill="currentColor"');
    svg = svg.replace(/fill:\s*#[0-9a-fA-F]+/gi, 'fill:currentColor');
    svg = svg.replace(/<svg\b[^>]*>/i, (open) => {
      const vb = open.match(/viewBox="([^"]+)"/i);
      const viewBox = vb ? vb[1] : '0 0 24 24';
      return `<svg class="mp-svg-icon" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="18" height="18" fill="currentColor" aria-hidden="true">`;
    });
    iconSvgCache.set(key, svg);
    return svg;
  } catch (err) {
    console.warn('[Lantern] icon load failed', key, url, err);
    iconSvgCache.set(key, '');
    return '';
  }
}

function providerIconKey(iconName, providerId) {
  let key = String(iconName || providerId || 'llamacpp').replace(/\.svg$/i, '');
  if (key === 'local' || providerId === 'local') key = 'llamacpp';
  if (key === 'opencodego') key = 'opencode';
  return key;
}

function iconHtmlForKey(key, fallbackLabel) {
  const svg = iconSvgCache.get(key);
  if (svg) return svg;
  return `<span class="mp-item-fallback">${escapePicker(initials(fallbackLabel || key || '?'))}</span>`;
}

function providerIconHtml(providerId, iconName) {
  const key = providerIconKey(iconName, providerId);
  return iconHtmlForKey(key, providerId || iconName);
}

function modelIconHtml(modelId, providerId, label) {
  const key = modelIconKey(modelId, providerId);
  return iconHtmlForKey(key, label || modelId || providerId);
}

async function loadModelPicker() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'LIST_PROVIDERS' });
    if (res?.ok && Array.isArray(res.providers)) {
      modelProviders = res.providers;
      selectedProvider = res.activeProvider || 'local';
      selectedModel = (res.activeModel || '').trim();
    }
  } catch (err) {
    console.warn('[Lantern] LIST_PROVIDERS', err);
    modelProviders = [
      { id: 'local', label: 'Local', hint: 'llama.cpp', icon: 'llamacpp',
        models: [{ id: '', label: 'Server default' }] },
    ];
  }
  // Preload
  await Promise.all(
    modelProviders.map((p) => loadIconSvg(providerIconKey(p.icon || p.id, p.id)))
  );
  updateModelTriggerIcon();
}

function updateModelTriggerIcon() {
  if (!els.modelTriggerIcon) return;
  const p = modelProviders.find((x) => x.id === selectedProvider);
  const key = providerIconKey(p?.icon || selectedProvider, selectedProvider);
  const svg = iconSvgCache.get(key);
  if (svg) {
    els.modelTriggerIcon.innerHTML = svg;
  } else {
    els.modelTriggerIcon.textContent = initials(selectedProvider);
    loadIconSvg(key).then((s) => {
      if (s) els.modelTriggerIcon.innerHTML = s;
    });
  }
  // Update provider -> model text on hint line
  const pm = modelProviders.find((x) => x.id === selectedProvider);
  const mlabel = selectedModel
    ? selectedModel
    : (pm?.models?.[0]?.label || pm?.label || 'Server default');
  els.hint.textContent = (pm?.label || selectedProvider) + (mlabel ? ' · ' + mlabel : '');
}

function renderProviderList() {
  if (!els.mpProviderList) return;
  els.mpProviderList.innerHTML = '';
  if (!modelProviders.length) {
    els.mpProviderList.innerHTML = '<div class="mp-empty">No providers. Open Settings to add API keys.</div>';
    return;
  }
  for (const p of modelProviders) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-item' + (p.id === selectedProvider ? ' is-active' : '');
    const lock = p.needsKey && !p.hasKey ? ' · needs key' : '';
    btn.innerHTML = `
      <span class="mp-item-mark mp-item-mark-icon">${providerIconHtml(p.id, p.icon)}</span>
      <span class="mp-item-body">
        <span class="mp-item-title">${escapePicker(p.label)}</span>
        <span class="mp-item-meta">${escapePicker((p.hint || '') + lock)}</span>
      </span>
      <span class="mp-item-chevron" aria-hidden="true">›</span>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showModelView(p.id);
    });
    els.mpProviderList.appendChild(btn);
  }
}

function showModelView(providerId) {
  activeProviderId = providerId;
  els.mpViewProviders.hidden = true;
  els.mpViewModels.hidden = false;
  const p = modelProviders.find((x) => x.id === providerId);
  if (els.mpModelsTitle) els.mpModelsTitle.textContent = p?.label || 'Models';
  renderModelList(providerId);
}

function renderModelList(providerId) {
  if (!els.mpModelList) return;
  els.mpModelList.innerHTML = '';
  const p = modelProviders.find((x) => x.id === providerId);
  if (!p) {
    els.mpModelList.innerHTML = '<div class="mp-empty">Unknown provider.</div>';
    return;
  }
  const models = p.models || [];
  if (!models.length) {
    els.mpModelList.innerHTML = '<div class="mp-empty">No models listed for this provider.</div>';
    return;
  }
  for (const m of models) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-item' +
      (providerId === selectedProvider && m.id === selectedModel ? ' is-active' : '');
    btn.innerHTML = `
      <span class="mp-item-mark mp-item-mark-icon">${modelIconHtml(m.id, providerId, m.label)}</span>
      <span class="mp-item-body">
        <span class="mp-item-title">${escapePicker(m.label || m.id)}</span>
      </span>
      <span class="mp-item-check" aria-hidden="true">✓</span>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectModel(providerId, m.id);
    });
    els.mpModelList.appendChild(btn);
  }
}

async function selectModel(providerId, modelId) {
  selectedProvider = providerId || 'local';
  selectedModel = (modelId || '').trim();
  try {
    await chrome.storage.sync.set({
      provider: selectedProvider,
      model: selectedModel,
    });
  } catch { /* ignore */ }
  updateModelTriggerIcon();
  closeModelPicker();
}

// ---- Quick actions ----
function renderQuickActions() {
  els.quickActions.innerHTML = '';
  for (const action of QUICK_ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-chip';
    btn.textContent = action.label;
    btn.dataset.id = action.id;
    btn.addEventListener('click', () => runQuickAction(action));
    els.quickActions.appendChild(btn);
  }
}

async function runQuickAction(action) {
  if (streaming) return;
  let selection = pageMeta.selection || '';
  if (action.needsSelection && !selection) {
    await refreshPageContext();
    selection = pageMeta.selection || '';
    if (!selection) {
      appendSystemNote('Select some text on the page first.');
      return;
    }
  }
  await sendMessage(action.prompt, { selectionOverride: selection });
}

// ---- Tab & Page ----
async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (tab.id !== activeTabId) {
    activeTabId = tab.id;
    if (!streaming && chatMode !== 'agent') await loadHistory();
  }
  await refreshPageContext();
}

async function refreshPageContext() {
  if (activeTabId == null) return;
  const res = await chrome.runtime.sendMessage({
    type: 'GET_PAGE_CONTEXT',
    tabId: activeTabId,
  });
  if (!res?.ok) return;
  const ctx = res.context;
  pageMeta = ctx;
  els.pageTitle.textContent = ctx.title || ctx.url || 'Unknown page';
  els.pageTitle.title = ctx.url || '';
  els.pageVisible.checked = !!ctx.allowed;
  els.pageChip.classList.toggle('blocked', !ctx.allowed);
  await refreshBookmarkState();
}

async function refreshBookmarkState() {
  if (!pageMeta?.url) { setBookmarkUi(false); return; }
  const res = await chrome.runtime.sendMessage({ type: 'PINS_IS', url: pageMeta.url });
  setBookmarkUi(!!(res?.ok && res.pinned));
}

function setBookmarkUi(on) {
  els.bookmark.classList.toggle('active-bookmark', on);
  els.bookmark.setAttribute('aria-pressed', on ? 'true' : 'false');
  els.bookmark.title = on ? 'Unpin from Lantern new tab' : 'Pin to Lantern new tab';
}

async function toggleBookmark() {
  if (!pageMeta?.url) return;
  const res = await chrome.runtime.sendMessage({
    type: 'PINS_TOGGLE',
    url: pageMeta.url,
    title: pageMeta.title || pageMeta.url,
  });
  if (res?.ok) setBookmarkUi(!!res.pinned);
}

// ---- History ----
async function loadHistory() {
  els.messages.innerHTML = '';
  if (activeTabId == null) return;
  const res = await chrome.runtime.sendMessage({
    type: 'GET_HISTORY',
    tabId: activeTabId,
  });
  if (!res?.ok) return;
  for (const m of res.history || []) {
    if (m.role === 'user') appendUserMessage(els.messages, m.content);
    else if (m.role === 'assistant') hydrateAssistantMessage(els.messages, m);
  }
  scrollBottom();
}

// ---- Health ----
let lastHandledPromptAt = 0;

async function consumePendingPrompt() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CONSUME_PENDING_PROMPT' });
    const pending = res?.pending;
    if (!pending?.prompt) return;
    if (pending.at && pending.at === lastHandledPromptAt) return;
    lastHandledPromptAt = pending.at || Date.now();
    await handleContextPrompt(pending);
  } catch (err) {
    console.warn('[Lantern] consumePendingPrompt', err);
  }
}

function setHealthState(state, label) {
  if (els.statusDot) els.statusDot.dataset.state = state;
  if (els.statusDotMenu) els.statusDotMenu.dataset.state = state;
  if (els.healthLabel && label != null) els.healthLabel.textContent = label;
}

async function checkHealth() {
  setHealthState('loading', 'Checking…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'HEALTH' });
    if (res?.ok && res.healthy) {
      setHealthState('ok', 'Connected');
    } else {
      setHealthState('error', res?.error || 'Unreachable');
    }
  } catch (err) {
    setHealthState('error', 'Background offline');
  }
}

// ---- Send / Chat ----
function onSendClick() {
  if (streaming) abortChat();
  else sendMessage(els.input.value);
}

async function sendMessage(text, { selectionOverride = '' } = {}) {
  const userText = (text || '').trim();
  if (!userText || streaming) return;

  appendUserMessage(els.messages, userText);
  els.input.value = '';
  autoResize();
  setStreaming(true);

  const requestId = crypto.randomUUID();
  currentRequestId = requestId;
  assistant = createReplyThread(els.messages);

  const isAgent = chatMode === 'agent';

  const res = await chrome.runtime.sendMessage({
    type: 'CHAT_START',
    requestId,
    tabId: activeTabId,
    userText,
    provider: selectedProvider || 'local',
    model: selectedModel || undefined,
    usePageContext: true,
    selectionOverride,
    saveToHistory: true,
    enableTools: true,
    agentMode: isAgent,
    sidebarMode: true,
  });

  if (res && res.ok === false) {
    finishAssistantError(res.error || 'Request failed');
    setStreaming(false);
    currentRequestId = null;
  }
}

function abortChat() {
  if (!currentRequestId) return;
  chrome.runtime.sendMessage({ type: 'CHAT_ABORT', requestId: currentRequestId });
}

function agentUiHost() {
  if (chatMode === 'agent' && els.agentFeed) return els.agentFeed;
  return els.messages;
}

function onRuntimeMessage(message) {
  if (!message) return;

  if (message.type === 'LANTERN_CONTEXT_PROMPT') {
    const stamp = message.at || 0;
    if (stamp && stamp === lastHandledPromptAt) return;
    if (stamp) lastHandledPromptAt = stamp;
    else lastHandledPromptAt = Date.now();
    chrome.runtime.sendMessage({ type: 'CONSUME_PENDING_PROMPT' }).catch(() => {});
    handleContextPrompt(message).catch((err) => console.warn(err));
    return;
  }

  // Agent confirmation
  if (message.type === 'AGENT_CONFIRM') {
    showAgentConfirm(message);
    return;
  }

  // Settings update from options page
  if (message.type === 'SETTINGS_UPDATED') {
    loadModelPicker().catch(() => {});
    if (message.settings) {
      agentModeAllowed = !!message.settings.agentModeAllowed;
      if (!agentModeAllowed && chatMode === 'agent') setChatMode('chat');
      els.modeAgentBtn?.classList.toggle('is-disabled', !agentModeAllowed);
    }
    return;
  }

  if (message.requestId !== currentRequestId) return;
  if (!assistant) return;

  if (message.type === 'CHAT_STATUS') {
    assistant.setMeta('Lantern');
  } else if (message.type === 'CHAT_TURN_START') {
    assistant.startTurn(message.turn || 1);
  } else if (message.type === 'CHAT_TURN_SEAL') {
    assistant.sealTurn(message.turn);
  } else if (message.type === 'CHAT_REASONING_DELTA') {
    assistant.appendReasoning(message.delta, message.turn);
  } else if (message.type === 'CHAT_TOOL_START') {
    assistant.addToolStart(message.tool || {});
  } else if (message.type === 'CHAT_TOOL_RESULT') {
    assistant.setToolResult(message.tool || {});
  } else if (message.type === 'CHAT_CONTENT_RESET') {
    assistant.resetContent();
  } else if (message.type === 'CHAT_DELTA') {
    assistant.appendContent(message.delta);
  } else if (message.type === 'CHAT_DONE') {
    assistant.finalize(message.content);
    assistant = null;
    setStreaming(false);
    currentRequestId = null;
  } else if (message.type === 'CHAT_ERROR') {
    if (message.aborted) {
      const c = assistant.getContent();
      if (c) assistant.finalize(c);
      else assistant.setError('Stopped.');
    } else {
      finishAssistantError(message.error || 'Error');
      assistant = null;
      setStreaming(false);
      currentRequestId = null;
      return;
    }
    assistant = null;
    setStreaming(false);
    currentRequestId = null;
  }
}

// ---- Agent confirm ----
function showAgentConfirm(msg) {
  const host = agentUiHost();
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  const card = document.createElement('div');
  card.className = 'agent-confirm';
  const name = msg.tool?.name || '';
  const summary = msg.summary || '';
  card.innerHTML = `
    <div class="agent-confirm-title">Allow agent action?</div>
    <div class="agent-confirm-body"><strong>${escapePicker(name)}</strong> — ${escapePicker(String(summary).slice(0, 200))}</div>
    <div class="agent-confirm-actions"></div>
  `;
  const acts = card.querySelector('.agent-confirm-actions');
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'btn';
  deny.textContent = 'Deny';
  deny.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'AGENT_CONFIRM_RESPONSE',
      requestId: msg.requestId,
      callId: msg.callId,
      approved: false,
    });
    card.remove();
    wrap.remove();
  });
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'btn btn-accept';
  accept.textContent = 'Allow';
  accept.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'AGENT_CONFIRM_RESPONSE',
      requestId: msg.requestId,
      callId: msg.callId,
      approved: true,
    });
    card.remove();
    wrap.remove();
  });
  acts.appendChild(accept);
  acts.appendChild(deny);
  wrap.appendChild(card);
  host.appendChild(wrap);
  if (chatMode === 'agent' && els.agentFeed) {
    els.agentFeed.scrollTop = els.agentFeed.scrollHeight;
  }
}

// ---- Helpers ----
async function handleContextPrompt(message) {
  if (message.tabId && message.tabId !== activeTabId) {
    activeTabId = message.tabId;
    await loadHistory();
    await refreshPageContext();
  }
  setTimeout(() => {
    sendMessage(message.prompt, { selectionOverride: message.selection || '' });
  }, 100);
}

function finishAssistantError(error) {
  if (assistant) {
    assistant.setError(error);
    assistant = null;
  } else {
    const a = createReplyThread(els.messages);
    a.setError(error);
  }
  setHealthState('error', null);
  scrollBottom();
}

function appendSystemNote(text) {
  const a = createReplyThread(els.messages);
  a.setMeta('Note');
  a.finalize(text);
}

async function clearChat() {
  if (activeTabId != null) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY', tabId: activeTabId });
  }
  els.messages.innerHTML = '';
}

function setStreaming(on) {
  streaming = on;
  els.send.classList.toggle('stop', on);
  els.send.setAttribute('aria-label', on ? 'Stop' : 'Send');
  els.input.disabled = false;
  for (const btn of els.quickActions.querySelectorAll('.action-chip')) {
    btn.disabled = on;
  }
}

function autoResize() {
  const el = els.input;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function scrollBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
