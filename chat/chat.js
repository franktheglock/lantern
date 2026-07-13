import {
  createReplyThread,
  appendUserMessage,
  hydrateAssistantMessage,
} from '../shared/chat-ui.js';
import { modelIconKey, MODEL_ORG_ICONS } from '../shared/model-icons.js';

const app = document.querySelector('.app');
const messages = document.getElementById('messages');
const empty = document.getElementById('empty');
const input = document.getElementById('input');
const btnSend = document.getElementById('btn-send');
const btnTheme = document.getElementById('btn-theme');
const btnNew = document.getElementById('btn-new');
const btnSidebar = document.getElementById('btn-sidebar');
const chatList = document.getElementById('chat-list');
const chatTitle = document.getElementById('chat-title');
const modelPicker = document.getElementById('model-picker');
const mpTrigger = document.getElementById('mp-trigger');
const mpPanel = document.getElementById('mp-panel');
const mpValue = document.getElementById('mp-value');
const mpProviderList = document.getElementById('mp-provider-list');
const mpModelList = document.getElementById('mp-model-list');
const mpViewProviders = document.getElementById('mp-view-providers');
const mpViewModels = document.getElementById('mp-view-models');
const mpModelsTitle = document.getElementById('mp-models-title');
const mpBack = document.getElementById('mp-back');
const mpSearch = document.getElementById('mp-search');
const mpTooltip = document.getElementById('mp-tooltip');
const modeChatBtn = document.getElementById('mode-chat');
const modeAgentBtn = document.getElementById('mode-agent');
const agentNotice = document.getElementById('agent-notice');
const threadDock = document.getElementById('thread-dock');
const threadDockBody = document.getElementById('thread-dock-body');
const threadDockToggle = document.getElementById('thread-dock-toggle');
const threadDockMeta = document.getElementById('thread-dock-meta');
const agentWorkspace = document.getElementById('agent-workspace');
const agentFeed = document.getElementById('agent-feed');
const mainStage = document.querySelector('.main-stage');
const composer = document.getElementById('composer');
const btnAttach = document.getElementById('btn-attach');
const fileInput = document.getElementById('file-input');
/** Tab id of this chat page — kept focused while agent works in background tabs */
let controllerTabId = null;

let conversationId = null;
let streaming = false;
let currentRequestId = null;
/** @type {ReturnType<typeof createReplyThread> | null} */
let assistant = null;
let conversations = [];
/** Selected model id (empty = server default for local) */
let selectedModel = '';
/** Active provider id: local | openrouter | openai | … */
let selectedProvider = 'local';
/** @type {{ id: string, label: string, hint: string, needsKey?: boolean, hasKey?: boolean, models: { id: string, label: string }[] }[]} */
let modelProviders = [];
let activeProviderId = '';
let mpOpen = false;
/** chat | agent */
let chatMode = 'chat';
let agentModeAllowed = false;
let memoriesEnabled = false;
/** @type {{ dataUrl: string, name: string }[]} */
let attachedImages = [];

init().catch((err) => {
  console.error('[Lantern chat] init failed', err);
  showFatalError(err);
});

/**
 * MV3 service workers can be asleep; first messages sometimes throw
 * "Receiving end does not exist". Retry with backoff.
 */
async function runtimeSend(message, attempts = 5) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await chrome.runtime.sendMessage(message);
      // Undefined usually means no listener answered (SW mid-restart)
      if (res === undefined && i < attempts - 1) {
        await sleep(60 * (i + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      const msg = (err && err.message) || String(err);
      const transient =
        /Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(
          msg
        );
      if (!transient || i === attempts - 1) throw err;
      await sleep(80 * (i + 1));
    }
  }
  throw lastErr || new Error('Background not responding');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function stripQueryFromUrl() {
  try {
    const clean = location.pathname + (location.hash || '');
    history.replaceState(null, '', clean);
  } catch {
    /* ignore */
  }
}

function showFatalError(err) {
  try {
    hideEmpty();
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    el.innerHTML =
      '<div class="msg-meta">Lantern</div><div class="bubble"><div class="msg-body msg-error"></div></div>';
    const body = el.querySelector('.msg-body');
    body.textContent =
      'Could not start chat: ' + ((err && err.message) || String(err)) +
      '. Reload the extension on chrome://extensions, then try again.';
    messages.appendChild(el);
  } catch {
    /* ignore */
  }
}

async function init() {
  initTheme();
  btnTheme.addEventListener('click', toggleTheme);
  btnNew.addEventListener('click', () => {
    newChat(true).catch((e) => console.error(e));
  });
  btnSend.addEventListener('click', onSendClick);
  btnSidebar.addEventListener('click', () => {
    app.classList.toggle('sidebar-collapsed');
  });
  btnAttach?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', onFilesSelected);
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('input', autoResize);
  bindModelPicker();
  bindModeToggle();
  bindThreadDock();

  // Remember this tab so agent tools don't yank focus away
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) controllerTabId = tab.id;
  } catch {
    /* ignore */
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // Read handoff first — check mode BEFORE consuming (consumePendingPrompt deletes it)
  const fromUrl = readQueryParam('q');
  const pendingObj = await consumePendingPrompt();
  const pendingMode = pendingObj.mode || readQueryParam('mode') || '';
  const q = (pendingObj.text || fromUrl || '').trim();
  const cid = (readQueryParam('c') || '').trim();

  // Load provider + model before sending any message so selectedProvider is set
  if (q || cid) {
    await loadModelPicker();
  } else {
    loadModelPicker().catch((err) => console.warn('[Lantern chat] models', err));
  }
  loadChatSettingsFlags().catch(() => {});
  autoResize();

  // Auto-enable agent mode from URL param or session storage handoff
  const wantsAgent = pendingMode === 'agent';
  if (wantsAgent) {
    // Wait for settings flags to load, then try enabling
    await loadChatSettingsFlags();
    if (agentModeAllowed) {
      setChatMode('agent');
    }
  }

  console.info('[Lantern chat] boot', {
    hasPending: !!pendingObj.text,
    hasUrlQ: !!fromUrl,
    qPreview: q ? q.slice(0, 80) : '',
    cid,
    href: location.href,
  });

  // Sidebar is best-effort; SW race must not block the prompt
  try {
    await refreshSidebar();
  } catch (err) {
    console.warn('[Lantern chat] sidebar load failed', err);
  }

  if (cid) {
    await openConversation(cid);
    if (q) {
      const ok = await sendMessage(q);
      if (ok) stripQueryFromUrl();
      else recoverPrompt(q);
    } else {
      stripQueryFromUrl();
      input.focus();
    }
    return;
  }

  if (q) {
    // Fresh thread for an incoming prompt (Tab from new tab)
    try {
      await newChat(false);
    } catch (err) {
      console.warn('[Lantern chat] newChat failed, will ensureConversation', err);
      conversationId = null;
      showEmpty();
    }
    const ok = await sendMessage(q);
    if (ok) stripQueryFromUrl();
    else recoverPrompt(q);
    return;
  }

  stripQueryFromUrl();

  // No prompt: most recent chat, or blank
  // (avoid `} else { await newChat }` so failures don't stack-trace on bare else)
  if (conversations.length) {
    await openConversation(conversations[0].id);
    return;
  }
  await startBlankChat();
}

