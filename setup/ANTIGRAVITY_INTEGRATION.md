# Connecting DEV_CLASH to Antigravity (AI Coding Assistant)

Antigravity is the AI coding assistant built into your IDE. When working on a project that has been analyzed by DEV_CLASH, you can give Antigravity instant access to your entire local codebase index using a simple system prompt injection — **zero token waste, zero re-reading files**.

---

## How It Works

Normally, when you ask Antigravity to fix a bug or add a feature, it has to read raw source files to understand the codebase. For a 500-file project, this burns 300,000+ tokens per session.

With DEV_CLASH connected:

```
You ask Antigravity a question
         ↓
Antigravity hits POST /api/agent-sync with your task
         ↓
DEV_CLASH returns 6 pre-summarized file contexts (50ms, FREE, local)
         ↓
Antigravity answers using ~300 tokens instead of 300,000
         ↓
You save ~99% of your token budget every session
```

---

## Setup — Method 1: Session Prompt (Quickest)

At the start of any coding session, paste this as your **first message** to Antigravity:

```
My DEV_CLASH local AI memory layer is running at http://localhost:3001.

Before reading any source file, always call this endpoint first to get 
pre-summarized context for exactly the files you need:

  POST http://localhost:3001/api/agent-sync
  Content-Type: application/json
  Body: { "task": "<describe what you need to do>" }

The response contains `optimized_prompt_context` — a compressed Markdown 
summary of the most relevant files. Use this instead of reading raw files.

For deeper info on a specific file:
  POST http://localhost:3001/api/query
  Body: { "query": "<filename or description>" }

For the full repo architecture map:
  GET http://localhost:3001/api/summary

The backend has already analyzed this project. Start by calling 
/api/agent-sync with a description of what we're working on today.
```

---

## Setup — Method 2: `.antigravity` Config File (Persistent)

Create a file called `.antigravity` in your project root. Antigravity reads this automatically at session start:

```markdown
# DEV_CLASH Memory Layer Configuration

This project uses DEV_CLASH for local AI codebase memory.
Backend URL: http://localhost:3001

## Rules for this project:
1. ALWAYS call POST /api/agent-sync before reading any source file
2. Use the returned `optimized_prompt_context` as your primary context source
3. Only read raw files if you need line-level precision for an edit
4. Call GET /api/summary for architecture overview when starting a new feature

## Quick reference:
- Search:       POST /api/agent-sync     { task: string }
- Deep query:   POST /api/query          { query: string }
- Graph data:   GET  /api/graph
- Architecture: GET  /api/summary
- Read file:    GET  /api/fs/read?path=<absolute_path>
```

---

## Setup — Method 3: MCP Protocol (Most Powerful)

If your version of Antigravity supports MCP (Model Context Protocol), add these lines to your IDE's MCP config:

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

With MCP enabled, Antigravity automatically calls DEV_CLASH tools with zero manual prompting. It gains 4 native tools:

| Tool | Called automatically when... |
|------|------------------------------|
| `search_codebase` | You ask anything about the codebase |
| `get_architecture_summary` | You start a new feature or ask for an overview |
| `get_file_context` | You mention a specific filename |
| `get_dependency_graph` | You ask about imports, dependencies, or callers |

---

## Example: Optimized Session with Antigravity

### Without DEV_CLASH (expensive):
```
You: "Fix the bug in the PetClinic owner form validation"
Antigravity: [reads 47 Java files — costs 150,000 tokens]
Antigravity: "The issue is in OwnerController.java line 42..."
```

### With DEV_CLASH (efficient):
```
You: "Fix the bug in the PetClinic owner form validation"
Antigravity: [calls /api/agent-sync "fix owner form validation" — 50ms, free]
DEV_CLASH returns: OwnerController.java, OwnerValidator.java, OwnerForm.java summaries
Antigravity: "Based on the local index, OwnerController.java handles validation 
              at the route level. Let me read just that file..."
Antigravity: [reads ONLY OwnerController.java — costs 800 tokens]
Antigravity: "The issue is on line 42..."
```

**Token reduction: ~99.5%** on a 47-file Java project.

---

## Live API Test

Run this in your terminal to verify DEV_CLASH is ready:

```powershell
# Windows PowerShell
$body = '{"task": "How does authentication work in this project?"}'
Invoke-RestMethod -Uri "http://localhost:3001/api/agent-sync" `
  -Method POST -ContentType "application/json" -Body $body |
  Select-Object -ExpandProperty optimized_prompt_context
```

```bash
# Mac / Linux / Git Bash
curl -s -X POST http://localhost:3001/api/agent-sync \
  -H "Content-Type: application/json" \
  -d '{"task": "How does authentication work in this project?"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['optimized_prompt_context'])"
```

If you see pre-summarized Markdown output, DEV_CLASH memory is active and ready. ✅

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `/api/agent-sync` returns 404 | Run `npm start` in `backend/` first |
| Empty `optimized_prompt_context` | Analyze your repo first: `POST /api/analyze { "targetPath": "/your/repo" }` |
| Backend not reachable | Check port 3001 is free and the server started successfully |
| Ollama models not found | Run `setup/setup.bat` (Windows) or `setup/setup.sh` (Mac/Linux) |
