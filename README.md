# Lantern

**Atlas-style browsing with local models** — a Chrome extension that puts a page-aware AI sidebar next to every tab, powered by your own [llama.cpp](https://github.com/ggml-org/llama.cpp) server.

Default server: `http://192.168.1.129:8084`

## Features

| Feature | What it does |
|--------|----------------|
| **Side panel chat** | Click the toolbar icon (or use context menus) for a ChatGPT-Atlas-style assistant |
| **Page context** | Sends title, URL, selection, and readable page text to the model (when Visible is on) |
| **Quick actions** | Summarize, key points, explain, critique, rewrite selection |
| **Selection toolbar** | Highlight text → Ask / Explain / Rewrite |
| **Context menus** | Right-click selection or page |
| **New tab** | **Enter** → SearXNG web search · **Tab** → ask the LLM |
| **LLM tools** | `web_search` (SearXNG) + `read_url` for live research |
| **New-tab pins** | Custom shortcuts stored only in Lantern (not browser bookmarks); star / right‑click to pin |
| **Privacy toggle** | Per-site “Visible” control — block pages from being sent to the model |
| **Streaming** | Token streaming from `/v1/chat/completions` |
| **Settings** | Endpoint, model, temperature, system prompt, context limits |

**Agent mode** (opt-in in Settings) can open tabs, navigate, click, and type with confirmation for mutations. **Memories** store local notes (manual or proposed after replies) and inject them into the system prompt when enabled.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder (`browser-launch-page`).
4. Pin **Lantern** and open the side panel from the toolbar icon.
5. Open **Settings** (gear in the panel) if you need to change the endpoint.

If Chrome asks for **local network access**, allow it so the extension can reach `192.168.1.x`.

## llama.cpp server

Example:

```bash
llama-server -m /path/to/model.gguf --host 0.0.0.0 --port 8084 -c 8192
```

Requirements:

- Reachable from your browser machine at the configured endpoint
- OpenAI-compatible **`POST /v1/chat/completions`** (llama.cpp server provides this)
- Optional: `GET /v1/models`, `GET /health`

No API key is required for a typical local setup.

### Firewall / LAN

- Bind with `--host 0.0.0.0` (not only `127.0.0.1`) if the browser runs on another device
- Allow TCP `8084` on the machine running llama.cpp

## Usage

1. Browse any page.
2. Open Lantern (toolbar icon).
3. Leave **Visible** on for page-aware answers; turn it off on sensitive sites.
4. Use quick actions, type a question, or highlight text and use the floating toolbar.
5. **Alt+L** on a selection also sends it to Lantern (via content script).

## Project layout

```
manifest.json
background/service-worker.js   # API calls, page extract, context menus
sidepanel/                     # Main Atlas-like chat UI
content/                       # Selection toolbar
newtab/                        # New tab page
options/                       # Settings
shared/                        # Defaults, storage, API client, markdown
icons/
```

## Settings reference

| Setting | Default |
|--------|---------|
| Endpoint | `http://192.168.1.129:8084` |
| Model | empty (server default) |
| Temperature | `0.7` |
| Max tokens | `2048` |
| Max page chars | `12000` |
| Stream | on |

## Privacy notes

- All inference goes to **your** llama.cpp host — nothing is sent to OpenAI.
- Page content is only included when the site is **Visible** and “Use page” is checked.
- Chat history is stored in `chrome.storage.local` per tab (capped).
- Optional “browser memories” stay local; off by default.

## Roadmap ideas

- [ ] Optional browser memories that auto-summarize visited pages
- [ ] Multi-tab context (“compare these tabs”)
- [ ] Lightweight agent mode (scripted clicks — careful, high risk)
- [ ] Firefox support
- [ ] Keyboard command palette

## License

MIT — use freely with your local models.
