/**
 * llama.cpp OpenAI-compatible client (runs in extension contexts).
 * Prefer calling via background messaging so host_permissions apply cleanly.
 */

export function normalizeEndpoint(endpoint) {
  return (endpoint || '').replace(/\/+$/, '');
}

export async function listModels(settings) {
  const base = normalizeEndpoint(settings.endpoint);
  const headers = { Accept: 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const res = await fetch(`${base}/v1/models`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Models request failed (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json();
  return data.data || data.models || [];
}

export async function healthCheck(settings) {
  const base = normalizeEndpoint(settings.endpoint);
  try {
    const res = await fetch(`${base}/health`, { method: 'GET' });
    if (res.ok) return { ok: true, status: res.status };
  } catch {
    // fall through to models
  }
  try {
    await listModels(settings);
    return { ok: true, status: 200 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Stream chat completion. Calls onDelta(textChunk) and returns full text.
 */
export async function chatCompletion(settings, messages, { onDelta, signal } = {}) {
  const base = normalizeEndpoint(settings.endpoint);
  const headers = {
    'Content-Type': 'application/json',
    Accept: settings.stream ? 'text/event-stream' : 'application/json',
  };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const body = {
    messages,
    temperature: settings.temperature ?? 0.7,
    max_tokens: settings.maxTokens ?? 2048,
    stream: !!settings.stream,
  };
  if (settings.model) body.model = settings.model;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Chat failed (${res.status}): ${text || res.statusText}`);
  }

  if (!settings.stream) {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (onDelta && content) onDelta(content);
    return content;
  }

  // SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta =
          json.choices?.[0]?.delta?.content ??
          json.choices?.[0]?.message?.content ??
          '';
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  return full;
}

export function buildMessages({ systemPrompt, pageContext, memories, history, userText }) {
  const messages = [];

  let system = systemPrompt || '';
  if (pageContext) {
    system += `\n\n--- Current page context ---\n${pageContext}\n--- End page context ---`;
  }
  if (memories?.length) {
    const memBlock = memories
      .slice(0, 8)
      .map((m) => `- [${m.title || m.url || 'memory'}] ${m.summary || m.text}`)
      .join('\n');
    system += `\n\n--- Browser memories (user opted in) ---\n${memBlock}\n--- End memories ---`;
  }

  if (system) messages.push({ role: 'system', content: system });

  for (const m of history || []) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }

  messages.push({ role: 'user', content: userText });
  return messages;
}

export function formatPageContext({ title, url, selection, text, maxChars }) {
  const parts = [];
  if (title) parts.push(`Title: ${title}`);
  if (url) parts.push(`URL: ${url}`);
  if (selection) parts.push(`Selected text:\n"""\n${selection.slice(0, 4000)}\n"""`);
  if (text) {
    const limit = maxChars ?? 12000;
    const body = text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text;
    parts.push(`Page content:\n${body}`);
  }
  return parts.join('\n\n');
}
