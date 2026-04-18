# AI Codebase Navigator — Polyglot ML Backend (v0.0.2)

Welcome to the ML Backend of the **DEV_CLASH AI Source Code Navigator**! This is an industry-grade, local-first retrieval-augmented generation (RAG) and architectural mapping engine designed to analyze massive multi-language codebases natively.

## 🚀 Key Capabilities

### 1. Polyglot Architecture & AST Parsing
The backend utilizes a smart routing adapter to process code based on its language:
- **TypeScript & JavaScript**: Introspected directly in Node.js via `ts-morph` and native file walkers.
- **Java & Spring Boot**: Dynamically offloaded to our dedicated `java-backend` microservice which builds highly accurate Java AST dependency graphs using Qdox (extracting true Class/Method dependencies, not brittle regex guessing). The Node pipeline seamlessly re-syncs physical paths for LLM ingestion.

### 2. Fast Concurrent NLP Pipeline (Local AI)
Processes files across multiple workers (x8 concurrency) using Ollama's local `qwen2.5-coder:3b` model to generate rich 10-field component overviews spanning single-line responsibilities, architectural tier classification, internal invocation patterns, and software design patterns. Features strict timeout protections and token limit caps.

### 3. Bulletproof Vector Store with Fallbacks
Uses local dense vector storage via `nomic-embed-text` to retain comprehensive embeddings. 
- Searches utilize **Maximal Marginal Relevance (MMR)** algorithms to ensure retrieved context is diverse, avoiding near-duplicate hits.
- **Resilient Fallback**: If vector embeddings fail or models are un-pulled, the system gracefully degrades to a fast keyword matching search automatically.

### 4. Zero-Latency Caching & Per Repo State
Analyses instantly persist out as raw local telemetry right into every scanned repo’s `.dev-clash/` folder including:
- 120-dimension metadata mappings (`meta.json`)
- Deep semantic caching matrices (`cache.json`) 
- Serialized layout graphs & vectors (`graph.json`, `vectors.json`)
Results can be rehydrated for UI graph-rendering in sub-30ms.

### 5. Gemini Global Insight (Non-Fatal)
Aggregates the holistic metadata array and asks Anthropic/Gemini to deliver global analysis of risk constraints, system architecture, orphan tracking, and developer onboarding trajectories. If no API key is present, the local pipeline completes successfully anyway.

---

## 🛠️ API Endpoints

### 🩺 Health & Diagnosis
- **`GET /health`**: Standard fast boot check.
- **`GET /api/status`**: Exhaustive microservice topology status (checks Node pipeline states AND connectivity to the Java AST backend cluster).

### 📡 Pipeline Endpoints
- **`POST /api/analyze`**: Runs the live analysis pipeline via Server-Sent Events (SSE) streaming updates back to frontends. Maps directly to local folders or GitHub clones.
- **`POST /api/load`**: Re-hydrates an entire project context payload instantly from its native `.dev-clash/` directory.

### 🔍 Query Endpoints
- **`POST /api/query`**: Semantic code query via vectors + Keyword fallback. Provide a prompt string and receive relevant codebase context logic synthetically formatted via Gemini (or just semantic search matches if Gemini is off).
- **`POST /api/query/stream`**: Same as query, but streams LLM output over SSE. 
- **`GET /api/summary`**: Returns the global repository architecture JSON mapping. 
- **`GET /api/graph`**: Returns the latest live in-memory Graph node + edge mappings.

### 🗂️ Filesystem (IDE) Endpoints
- **`GET /api/fs/read`**: Returns raw physical file content text given a valid absolute path. Limits out at 5MB bounds to protect JSON transfer size crash points.
- **`GET /api/fs/list`**: Reconstructs physical directory nested hierarchy maps instantly. Sorts folders to the top automatically. 
- **`POST /api/fs/open`**: Invokes local OS bindings (`code`) to launch VSCode straight in front of the developer's eyes inside the local physical path. 

---

## 🧪 Testing

The backend ships with a hardcore **E2E Integration Test Suite** that is dependency-free (pure Node).
Run `node test-e2e.js` from the `backend/` folder.
* Currently passing: **22/22 Assertions** including full microservice state tests, edge casing, and SSE streaming pipeline resolution.

---

## 💻 Tech Stack
- **Node.js + Express** (Core orchestrator, pipelines, SSE streams)
- **Spring Boot + Qdox** (Dedicated Java AST Microservice)
- **Ollama / Qwen2.5 Coder 3B / Nomic-embed-text** (Local AI processing)
- **Google Generative AI (Gemini 1.5 Pro)** (Global synthetics - Optional)
- **TS-Morph** (JS/TS Analysis)
- Vector Storage: **In-Memory Dense Tensor Matcher with Cosine/MMR & Keyword Fallback**
