/**
 * Chat UI — plain-text activity status + inline thinking/tool stream.
 *
 * Each reply bubble shows a simple "thinking [Ns]" status button,
 * with the full activity timeline rendered inline underneath it.
 */
import { renderMarkdown, formatToolPayload, escapeHtml, toolLabel } from './markdown.js';

function detectMode() {
  try {
    if (location.pathname.includes('/chat/')) return 'rail';
    if (document.querySelector('.chat-list')) return 'rail';
  } catch {
    /* ignore */
  }
  return 'dropdown';
}

/** Favicon URL for a page (works for sites not in the browser cache). */
export function faviconUrlFor(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    // Prefer Google's open service — search hits are rarely in chrome://favicon
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
  } catch {
    return '';
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function tryParseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/**
 * Build rich HTML for a tool result (search hits with favicons, etc.).
 * @param {string} name
 * @param {string|object} result
 * @param {object} [args]
 */
export function renderToolResultHtml(name, result, args) {
  const data = tryParseJson(result);
  if (name === 'web_search' && data && Array.isArray(data.results)) {
    return renderWebSearchResult(data);
  }
  if (name === 'read_url' && data && (data.url || data.content || data.error)) {
    return renderReadUrlResult(data);
  }
  // Generic JSON / text
  const text = formatToolPayload(result);
  return `<pre class="tl-body">${escapeHtml(text)}</pre>`;
}

function renderWebSearchResult(data) {
  const q = data.query || '';
  const results = data.results || [];
  let html = '';
  if (q) {
    html += `<div class="tl-search-query"><span class="tl-search-q-label">Query</span><span class="tl-search-q-text">${escapeHtml(q)}</span></div>`;
  }
  if (!results.length) {
    html += `<p class="tl-empty">${escapeHtml(data.note || 'No results')}</p>`;
    return html;
  }
  html += '<div class="tl-hits">';
  for (const r of results) {
    const url = r.url || '';
    const title = r.title || url || 'Result';
    const snip = r.content || '';
    const fav = url ? faviconUrlFor(url) : '';
    const host = hostnameOf(url);
    const favImg = fav
      ? `<img class="tl-fav" src="${escapeHtml(fav)}" alt="" width="16" height="16" loading="lazy" />`
      : `<span class="tl-fav tl-fav-fallback" aria-hidden="true"></span>`;
    if (url) {
      html += `
        <a class="tl-hit" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
          ${favImg}
          <span class="tl-hit-main">
            <span class="tl-hit-title">${escapeHtml(title)}</span>
            <span class="tl-hit-url">${escapeHtml(host)}</span>
            ${snip ? `<span class="tl-hit-snip">${escapeHtml(snip)}</span>` : ''}
          </span>
        </a>`;
    } else {
      html += `
        <div class="tl-hit tl-hit-static">
          ${favImg}
          <span class="tl-hit-main">
            <span class="tl-hit-title">${escapeHtml(title)}</span>
            ${snip ? `<span class="tl-hit-snip">${escapeHtml(snip)}</span>` : ''}
          </span>
        </div>`;
    }
  }
  html += '</div>';
  return html;
}

function renderReadUrlResult(data) {
  const url = data.url || '';
  const fav = url ? faviconUrlFor(url) : '';
  const host = hostnameOf(url);
  const favImg = fav
    ? `<img class="tl-fav" src="${escapeHtml(fav)}" alt="" width="16" height="16" loading="lazy" />`
    : `<span class="tl-fav tl-fav-fallback" aria-hidden="true"></span>`;

  let html = '<div class="tl-read">';
  if (url) {
    html += `
      <a class="tl-hit tl-read-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        ${favImg}
        <span class="tl-hit-main">
          <span class="tl-hit-title">${escapeHtml(host || url)}</span>
          <span class="tl-hit-url">${escapeHtml(url)}</span>
        </span>
      </a>`;
  }
  if (data.error) {
    html += `<p class="tl-error-text">${escapeHtml(String(data.error))}</p>`;
  } else if (data.content) {
    const snippet = String(data.content).slice(0, 1200);
    html += `<pre class="tl-body tl-read-body">${escapeHtml(snippet)}${data.content.length > 1200 ? '\n…' : ''}</pre>`;
  }
  html += '</div>';
  return html;
}

function renderToolInputHtml(name, args) {
  const a = tryParseJson(args) || args || {};
  if (name === 'web_search') {
    const q = a.query || a.q || '';
    if (q) {
      return `<div class="tl-input-pill"><span class="tl-input-label">Search</span><span class="tl-input-value">${escapeHtml(String(q))}</span></div>`;
    }
  }
  if (name === 'read_url') {
    const url = a.url || a.link || '';
    if (url) {
      const fav = faviconUrlFor(url);
      const favImg = fav
        ? `<img class="tl-fav" src="${escapeHtml(fav)}" alt="" width="14" height="14" loading="lazy" />`
        : '';
      return `<div class="tl-input-pill tl-input-url">${favImg}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostnameOf(url) || url)}</a></div>`;
    }
  }
  return `<pre class="tl-body">${escapeHtml(formatToolPayload(args))}</pre>`;
}

/**
 * Hydrate a finished assistant message (history restore).
 * @param {HTMLElement} container
 * @param {{ content?: string, reasoning?: string, activity?: Array }} message
 */
export function hydrateAssistantMessage(container, message) {
  const thread = createReplyThread(container);
  const activity = message?.activity;
  if (activity && activity.length) {
    thread.restoreActivity(activity);
  } else if (message?.reasoning) {
    thread.startTurn(1);
    thread.appendReasoning(message.reasoning, 1);
    thread.sealTurn(1);
  }
  thread.finalize(message?.content || '');
  return thread;
}

/**
 * @param {HTMLElement} container
 * @param {{ mode?: 'rail' | 'dropdown' }} [opts]
 */
export function createReplyThread(container, opts = {}) {
  const mode = opts.mode || detectMode();

  /** @type {Array<TimelineEvent>} */
  const events = [];
  let activeTurn = 0;
  let content = '';
  let open = false;
  let done = false;
  let startedAt = Date.now();
  /** Absolute start — never reset, used for the final "Done · Xs" summary. */
  let totalStartedAt = Date.now();

  /**
   * @typedef {object} TimelineEvent
   * @property {'thinking'|'tool'} type
   * @property {number} turn
   * @property {string} [text]
   * @property {boolean} [sealed]
   * @property {string} [id]
   * @property {string} [name]
   * @property {unknown} [args]
   * @property {string} [result]
   * @property {string} [error]
   * @property {'running'|'done'|'error'} [status]
   * @property {HTMLElement} [el]
   */

  const root = document.createElement('div');
  root.className = 'msg msg-assistant';

  // Always "Lantern" above the chevron row — never overwritten by tool/round status
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = 'Lantern';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'activity-chip';
  chip.hidden = true;
  chip.setAttribute('aria-expanded', 'false');
  chip.innerHTML = `
    <span class="activity-status">Thinking…</span>
    <span class="activity-preview">
      <span class="activity-preview-track"></span>
    </span>
  `;
  const statusEl = chip.querySelector('.activity-status');
  const previewEl = chip.querySelector('.activity-preview');
  const previewTrack = chip.querySelector('.activity-preview-track');

  function brandLantern() {
    meta.hidden = false;
    meta.textContent = 'Lantern';
  }

  /** Chevron row text (e.g. "Thinking for 3s", "Web search") — not the brand */
  function setChevronStatus(line) {
    if (statusEl) statusEl.textContent = line || '';
  }

  const panel = document.createElement('div');
  panel.className =
    mode === 'rail' ? 'activity-panel activity-rail' : 'activity-panel activity-dropdown';
  panel.hidden = true;

  const panelHead = document.createElement('div');
  panelHead.className = 'activity-panel-head';
  panelHead.innerHTML = `
    <span class="activity-panel-title">Activity</span>
    <button type="button" class="activity-panel-close" aria-label="Close">×</button>
  `;

  const timeline = document.createElement('div');
  timeline.className = 'activity-timeline';
  timeline.setAttribute('role', 'log');
  timeline.setAttribute('aria-live', 'polite');

  panel.appendChild(panelHead);
  panel.appendChild(timeline);

  let backdrop = null;
  if (mode === 'rail') {
    backdrop = document.createElement('div');
    backdrop.className = 'activity-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', () => setOpen(false));
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.hidden = true;

  bubble.appendChild(chip);
  if (mode === 'dropdown') bubble.appendChild(panel);
  bubble.appendChild(body);
  root.appendChild(meta);
  root.appendChild(bubble);
  if (mode === 'rail' && backdrop) {
    root.appendChild(backdrop);
    root.appendChild(panel);
  }
  container.appendChild(root);

  chip.addEventListener('click', () => setOpen(!open));
  panelHead.querySelector('.activity-panel-close')?.addEventListener('click', () => setOpen(false));

  function scrollBottom() {
    container.scrollTop = container.scrollHeight;
  }

  function setOpen(next) {
    open = !!next;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    chip.classList.toggle('is-open', open);
    panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;
    if (open && container) {
      container.querySelectorAll('.msg-assistant').forEach((msg) => {
        if (msg === root) return;
        const closer = msg.__lanternSetActivityOpen;
        if (typeof closer === 'function') closer(false);
      });
    }
    if (open) timeline.scrollTop = timeline.scrollHeight;
  }
  root.__lanternSetActivityOpen = setOpen;

  function showChip() {
    if (chip.hidden) {
      chip.hidden = false;
      brandLantern(); // Lantern stays above the chevron row
      scrollBottom();
    }
  }

  function lastThinkingEvent() {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'thinking' && !events[i].sealed) return events[i];
    }
    return null;
  }

  function findTool(id) {
    for (const e of events) {
      if (e.type === 'tool' && e.id === id) return e;
    }
    return null;
  }

  /** Collapse whitespace for the ticker line */
  function tickerText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Set the one-line streaming preview shown below the status.
   */
  function setPreviewLine(line, { streaming = false } = {}) {
    const t = line || '';
    if (previewTrack) previewTrack.textContent = t;
    else if (previewEl) previewEl.textContent = t;
    previewEl?.classList.toggle('is-streaming', !!streaming);
  }

  let elapsedTimer = null;

  function startElapsedTimer() {
    if (elapsedTimer) return;
    elapsedTimer = setInterval(updatePreview, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function elapsedSeconds() {
    return Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  }

  function updatePreview() {
    showChip();
    brandLantern(); // always "Lantern" on the meta line above
    let spinning = !done;

    const last = events[events.length - 1];
    if (last?.type === 'thinking' && !last.sealed) {
      setChevronStatus(`Thinking for ${elapsedSeconds()}s`);
      const tail = tickerText(last.text);
      setPreviewLine(tail ? tail.slice(-480) : '', { streaming: true });
      startElapsedTimer();
    } else if (last?.type === 'tool' && last.status === 'running') {
      setChevronStatus(toolLabel(last.name));
      var toolSnippet = last.name === 'web_search'
        ? 'Searching: ' + (last.args?.query || '')
        : last.name === 'read_url'
          ? 'Reading: ' + (last.args?.url || '')
          : toolLabel(last.name);
      setPreviewLine(toolSnippet, { streaming: false });
      startElapsedTimer();
    } else if (!done && last?.type === 'thinking') {
      setChevronStatus(`Thinking for ${elapsedSeconds()}s`);
      const tail = tickerText(last.text);
      setPreviewLine(tail ? tail.slice(-480) : '', { streaming: true });
    } else if (!done && last?.type === 'tool') {
      setChevronStatus(toolLabel(last.name));
      var toolSnippet = last.name === 'web_search'
        ? 'Searched: ' + (last.args?.query || '')
        : last.name === 'read_url'
          ? 'Read: ' + (last.args?.url || '')
          : toolLabel(last.name);
      setPreviewLine(toolSnippet, { streaming: false });
      stopElapsedTimer();
    } else if (done) {
      spinning = false;
      stopElapsedTimer();
      const tools = events.filter((e) => e.type === 'tool').length;
      const thought = events.some((e) => e.type === 'thinking' && e.text);
      const secs = Math.max(1, Math.round((Date.now() - totalStartedAt) / 1000));
      let line = 'Done';
      if (thought && tools) line = `Thought · ${tools} tool${tools === 1 ? '' : 's'} · ${secs}s`;
      else if (thought) line = `Thought for ${secs}s`;
      else if (tools) line = `${tools} tool call${tools === 1 ? '' : 's'}`;
      setChevronStatus(line);
      setPreviewLine('', { streaming: false });
    } else {
      setChevronStatus('Working…');
      setPreviewLine('', { streaming: false });
      startElapsedTimer();
    }

    chip.classList.toggle('is-spinning', spinning);
    chip.classList.toggle('is-done', done && !spinning);
  }

  function ensureThinkingRow(turn) {
    let ev = lastThinkingEvent();
    if (ev && ev.turn === turn) return ev;

    ev = {
      type: 'thinking',
      turn,
      text: '',
      sealed: false,
      el: null,
    };
    events.push(ev);

    const row = document.createElement('div');
    row.className = 'tl-item tl-thinking';
    row.dataset.turn = String(turn);
    row.innerHTML = `
      <div class="tl-rail" aria-hidden="true"></div>
      <div class="tl-card">
        <div class="tl-card-head">
          <span class="tl-kind">Thinking</span>
          <span class="tl-turn">turn ${turn}</span>
          <span class="tl-state" data-state="running">streaming</span>
        </div>
        <pre class="tl-body"></pre>
      </div>
    `;
    timeline.appendChild(row);
    ev.el = row;
    return ev;
  }

  function startTurn(n) {
    const num = n || activeTurn + 1 || 1;
    if (activeTurn) sealTurn(activeTurn);
    activeTurn = num;
    startedAt = Date.now();
    stopElapsedTimer();
    updatePreview();
    scrollBottom();
  }

  function appendReasoning(delta, turnNum) {
    if (!delta) return;
    const n = turnNum || activeTurn || 1;
    activeTurn = n;
    showChip();

    let ev = lastThinkingEvent();
    if (!ev || ev.sealed || ev.turn !== n) {
      if (ev && !ev.sealed && ev.turn !== n) sealEvent(ev);
      startedAt = Date.now();
      ev = ensureThinkingRow(n);
    }

    ev.text += delta;
    const bodyEl = ev.el?.querySelector('.tl-body');
    if (bodyEl) {
      bodyEl.textContent = ev.text;
      if (open) timeline.scrollTop = timeline.scrollHeight;
    }
    updatePreview();
    scrollBottom();
  }

  function sealEvent(ev) {
    if (!ev || ev.sealed) return;
    ev.sealed = true;
    if (ev.el) {
      const st = ev.el.querySelector('.tl-state');
      if (st) {
        st.dataset.state = 'done';
        const words = (ev.text || '').trim().split(/\s+/).filter(Boolean).length;
        st.textContent = words ? `${words} words` : 'done';
      }
      ev.el.classList.add('is-sealed');
    }
  }

  function sealTurn(turnNum) {
    const n = turnNum || activeTurn;
    for (const ev of events) {
      if (ev.type === 'thinking' && ev.turn === n) sealEvent(ev);
    }
    updatePreview();
  }

  function paintToolResult(ev) {
    if (!ev?.el) return;
    const resultBlock = ev.el.querySelector('.tl-result');
    if (!resultBlock) return;
    resultBlock.hidden = false;
    resultBlock.innerHTML = `
      <div class="tl-section-label">Result</div>
      <div class="tl-result-body">${renderToolResultHtml(ev.name, ev.error || ev.result, ev.args)}</div>
    `;
  }

  function addToolStart(tool) {
    const n = activeTurn || 1;
    activeTurn = n;
    sealTurn(n);
    showChip();

    const id = tool.id || `tool_${events.filter((e) => e.type === 'tool').length}`;
    const name = tool.name || 'tool';
    let args = tool.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        /* keep */
      }
    }

    const ev = {
      type: 'tool',
      turn: n,
      id,
      name,
      args,
      result: '',
      status: 'running',
      el: null,
    };
    events.push(ev);

    const row = document.createElement('div');
    row.className = 'tl-item tl-tool';
    row.dataset.toolId = id;
    row.innerHTML = `
      <div class="tl-rail" aria-hidden="true"></div>
      <div class="tl-card">
        <div class="tl-card-head">
          <span class="tl-kind">Tool</span>
          <span class="tl-name">${escapeHtml(toolLabel(name))}</span>
          <span class="tl-state" data-state="running">running</span>
        </div>
        <div class="tl-tool-block tl-input">
          <div class="tl-section-label">Input</div>
          <div class="tl-input-body">${renderToolInputHtml(name, args)}</div>
        </div>
        <div class="tl-tool-block tl-result" hidden></div>
      </div>
    `;
    timeline.appendChild(row);
    ev.el = row;
    if (open) timeline.scrollTop = timeline.scrollHeight;
    updatePreview();
    scrollBottom();
    return id;
  }

  function setToolResult(tool) {
    const id = tool.id;
    let ev = id ? findTool(id) : null;
    if (!ev) {
      addToolStart(tool);
      ev = findTool(tool.id) || events[events.length - 1];
    }
    if (!ev || ev.type !== 'tool') return;

    ev.status = tool.error ? 'error' : 'done';
    ev.result = String(tool.error || tool.result || '');
    if (tool.error) ev.error = String(tool.error);

    if (ev.el) {
      const st = ev.el.querySelector('.tl-state');
      if (st) {
        st.dataset.state = ev.status;
        st.textContent = tool.error ? 'failed' : 'done';
      }
      paintToolResult(ev);
      ev.el.classList.toggle('is-error', !!tool.error);
    }
    if (open) timeline.scrollTop = timeline.scrollHeight;
    updatePreview();
    scrollBottom();
  }

  /**
   * Restore a saved activity timeline (history / chat switch).
   * @param {Array} list
   */
  function restoreActivity(list) {
    if (!Array.isArray(list) || !list.length) return;
    for (const item of list) {
      if (!item || !item.type) continue;
      if (item.type === 'thinking') {
        const turn = item.turn || 1;
        activeTurn = turn;
        const ev = ensureThinkingRow(turn);
        ev.text = item.text || '';
        const bodyEl = ev.el?.querySelector('.tl-body');
        if (bodyEl) bodyEl.textContent = ev.text;
        if (item.sealed !== false) sealEvent(ev);
      } else if (item.type === 'tool') {
        activeTurn = item.turn || activeTurn || 1;
        addToolStart({
          id: item.id,
          name: item.name,
          arguments: item.args,
        });
        const ev = findTool(item.id) || events[events.length - 1];
        if (ev && (item.result || item.error || item.status === 'done' || item.status === 'error')) {
          setToolResult({
            id: ev.id,
            name: ev.name,
            result: item.result,
            error: item.error || (item.status === 'error' ? item.result : ''),
          });
        }
      }
    }
    showChip();
    updatePreview();
  }

  function appendContent(delta) {
    if (!delta) return;
    sealTurn(activeTurn || 1);
    if (!content) {
      body.hidden = false;
      body.innerHTML = '';
    }
    content += delta;
    body.innerHTML = renderMarkdown(content);
    brandLantern();
    updatePreview();
    scrollBottom();
  }

  function resetContent() {
    content = '';
    body.hidden = true;
    body.innerHTML = '';
    scrollBottom();
  }

  function finalize(finalContent) {
    for (const ev of events) {
      if (ev.type === 'thinking') sealEvent(ev);
      if (ev.type === 'tool' && ev.status === 'running') {
        ev.status = 'done';
        const st = ev.el?.querySelector('.tl-state');
        if (st) {
          st.dataset.state = 'done';
          st.textContent = 'done';
        }
      }
    }
    if (finalContent != null && finalContent !== '') {
      content = finalContent;
    }
    if (content) {
      body.hidden = false;
      body.innerHTML = renderMarkdown(content);
    }
    done = true;
    if (!events.length) {
      chip.hidden = true;
      setOpen(false);
    } else {
      updatePreview();
    }
    brandLantern();
    scrollBottom();
  }

  function setError(err) {
    done = true;
    stopElapsedTimer();
    root.classList.add('msg-error');
    body.hidden = false;
    body.innerHTML = `<p>${escapeHtml(err)}</p>`;
    brandLantern();
    setChevronStatus('Error');
    if (events.length) updatePreview();
    scrollBottom();
  }

  function setMeta(_text) {
    // CHAT_STATUS used to overwrite the brand ("Thinking (round 2)", "Web search").
    // Keep meta as Lantern; chevron status is driven by updatePreview instead.
    brandLantern();
    if (!done && !events.length) {
      showChip();
      setChevronStatus('Working…');
    }
  }

  function getActivity() {
    return events.map((e) => {
      if (e.type === 'thinking') {
        return {
          type: 'thinking',
          turn: e.turn,
          text: e.text || '',
          sealed: !!e.sealed,
        };
      }
      return {
        type: 'tool',
        turn: e.turn,
        id: e.id,
        name: e.name,
        args: e.args,
        result: e.result || '',
        error: e.error || '',
        status: e.status || 'done',
      };
    });
  }

  return {
    get el() {
      return root;
    },
    setMeta,
    startTurn,
    appendReasoning,
    sealTurn,
    sealActiveTurn: () => sealTurn(activeTurn),
    addToolStart,
    setToolResult,
    appendContent,
    resetContent,
    finalize,
    setError,
    getContent: () => content,
    getActivity,
    restoreActivity,
  };
}

/** @deprecated use createReplyThread */
export function createAssistantMessage(container) {
  return createReplyThread(container);
}

export function appendUserMessage(container, text) {
  // Row matches the composer column width; bubble sits on the row's right edge
  const row = document.createElement('div');
  row.className = 'msg msg-user-row';
  const bubble = document.createElement('div');
  bubble.className = 'msg-user';
  bubble.textContent = text;
  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}
