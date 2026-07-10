/**
 * Cloud + local provider catalog for Lantern.
 * Background duplicates essentials in classic form; UI imports this module.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   kind: 'openai'|'anthropic',
 *   baseUrl?: string,
 *   needsKey: boolean,
 *   defaultModels: string[],
 *   keyField: string,
 *   icon: string
 * }} ProviderDef
 */

/**
 * Monochrome LobeHub icons (from @lobehub/icons-static-svg, not *-color).
 * Files live under assets/providers/
 */
/** @type {ProviderDef[]} */
export const PROVIDERS = [
  {
    id: 'local',
    label: 'Local',
    kind: 'openai',
    needsKey: false,
    defaultModels: [],
    keyField: 'apiKey',
    icon: 'llamacpp.svg',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyField: 'keyOpenrouter',
    icon: 'openrouter.svg',
    // Curated pins (July 2026) — floated to top of picker; full list still from /models
    defaultModels: [
      'openai/gpt-5.6-luna',
      'openai/gpt-5.6-sol',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-4.8',
      'google/gemini-3.5-flash',
      'deepseek/deepseek-v4-flash',
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keyField: 'keyOpenai',
    icon: 'openai.svg',
    defaultModels: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5'],
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keyField: 'keyGroq',
    icon: 'groq.svg',
    defaultModels: [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.6-27b',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    needsKey: true,
    keyField: 'keyAnthropic',
    icon: 'anthropic.svg',
    defaultModels: [
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-haiku-4-5',
      'claude-fable-5',
    ],
  },
  {
    id: 'xai',
    label: 'xAI',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    keyField: 'keyXai',
    icon: 'xai.svg',
    defaultModels: ['grok-4.5', 'grok-4.3'],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    kind: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    needsKey: true,
    keyField: 'keyNvidia',
    icon: 'nvidia',
    defaultModels: [
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/llama-3.3-nemotron-super-49b-v1',
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-8b-instruct',
    ],
  },
  {
    id: 'opencodego',
    label: 'OpenCode Go',
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    needsKey: true,
    keyField: 'keyOpencodego',
    icon: 'opencode',
    defaultModels: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'qwen3.6-plus',
      'qwen3.7-plus',
      'qwen3.7-max',
      'kimi-k2.6',
      'kimi-k2.7-code',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'minimax-m3',
      'minimax-m2.7',
      'glm-5.2',
      'glm-5.1',
    ],
  },
];

/** Map provider id → monochrome icon filename under assets/providers/ */
export const PROVIDER_ICON_FILES = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p.icon])
);

export function providerIconUrl(providerId) {
  const file = PROVIDER_ICON_FILES[providerId] || 'llamacpp.svg';
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`assets/providers/${file}`);
  }
  return `../assets/providers/${file}`;
}

export function getProviderDef(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

export function providerKeyFromSettings(settings, providerId) {
  const def = getProviderDef(providerId);
  if (!def) return '';
  if (providerId === 'local') return (settings.apiKey || '').trim();
  return (settings[def.keyField] || '').trim();
}

export function providerHasKey(settings, providerId) {
  const def = getProviderDef(providerId);
  if (!def) return false;
  if (!def.needsKey) return true;
  return !!providerKeyFromSettings(settings, providerId);
}
