# AI Codebase Navigator — ML Backend

Welcome to the ML Backend of the **DEV_CLASH AI Source Code Navigator**! This is an industry-grade, local-first retrieval-augmented generation (RAG) and architectural mapping engine designed to analyze massive codebases natively.

## 🚀 Key Capabilities

### 1. Robust AST Code Extraction
Utilizes advanced `ts-morph` and custom Native Node.js `fs` file walkers to instantly ingest TypeScript, JavaScript, and TSX/JSX projects without brittle file-extension blindspots.

### 2. Fast Concurrent NLP Pipeline
Processes files across multiple workers using Ollama's local `qwen2.5-coder:3b` model to generate rich 10-field component overviews spanning single-line responsibilities, architectural tier classification, internal invocation patterns, and software design patterns.

### 3. Infinite Memory via Vector Store with MMR
Uses local dense vector storage via `nomic-embed-text` to retain comprehensive embeddings. Searches are orchestrated using Maximal Marginal Relevance (MMR) algorithms to ensure the system retrieves diverse architectural elements, avoiding duplicate matches.

### 4. Zero-Latency Caching & Per Repo State
Analyses instantly persist out as raw local telemetry right into every scanned repo’s `.dev-clash/` folder including:
- 120-dimension metadata mappings (`meta.json`)
- Deep semantic caching matrices (`cache.json`) 
- Serialized layout graphs & vectors (`graph.json`, `vectors.json`)
Results can be rehydrated for UI graph-rendering in sub-30ms.

### 5. Gemini Global Insight
Aggregates the holistic metadata array and asks Anthropic/Gemini to deliver global analysis of risk constraints, system architecture, orphan tracking, and developer onboarding trajectories.

---

## 🛠️ API Endpoints

### 📡 Pipeline Endpoints
- **`POST /api/analyze`**: Runs the live analysis pipeline via Server-Sent Events (SSE) streaming updates back to frontends.
- **`POST /api/load`**: Re-hydrates an entire project context payload instantly from its native `.dev-clash/` directory. Sub-30ms execution.

### 🔍 Query Endpoints
- **`POST /api/query`**: Semantic code query via LLMs. Provide a prompt string and receive relevant codebase context logic synthetically formatted via Gemini.
- **`POST /api/query/stream`**: Same as query, but streams output over SSE. 
- **`GET /api/summary`**: Returns global repository architecture JSON mapping. 

### 🗂️ Filesystem (IDE) Endpoints
- **`GET /api/fs/read`**: Returns raw physical file content text given a valid absolute path. Limits out at 5MB bounds to protect JSON transfer size crash points.
- **`GET /api/fs/list`**: Reconstructs physical directory nested hierarchy maps instantly. Sorts folders to the top automatically. 
- **`POST /api/fs/open`**: Invokes local OS bindings (`code`) to launch VSCode straight in front of the developer's eyes inside the local physical path. 

---

## 💻 Tech Stack
- **Node.js + TSX + Express**
- **Ollama / Qwen2.5 Coder 3B / Nomic-embed-text**
- **Google Generative AI (Gemini 1.5 Pro)**
- **TS-Morph** 
- Vector Storage: **In-Memory Dense Tensor Matcher with Cosine/MMR**
