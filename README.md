# DevClash AI: The Ultimate Codebase Architect 🚀

**Visualize the Invisible · Local AI Powered · Cross-Repo Intelligence**

DevClash AI transforms complex, multi-repository codebases into interactive, navigable architectural maps. Understand deep dependency chains, architectural intent, and cross-repo relationships in real-time — powered by local Ollama models and Gemini AI.

![Hero Showcase](https://via.placeholder.com/1200x600/1a1a1a/ffffff?text=DevClash+Architecture+Graph+v0.0.9)

## 🌟 Key Features (v0.0.9)

- **🔄 Multi-Repository Merging**: The first tool to visualize frontend, backend, and microservices in a single, unified radial cluster layout. Trace calls from a React frontend all the way to a Java Spring Boot backend.
- **🏠 100% Local Ingestion (Ollama)**: Phase 1 & 2 analysis (summarization and embedding) now runs entirely on your local GPU/CPU using `qwen2.5-coder` and `nomic-embed-text`. Zero API costs and total privacy for your source code.
- **🧠 Hybrid Semantic RAG**: Combining the speed of local vector search with the reasoning power of Gemini AI. Ask complex architectural questions and get synthesized, multi-file answers.
- **⚡ Hot-Reload Persistence**: The backend now automatically recovers its state on startup. Editing your environment variables or restarting the server no longer wipes your analysis.
- **🤖 MCP native Server**: Built-in Model Context Protocol support. Plug DevClash directly into **Cursor**, **Claude Desktop**, or **Antigravity** to give your AI agents permanent codebase memory with 90% fewer tokens.

## 🏗️ The Tech Stack

DevClash is built for scale and speed:
- **Frontend**: React 19, TypeScript, Vite, @xyflow/react (React Flow).
- **ML Backend**: Node.js, Express, Ollama (Local LLM), ChromaDB (Local Vector Store).
- **Core Parser**: Custom Java AST Parser (Spring Boot + JavaParser) & TypeScript AST Extraction.

## ⚙️ Quick Start

1. **Prerequisites**: 
   - Node.js 18+
   - Java 17+ (for Java repo support)
   - [Ollama](https://ollama.ai) installed.

2. **Setup AI Models**:
   ```bash
   ollama pull qwen2.5-coder:3b
   ollama pull nomic-embed-text
   ```

3. **Launch**:
   - **Windows**: Run `start.bat`
   - **Mac/Linux**: Run `./start.sh`

Navigate to `http://localhost:5173` to begin your architectural journey.

## 🤝 Contribution & License

Created for the **DevClash Hackathon 2024**. 

**Default Branch**: `end-of-hackathon`
**Version**: `v0.0.9`

---
*Built with ❤️ by the DevClash Team (Nirbhay Langote & Antigravity AI)*