/** Parse ?q= / ?c= from search or full href (some builds mangle location.search) */
function readQueryParam(name) {
  try {
    const fromSearch = new URLSearchParams(location.search).get(name);
    if (fromSearch) return fromSearch;
  } catch {
    /* ignore */
  }
  try {
    return new URL(location.href).searchParams.get(name) || '';
  } catch {
    return '';
  }
}

async function startBlankChat() {
  try {
    await newChat(true);
  } catch (err) {
    console.error('[Lantern chat] startBlankChat', err);
    conversationId = null;
    showEmpty();
    showFatalError(err);
  }
}

/** Keep the failed prompt editable so Enter can retry */
function recoverPrompt(text) {
  if (!text) return;
  input.value = text;
  autoResize();
  input.focus();
}

/** Read + clear one-shot prompt from new tab */
async function consumePendingPrompt() {
  try {
    if (!chrome.storage?.session) return { text: '', mode: '' };
    const data = await chrome.storage.session.get('lanternPendingChat');
    const pending = data?.lanternPendingChat;
    if (!pending?.text) return { text: '', mode: '' };
    if (Date.now() - (pending.at || 0) > 60000) {
      await chrome.storage.session.remove('lanternPendingChat');
      return { text: '', mode: '' };
    }
    await chrome.storage.session.remove('lanternPendingChat');
    return { text: String(pending.text).trim(), mode: pending.mode || '' };
  } catch {
    return { text: '', mode: '' };
  }
}

function hideEmpty() {
  if (empty) empty.hidden = true;
}

function showEmpty() {
  messages.innerHTML = '';
  if (empty) {
    empty.hidden = false;
    messages.appendChild(empty);
  }
}

async function refreshSidebar() {
  const res = await runtimeSend({ type: 'CONVERSATIONS_LIST' });
  conversations = res?.ok ? res.conversations || [] : [];
  renderSidebar();
}

function renderSidebar() {
  chatList.innerHTML = '';
  if (!conversations.length) {
    const p = document.createElement('div');
    p.className = 'sidebar-empty';
    p.textContent = 'No chats yet. Send a message to start.';
    chatList.appendChild(p);
    return;
  }

  for (const c of conversations) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-item' + (c.id === conversationId ? ' active' : '');
    btn.dataset.id = c.id;

    const body = document.createElement('div');
    body.className = 'chat-item-body';

    const title = document.createElement('span');
    title.className = 'chat-item-title';
    title.textContent = c.title || 'New chat';

    const meta = document.createElement('span');
    meta.className = 'chat-item-meta';
    let metaBits = [formatTime(c.updatedAt)];
    if (c.source === 'page' && c.pageUrl) {
      try {
        metaBits.push(new URL(c.pageUrl).hostname.replace(/^www\./, ''));
      } catch {
        /* ignore */
      }
    }
    if (c.preview) metaBits.push(c.preview);
    meta.textContent = metaBits.filter(Boolean).join(' · ');

    body.appendChild(title);
    body.appendChild(meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-item-del';
    del.title = 'Delete chat';
    del.setAttribute('aria-label', 'Delete chat');
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await deleteConversation(c.id);
      } catch (err) {
        console.error(err);
        alert((err && err.message) || 'Delete failed');
      }
    });

    btn.appendChild(body);
    btn.appendChild(del);
    btn.addEventListener('click', () => {
      openConversation(c.id).catch((err) => console.error(err));
    });
    chatList.appendChild(btn);
  }
}

