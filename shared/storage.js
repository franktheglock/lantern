import { DEFAULTS } from './defaults.js';

export async function getSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(partial) {
  await chrome.storage.sync.set(partial);
  return getSettings();
}

export async function getLocal(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

export async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/** Site visibility: when false, page content is not sent to the model */
export async function isSiteAllowed(hostname) {
  const blocked = (await getLocal('blockedSites', [])) || [];
  return !blocked.includes(hostname);
}

export async function setSiteAllowed(hostname, allowed) {
  const blocked = new Set((await getLocal('blockedSites', [])) || []);
  if (allowed) blocked.delete(hostname);
  else blocked.add(hostname);
  await setLocal('blockedSites', [...blocked]);
}

/** Normalize a memory row (back-compat with older { summary } shape). */
export function normalizeMemory(row) {
  if (!row || typeof row !== 'object') return null;
  const text = String(row.text || row.summary || '').trim();
  if (!text) return null;
  const now = Date.now();
  return {
    id: row.id || crypto.randomUUID(),
    createdAt: row.createdAt || now,
    updatedAt: row.updatedAt || row.createdAt || now,
    text,
    title: row.title ? String(row.title).trim() : '',
    source: row.source || 'user',
    url: row.url || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    status: row.status || 'active',
    conversationId: row.conversationId || '',
  };
}

export async function getMemories() {
  const raw = (await getLocal('memories', [])) || [];
  return raw.map(normalizeMemory).filter(Boolean);
}

export async function getActiveMemories() {
  return (await getMemories()).filter((m) => m.status === 'active' || !m.status);
}

export async function saveMemory(entry) {
  const memories = await getMemories();
  const now = Date.now();
  const next = normalizeMemory({
    ...entry,
    updatedAt: now,
    createdAt: entry?.createdAt || now,
  });
  if (!next) throw new Error('Memory text required');
  const idx = memories.findIndex((m) => m.id === next.id);
  if (idx >= 0) memories[idx] = { ...memories[idx], ...next, updatedAt: now };
  else memories.unshift(next);
  const active = memories.filter((m) => m.status === 'active' || !m.status);
  const pending = memories.filter((m) => m.status === 'pending');
  const rest = memories.filter(
    (m) => m.status && m.status !== 'active' && m.status !== 'pending'
  );
  const trimmed = [
    ...active.slice(0, 100),
    ...pending.slice(0, 20),
    ...rest.slice(0, 20),
  ];
  await setLocal('memories', trimmed);
  return next;
}

/** @deprecated use saveMemory */
export async function addMemory(entry) {
  return saveMemory({ ...entry, source: entry?.source || 'user', status: 'active' });
}

export async function deleteMemory(id) {
  const memories = (await getMemories()).filter((m) => m.id !== id);
  await setLocal('memories', memories);
}

export async function clearMemories() {
  await setLocal('memories', []);
}

export async function setMemoryStatus(id, status) {
  const memories = await getMemories();
  const row = memories.find((m) => m.id === id);
  if (!row) return null;
  row.status = status;
  row.updatedAt = Date.now();
  await setLocal('memories', memories);
  return row;
}

export async function getChatHistory(tabId) {
  const all = (await getLocal('chatByTab', {})) || {};
  return all[String(tabId)] || [];
}

export async function setChatHistory(tabId, messages) {
  const all = (await getLocal('chatByTab', {})) || {};
  all[String(tabId)] = messages.slice(-40);
  // Cap total tabs stored
  const keys = Object.keys(all);
  if (keys.length > 30) {
    for (const k of keys.slice(0, keys.length - 30)) delete all[k];
  }
  await setLocal('chatByTab', all);
}
