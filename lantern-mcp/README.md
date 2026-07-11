# lantern-mcp

MCP server that exposes **Lantern's browser automation** as MCP tools for any AI client — Claude Desktop, Cursor, VS Code, ChatGPT, etc.

## How it works

```
AI Client (Claude Desktop / Cursor / VS Code)
    ↕ MCP (stdio)
lantern-mcp (Node.js)
    ↕ WebSocket (localhost:9847)
Lantern Extension (Chrome)
    ↕ chrome.tabs.sendMessage
Content Script
    ↕ DOM
```

## Setup

### 1. Install dependencies

```bash
cd lantern-mcp
npm install
```

### 2. Make sure Lantern is loaded in Chrome

Load the `lantern/` directory as an unpacked extension (`chrome://extensions` → Load unpacked). The extension connects to `ws://localhost:9847` automatically on startup.

### 3. Run the MCP server

```bash
cd lantern-mcp
node index.js
```

Or install globally:

```bash
npm install -g .
lantern-mcp
```

### 4. Configure your AI client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lantern": {
      "command": "node",
      "args": ["/path/to/lantern/lantern-mcp/index.js"]
    }
  }
}
```

**Cursor** (Settings → MCP Servers):

```json
{
  "mcpServers": {
    "lantern": {
      "command": "node",
      "args": ["/path/to/lantern/lantern-mcp/index.js"]
    }
  }
}
```

**VS Code** (`.vscode/mcp.json` or settings):

```json
{
  "servers": {
    "lantern": {
      "command": "node",
      "args": ["/path/to/lantern/lantern-mcp/index.js"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `browser_snapshot` | Capture interactive elements with refs (e1, e2…) |
| `browser_get_page` | Get title, URL, and readable text |
| `browser_tabs_list` | List all open tabs |
| `browser_tabs_open` | Open a URL in a new background tab |
| `browser_tabs_switch` | Switch active tab by ID |
| `browser_navigate` | Navigate to URL, reload, back, forward |
| `browser_click` | Click element by ref |
| `browser_type` | Type text into element (or focused field) |
| `browser_press` | Press a key (Enter, Tab, Escape, etc.) |
| `browser_wait` | Wait ms before next action (max 8000) |
| `browser_find` | Find text on page with context snippets |

## Configuration

- `LANTERN_MCP_PORT` — WebSocket port (default: `9847`)

## Requirements

- Node.js 18+
- Chrome with Lantern extension loaded
