# CodeMap AI: Visualize the invisible

**Local AI · Zero Cloud · Full Privacy**

Transform complex codebases into interactive architectural maps. Understand dependencies, logic paths, and architectural intent — powered by local Ollama models and Gemini AI.

## 🚀 Features

- **Automated Dependency Mapping**: Trace import graphs automatically. Discover dead paths, critical execution loops, and fan-in/out metrics without manual stepping.
- **AI Intent Mapping**: Extract functional intent from legacy code blocks. Translate dense monoliths into readable domain concepts using local Ollama AI (Qwen2.5 Coder).
- **Dependency Risk Analysis**: Identify cyclical dependencies and high-risk modules. Visualize technical debt impact before refactoring.
- **Semantic RAG Search**: Ask questions in plain English. Vector search + Gemini AI returns exactly the files relevant to your task in milliseconds.
- **MCP Agent Integration**: Connect Claude Desktop, Cursor, or Antigravity. Your AI agent gets permanent codebase memory with ~90% fewer tokens.
- **Multi-Repo Merging**: Analyze frontend + backend + microservices simultaneously. Visualize cross-repository dependency relationships in one unified graph with an advanced radial cluster layout.

## 🏗️ Architecture

CodeMap AI consists of three core components running locally:
1. **Frontend (`frontend/`)**: A React 19 + Vite application using `@xyflow/react` and `@dagrejs/dagre` for the interactive node-based architecture graph.
2. **Backend Engine (`backend/`)**: A Node.js ML pipeline handling the Model Context Protocol (MCP) server, file orchestration, AST aggregation, and semantic embedding.
3. **Java AST Parser (`java-backend/`)**: A Spring Boot service using JavaParser to accurately extract class graphs and method-level symbols from Java repositories.

## ⚙️ Setup & Installation

CodeMap AI runs entirely on your local machine. Your code never leaves your device.

1. **Prerequisites**: 
   - Node.js 18+
   - Java 17+
   - [Ollama](https://ollama.ai) installed locally.

2. **Pull Required Local AI Models**:
   ```bash
   ollama pull qwen2.5-coder:3b
   ollama pull nomic-embed-text
   ```

3. **Start the Application**:
   We provide easy-to-use launch scripts that install dependencies and boot all three services simultaneously. Ensure you have an `.env` file with your `GEMINI_API_KEY` present.
   - On **Windows**: Run `start.bat`
   - On **Mac/Linux**: Run `./start.sh`

Navigate to `http://localhost:5173` to explore your codebase!

## 🤖 MCP Tool Integration
Configure your AI agent (Claude Desktop, Cursor IDE) with the native HTTP/MCP endpoints to give it full project memory. CodeMap AI exposes:
- `search_codebase`: Semantic search over all indexed files.
- `get_architecture_summary`: High-level repo overview & tech stack.
- `get_file_context`: AI summary for a file — cheaper than raw reads.
- `get_dependency_graph`: Fan-in/fan-out graph — who imports what.
- `update_file_context`: Re-embeds a file after editing, keeping memory fresh.
