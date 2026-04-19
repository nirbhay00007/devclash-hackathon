# Connecting DEV_CLASH to Cursor IDE (MCP)

Cursor has native MCP support built in. Once configured, Cursor will automatically call DEV_CLASH tools before reading any file — giving it permanent, free, local codebase memory.

---

## Prerequisites

1. Cursor **v0.44+** installed (MCP support requires this version)
2. DEV_CLASH backend running: `npm start` in the `backend/` folder
3. Your repo has been analyzed: hit `POST http://localhost:3001/api/analyze`

---

## Setup (2 minutes)

### Step 1 — Open Cursor MCP settings

Press `Ctrl+Shift+P` → type **"MCP"** → select **"Open MCP Config"**

This opens `~/.cursor/mcp.json` (or `%APPDATA%\Cursor\mcp.json` on Windows).

### Step 2 — Add DEV_CLASH as an MCP server

```json
{
  "mcpServers": {
    "dev-clash-memory": {
      "command": "node",
      "args": ["C:/path/to/DEV_CLASH/setup/mcp-proxy.js"],
      "env": {
        "DEV_CLASH_URL": "http://localhost:3001"
      }
    }
  }
}
```

> **Replace** `C:/path/to/DEV_CLASH/` with the actual absolute path to this project folder.

### Step 3 — Restart Cursor

Close and reopen Cursor. In the bottom status bar you should see a **🔧 MCP** indicator showing `dev-clash-memory` as connected and green.

---

## How Cursor Uses DEV_CLASH

Once connected, Cursor's AI composer will automatically call DEV_CLASH tools when you ask questions about your codebase:

### Example session in Cursor Composer:

> **You:** "How do I add a new Owner entity field?"

> **Cursor (behind the scenes):**
> 1. Calls `search_codebase("add new Owner entity field")` on DEV_CLASH
> 2. Gets back in 50ms: `OwnerController.java`, `Owner.java`, `OwnerRepository.java` — pre-summarized
> 3. Answers using just those 3 file summaries (~250 tokens) instead of scanning the entire project

### Available tools in Cursor:

| Tool | When Cursor calls it |
|------|---------------------|
| `search_codebase` | Automatically on every code question |
| `get_architecture_summary` | When you ask "explain this codebase" |
| `get_file_context` | When you mention a specific file |
| `get_dependency_graph` | When you ask about imports or dependencies |

---

## Verifying It Works

In Cursor Composer, type:

```
/mcp describe dev-clash-memory
```

You should see the 4 DEV_CLASH tools listed. Then test it:

```
Search my codebase for: "login authentication flow"
```

If Cursor calls the `search_codebase` tool and returns results, the integration is working. 🎉

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| MCP indicator shows red | Check that `npm start` is running in `backend/` |
| Tools not appearing | Confirm `mcp.json` path is correct and Cursor is restarted |
| Empty results | Run `POST /api/analyze` on your project first |
| `node` not found | Use the full Node.js path, e.g. `C:/Program Files/nodejs/node.exe` |