function formatTime(ts) {
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

async function ensureConversation() {
  if (conversationId) return conversationId;
  const res = await runtimeSend({ type: 'CONVERSATION_CREATE' });
  if (!res?.ok || !res.conversation) {
    throw new Error(
      (res && res.error) || 'Could not create chat (background not ready)'
    );
  }
  conversationId = res.conversation.id;
  chatTitle.textContent = res.conversation.title || 'New chat';
  try {
    await refreshSidebar();
  } catch {
    /* ignore */
  }
  return conversationId;
}

async function openConversation(id) {
  if (streaming) return;
  if (!id) return;

  const res = await runtimeSend({
    type: 'CONVERSATION_GET',
    id,
  });
  if (!res?.ok || !res.conversation) return;

  conversationId = id;
  chatTitle.textContent = res.conversation.title || 'New chat';
  assistant = null;
  currentRequestId = null;
  setStreaming(false);

  const hist = res.conversation.messages || [];
  messages.innerHTML = '';
  if (!hist.length) {
    showEmpty();
  } else {
    hideEmpty();
    for (const m of hist) {
      if (m.role === 'user') appendUserMessage(messages, m.content);
      else if (m.role === 'assistant') {
        hydrateAssistantMessage(messages, m);
      }
    }
    scrollBottom();
  }

  renderSidebar();
  input.focus();
}

async function deleteConversation(id) {
  if (!confirm('Delete this chat?')) return;
  await runtimeSend({ type: 'CONVERSATION_DELETE', id });
  if (conversationId !== id) {
    await refreshSidebar();
    return;
  }
  conversationId = null;
  await refreshSidebar();
  if (conversations.length) {
    await openConversation(conversations[0].id);
    return;
  }
  // Named path so stack traces say startBlankChat, not "} else {"
  await startBlankChat();
}

async function newChat(focusInput) {
  if (streaming && currentRequestId) {
    runtimeSend({ type: 'CHAT_ABORT', requestId: currentRequestId }).catch(() => {});
  }
  streaming = false;
  currentRequestId = null;
  assistant = null;
  setStreaming(false);

  const res = await runtimeSend({ type: 'CONVERSATION_CREATE' });
  if (res?.ok && res.conversation) {
    conversationId = res.conversation.id;
    chatTitle.textContent = res.conversation.title || 'New chat';
  } else {
    conversationId = null;
    chatTitle.textContent = 'New chat';
    if (res && res.ok === false) {
      throw new Error(res.error || 'Could not create chat');
    }
  }

  showEmpty();
  // Don't wipe a recovered prompt the caller put in the box
  if (focusInput !== false) {
    input.value = '';
    autoResize();
    input.focus();
  } else {
    // Keep empty for auto-send path (sendMessage clears it)
    input.value = '';
    autoResize();
  }
  try {
    await refreshSidebar();
  } catch {
    /* ignore */
  }
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
  let wrap = input.parentElement.querySelector('.image-previews');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'image-previews';
    input.parentElement.insertBefore(wrap, input.parentElement.querySelector('.composer-bar'));
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
  const wrap = input.parentElement.querySelector('.image-previews');
  if (wrap) wrap.remove();
  btnAttach?.classList.remove('has-image');
}

function onSendClick() {
  if (streaming) {
    if (currentRequestId) {
      runtimeSend({ type: 'CHAT_ABORT', requestId: currentRequestId }).catch(() => {});
    }
    return;
  }
  sendMessage(input.value).catch((e) => console.error(e));
}

function onKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (streaming) return;
    sendMessage(input.value).catch((err) => console.error(err));
  }
}

/**
 * @returns {Promise<boolean>} true if the request was accepted
 */
async function sendMessage(text) {
  const userText = (text || '').trim();
  if (!userText || streaming) return false;

  const imageUrls = attachedImages.map((img) => img.dataUrl);
  clearAttachments();

  try {
    await ensureConversation();
  } catch (err) {
    console.error('[Lantern chat] ensureConversation', err);
    // Retry once after SW warm-up
    try {
      await new Promise(r => setTimeout(r, 500));
      await ensureConversation();
    } catch (err2) {
      console.error('[Lantern chat] ensureConversation retry', err2);
      recoverPrompt(userText);
      return false;
    }
  }

  hideEmpty();
  appendUserMessage(messages, userText, { images: imageUrls });
  input.value = '';
  autoResize();
  setStreaming(true);

  if (chatTitle.textContent === 'New chat') {
    chatTitle.textContent =
      userText.length > 48 ? userText.slice(0, 45) + '…' : userText;
  }

  currentRequestId = newRequestId();
  assistant = createReplyThread(messages);
  scrollBottom();

  try {
    const res = await runtimeSend({
      type: 'CHAT_START',
      requestId: currentRequestId,
      conversationId,
      tabId: null,
      userText,
      provider: selectedProvider || 'local',
      model: selectedModel || undefined,
      usePageContext: false,
      saveToHistory: true,
      enableTools: true,
      agentMode: chatMode === 'agent',
      controllerTabId: controllerTabId,
      images: imageUrls.length ? imageUrls : undefined,
    });

    if (!res || res.ok === false) {
      const errMsg = (res && res.error) || 'Background did not accept chat request';
      assistant?.setError(errMsg);
      assistant = null;
      setStreaming(false);
      currentRequestId = null;
      recoverPrompt(userText);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Lantern chat] CHAT_START', err);
    assistant?.setError((err && err.message) || 'Request failed');
    assistant = null;
    setStreaming(false);
    currentRequestId = null;
    recoverPrompt(userText);
    return false;
  }
}

