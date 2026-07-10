# Lantern

**AI sidebar for every tab** — a Chrome extension that puts a page-aware AI assistant next to every page. Works with local models via [llama.cpp](https://github.com/ggml-org/llama.cpp) or any OpenAI/Anthropic-compatible cloud provider.

## Features

| Feature | What it does |
|---------|-------------|
| **Side panel chat** | Click the toolbar icon for an always-available AI assistant |
| **Multiple providers** | Local (llama.cpp), OpenRouter, OpenAI, Anthropic, Groq, xAI, NVIDIA, OpenCode Go |
| **Agent mode** | Browser automation — open tabs, navigate, click, type, search |
| **Search tools** | `web_search` + `read_url` for live research via SearXNG, Exa, ParallelSearch, or Tinyfish |
| **Page context** | Sends title, URL, selection, and readable text to the model (when Visible is on) |
| **Quick actions** | Summarize, key points, explain, critique, rewrite selection |
| **Selection toolbar** | Highlight text → Ask / Explain / Rewrite |
| **Context menus** | Right-click selection or page to send to Lantern |
| **New tab** | Optional replacement — **Enter** searches, **Tab** queries the LLM |
| **New-tab pins** | Custom shortcuts stored in Lantern (not browser bookmarks) |
| **Privacy toggle** | Per-site “Visible” control — block pages from being sent to the model |
| **Memories** | Local notes injected into the system prompt; optional auto-extract after replies |
| **Streaming** | Token streaming from any OpenAI-compatible `/v1/chat/completions` endpoint |
| **Setup wizard** | First-launch flow that guides through provider and search configuration |

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Pin **Lantern** and open the side panel from the toolbar icon.

On first launch the setup wizard will guide you through picking a provider and entering your API key. You can also open **Settings** anytime from the panel menu.

## Providers

| Provider | Kind | Needs key |
|----------|------|-----------|
| Local (llama.cpp) | OpenAI-compatible | No (endpoint only) |
| OpenRouter | OpenAI-compatible | Yes |
| OpenAI | OpenAI-compatible | Yes |
| Groq | OpenAI-compatible | Yes |
| Anthropic | Anthropic Messages API | Yes |
| xAI | OpenAI-compatible | Yes |
| NVIDIA NIM | OpenAI-compatible | Yes |
| [OpenCode Go](https://opencode.ai/docs/go/) | OpenAI-compatible | Yes |

Add API keys in **Settings**. Keys stay in `chrome.storage.sync`.

## Search providers

| Provider | Type | Needs key |
|----------|------|-----------|
| SearXNG | Self-hosted meta-search | No |
| Exa | Neural search API | Yes |
| ParallelSearch | AI-powered search | Yes |
| Tinyfish | Lightweight search API | Yes |

Configure in **Settings** → Web search. The LLM uses the selected provider when it runs `web_search`.

## Agent mode

Opt-in in Settings. When enabled, switch the composer toggle to **Agent** and the model can:

- Open tabs and navigate to URLs
- Click buttons and links (by snapshot refs)
- Type into inputs and press keys
- Search the page for text (`browser_find`)
- Read page content

Mutation actions (click, type, press) ask for confirmation by default. The sidebar agent opens tabs in the foreground since the panel stays visible.

## Project layout

```
manifest.json
background.js                 # Service worker, API calls, tool dispatch
sidepanel/                    # Side panel chat UI
chat/                         # Full-page chat UI
content/                      # Selection toolbar & agent content script
newtab/                       # Optional new tab page
options/                      # Settings page
setup/                        # First-launch setup wizard
shared/                       # Defaults, storage, API client, markdown, model icons, search
assets/providers/             # Monochrome provider SVG icons
icons/
```

## Settings reference

| Setting | Default |
|---------|---------|
| Endpoint | `http://192.168.1.129:8084` |
| Provider | `local` |
| Model | empty (server default) |
| Temperature | `0.7` |
| Max tokens | `2048` |
| Max page chars | `12000` |
| Stream | on |
| Tools enabled | on |
| Search provider | `searxng` |
| Max tool rounds | 4 |
| Agent mode allowed | off |
| New tab enabled | on |

## Privacy notes

- Cloud provider keys are stored in `chrome.storage.sync` (synced to your Google account if enabled).
- Page content is only sent when the site is **Visible** and the toggle is on.
- Chat history is stored in `chrome.storage.local` per tab (capped).
- Memories stay local; off by default.
- When using a local llama.cpp server, all inference runs on your machine.

## License

MIT — use freely with your local models.
