# Connecting DEV_CLASH to Claude Desktop (MCP)

This guide integrates DEV_CLASH as a **permanent, free memory layer** for Claude Desktop using the Model Context Protocol (MCP). Once connected, Claude will automatically query your local codebase index before reading any files — saving you thousands of tokens per session.

---

## How It Works

```
You type a question in Claude Desktop
         ↓
Claude calls dev-clash MCP tool: search_codebase("fix login bug")
         ↓
DEV_CLASH queries local Ollama nomic-embed-text vectors (50ms, FREE)
         ↓
Returns 6 pre-summarized file contexts (~200 tokens total)
         ↓
Claude answers intelligently using only 200 tokens, not 500,000
```

**Token savings per session: ~95%** on large codebases.

---

## Prerequisites

1. DEV_CLASH backend is running: `npm start` (port 3001)
2. The repository you want to work on has been analyzed:
   - Hit `POST http://localhost:3001/api/analyze` with `{ "targetPath": "/your/repo" }`
   - Or use the DEV_CLASH web UI
3. Claude Desktop is installed: https://claude.ai/download

---

## Setup (2-minute install)

### Step 1 — Open Claude Desktop config

| OS      | Config file location |
|---------|----------------------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux   | `~/.config/Claude/claude_desktop_config.json` |

### Step 2 — Add DEV_CLASH as an MCP server

Open the config file and add the `mcpServers` block:

```json
{
  "mcpServers": {
    "dev-clash-memory": {
      "command": "node",
      "args": [
        "C:/path/to/DEV_CLASH/setup/mcp-proxy.js"
      ],
      "env": {
        "DEV_CLASH_URL": "http://localhost:3001"
      }
    }
  }
}
```

> **Replace** `C:/path/to/DEV_CLASH/` with the actual path to this project.

### Step 3 — Create the MCP proxy (one-time)

Create `setup/mcp-proxy.js` (we provide this — see next section). This tiny Node.js file bridges Claude's stdio MCP transport to our HTTP `/api/mcp` endpoint.

### Step 4 — Restart Claude Desktop

Close and reopen Claude Desktop. You should now see a "🔧 dev-clash-memory" tool available in the tool selector.

---

## Available Tools in Claude Desktop

Once connected, Claude has access to 4 tools it can call automatically:

| Tool | What it does |
|------|-------------|
| `search_codebase` | Semantic search for relevant files by task description |
| `get_architecture_summary` | Returns full repo structure overview |
| `get_file_context` | Returns AI-generated summary + metadata for a specific file |
| `get_dependency_graph` | Shows what a file imports and what imports it |

### Example Interaction

> **You:** "How do I add a new pet type to the PetClinic app?"

> **Claude (behind the scenes):** Calls `search_codebase("add new pet type petclinic")`

> **DEV_CLASH responds with:**
> ```
> ## [1/6] PetType.java — Handles pet type entity definitions
> ## [2/6] PetController.java — Manages HTTP routing for pet operations
> ## [3/6] PetRepository.java — Database layer for pet persistence
> ...
> ```

> **Claude (to you):** "To add a new pet type, you'll need to modify `PetType.java` to add the enum value, then update `PetController.java` route `/pets/types` to include your new type..."

All with only ~200 tokens burned instead of 200,000. 🚀

---

## Using the HTTP Bridge (Other Agents)

For **Cursor, Devin, custom scripts, or any non-MCP agent**, use the HTTP endpoint directly:

```bash
# Request
curl -X POST http://localhost:3001/api/agent-sync \
  -H "Content-Type: application/json" \
  -d '{"task": "Fix the authentication token expiry bug"}'

# Response includes optimized_prompt_context ready to inject
```

Then prepend the `optimized_prompt_context` to your agent's system prompt or user message.

---

## Using with Antigravity (This AI)

Since Antigravity has browser access, it can directly query your DEV_CLASH backend when you are working on this project:

1. Keep `npm start` running in the background
2. Paste this at the start of any coding session:
   > "My DEV_CLASH backend is running at localhost:3001. To understand my codebase, query `POST /api/agent-sync` with the task you need context for before making changes."

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Tool doesn't appear in Claude Desktop | Restart Claude Desktop, check config JSON syntax |
| `search_codebase` returns empty | Run `POST /api/analyze` on your repo first |
| Models not found | Run `setup/setup.bat` (Windows) or `setup/setup.sh` (Mac/Linux) |
| Port 3001 not reachable | `npm start` in the `backend/` directory |
