/**
 * Content script: floating selection toolbar + keyboard shortcut.
 * Does not call llama.cpp directly — opens side panel via messages.
 */

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

  function agentClick(ref) {
    const el = resolveRef(ref);
    if (!el) return { ok: false, error: 'Unknown ref: ' + ref + ' (take a new snapshot)' };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    // Dispatch full mouse events (React and most frameworks listen for these)
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const mouseOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    el.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    el.dispatchEvent(new MouseEvent('click', mouseOpts));
    return { ok: true, url: location.href, title: document.title || '' };
  }

  function agentType(ref, text, clear) {
    const el = resolveRef(ref) || document.activeElement;
    if (!el) return { ok: false, error: 'No target element' };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    const value = String(text ?? '');
    if (el.isContentEditable) {
      if (clear) el.textContent = '';
      el.textContent = (el.textContent || '') + value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else if ('value' in el) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const next = clear ? value : String(el.value || '') + value;
      if (desc && desc.set) desc.set.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      return { ok: false, error: 'Element is not editable' };
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

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'AGENT_SNAPSHOT') {
      sendResponse({ ok: true, snapshot: buildSnapshot() });
      return true;
    }
    if (msg.type === 'AGENT_CLICK') {
      sendResponse(agentClick(msg.ref));
      return true;
    }
    if (msg.type === 'AGENT_TYPE') {
      sendResponse(agentType(msg.ref, msg.text, !!msg.clear));
      return true;
    }
    if (msg.type === 'AGENT_PRESS') {
      sendResponse(agentPress(msg.key));
      return true;
    }
    if (msg.type === 'AGENT_FIND') {
      sendResponse(agentFind(String(msg.query || '')));
      return true;
    }
    if (msg.type === 'AGENT_PING') {
      sendResponse({ ok: true, agent: true });
      return true;
    }
  });
})();
