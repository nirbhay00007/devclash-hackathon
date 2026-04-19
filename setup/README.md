# DEV_CLASH — Setup & Integration Hub

Welcome! This folder contains everything needed to install DEV_CLASH locally and connect it to your AI coding assistant.

---

## 🚀 Step 1: One-Click Install

Run the script for your operating system from this folder:

| OS | Command |
|----|---------|
| **Windows** | Double-click `setup.bat` or run it in a terminal |
| **Mac / Linux** | `chmod +x setup.sh && ./setup.sh` |

The installer will:
- ✅ Check Node.js is installed
- ✅ Install Ollama (the local AI runtime) automatically
- ✅ Pull `qwen2.5-coder:3b` — code summarization model
- ✅ Pull `nomic-embed-text` — semantic embedding model  
- ✅ Install Node.js backend dependencies
- ✅ Configure your `.env` file
- ✅ Optionally start the backend immediately

After setup, the backend runs at **`http://localhost:3001`**.

---

## 🤖 Step 2: Connect Your AI Assistant

Pick your AI coding tool and follow the matching guide:

| Tool | Guide | Method |
|------|-------|--------|
| **Claude Desktop** | [CLAUDE_INTEGRATION.md](./CLAUDE_INTEGRATION.md) | MCP (native) |
| **Cursor IDE** | [CURSOR_INTEGRATION.md](./CURSOR_INTEGRATION.md) | MCP (native) |
| **Antigravity** | [ANTIGRAVITY_INTEGRATION.md](./ANTIGRAVITY_INTEGRATION.md) | MCP / HTTP / Prompt |
| **Custom agent / script** | Use `POST /api/agent-sync` directly | HTTP REST |

---

## ⚡ How Much Faster Is It?

| Project Size | Without DEV_CLASH | With DEV_CLASH | Savings |
|-------------|-------------------|----------------|---------|
| 50 files | ~60,000 tokens/session | ~400 tokens | **99%** |
| 200 files | ~250,000 tokens/session | ~800 tokens | **99.7%** |
| 1,000 files | ~1,200,000 tokens/session | ~1,600 tokens | **99.9%** |

Token savings come from replacing raw file reading with pre-computed AI summaries stored locally via Ollama.

---

## 🔌 API Quick Reference

Once the backend is running (`npm start` in `backend/`):

```
POST /api/analyze       → Index a codebase (targetPath or repoUrl)
GET  /api/graph         → Get node + edge graph data
GET  /api/summary       → Global Gemini architectural summary
POST /api/query         → Semantic search with Gemini RAG
POST /api/agent-sync    → HTTP bridge for any AI agent (returns prompt-ready context)
POST /api/mcp           → Full MCP JSON-RPC 2.0 endpoint (Claude Desktop, Cursor)
GET  /health            → Server health check
GET  /api/status        → Full microservice status
```

---

## 📦 What's in This Folder

```
setup/
├── setup.bat                  ← Windows one-click installer
├── setup.sh                   ← Mac/Linux one-click installer
├── mcp-proxy.js               ← MCP stdio↔HTTP bridge (auto-used by Claude/Cursor)
├── CLAUDE_INTEGRATION.md      ← Claude Desktop setup guide
├── CURSOR_INTEGRATION.md      ← Cursor IDE setup guide
├── ANTIGRAVITY_INTEGRATION.md ← Antigravity setup guide
└── README.md                  ← This file
```