function onRuntimeMessage(message) {
  if (!message) return;

  // Auto-title from background (no requestId) after the main reply finishes
  if (message.type === 'CHAT_TITLE') {
    if (message.conversationId && message.conversationId === conversationId) {
      if (message.title) chatTitle.textContent = message.title;
      refreshSidebar().catch(() => {});
    }
    return;
  }

  // Memory proposals can arrive after CHAT_DONE (requestId may already be cleared)
  if (message.type === 'CHAT_MEMORY_PROPOSALS') {
    if (message.conversationId && message.conversationId !== conversationId) return;
    showMemoryProposals(message.memories || []);
    return;
  }

  if (message.type === 'CHAT_AGENT_CONFIRM') {
    if (message.requestId !== currentRequestId) return;
    showAgentConfirm(message);
    return;
  }

  if (message.requestId !== currentRequestId) return;
  if (!assistant) return;

  if (message.type === 'CHAT_STATUS') {
    // Brand stays "Lantern"; status strings are not shown as the name
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
    const content = message.content || assistant.getContent() || '';
    const root = assistant.el;
    assistant = null;
    setStreaming(false);
    currentRequestId = null;
    if (root && content) attachMessageActions(root, content);
    refreshSidebar().catch(() => {});
    input.focus();
  } else if (message.type === 'CHAT_ERROR') {
    if (message.aborted) {
      const c = assistant.getContent();
      if (c) assistant.finalize(c);
      else assistant.setError('Stopped.');
    } else {
      assistant.setError(message.error || 'Error');
    }
    assistant = null;
    setStreaming(false);
    currentRequestId = null;
    refreshSidebar().catch(() => {});
    input.focus();
  }
}

function setStreaming(on) {
  streaming = on;
  btnSend.classList.toggle('stop', on);
  btnSend.setAttribute('aria-label', on ? 'Stop' : 'Send');
  input.disabled = false;
}

function autoResize() {
  input.style.height = 'auto';
  // Match taller floating bar (min ~72px, grow up to 280)
  const next = Math.min(Math.max(input.scrollHeight, 72), 280);
  input.style.height = next + 'px';
}

async function loadChatSettingsFlags() {
  try {
    const res = await runtimeSend({ type: 'GET_SETTINGS' });
    const s = res?.settings || res || {};
    agentModeAllowed = !!s.agentModeAllowed;
    memoriesEnabled = !!s.memoriesEnabled;
    if (!agentModeAllowed && chatMode === 'agent') {
      chatMode = 'chat';
    }
    updateModeToggleUi();
  } catch {
    /* ignore */
  }
}

function bindModeToggle() {
  modeChatBtn?.addEventListener('click', () => setChatMode('chat'));
  modeAgentBtn?.addEventListener('click', () => {
    if (!agentModeAllowed) {
      alert(
        'Agent mode is disabled. Open Settings → Agent mode → allow Agent mode, then try again.'
      );
      return;
    }
    setChatMode('agent');
  });
  updateModeToggleUi();
}

function setChatMode(mode) {
  if (mode === 'agent' && !agentModeAllowed) return;
  const next = mode === 'agent' ? 'agent' : 'chat';
  if (next === chatMode) {
    updateModeToggleUi();
    return;
  }
  chatMode = next;
  if (chatMode === 'agent') {
    enterAgentLayout();
  } else {
    exitAgentLayout();
  }
  updateModeToggleUi();
}

function updateModeToggleUi() {
  modeChatBtn?.classList.toggle('is-active', chatMode === 'chat');
  modeAgentBtn?.classList.toggle('is-active', chatMode === 'agent');
  modeAgentBtn?.classList.toggle('is-disabled', !agentModeAllowed);
  if (agentNotice) {
    agentNotice.hidden = chatMode !== 'agent';
  }
  document.body?.classList.toggle('mode-agent', chatMode === 'agent');
  app?.classList.toggle('agent-layout', chatMode === 'agent');
  updateThreadDockMeta();
}

/** Host for ephemeral agent UI (confirm cards, proposals) */
function agentUiHost() {
  if (chatMode === 'agent' && agentFeed) return agentFeed;
  return messages;
}

function enterAgentLayout() {
  // Expand sidebar for chat list; keep the live thread in the main pane
  // (agent tabs open in the background so focus stays here)
  app?.classList.remove('sidebar-collapsed');
  app?.classList.add('agent-layout');
  if (threadDock) threadDock.hidden = true;
  if (agentWorkspace) agentWorkspace.hidden = false;
  // If a previous run parked messages in the dock, restore them
  if (mainStage && messages && composer && threadDockBody?.contains(messages)) {
    mainStage.insertBefore(messages, composer);
  }
  updateThreadDockMeta();
}

function exitAgentLayout() {
  app?.classList.remove('agent-layout');
  if (threadDock) threadDock.hidden = true;
  if (agentWorkspace) agentWorkspace.hidden = true;
  if (mainStage && messages && composer && !mainStage.contains(messages)) {
    mainStage.insertBefore(messages, composer);
  }
  if (agentFeed && messages) {
    while (agentFeed.firstChild) {
      messages.appendChild(agentFeed.firstChild);
    }
  }
}

