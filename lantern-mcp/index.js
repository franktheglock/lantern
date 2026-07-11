#!/usr/bin/env node

/**
 * lantern-mcp — MCP server that exposes Lantern's browser automation
 * as MCP tools for any AI client (Claude Desktop, Cursor, VS Code, etc.).
 *
 * How it works:
 *   1. Starts a WebSocket server on localhost:9847 (configurable via LANTERN_MCP_PORT)
 *   2. The Lantern Chrome extension connects to this WebSocket
 *   3. The MCP client (via stdio) calls browser tools
 *   4. This server forwards calls to the extension and returns results
 *
 * Usage:
 *   npx lantern-mcp
 *   LANTERN_MCP_PORT=9847 npx lantern-mcp
 *
 * MCP client config (Claude Desktop / Cursor / VS Code):
 *   {
 *     "mcpServers": {
 *       "lantern": {
 *         "command": "npx",
 *         "args": ["lantern-mcp"]
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebSocketServer } from "ws";

const PORT = parseInt(process.env.LANTERN_MCP_PORT || "9847", 10);

// ── WebSocket bridge to the Lantern extension ──────────────────────────

let extensionWs = null;
const pendingCalls = new Map();
let callIdSeq = 0;

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.error(`[lantern-mcp] ✅ Extension connected on ws://localhost:${PORT}`);
  extensionWs = ws;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "tool_result") {
      const pending = pendingCalls.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCalls.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(String(msg.error).slice(0, 500)));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  });

  ws.on("close", () => {
    console.error("[lantern-mcp] ❌ Extension disconnected");
    extensionWs = null;
    for (const [, pending] of pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Extension disconnected"));
    }
    pendingCalls.clear();
  });

  ws.on("error", (err) => {
    console.error("[lantern-mcp] WebSocket error:", err.message);
  });
});

wss.on("listening", () => {
  console.error(`[lantern-mcp] WebSocket server listening on ws://localhost:${PORT}`);
});

wss.on("error", (err) => {
  console.error("[lantern-mcp] WebSocket server error:", err.message);
  process.exit(1);
});

/**
 * Send a tool call to the connected Lantern extension and wait for the result.
 */
function callExtension(tool, args) {
  return new Promise((resolve, reject) => {
    if (!extensionWs) {
      return reject(
        new Error(
          "No Lantern extension connected. Open Chrome, make sure Lantern is loaded, then try again."
        )
      );
    }
    const id = `mcp-${++callIdSeq}`;
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`Tool '${tool}' timed out after 30s`));
    }, 30_000);

    pendingCalls.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });

    extensionWs.send(JSON.stringify({ type: "tool_call", id, tool, args }));
  });
}

// ── MCP tools ──────────────────────────────────────────────────────────

const server = new McpServer({
  name: "lantern-browser",
  version: "0.1.0",
});

// --- browser_snapshot ---
server.tool(
  "browser_snapshot",
  "Capture interactive elements on the active tab with short refs (e1, e2…). Call before click/type.",
  {},
  async () => {
    const result = await callExtension("browser_snapshot", {});
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_get_page ---
server.tool(
  "browser_get_page",
  "Get the title, URL, and readable text content of the active tab.",
  {},
  async () => {
    const result = await callExtension("browser_get_page", {});
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_tabs_list ---
server.tool(
  "browser_tabs_list",
  "List all open browser tabs with their IDs, titles, and URLs.",
  {},
  async () => {
    const result = await callExtension("browser_tabs_list", {});
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_tabs_open ---
server.tool(
  "browser_tabs_open",
  "Open a new tab with the given http(s) URL in the background.",
  {
    url: z.string().url().describe("http(s) URL to open"),
  },
  async ({ url }) => {
    const result = await callExtension("browser_tabs_open", { url });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_tabs_switch ---
server.tool(
  "browser_tabs_switch",
  "Switch the active target tab by ID from browser_tabs_list.",
  {
    tabId: z.number().int().describe("Tab ID from browser_tabs_list"),
  },
  async ({ tabId }) => {
    const result = await callExtension("browser_tabs_switch", { tabId });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_navigate ---
server.tool(
  "browser_navigate",
  "Navigate the active tab: go to a URL, reload, back, or forward.",
  {
    url: z.string().optional().describe("http(s) URL to navigate to"),
    action: z
      .enum(["goto", "reload", "back", "forward"])
      .optional()
      .describe("Navigation action (default: goto when url is set, reload otherwise)"),
  },
  async ({ url, action }) => {
    const result = await callExtension("browser_navigate", { url, action });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_click ---
server.tool(
  "browser_click",
  "Click an element by its ref (e1, e2…) from the latest browser_snapshot.",
  {
    ref: z.string().describe("Element ref (e.g. e1, e12) from browser_snapshot"),
  },
  async ({ ref }) => {
    const result = await callExtension("browser_click", { ref });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_type ---
server.tool(
  "browser_type",
  "Type text into an element by ref (or the currently focused field).",
  {
    ref: z.string().optional().describe("Element ref from browser_snapshot (optional, uses focused field if omitted)"),
    text: z.string().describe("Text to type"),
    clear: z.boolean().optional().describe("Clear the field before typing"),
  },
  async ({ ref, text, clear }) => {
    const result = await callExtension("browser_type", { ref, text, clear });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_press ---
server.tool(
  "browser_press",
  "Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.) on the focused element.",
  {
    key: z.string().describe("Key name (Enter, Tab, Escape, ArrowDown, ArrowUp, etc.)"),
  },
  async ({ key }) => {
    const result = await callExtension("browser_press", { key });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_wait ---
server.tool(
  "browser_wait",
  "Wait a short time (ms) before the next action. Useful after navigation or clicking elements that trigger transitions. Max 8000ms.",
  {
    ms: z
      .number()
      .int()
      .min(0)
      .max(8000)
      .default(500)
      .describe("Milliseconds to wait (max 8000)"),
  },
  async ({ ms }) => {
    const result = await callExtension("browser_wait", { ms });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- browser_find ---
server.tool(
  "browser_find",
  "Find text on the active tab. Returns snippets with surrounding context and element refs when matches fall inside interactive elements. Max 20 results.",
  {
    query: z.string().describe("Text to search for (case-insensitive)"),
  },
  async ({ query }) => {
    const result = await callExtension("browser_find", { query });
    return { content: [{ type: "text", text: result }] };
  }
);

// ── Start ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
