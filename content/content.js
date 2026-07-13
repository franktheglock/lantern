/**
 * Content script: floating selection toolbar + keyboard shortcut.
 * Does not call llama.cpp directly — opens side panel via messages.
 */

(function () {
  // ── Console log capture ──
  var agentLogs = [];
  var LOG_MAX = 200;
  function captureLog(level, args) {
    var msg = (args || []).map(function (a) {
      try { return typeof a === 'object' ? JSON.stringify(a).slice(0, 500) : String(a); }
      catch (e) { return String(a); }
    }).join(' ');
    agentLogs.push({ level: level, text: msg.slice(0, 500), at: Date.now() });
    if (agentLogs.length > LOG_MAX) agentLogs.shift();
  }
  var _log = console.log, _warn = console.warn, _err = console.error;
  console.log = function () { captureLog('log', Array.prototype.slice.call(arguments)); return _log.apply(console, arguments); };
  console.warn = function () { captureLog('warn', Array.prototype.slice.call(arguments)); return _warn.apply(console, arguments); };
  console.error = function () { captureLog('error', Array.prototype.slice.call(arguments)); return _err.apply(console, arguments); };
  // Also capture uncaught errors
  window.addEventListener('error', function (e) {
    captureLog('error', ['Uncaught: ' + (e.message || e.error || String(e)) + ' at ' + (e.filename || '') + ':' + (e.lineno || '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    captureLog('error', ['Unhandled rejection: ' + (e.reason ? String(e.reason) : String(e))]);
  });

(function () {
  if (window.__lanternInjected) return;
  window.__lanternInjected = true;

  const TOOLBAR_ID = 'lantern-selection-toolbar';
  let toolbar = null;
  let lastSelection = '';
  let hideTimer = null;

  function ensureToolbar() {
    if (toolbar && document.documentElement.contains(toolbar)) return toolbar;
    toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Lantern selection actions');

    const actions = [
      { id: 'ask', label: 'Ask' },
      { id: 'explain', label: 'Explain' },
      { id: 'rewrite', label: 'Rewrite' },
    ];
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = a.id;
      btn.textContent = a.label;
      btn.title = a.label + ' with Lantern';
      toolbar.appendChild(btn);
    }

    // Keep selection alive when interacting with the toolbar
    toolbar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    toolbar.addEventListener('mouseup', (e) => {
      e.stopPropagation();
    });
    toolbar.addEventListener('click', onToolbarClick);
    (document.body || document.documentElement).appendChild(toolbar);
    return toolbar;
  }

  function hideToolbar() {
    if (toolbar) toolbar.classList.remove('lantern-visible');
  }

  function showToolbar(x, y) {
    const el = ensureToolbar();
    const pad = 8;
    const w = 220;
    const left = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
    const top = Math.max(pad, Math.min(y, window.innerHeight - 48 - pad));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.classList.add('lantern-visible');
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().trim();
    if (!text || text.length < 2) return null;
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    // Fallback when getBoundingClientRect is empty (some multiline selections)
    if ((!rect.width && !rect.height) || (rect.top === 0 && rect.left === 0 && !rect.bottom)) {
      const rects = range.getClientRects();
      if (rects && rects.length) rect = rects[0];
    }
    return { text, rect };
  }

  function onMouseUp(e) {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('#' + TOOLBAR_ID)) return;
    if (hideTimer) clearTimeout(hideTimer);
    // Defer so the browser finishes updating the selection
    hideTimer = setTimeout(() => {
      const info = getSelectionInfo();
      if (!info) {
        hideToolbar();
        return;
      }
      lastSelection = info.text;
      // fixed positioning → use viewport coords
      const x = info.rect.left + info.rect.width / 2 - 100;
      const y = info.rect.top - 46;
      showToolbar(x, y > 4 ? y : info.rect.bottom + 8);
    }, 12);
  }

  function onScrollOrResize() {
    hideToolbar();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      hideToolbar();
      return;
    }
    // Alt+L opens ask with selection
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
      const info = getSelectionInfo();
      if (info) {
        e.preventDefault();
        lastSelection = info.text;
        dispatchPrompt(
          'Regarding this selection:\n"""\n' +
            info.text +
            '\n"""\n\nWhat should I know about it?',
          info.text
        );
      }
    }
  }

  function onSelectionChange() {
    // If user cleared selection (e.g. click away), hide after a tick
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!getSelectionInfo()) hideToolbar();
    }, 80);
  }

  async function onToolbarClick(e) {
    const btn = e.target.closest && e.target.closest('button[data-action]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const action = btn.dataset.action;
    const text = lastSelection || (getSelectionInfo() && getSelectionInfo().text) || '';
    if (!text) return;

    let prompt = '';
    if (action === 'ask') {
      prompt =
        'Regarding this selection:\n"""\n' + text + '\n"""\n\nWhat should I know about it?';
    } else if (action === 'explain') {
      prompt = 'Explain the following text simply and clearly:\n\n"""\n' + text + '\n"""';
    } else if (action === 'rewrite') {
      prompt =
        'Rewrite the following text to be clearer and more polished. Preserve meaning. Return only the rewritten text.\n\n"""\n' +
        text +
        '\n"""';
    } else {
      return;
    }

    hideToolbar();
    await dispatchPrompt(prompt, text);
  }

  async function dispatchPrompt(prompt, selection) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'LANTERN_OPEN_AND_ASK',
        prompt: prompt,
        selection: selection,
      });
      if (res && res.ok === false) {
        console.warn('[Lantern] open/ask failed', res.error || res);
      } else if (res && res.panelOpened === false) {
        console.warn(
          '[Lantern] Side panel did not open:',
          res.panelError || 'unknown',
          '— try clicking the Lantern icon once to grant panel access.'
        );
      }
    } catch (err) {
      console.warn('[Lantern] Extension context may need a page refresh', err);
    }
  }

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('selectionchange', onSelectionChange);

  // —— Browser agent bridge (snapshot / click / type / press) ——
  /** @type {Map<string, Element>} */
  const agentRefMap = new Map();
  let agentRefSeq = 0;

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function accessibleName(el) {
    if (!el) return '';
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 120);
    if (el.labels && el.labels[0]) return el.labels[0].textContent.trim().slice(0, 120);
    const ph = el.getAttribute('placeholder');
    if (ph) return ph.trim().slice(0, 120);
    const title = el.getAttribute('title');
    if (title) return title.trim().slice(0, 120);
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120);
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return el.type || 'textbox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (el.isContentEditable) return 'textbox';
    return tag;
  }

  function buildSnapshot() {
    agentRefMap.clear();
    agentRefSeq = 0;
    const interactives = [];
    const tracked = new WeakSet();
    const selector =
      'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="menuitem"], [role="option"], [role="tab"], [contenteditable="true"]';

    function addElement(el) {
      if (tracked.has(el)) return false;
      if (!isVisible(el)) return false;
      if (el.closest('#' + TOOLBAR_ID)) return false;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'password') return false;
      tracked.add(el);
      const ref = 'e' + ++agentRefSeq;
      agentRefMap.set(ref, el);
      const item = {
        ref: ref,
        role: roleOf(el),
        tag: el.tagName.toLowerCase(),
        name: accessibleName(el),
        disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      };
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (type !== 'password') item.value = String(el.value || '').slice(0, 80);
      }
      interactives.push(item);
      return true;
    }

    // Scan visible modals / popups first so pop-up controls are never cut off.
    // Cover aria roles, aria-modal, and common class-name heuristics.
    var modalSelectors = [
      '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
      '[class*="modal" i]', '[class*="dialog" i]', '[class*="popup" i]', '[class*="popover" i]',
      '[class*="overlay" i]',
    ];
    for (var si = 0; si < modalSelectors.length; si++) {
      var candidates = document.querySelectorAll(modalSelectors[si]);
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci];
        if (!isVisible(c)) continue;
        // Don't re-scan the same container matched by multiple selectors
        if (tracked.has(c)) continue;
        tracked.add(c);
        var inside = c.querySelectorAll(selector);
        for (var ji = 0; ji < inside.length; ji++) addElement(inside[ji]);
      }
    }

    const nodes = document.querySelectorAll(selector);
    for (let i = 0; i < nodes.length && interactives.length < 120; i++) {
      addElement(nodes[i]);
    }
    const headings = [];
    document.querySelectorAll('h1, h2, h3').forEach((h) => {
      if (headings.length >= 12) return;
      const t = (h.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) headings.push({ level: h.tagName.toLowerCase(), text: t.slice(0, 160) });
    });
    let focusedRef = null;
    const active = document.activeElement;
    agentRefMap.forEach((el, ref) => {
      if (el === active) focusedRef = ref;
    });
    return {
      url: location.href,
      title: document.title || '',
      headings: headings,
      interactives: interactives,
      focusedRef: focusedRef,
    };
  }

  function resolveRef(ref) {
    return agentRefMap.get(String(ref || '')) || null;
  }

  let agentCursorEl = null;
  let agentCursorTimer = null;

  function agentCursorMove(x, y) {
    if (!agentCursorEl) {
      agentCursorEl = document.createElement('div');
      agentCursorEl.id = 'lantern-agent-cursor';
      const s = agentCursorEl.style;
      s.position = 'fixed';
      s.zIndex = '2147483646';
      s.pointerEvents = 'none';
      s.width = '24px';
      s.height = '24px';
      s.borderRadius = '50%';
      s.background = 'radial-gradient(circle, rgba(255,140,0,0.6) 0%, rgba(255,140,0,0.2) 50%, transparent 70%)';
      s.border = '2px solid rgba(255,140,0,0.7)';
      s.boxShadow = '0 0 12px rgba(255,140,0,0.4)';
      s.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), left 0.25s ease, top 0.25s ease';
      s.marginLeft = '-12px';
      s.marginTop = '-12px';
      s.transform = 'scale(1)';
      document.documentElement.appendChild(agentCursorEl);
    }
    agentCursorEl.style.left = x + 'px';
    agentCursorEl.style.top = y + 'px';

    // Pulse on arrival
    agentCursorEl.style.transform = 'scale(1.4)';
    setTimeout(() => { if (agentCursorEl) agentCursorEl.style.transform = 'scale(1)'; }, 200);

    // Auto-hide after 3s
    if (agentCursorTimer) clearTimeout(agentCursorTimer);
    agentCursorTimer = setTimeout(() => {
      if (agentCursorEl) { agentCursorEl.style.opacity = '0'; }
    }, 3000);
    if (agentCursorEl) agentCursorEl.style.opacity = '1';
  }

  function waitForCursor() {
    return new Promise(function (r) { setTimeout(r, 300); });
  }

  async function agentClick(ref) {
    const el = resolveRef(ref);
    if (!el) return { ok: false, error: 'Unknown ref: ' + ref + ' (take a new snapshot)' };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Animate cursor to position first, then click
    agentCursorMove(cx, cy);
    await waitForCursor();

    // Dispatch full mouse events
    const mouseOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    el.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    el.dispatchEvent(new MouseEvent('click', mouseOpts));
    return { ok: true, url: location.href, title: document.title || '' };
  }

  async function agentType(ref, text, clear) {
    const el = resolveRef(ref) || document.activeElement;
    if (!el) return { ok: false, error: 'No target element' };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }

    // Move cursor to the input first, then type
    const r = el.getBoundingClientRect();
    agentCursorMove(r.left + 10, r.top + r.height / 2);
    await waitForCursor();

    if (clear) {
      if (el.isContentEditable) el.textContent = '';
      else if ('value' in el) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, '');
        else el.value = '';
      }
    }

    const value = String(text ?? '');
    // Stream characters with a small delay for visual feedback
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (el.isContentEditable) {
        el.textContent = (el.textContent || '') + ch;
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      } else if ('value' in el) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const next = String(el.value || '') + ch;
        if (desc && desc.set) desc.set.call(el, next);
        else el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 30 + Math.floor(Math.random() * 20)));
    }
    return { ok: true, url: location.href };
  }

  function agentPress(key) {
    const el = document.activeElement || document.body;
    const k = String(key || 'Enter');
    const opts = { key: k, code: k, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (k === 'Enter' && el.form && typeof el.form.requestSubmit === 'function') {
      try {
        el.form.requestSubmit();
      } catch {
        /* ignore */
      }
    }
    return { ok: true, url: location.href };
  }

  function agentScroll(delta) {
    var d = Number(delta) || 0;
    if (!d) return { ok: false, error: 'Missing delta' };
    window.scrollBy({ top: d, left: 0, behavior: 'smooth' });
    return { ok: true, url: location.href, scrolled: d };
  }

  function agentFind(query) {
    if (!query) return { ok: false, error: 'Missing query' };
    const q = query.toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const results = [];
    let node;
    while ((node = walker.nextNode())) {
      if (results.length >= 20) break;
      const text = node.textContent || '';
      const lower = text.toLowerCase();
      let idx = lower.indexOf(q);
      if (idx === -1) continue;
      const el = node.parentElement;
      if (!el || !isVisible(el)) continue;
      // Avoid collecting adjacent text-node matches from the same parent
      if (results.length && results[results.length - 1]._parent === el) continue;
      const before = text.slice(Math.max(0, idx - 40), idx);
      const match = text.slice(idx, idx + q.length);
      const after = text.slice(idx + q.length, idx + q.length + 60);
      const snippet = (before ? '…' + before : '') + match + (after ? after + '…' : '');
      // Check if this element or an ancestor has a snapshot ref
      let ref = null;
      agentRefMap.forEach(function (mapped, r) {
        if (ref) return;
        if (mapped === el || mapped.contains(el)) ref = r;
      });
      results.push({
        snippet: snippet.replace(/\s+/g, ' ').trim(),
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        ref: ref,
        _parent: el,
      });
    }
    // Strip internal _parent key
    for (var i = 0; i < results.length; i++) delete results[i]._parent;
    var count = results.length;
    if (!count) {
      // Fallback: search innerText with regex
      var bodyText = (document.body.innerText || '').toLowerCase();
      var rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      var matches = bodyText.match(rx);
      var total = matches ? matches.length : 0;
      return { ok: true, result: { count: count, total: total, matches: results, note: 'No visible match in walkable text nodes. Try a different query or take a snapshot first.' } };
    }
    return { ok: true, result: { count: count, matches: results } };
  }

  function agentEval(js) {
    if (!js || !String(js).trim()) return { ok: false, error: 'Missing JavaScript' };
    try {
      var result = (0, eval)(String(js));
      var out = typeof result === 'undefined' ? 'undefined' : (result === null ? 'null' : String(result));
      return { ok: true, result: out.slice(0, 2000) };
    } catch (err) {
      return { ok: true, result: 'Error: ' + (err.message || String(err)).slice(0, 500) };
    }
  }

  function agentLogs() {
    var recent = agentLogs.slice(-40);
    var text = recent.map(function (l) {
      var time = new Date(l.at).toISOString().slice(11, 19);
      return '[' + time + '] [' + l.level + '] ' + l.text;
    }).join('\n');
    return { ok: true, count: recent.length, total: agentLogs.length, logs: text || '(no logs)' };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'AGENT_SNAPSHOT') {
      sendResponse({ ok: true, snapshot: buildSnapshot() });
      return true;
    }
    if (msg.type === 'AGENT_CLICK') {
      agentClick(msg.ref).then(function (r) { sendResponse(r); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
      return true;
    }
    if (msg.type === 'AGENT_TYPE') {
      agentType(msg.ref, msg.text, !!msg.clear).then(function (r) { sendResponse(r); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
      return true;
    }
    if (msg.type === 'AGENT_PRESS') {
      sendResponse(agentPress(msg.key));
      return true;
    }
    if (msg.type === 'AGENT_SCROLL') {
      sendResponse(agentScroll(msg.delta));
      return true;
    }
    if (msg.type === 'AGENT_EVAL') {
      sendResponse(agentEval(String(msg.js || '')));
      return true;
    }
    if (msg.type === 'AGENT_LOGS') {
      sendResponse(agentLogs());
      return true;
    }
    if (msg.type === 'AGENT_FIND') {
      sendResponse(agentFind(String(msg.query || '')));
      return true;
    }
    if (msg.type === 'AGENT_GLOW') {
      if (msg.on) agentGlowOn();
      else agentGlowOff();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'AGENT_PING') {
      sendResponse({ ok: true, agent: true });
      return true;
    }
  });

  let agentGlowStyle = null;

  function agentGlowOn() {
    agentGlowOff();
    agentGlowStyle = document.createElement('style');
    agentGlowStyle.id = 'lantern-agent-glow';
    agentGlowStyle.textContent = `
      @property --lantern-angle {
        syntax: '<angle>';
        initial-value: 0deg;
        inherits: false;
      }
      @keyframes lantern-glow-wave {
        to { --lantern-angle: 360deg; }
      }
      html::after {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
        border-radius: 12px;
        padding: 3px;
        background: conic-gradient(
          from var(--lantern-angle),
          transparent,
          rgba(255, 140, 0, 0.7) 10%,
          rgba(255, 140, 0, 0.9) 15%,
          rgba(255, 140, 0, 0.3) 20%,
          transparent 30%
        );
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        animation: lantern-glow-wave 3s linear infinite;
      }
    `;
    document.documentElement.appendChild(agentGlowStyle);
  }

  function agentGlowOff() {
    if (agentGlowStyle) {
      agentGlowStyle.remove();
      agentGlowStyle = null;
    }
  }
})();

})();