function setThreadDockExpanded(expanded) {
  app?.classList.toggle('thread-dock-collapsed', !expanded);
  threadDockToggle?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function updateThreadDockMeta() {
  if (!threadDockMeta || !messages) return;
  const n = messages.querySelectorAll('.msg').length;
  threadDockMeta.textContent = n ? `${n} message${n === 1 ? '' : 's'}` : 'Empty';
}

function bindThreadDock() {
  threadDockToggle?.addEventListener('click', () => {
    const expanded = threadDockToggle.getAttribute('aria-expanded') !== 'false';
    setThreadDockExpanded(!expanded);
  });
}

function attachMessageActions(root, content) {
  if (!root || root.querySelector('.msg-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  if (memoriesEnabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-action-btn';
    btn.textContent = 'Remember';
    btn.title = 'Save a note from this reply';
    btn.addEventListener('click', () => rememberFromText(content));
    actions.appendChild(btn);
  }
  if (actions.childNodes.length) root.appendChild(actions);
}

async function rememberFromText(content) {
  const draft = String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  const text = window.prompt('Save this memory (edit as needed):', draft);
  if (text == null) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const res = await runtimeSend({
      type: 'MEMORY_SAVE',
      entry: {
        text: trimmed,
        title: trimmed.slice(0, 48),
        source: 'user',
        status: 'active',
        conversationId: conversationId || '',
      },
    });
    if (res?.ok) flashToast('Memory saved');
    else alert(res?.error || 'Could not save memory');
  } catch (err) {
    alert(err?.message || 'Could not save memory');
  }
}

function showMemoryProposals(list) {
  if (!list?.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'memory-proposals';
  wrap.innerHTML = `<div class="memory-proposals-title">Remember for later?</div>`;
  for (const m of list) {
    const row = document.createElement('div');
    row.className = 'memory-proposal';
    row.innerHTML = `
      <div class="memory-proposal-text">${escapePicker(m.title ? m.title + ' — ' : '')}${escapePicker(m.text || '')}</div>
      <div class="memory-proposal-actions"></div>
    `;
    const acts = row.querySelector('.memory-proposal-actions');
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'msg-action-btn';
    accept.textContent = 'Accept';
    accept.addEventListener('click', async () => {
      await runtimeSend({ type: 'MEMORY_CONFIRM', id: m.id });
      row.remove();
      if (!wrap.querySelector('.memory-proposal')) wrap.remove();
      flashToast('Memory saved');
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'msg-action-btn msg-action-muted';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', async () => {
      await runtimeSend({ type: 'MEMORY_REJECT', id: m.id });
      row.remove();
      if (!wrap.querySelector('.memory-proposal')) wrap.remove();
    });
    acts.appendChild(accept);
    acts.appendChild(dismiss);
    wrap.appendChild(row);
  }
  agentUiHost()?.appendChild(wrap);
  scrollBottom();
  updateThreadDockMeta();
}

function showAgentConfirm(message) {
  const card = document.createElement('div');
  card.className = 'agent-confirm';
  const tool = message.tool || {};
  const name = tool.name || 'action';
  const summary = message.summary || JSON.stringify(tool.arguments || tool.args || {});
  card.innerHTML = `
    <div class="agent-confirm-title">Allow agent action?</div>
    <div class="agent-confirm-body"><strong>${escapePicker(name)}</strong> — ${escapePicker(String(summary).slice(0, 200))}</div>
    <div class="agent-confirm-actions"></div>
  `;
  const acts = card.querySelector('.agent-confirm-actions');
  const once = document.createElement('button');
  once.type = 'button';
  once.className = 'msg-action-btn';
  once.textContent = 'Allow once';
  once.addEventListener('click', () => {
    runtimeSend({
      type: 'AGENT_CONFIRM_RESPONSE',
      requestId: message.requestId,
      callId: message.callId,
      decision: 'once',
    });
    card.remove();
  });
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'msg-action-btn';
  run.textContent = 'Allow for run';
  run.addEventListener('click', () => {
    runtimeSend({
      type: 'AGENT_CONFIRM_RESPONSE',
      requestId: message.requestId,
      callId: message.callId,
      decision: 'run',
    });
    card.remove();
  });
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'msg-action-btn msg-action-muted';
  deny.textContent = 'Deny';
  deny.addEventListener('click', () => {
    runtimeSend({
      type: 'AGENT_CONFIRM_RESPONSE',
      requestId: message.requestId,
      callId: message.callId,
      decision: 'deny',
    });
    card.remove();
  });
  acts.appendChild(once);
  acts.appendChild(run);
  acts.appendChild(deny);
  // Approvals stay in the main agent workspace (not buried in the sidebar thread)
  agentUiHost()?.appendChild(card);
  if (chatMode === 'agent' && agentFeed) {
    try {
      agentFeed.scrollTop = agentFeed.scrollHeight;
    } catch {
      /* ignore */
    }
  } else {
    scrollBottom();
  }
}

function flashToast(text) {
  const t = document.createElement('div');
  t.className = 'lantern-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function bindModelPicker() {
  if (!mpTrigger || !mpPanel) return;

  mpTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setModelPickerOpen(!mpOpen);
  });
  mpBack?.addEventListener('click', (e) => {
    e.stopPropagation();
    showProviderView();
  });
  if (mpSearch) {
    mpSearch.addEventListener('click', (e) => e.stopPropagation());
    mpSearch.addEventListener('keydown', (e) => e.stopPropagation());
    mpSearch.addEventListener('input', () => {
      if (activeProviderId) renderModelList(activeProviderId);
      else renderProviderList();
    });
  }
  document.addEventListener('click', (e) => {
    if (!mpOpen || !modelPicker) return;
    if (modelPicker.contains(e.target)) return;
    setModelPickerOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mpOpen) {
      setModelPickerOpen(false);
    }
  });
}

