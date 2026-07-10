/**
 * Model brand icon resolution — shared between chat and sidebar pickers.
 * Matches model IDs to monochrome SVG icons under assets/providers/.
 */

export const MODEL_ORG_ICONS = {
  openai: 'openai',
  anthropic: 'anthropic',
  claude: 'claude',
  google: 'google',
  'google-ai-studio': 'google',
  'google-vertex': 'google',
  gemini: 'gemini',
  gemma: 'gemma',
  meta: 'meta',
  'meta-llama': 'meta',
  deepseek: 'deepseek',
  mistralai: 'mistral',
  mistral: 'mistral',
  qwen: 'qwen',
  alibaba: 'qwen',
  'x-ai': 'xai',
  xai: 'xai',
  moonshotai: 'kimi',
  moonshot: 'kimi',
  kimi: 'kimi',
  'z-ai': 'zhipu',
  zhipu: 'zhipu',
  thudm: 'zhipu',
  minimax: 'minimax',
  cohere: 'cohere',
  nvidia: 'nvidia',
  perplexity: 'perplexity',
  microsoft: 'microsoft',
  azure: 'azure',
  amazon: 'aws',
  aws: 'aws',
  bedrock: 'bedrock',
  huggingface: 'huggingface',
  groq: 'groq',
  openrouter: 'openrouter',
  ollama: 'ollama',
  local: 'llamacpp',
  llamacpp: 'llamacpp',
};

export function modelIconKey(modelId, providerId) {
  const raw = String(modelId || '').trim();
  if (!raw) return (providerId || 'llamacpp').replace(/\.svg$/i, '');

  const id = raw.toLowerCase().replace(/^~/, '');

  if (id.includes('/')) {
    const org = id.split('/')[0];
    const rest = id.slice(org.length + 1);
    if (rest.includes('gemini') || org === 'gemini') return 'gemini';
    if (rest.includes('gemma') || org === 'gemma') return 'gemma';
    if (rest.includes('claude') || org === 'claude') return 'claude';
    if (MODEL_ORG_ICONS[org]) return MODEL_ORG_ICONS[org];
  }

  if (/\bclaude\b/.test(id) || id.startsWith('claude-')) return 'claude';
  if (/\bgpt\b/.test(id) || /^o[1-9]/.test(id) || id.startsWith('gpt-') || id.includes('gpt-oss')) return 'openai';
  if (id.includes('gemini')) return 'gemini';
  if (id.includes('gemma')) return 'gemma';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('llama') || id.includes('meta-llama')) return 'meta';
  if (id.includes('mistral') || id.includes('mixtral') || id.includes('codestral')) return 'mistral';
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('grok')) return 'xai';
  if (id.includes('kimi') || id.includes('moonshot')) return 'kimi';
  if (id.includes('glm') || id.includes('zhipu') || id.includes('z-ai')) return 'zhipu';
  if (id.includes('minimax')) return 'minimax';
  if (id.includes('command-') || id.includes('cohere') || id.includes('north-')) return 'cohere';
  if (id.includes('nemotron')) return 'nvidia';
  if (id.includes('sonar') || id.includes('perplexity')) return 'perplexity';
  if (id.includes('whisper')) return 'openai';

  let fallback = (providerId || 'llamacpp').replace(/\.svg$/i, '');
  if (fallback === 'local' || providerId === 'local') fallback = 'llamacpp';
  if (fallback === 'opencodego') fallback = 'opencode';
  return fallback;
}
