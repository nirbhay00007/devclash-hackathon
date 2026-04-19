# CodeMap AI — Codebase Intelligence Platform

> **Transform any repository into an interactive architectural map, powered by local AI.**  
> Zero cloud. Full privacy. Production-grade analysis in minutes.

---

## Table of Contents

- [What Is CodeMap AI?](#what-is-codemap-ai)
- [Architecture Overview](#architecture-overview)
- [How It Works — The Pipeline](#how-it-works--the-pipeline)
- [AI Model Summary](#ai-model-summary)
- [Data Flow & MCP Integration](#data-flow--mcp-integration)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [API Reference](#api-reference)
- [Frontend Structure](#frontend-structure)
- [Performance & Scaling](#performance--scaling)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## What Is CodeMap AI?

CodeMap AI is an **AI-powered codebase navigator** that gives engineering teams instant architectural visibility into any repository. It:

1. **Parses** your source files using AST extraction (TypeScript/JavaScript via ts-morph, Java via a Spring Boot microservice)
2. **Summarizes** every file using a **local Ollama AI model** (no data leaves your machine)
3. **Embeds** those summaries into an in-memory **vector store** for semantic search
4. **Synthesizes** a holistic **Gemini architectural report** covering purpose, subsystems, risks, and onboarding path
5. **Renders** everything as an **interactive ReactFlow dependency graph** with cross-repo edge visualization

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND  :5173                           │
│  React + ReactFlow + Vite                                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐    │
│  │  Home/Hero   │  │  Repositories  │  │  Graph Canvas    │    │
│  │  Landing     │  │  ScanViz SSE   │  │  ArchitectureG.  │    │
│  └──────────────┘  └────────────────┘  └──────────────────┘    │
│  ┌──────────────┐  ┌────────────────┐                           │
│  │  Query Chat  │  │  Setup & MCP   │                           │
│  │  (RAG + AI)  │  │  Config Panel  │                           │
│  └──────────────┘  └────────────────┘                           │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP / SSE / JSON-RPC
┌────────────────────────▼────────────────────────────────────────┐
│                    NODE ML BACKEND  :3001                        │
│  Express + TypeScript                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  /api/      │  │ Vector Store │  │  Gemini Intelligence  │  │
│  │  analyze    │  │ (in-memory)  │  │  (global summary +    │  │
│  │  (SSE pipe) │  │              │  │   RAG query)          │  │
│  └─────────────┘  └──────────────┘  └──────────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  /api/query │  │  Graph Store │  │  MCP Server          │  │
│  │  (RAG)      │  │  (in-memory) │  │  (JSON-RPC 2.0)      │  │
│  └─────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP + local exec
         ┌───────────────┴──────────────────┐
         │                                  │
┌────────▼────────┐              ┌──────────▼──────────┐
│  Ollama  :11434 │              │  Java AST  :8080     │
│  (local LLM)    │              │  Spring Boot         │
│  File summaries │              │  Class-level graph   │
└─────────────────┘              └─────────────────────┘
```

---

## How It Works — The Pipeline

When you click **Run All**, the backend processes your repository through 6 sequential phases:

| Phase | Name | What Happens | Est. Time |
|-------|------|-------------|-----------|
| 0 | **Resolve** | Clone GitHub URL or validate local path. Detect language (TS/JS/Java). | 5–60s |
| 1 | **Parse** | Extract AST dependency graph. ts-morph for TS/JS; Spring Boot for Java. | 1–5s |
| 2 | **Summarize** | Call Ollama `codellama` for every source file, 4 parallel workers. | ~3s/file |
| 3 | **Embed** | Build composite text and store in-memory vector index (cosine sim). | ~0.5s/file |
| 4 | **Metrics** | Compute fan-in/fan-out, orphan detection, risk scoring per node. | <1s |
| 5 | **Persist** | Write graph + vectors to `.dev-clash/` cache folder inside repo. | <1s |
| 6 | **Gemini** | Send all summaries to Gemini 2.0 Flash for holistic architectural report. | 5–15s |

**Progress bar math:**  
- Phase 0–1 → 0–20%  
- Phase 2–3 → 20–78% (proportional to file count)  
- Phase 4–5 → 78–85%  
- Phase 6 (Gemini) → 85–100%

---

## AI Model Summary

| Model | Role | Where It Runs | Token Load |
|-------|------|---------------|------------|
| **Ollama (codellama/mistral)** | Per-file code summarization | **Local machine** | ~800–1200 tokens/file |
| **Gemini 2.0 Flash** | Holistic architectural report + RAG query answers | Google API (cloud) | ~8k–32k tokens/repo |

**Typical resource usage (30-file repo):**
- Ollama RAM: ~4–8 GB VRAM (GPU) or 6–12 GB RAM (CPU)
- Gemini tokens consumed per full scan: ~15,000–40,000 input tokens
- Gemini tokens consumed per query: ~3,000–8,000 input tokens
- Total scan time on GPU: ~2–4 minutes
- Total scan time on CPU: ~8–20 minutes

**Vector search** uses cosine similarity on TF-IDF-style composite embeddings generated locally through Ollama output — no external embedding API required.

---

## Data Flow & MCP Integration

### Standard Query Flow

```
User types query
    │
    ▼
POST /api/query
    │
    ├── semanticSearch(query, top-8) → local vector index
    │       └── cosine similarity → ranked files
    │
    ├── buildSubGraph(results) → picks node metadata from graph store
    │
    └── askGeminiArchitect(subGraph, query, apiKey?)
            └── Gemini 2.0 Flash → JSON { explanation, recommendations, learningPath }
                        │
                        ▼
                Frontend chat bubble
```

### MCP Integration (Claude Desktop / Cursor)

The backend implements **Model Context Protocol (MCP) JSON-RPC 2.0** natively at `POST /api/mcp`.

**Supported tools:**

| Tool | Description |
|------|-------------|
| `search_codebase` | Semantic search returning pre-summarized markdown context block |
| `get_architecture_summary` | Full Gemini architectural report as structured markdown |
| `get_file_context` | Deep context for a specific file path |
| `update_file_context` | Incremental sync after file edit |

**MCP config for Claude Desktop** (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "codemap-ai": {
      "url": "http://localhost:3001/api/mcp",
      "transport": "http"
    }
  }
}
```

**How much does MCP reduce token cost?**  
Instead of pasting 50 raw files into your prompt (~200k tokens), MCP returns pre-summarized context for the top 6–8 relevant files (~3k–8k tokens). **Estimated 90–96% token reduction** for typical architectural queries.

---

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 18 | For ML backend + frontend |
| npm | ≥ 9 | Package manager |
| Java JDK | ≥ 17 | For Java AST backend |
| Maven | ≥ 3.8 | Java build tool |
| Ollama | Latest | Local LLM runtime |
| Git | Any | For GitHub repo cloning |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/codemap-ai.git
cd codemap-ai

# 2. Pull the Ollama model (one-time, ~4GB download)
ollama pull codellama
# or: ollama pull mistral

# 3. Install all dependencies
npm install          # root (if applicable)
cd backend && npm install
cd ../frontend_merged && npm install

# 4. Configure environment
cd ../backend
cp .env.example .env
# Edit .env and add GEMINI_API_KEY

# 5. Start everything
cd ..
.\start.bat          # Windows
# or: ./start.sh    # Linux/macOS
```

### One-Command Start

The `start.bat` script launches all three services in sequence:
1. **Java AST Backend** on port `8080`
2. **Node ML Backend** on port `3001`
3. **React Frontend** on port `5173`

Open `http://localhost:5173` in your browser.

---

## Environment Configuration

**`backend/.env`**

```env
PORT=3001
JAVA_BACKEND_PORT=8080

# Gemini API Key — required for architectural summaries and RAG queries
# Get yours free at: https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_key_here

# Ollama base URL (default: local)
OLLAMA_BASE_URL=http://localhost:11434
```

> **Note:** If the backend starts without a `GEMINI_API_KEY`, the pipeline still completes using only local Ollama AI. Gemini phases are **non-blocking** — you'll see a warning in the log but the graph, vectors, and search still work.

---

## API Reference

### Core Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Basic health check |
| `GET` | `/api/status` | — | Node + Java backend health + latency |
| `POST` | `/api/analyze` | `{ targetPath?, repoUrl?, repoId?, repoLabel? }` | Start full analysis pipeline (SSE stream) |
| `GET` | `/api/graph` | — | Current in-memory graph snapshot |
| `GET` | `/api/summary` | — | Gemini architectural summary |
| `POST` | `/api/summary/generate` | `{ apiKey? }` | Force-generate summary from existing graph |
| `POST` | `/api/load` | `{ targetPath }` | Reload from `.dev-clash/` cache (instant) |
| `POST` | `/api/query` | `{ query, maxResults?, apiKey? }` | Semantic search + Gemini RAG |
| `POST` | `/api/query/stream` | `{ query, maxResults?, apiKey? }` | Same, streamed over SSE |

### Agent & MCP Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/mcp` | JSON-RPC 2.0 | Full MCP protocol endpoint |
| `POST` | `/api/agent-sync` | `{ task, maxResults? }` | HTTP bridge for any AI agent |
| `POST` | `/api/notify-changes` | `{ files: string[] }` | Incremental memory sync |

### Filesystem Endpoints

| Method | Path | Query/Body | Description |
|--------|------|-----------|-------------|
| `GET` | `/api/fs/read` | `?path=...` | Read raw file content (max 5MB) |
| `GET` | `/api/fs/list` | `?path=...` | List directory contents |
| `POST` | `/api/fs/open` | `{ path }` | Open in VS Code / default app |

---

## Frontend Structure

```
frontend_merged/src/
├── App.tsx                    # Root app shell, state management, routing
├── index.css                  # Design system: tokens, components, utilities
├── components/
│   ├── ArchitectureGraph.tsx  # ReactFlow graph, node click, edge coloring, minimap
│   ├── ScanVisualizer.tsx     # Live scan progress UI with circular ring + log
│   ├── NodeDetailPanel.tsx    # Right-slide panel on node click
│   ├── CustomNode.tsx         # Styled ReactFlow node renderer
│   ├── SetupPage.tsx          # MCP config, agent setup, API key UI
│   └── SetupPanel.tsx         # Alternative setup panel variant
```

### Key State Architecture

```
App.tsx
├── repos[]             RepoEntry[]     — per-repo: nodes, edges, log, progress, summary
├── mergedNodes         BackendNode[]   — flat union of all repo nodes
├── mergedEdges         BackendEdge[]   — flat union of all repo edges  
├── messages            ChatMessage[]   — query chat history
├── apiKey              string          — Gemini override key (runtime only)
├── graphFilterRepoId   string|null     — filter graph to single repo
└── activeTab           AppTab          — navigation state
```

### Edge Color Legend

| Color | Meaning |
|-------|---------|
| 🟠 Orange (`#f97316`) | Cross-repository dependency |
| ⚫ Gray (`#94a3b8`) | Normal intra-repo dependency |
| 🔵 Blue dashed | Selected node's immediate edges (interactive) |

### MiniMap Node Colors

| Color | Priority | Meaning |
|-------|----------|---------|
| 🟣 Purple | 1 (highest) | Orphan node (no in/out edges) |
| 🔵 Blue | 2 | Entry point |
| 🔴 Red | 3 | High-risk file |
| 🟡 Amber | 4 | Medium-risk file |
| Repo color | 5 | Standard node (grouped by repo) |
| 🟢 Green | 6 | Default |

---

## Performance & Scaling

| Repo Size | Estimated Scan Time | Gemini Tokens |
|-----------|--------------------|-|  
| 1–10 files | 30–90 seconds | ~5k |
| 10–50 files | 2–6 minutes | ~15k–40k |
| 50–150 files | 8–20 minutes | ~40k–120k |
| 150+ files | 25–60+ minutes | Recommend batching |

**Tips to speed up analysis:**
- Run Ollama with GPU acceleration (set in `~/.ollama/settings.json`)
- Use `mistral` model instead of `codellama` for 2x faster summarization
- Increase `CONCURRENCY` constant in `backend/src/core/pipeline.ts` (default: 4) on machines with >8 cores
- Use the `.dev-clash/` cache — re-running `POST /api/load` reloads from disk in <1 second

---

## Known Limitations

| Issue | Workaround |
|-------|-----------|
| Gemini API key missing at startup | Use the "Generate Summary" button in Query tab, or add key to `.env` and restart |
| Large repos (>100 files) may hit Gemini token limits | Analysis succeeds; Gemini summary phase may fail gracefully |
| Java repos require Spring Boot AST backend on port 8080 | Backend auto-falls back to file-level scan if Java backend is offline |
| `net::ERR_CONNECTION_REFUSED` in console | Harmless — frontend pings Ollama for health status; safe to ignore |
| File count shows `/1` during early scan | Dynamic — updates as SSE stream reports `total` field from pipeline |

---

## Roadmap

- [ ] **Persistent sessions** — Save graph layout and chat history in `localStorage`
- [ ] **Git blame integration** — Show author + commit frequency heatmap on nodes  
- [ ] **Diff analysis** — Incremental re-analysis on file save (chokidar watcher)
- [ ] **Python/Go support** — Extend AST parser to additional languages
- [ ] **Multi-model support** — Switch between Ollama model variants in UI
- [ ] **Export as PNG/SVG** — Download graph as image for documentation
- [ ] **Team mode** — Shared backend with authentication for engineering teams

---

## License

MIT License © 2024 DevClash Hackathon Team

---

*Built with ❤️ during DevClash Hackathon v0.0.6*