function pickerQuery() {
  return (mpSearch?.value || '').trim().toLowerCase();
}

function clearPickerSearch(placeholder) {
  if (!mpSearch) return;
  mpSearch.value = '';
  mpSearch.placeholder = placeholder || 'Search…';
}

function setModelPickerOpen(open) {
  mpOpen = !!open;
  if (!mpPanel || !mpTrigger || !modelPicker) return;
  mpPanel.hidden = !mpOpen;
  mpTrigger.setAttribute('aria-expanded', mpOpen ? 'true' : 'false');
  modelPicker.classList.toggle('is-open', mpOpen);
  if (mpOpen) {
    showProviderView();
    renderProviderList();
    // Focus search after open
    requestAnimationFrame(() => {
      mpSearch?.focus();
      mpSearch?.select();
    });
  } else {
    hideModelTooltip();
  }
}

function showProviderView() {
  if (mpViewProviders) mpViewProviders.hidden = false;
  if (mpViewModels) mpViewModels.hidden = true;
  activeProviderId = '';
  clearPickerSearch('Search providers…');
  renderProviderList();
}

function showModelView(providerId) {
  activeProviderId = providerId;
  if (mpViewProviders) mpViewProviders.hidden = true;
  if (mpViewModels) mpViewModels.hidden = false;
  const p = modelProviders.find((x) => x.id === providerId);
  if (mpModelsTitle) mpModelsTitle.textContent = p?.label || 'Models';
  clearPickerSearch(`Search ${p?.label || 'models'}…`);
  renderModelList(providerId);
  requestAnimationFrame(() => mpSearch?.focus());
}

