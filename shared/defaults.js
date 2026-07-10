/** Default settings for Lantern */
export const DEFAULTS = {
  endpoint: 'http://192.168.1.129:8084',
  apiKey: '',
  /** Active provider id: local | openrouter | openai | groq | anthropic | xai | nvidia | opencodego */
  provider: 'local',
  model: 'Gemma-Test',
  temperature: 0.7,
  maxTokens: 2048,
  maxPageChars: 12000,
  systemPrompt:
    'You are Lantern, a helpful browsing assistant running locally. Be concise and practical. When page context is provided, use it accurately — quote sparingly and do not invent page content. You have tools to search the web and read URLs; use them when you need current information or page contents rather than guessing.',
  includePageContext: true,
  /** Inject local memories into the system prompt */
  memoriesEnabled: false,
  /** After replies, propose facts to remember (needs user confirm unless auto-accept) */
  memoryAutoExtract: false,
  /** Skip confirm chips and save auto-extract proposals as active */
  memoryAutoAccept: false,
  stream: true,
  toolsEnabled: true,
  searchProvider: 'searxng',
  searxngUrl: 'http://192.168.1.129:55001',
  maxToolRounds: 4,
  /** Global gate: allow Agent mode in the composer */
  agentModeAllowed: false,
  /** Require UI confirm before click/type/press */
  agentConfirmMutations: true,
  /** Hard cap on browser-tool steps per agent run */
  maxAgentSteps: 25,
  /** Replace the browser new tab page */
  newtabEnabled: true,
  // Cloud provider API keys
  keyOpenrouter: '',
  keyOpenai: '',
  keyGroq: '',
  keyAnthropic: '',
  keyXai: '',
  keyNvidia: '',
  keyOpencodego: '',
  keyExa: '',
  keyParallel: '',
  keyTinyfish: '',
};

export const QUICK_ACTIONS = [
  {
    id: 'summarize',
    label: 'Summarize',
    prompt: 'Summarize this page. Cover the main points, key facts, and any conclusions. Use short bullet points.',
  },
  {
    id: 'key-points',
    label: 'Key points',
    prompt: 'Extract the key points from this page as a tight numbered list. Prioritize actionable or memorable facts.',
  },
  {
    id: 'explain',
    label: 'Explain simply',
    prompt: 'Explain what this page is about in plain language, as if to a smart friend who has no background in the topic.',
  },
  {
    id: 'critique',
    label: 'Critique',
    prompt: 'Critically evaluate this page. Note strengths, weaknesses, missing context, and potential bias. Be fair but sharp.',
  },
  {
    id: 'rewrite-selection',
    label: 'Rewrite selection',
    prompt: 'Rewrite the selected text to be clearer and more polished. Preserve meaning. Return only the rewritten text.',
    needsSelection: true,
  },
  {
    id: 'eli5-selection',
    label: 'ELI5 selection',
    prompt: 'Explain the selected text simply, as if to a curious 12-year-old. Keep it short.',
    needsSelection: true,
  },
  {
    id: 'research',
    label: 'Research',
    prompt: 'Research this topic using web search. Summarize what you find with sources.',
  },
];