function initials(label) {
  const s = (label || '?').trim();
  if (!s) return '?';
  const parts = s.split(/[\s/_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).slice(0, 2);
  return s.slice(0, 2);
}

/** Inlined monochrome SVGs — currentColor works when inlined (masks were flaky) */
const iconSvgCache = new Map();

function providerIconKey(iconName, providerId) {
  let key = String(iconName || providerId || 'llamacpp').replace(/\.svg$/i, '');
  // Local provider always uses the llama.cpp mark (not "local.svg")
  if (key === 'local' || providerId === 'local') key = 'llamacpp';
  if (key === 'opencodego') key = 'opencode';
  return key;
}

async function loadIconSvg(key) {
  key = String(key || 'llamacpp').replace(/\.svg$/i, '');
  if (key === 'local') key = 'llamacpp';
  if (iconSvgCache.has(key)) return iconSvgCache.get(key);
  let url = `../assets/providers/${key}.svg`;
  try {
    if (chrome?.runtime?.getURL) {
      url = chrome.runtime.getURL(`assets/providers/${key}.svg`);
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    let svg = await res.text();
    svg = svg.replace(/<\?xml[^?]*\?>/gi, '').trim();
    svg = svg.replace(/<!--[\s\S]*?-->/g, '');
    svg = svg.replace(/<title>[\s\S]*?<\/title>/gi, '');
    // Normalize fills to currentColor for theme mono
    svg = svg.replace(/\sfill="(?!none)[^"]*"/gi, ' fill="currentColor"');
    svg = svg.replace(/fill:\s*#[0-9a-fA-F]+/gi, 'fill:currentColor');
    // Clean root attributes and set fixed display size
    svg = svg.replace(/<svg\b[^>]*>/i, (open) => {
      const vb = open.match(/viewBox="([^"]+)"/i);
      const viewBox = vb ? vb[1] : '0 0 24 24';
      return `<svg class="mp-svg-icon" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="22" height="22" fill="currentColor" aria-hidden="true">`;
    });
    iconSvgCache.set(key, svg);
    return svg;
  } catch (err) {
    console.warn('[Lantern] icon load failed', key, url, err);
    iconSvgCache.set(key, '');
    return '';
  }
}

async function loadProviderIconSvg(iconName, providerId) {
  return loadIconSvg(providerIconKey(iconName, providerId));
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

async function preloadProviderIcons(providers) {
  const list = providers || modelProviders || [];
  await Promise.all(list.map((p) => loadProviderIconSvg(p.icon || p.id, p.id)));
}

async function preloadModelIcons(models, providerId) {
  const keys = new Set();
  for (const m of models || []) {
    keys.add(modelIconKey(m?.id, providerId));
  }
  // Common brands so first paint is snappy when switching providers
  for (const k of Object.values(MODEL_ORG_ICONS)) keys.add(k);
  await Promise.all([...keys].map((k) => loadIconSvg(k)));
}

function displayLabelForSelection() {
  const p = modelProviders.find((x) => x.id === selectedProvider);
  const pname = p?.label || selectedProvider || 'Local';
  if (!selectedModel) {
    return selectedProvider === 'local' ? `${pname} · default` : pname;
  }
  // Short model tail for display
  const short = selectedModel.includes('/')
    ? selectedModel.split('/').slice(-1)[0]
    : selectedModel;
  return `${pname} · ${short}`;
}

function updateModelTrigger() {
  if (mpValue) mpValue.textContent = displayLabelForSelection();
  if (mpTrigger) {
    mpTrigger.title = selectedModel
      ? `${selectedProvider}: ${selectedModel}`
      : `${selectedProvider}: default`;
    let lead = mpTrigger.querySelector('.mp-trigger-icon');
    if (!lead) {
      lead = document.createElement('span');
      lead.className = 'mp-trigger-icon';
      lead.setAttribute('aria-hidden', 'true');
      mpTrigger.insertBefore(lead, mpTrigger.firstChild);
    }
    const p = modelProviders.find((x) => x.id === selectedProvider);
    // Trigger always shows the provider mark (model icons are only in the list)
    const key = providerIconKey(p?.icon || selectedProvider, selectedProvider);
    const svg = iconSvgCache.get(key);
    if (svg) {
      lead.innerHTML = svg;
    } else {
      lead.innerHTML = '';
      loadIconSvg(key).then((s) => {
        if (s) lead.innerHTML = s;
      });
    }
  }
}

function renderProviderList() {
  if (!mpProviderList) return;
  mpProviderList.innerHTML = '';
  if (!modelProviders.length) {
    const empty = document.createElement('div');
    empty.className = 'mp-empty';
    empty.textContent = 'No providers. Open Settings to add API keys or a local endpoint.';
    mpProviderList.appendChild(empty);
    return;
  }

  const q = pickerQuery();
  const filtered = modelProviders.filter((p) => {
    if (!q) return true;
    const hay = `${p.id} ${p.label} ${p.hint || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'mp-empty';
    empty.textContent = q ? `No providers match “${mpSearch.value.trim()}”.` : 'No providers.';
    mpProviderList.appendChild(empty);
    return;
  }

  for (const p of filtered) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-item' + (p.id === selectedProvider ? ' is-active' : '');
    btn.setAttribute('role', 'option');
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
    mpProviderList.appendChild(btn);
  }
}

async function renderModelList(providerId) {
  if (!mpModelList) return;
  mpModelList.innerHTML = '';
  const p = modelProviders.find((x) => x.id === providerId);
  if (!p) {
    const empty = document.createElement('div');
    empty.className = 'mp-empty';
    empty.textContent = 'Unknown provider.';
    mpModelList.appendChild(empty);
    return;
  }
  if (p.needsKey && !p.hasKey) {
    const empty = document.createElement('div');
    empty.className = 'mp-empty';
    empty.innerHTML =
      'Add an API key in <strong>Settings</strong> to use ' + escapePicker(p.label) + '.';
    mpModelList.appendChild(empty);
    return;
  }
  if (!p.models.length) {
    const empty = document.createElement('div');
    empty.className = 'mp-empty';
    empty.textContent = 'No models listed for this provider.';
    mpModelList.appendChild(empty);
    return;
  }

  const q = pickerQuery();
  const filtered = p.models.filter((m) => {
    if (!q) return true;
    const info = m.info || {};
    const hay = `${m.id || ''} ${m.label || ''} ${info.description || ''} ${info.modality || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'mp-empty';
    empty.textContent = q
      ? `No models match “${mpSearch.value.trim()}”.`
      : 'No models listed for this provider.';
    mpModelList.appendChild(empty);
    return;
  }

  hideModelTooltip();
  await preloadModelIcons(filtered, providerId);
  // Drop if user navigated away while icons loaded
  if (activeProviderId !== providerId) return;

  for (const m of filtered) {
    const active =
      providerId === selectedProvider &&
      (m.id === selectedModel || (!selectedModel && !m.id));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-item' + (active ? ' is-active' : '');
    btn.setAttribute('role', 'option');
    btn.dataset.modelId = m.id;

    // Compact meta: context + price when we have OpenRouter specs
    let metaLine = m.id || 'server default';
    if (m.info) {
      const bits = [];
      if (m.info.contextLength) bits.push(formatContextTokens(m.info.contextLength));
      const pin = formatPricePerMillion(m.info.promptPrice);
      const pout = formatPricePerMillion(m.info.completionPrice);
      if (pin || pout) bits.push(`${pin || '—'}/${pout || '—'} · 1M`);
      if (bits.length) metaLine = bits.join(' · ');
    }

    btn.innerHTML = `
      <span class="mp-item-mark mp-item-mark-icon">${modelIconHtml(m.id, providerId, m.label)}</span>
      <span class="mp-item-body">
        <span class="mp-item-title">${escapePicker(shortModelLabel(m.label, m.id))}</span>
        <span class="mp-item-meta">${escapePicker(metaLine)}</span>
      </span>
      <span class="mp-item-check" aria-hidden="true"></span>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideModelTooltip();
      selectModel(providerId, m.id);
    });
    if (m.info && providerId === 'openrouter') {
      btn.addEventListener('mouseenter', (e) => showModelTooltip(e.currentTarget, m));
      btn.addEventListener('mouseleave', () => hideModelTooltip());
      btn.addEventListener('focus', (e) => showModelTooltip(e.currentTarget, m));
      btn.addEventListener('blur', () => hideModelTooltip());
    }
    mpModelList.appendChild(btn);
  }
}

function shortModelLabel(label, id) {
  const s = label || id || '';
  // "OpenAI: GPT-4o mini" → keep; long ids get last segment
  if (s.length <= 42) return s;
  if (id && id.includes('/')) return id.split('/').slice(-1)[0];
  return s.slice(0, 40) + '…';
}

function formatContextTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M ctx';
  if (v >= 1000) return Math.round(v / 1000) + 'k ctx';
  return v + ' ctx';
}

/** OpenRouter prices are USD per token as strings */
function formatPricePerMillion(perTokenStr) {
  if (perTokenStr == null || perTokenStr === '') return null;
  const n = Number(perTokenStr);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'Free';
  const perM = n * 1e6;
  if (perM < 0.01) return '$' + perM.toFixed(4);
  if (perM < 1) return '$' + perM.toFixed(3);
  return '$' + perM.toFixed(2);
}

function showModelTooltip(anchor, model) {
  if (!mpTooltip || !model?.info || !mpPanel) return;
  const info = model.info;
  const rows = [];
  rows.push(`<div class="mp-tip-title">${escapePicker(info.name || model.label || model.id)}</div>`);
  rows.push(`<div class="mp-tip-id">${escapePicker(model.id)}</div>`);

  const specs = [];
  if (info.contextLength) specs.push(`<span class="mp-tip-chip">${escapePicker(formatContextTokens(info.contextLength))}</span>`);
  if (info.maxCompletion) {
    specs.push(
      `<span class="mp-tip-chip">max out ${escapePicker(formatContextTokens(info.maxCompletion).replace(' ctx', ''))}</span>`
    );
  }
  const pin = formatPricePerMillion(info.promptPrice);
  const pout = formatPricePerMillion(info.completionPrice);
  if (pin) specs.push(`<span class="mp-tip-chip">in ${escapePicker(pin)}/M</span>`);
  if (pout) specs.push(`<span class="mp-tip-chip">out ${escapePicker(pout)}/M</span>`);
  if (info.modality) specs.push(`<span class="mp-tip-chip">${escapePicker(info.modality)}</span>`);
  if (specs.length) rows.push(`<div class="mp-tip-chips">${specs.join('')}</div>`);

  if (info.description) {
    const desc = String(info.description).replace(/\s+/g, ' ').trim();
    const clipped = desc.length > 280 ? desc.slice(0, 277) + '…' : desc;
    rows.push(`<p class="mp-tip-desc">${escapePicker(clipped)}</p>`);
  }

  mpTooltip.innerHTML = rows.join('');
  mpTooltip.hidden = false;

  // Position to the right of the panel when possible, else left
  const panelRect = mpPanel.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const tipW = 280;
  let left = panelRect.width + 8;
  let top = anchorRect.top - panelRect.top;

  // Clamp vertically inside panel
  mpTooltip.style.left = left + 'px';
  mpTooltip.style.right = 'auto';
  mpTooltip.style.top = Math.max(8, top) + 'px';

  // If would overflow viewport, flip to the left of panel
  requestAnimationFrame(() => {
    const tipRect = mpTooltip.getBoundingClientRect();
    if (tipRect.right > window.innerWidth - 8) {
      mpTooltip.style.left = 'auto';
      mpTooltip.style.right = panelRect.width + 8 + 'px';
    }
    const tipRect2 = mpTooltip.getBoundingClientRect();
    if (tipRect2.bottom > window.innerHeight - 8) {
      const overflow = tipRect2.bottom - (window.innerHeight - 8);
      const curTop = parseFloat(mpTooltip.style.top) || 0;
      mpTooltip.style.top = Math.max(8, curTop - overflow) + 'px';
    }
  });
}

function hideModelTooltip() {
  if (!mpTooltip) return;
  mpTooltip.hidden = true;
  mpTooltip.innerHTML = '';
}

function escapePicker(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function selectModel(providerId, modelId) {
  selectedProvider = providerId || 'local';
  selectedModel = (modelId || '').trim();
  updateModelTrigger();
  setModelPickerOpen(false);
  try {
    await chrome.storage.sync.set({
      provider: selectedProvider,
      model: selectedModel,
    });
  } catch {
    /* ignore */
  }
}

async function loadModelPicker() {
  try {
    const res = await runtimeSend({ type: 'LIST_PROVIDERS' });
    if (res?.ok && Array.isArray(res.providers)) {
      modelProviders = res.providers;
      selectedProvider = res.activeProvider || 'local';
      selectedModel = (res.activeModel || '').trim();
    }
  } catch (err) {
    console.warn('[Lantern chat] LIST_PROVIDERS', err);
    modelProviders = [
      {
        id: 'local',
        label: 'Local',
        hint: 'llama.cpp',
        icon: 'llamacpp',
        models: [{ id: '', label: 'Server default' }],
      },
    ];
  }
  await preloadProviderIcons(modelProviders);
  // Warm model-vendor icons for the active provider (and common brands)
  const active = modelProviders.find((x) => x.id === selectedProvider);
  if (active?.models?.length) {
    await preloadModelIcons(active.models, selectedProvider);
  } else {
    await preloadModelIcons([], selectedProvider);
  }
  updateModelTrigger();
  // Re-render open list if picker already open
  if (mpOpen) {
    if (activeProviderId) renderModelList(activeProviderId);
    else renderProviderList();
  }
}

function scrollBottom() {
  messages.scrollTop = messages.scrollHeight;
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
