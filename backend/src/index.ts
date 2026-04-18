import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { runIngestionPipeline, getLastGlobalSummary, isPipelineRunning, PipelineOptions } from './core/pipeline';
import { globalGraph } from './storage/graphStore';
import { semanticSearch, initVectorStore } from './storage/vectorStore';
import { askGeminiArchitect } from './ai/geminiIntelligence';
import { initStore } from './storage/persistentStore';
import { isJavaBackendAlive } from './core/javaBackendClient';
import { MCP_TOOLS, executeMcpTool } from './mcp/mcpServer';

dotenv.config();

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// ─── Health Check ───────────────────────────────────────────────────

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── GET /api/status ───────────────────────────────────────────────────
// Reports health of both microservices (Node ML + Java AST backend).

app.get('/api/status', async (_req, res) => {
    const javaAlive = await isJavaBackendAlive();
    res.json({
        nodeBackend:  { status: 'ok',                    port: process.env.PORT ?? 3001 },
        javaBackend:  { status: javaAlive ? 'ok' : 'offline', port: process.env.JAVA_BACKEND_PORT ?? 8080 },
        pipelineRunning: isPipelineRunning(),
        timestamp: new Date().toISOString(),
    });
});

// ─── POST /api/analyze ───────────────────────────────────────────────────
// Accepts:
//   { targetPath: string }  — local TS/JS repo scan
//   { repoUrl: string }     — GitHub Java repo (clones via Spring Boot)

app.post('/api/analyze', async (req, res) => {
    if (isPipelineRunning()) {
        return res.status(409).json({ error: 'Pipeline is already running. Please wait.' });
    }

    // Guard: Express 5 body-parser may leave req.body undefined on Content-Type mismatch
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body must be JSON with "targetPath" or "repoUrl".' });
    }

    let { targetPath, repoUrl, language } = req.body as { targetPath?: string; repoUrl?: string; language?: string };

    // Graceful fallback: If the frontend sends a URL inside targetPath, intercept it
    if (targetPath && typeof targetPath === 'string') {
        const cleaned = targetPath.trim();
        if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
            repoUrl = cleaned;
            targetPath = undefined;
        } else {
            targetPath = cleaned;
        }
    }

    if (!targetPath && !repoUrl) {
        return res.status(400).json({
            error: 'Provide either "targetPath" (local repo) or "repoUrl" (GitHub Java repo).',
        });
    }

    const options: PipelineOptions = {
        targetPath: targetPath ? path.resolve(targetPath) : undefined,
        repoUrl:    repoUrl   ?? undefined,
        language:   (language as PipelineOptions['language']) ?? 'auto',
    };

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        await runIngestionPipeline(options, res);

        const graphData    = globalGraph.exportForReactFlow();
        const globalSummary = getLastGlobalSummary();

        res.write(`data: ${JSON.stringify({
            phase: 'result',
            graph: graphData,
            globalSummary,
        })}\n\n`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[API /api/analyze] Error:', msg);
        res.write(`data: ${JSON.stringify({ phase: 'error', message: msg })}\n\n`);
    } finally {
        res.end();
    }
});

// ─── GET /api/graph ────────────────────────────────────────────────────────────
// Returns the current in-memory graph (for polling if SSE isn't desired).

app.get('/api/graph', (_req, res) => {
    const nodes = globalGraph.getAllNodes();
    if (nodes.length === 0) {
        return res.status(404).json({ error: 'No graph data available. Run /api/analyze first.' });
    }
    res.json({ success: true, data: globalGraph.exportForReactFlow() });
});

// ─── GET /api/summary ─────────────────────────────────────────────────────────
// Returns the Gemini-generated global repository summary.

app.get('/api/summary', (_req, res) => {
    const summary = getLastGlobalSummary();
    if (!summary) {
        return res.status(404).json({ error: 'No summary available. Run /api/analyze first.' });
    }
    res.json({ success: true, data: summary });
});

// ─── POST /api/load ───────────────────────────────────────────────────────────
// Reload a previously analyzed repo directly from its .dev-clash/ cache.
// Instant — no Ollama or Gemini calls needed.
// Body: { targetPath: string }

app.post('/api/load', async (req, res) => {
    const { targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'targetPath is required.' });

    try {
        const store = initStore(path.resolve(targetPath));
        const persistedGraph = store.loadGraph();
        const persistedVectors = store.loadVectors();
        const meta = store.loadMeta();

        if (!persistedGraph) {
            return res.status(404).json({
                error: 'No persisted analysis found for this path. Run /api/analyze first.',
                hint: `Expected .dev-clash/ directory inside: ${targetPath}`,
            });
        }

        // Re-hydrate the in-memory graph from disk
        globalGraph.clear();
        for (const node of persistedGraph.nodes) {
            globalGraph.addNode(node);
        }
        for (const edge of persistedGraph.edges) {
            globalGraph.addEdge(edge.source, edge.target);
        }
        globalGraph.computeMetrics();

        // Re-hydrate the in-memory vector store from disk
        initVectorStore(persistedVectors);

        const data = globalGraph.exportForReactFlow();
        console.log(`[/api/load] Reloaded ${persistedGraph.nodes.length} nodes from cache.`);

        res.json({
            success: true,
            source: 'cache',
            meta,
            vectorCount: persistedVectors.length,
            data,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[/api/load] Error:', msg);
        res.status(500).json({ error: msg });
    }
});


// Semantic search + Gemini RAG answer.
// Body: { query: string, maxResults?: number }

app.post('/api/query', async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body must be JSON with a "query" field.' });
    }
    const { query, maxResults = 8 } = req.body as { query?: string; maxResults?: number };

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'Request body must contain a non-empty "query" string.' });
    }

    try {
        // Step 1: Semantic vector search (with keyword fallback built-in)
        const searchResults = await semanticSearch(query.trim(), maxResults);

        if (searchResults.length === 0) {
            return res.status(404).json({
                error: 'No relevant files found. Run /api/analyze first to build the vector index.',
                results: [],
            });
        }

        // Step 2: Build rich sub-graph for Gemini context
        const subGraph = searchResults.map(r => {
            const node = globalGraph.getNode(r.filePath);
            return {
                filePath:       r.filePath,
                relevanceScore: r.score,
                summary:        r.summary,
                responsibility: r.responsibility,
                complexity:     r.complexity,
                codeQuality:    node?.codeQuality       ?? 'acceptable',
                layer:          node?.layer             ?? 'unknown',
                patterns:       r.patterns,
                keyExports:     r.keyExports,
                internalCalls:  r.internalCalls,
                fanIn:          node?.inboundEdgeCount  ?? 0,
                fanOut:         node?.outboundEdgeCount ?? 0,
                risk:           node?.riskCategory      ?? 'unknown',
                isOrphan:       node?.isOrphan          ?? false,
                commitChurn:    node?.commitChurn       ?? 0,
            };
        });

        // Step 3: Gemini architectural synthesis (non-fatal — works without API key)
        let analysis = null;
        try {
            analysis = await askGeminiArchitect(subGraph, query.trim());
        } catch (geminiErr: any) {
            console.warn('[API /api/query] Gemini unavailable (non-fatal):', geminiErr?.message ?? geminiErr);
        }

        res.json({
            success: true,
            query,
            results:      searchResults.map(r => ({ path: r.filePath, score: r.score, summary: r.summary })),
            relevantFiles: searchResults.map(r => ({ path: r.filePath, score: r.score })),
            analysis,
            gemini: analysis !== null,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[API /api/query] Error:', msg);
        res.status(500).json({ error: msg });
    }
});

// ─── POST /api/query/stream ───────────────────────────────────────────────────
// Same as /api/query but streams progress as SSE.
// Body: { query: string, maxResults?: number }

app.post('/api/query/stream', async (req, res) => {
    const { query, maxResults = 8 } = req.body;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Missing query.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sse = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        sse({ phase: 'search', message: 'Running semantic search…' });
        const searchResults = await semanticSearch(query.trim(), maxResults);

        if (searchResults.length === 0) {
            sse({ phase: 'error', message: 'No relevant files found in vector store.' });
            return res.end();
        }

        sse({
            phase: 'search',
            message: `Found ${searchResults.length} relevant files. Sending to Gemini…`,
            files: searchResults.map(r => r.filePath),
        });

        const subGraph = searchResults.map(r => {
            const node = globalGraph.getNode(r.filePath);
            return {
                filePath:       r.filePath,
                relevanceScore: r.score,
                summary:        r.summary,
                responsibility: r.responsibility,
                complexity:     r.complexity,
                codeQuality:    node?.codeQuality   ?? 'acceptable',
                layer:          node?.layer         ?? 'unknown',
                patterns:       r.patterns,
                keyExports:     r.keyExports,
                internalCalls:  r.internalCalls,
                fanIn:          node?.inboundEdgeCount  ?? 0,
                fanOut:         node?.outboundEdgeCount ?? 0,
                risk:           node?.riskCategory  ?? 'unknown',
                isOrphan:       node?.isOrphan       ?? false,
                commitChurn:    node?.commitChurn    ?? 0,
            };
        });

        sse({ phase: 'gemini', message: 'Gemini is analyzing the architecture…' });
        const analysis = await askGeminiArchitect(subGraph, query.trim());

        sse({
            phase: 'result',
            query,
            relevantFiles: searchResults.map(r => ({ path: r.filePath, score: r.score })),
            analysis,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sse({ phase: 'error', message: msg });
    } finally {
        res.end();
    }
});

// ─── FileSystem API ───────────────────────────────────────────────────────────

// 1. Read raw file content
app.get('/api/fs/read', (req, res) => {
    const targetPath = req.query.path as string;
    if (!targetPath) return res.status(400).json({ error: 'path query parameter required' });

    try {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'File not found' });
        
        const stat = fs.statSync(absolutePath);
        if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
        
        // Limit to 5MB to prevent memory crash on massive files
        if (stat.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File exceeds 5MB limit' });

        const content = fs.readFileSync(absolutePath, 'utf-8');
        res.json({ success: true, path: absolutePath, content });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 2. List directory contents
app.get('/api/fs/list', (req, res) => {
    const targetPath = req.query.path as string;
    if (!targetPath) return res.status(400).json({ error: 'path query parameter required' });

    try {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'Directory not found' });
        
        const stat = fs.statSync(absolutePath);
        if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is a file, not a directory' });

        const items = fs.readdirSync(absolutePath, { withFileTypes: true }).map(dirent => ({
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            path: path.join(absolutePath, dirent.name).replace(/\\/g, '/')
        }));
        
        // Sort folders first, then alphabetical
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        res.json({ success: true, path: absolutePath.replace(/\\/g, '/'), items });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Open file or folder in local OS / IDE
app.post('/api/fs/open', (req, res) => {
    const targetPath = req.body.path;
    if (!targetPath) return res.status(400).json({ error: 'path body parameter required' });

    try {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'Path not found' });

        // On Windows, 'code <path>' opens VS Code. Fallback to 'start "" "<path>"' to open in default app/explorer.
        const isWindows = process.platform === 'win32';
        const cmd = isWindows 
            ? `code "${absolutePath}" || start "" "${absolutePath}"` 
            : `code "${absolutePath}" || open "${absolutePath}"`;

        exec(cmd, (err) => {
            if (err) {
                console.error(`[/api/fs/open] Failed to open:`, err.message);
                return res.status(500).json({ error: 'Failed to open file. Is VS Code ("code" CLI) installed?' });
            }
            res.json({ success: true, message: `Opened: ${absolutePath}` });
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/agent-sync ─────────────────────────────────────────────────────
// HTTP bridge for AI agents (Cursor, Devin, CLI scripts, custom agents).
// Returns a prompt-ready Markdown context block for a given task description.
// Body: { task: string, maxResults?: number }

app.post('/api/agent-sync', async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Body must be JSON with a "task" field.' });
    }
    const { task, maxResults = 6 } = req.body as { task?: string; maxResults?: number };

    if (!task || typeof task !== 'string' || task.trim().length === 0) {
        return res.status(400).json({ error: '"task" field is required and must be a non-empty string.' });
    }

    try {
        const context = await executeMcpTool('search_codebase', { task: task.trim(), maxResults }, getLastGlobalSummary());
        const nodes = globalGraph.getAllNodes();

        res.json({
            success: true,
            task: task.trim(),
            optimized_prompt_context: context,
            token_estimate: Math.round(context.length / 4),
            files_searched: nodes.length,
            instructions: [
                'Paste the `optimized_prompt_context` into your agent\'s system prompt or prepend it to your user message.',
                'The context is pre-summarized by local AI — no need to read raw files for these components.',
                'For more detail on any file, call: POST /api/query { query: "<filename>" }',
            ],
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/mcp ────────────────────────────────────────────────────────────
// Full MCP (Model Context Protocol) endpoint for Claude Desktop, Cursor, etc.
// Implements the MCP JSON-RPC 2.0 protocol natively.
//
// Supported methods:
//   initialize            → Handshake: returns server info + capabilities
//   tools/list            → Returns full tool catalog (search_codebase, etc.)
//   tools/call            → Executes a named tool and returns the result

app.post('/api/mcp', async (req, res) => {
    const { jsonrpc, method, params, id } = req.body ?? {};

    const success = (result: any) => res.json({ jsonrpc: '2.0', id, result });
    const error   = (code: number, message: string) =>
        res.status(400).json({ jsonrpc: '2.0', id, error: { code, message } });

    try {
        switch (method) {

            // ── Handshake ────────────────────────────────────────────────────
            case 'initialize':
                return success({
                    protocolVersion: '2024-11-05',
                    serverInfo: {
                        name:    'dev-clash-memory',
                        version: '0.0.2',
                    },
                    capabilities: { tools: {} },
                });

            // ── Tool list ────────────────────────────────────────────────────
            case 'tools/list':
                return success({ tools: MCP_TOOLS });

            // ── Tool execution ───────────────────────────────────────────────
            case 'tools/call': {
                const toolName = params?.name as string;
                const toolInput = (params?.arguments ?? {}) as Record<string, any>;

                if (!toolName) return error(-32602, 'Missing tool name in params.name');

                const result = await executeMcpTool(toolName, toolInput, getLastGlobalSummary());
                return success({
                    content: [{ type: 'text', text: result }],
                    isError: false,
                });
            }

            // ── Notifications (fire-and-forget, no response needed) ──────────
            case 'notifications/initialized':
                return res.status(204).end();

            default:
                return error(-32601, `Method not found: ${method}`);
        }
    } catch (err: any) {
        return error(-32603, `Internal error: ${err.message}`);
    }
});

// ─── Boot ──────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  DEV_CLASH Backend API — Port ${PORT}`);
    console.log(`  Java AST Backend expected at port ${process.env.JAVA_BACKEND_PORT ?? 8080}`);
    console.log('  Core Endpoints:');
    console.log('    GET  /api/status        → Health of Node + Java microservices');
    console.log('    POST /api/analyze       → Full ingestion: { targetPath } or { repoUrl }');
    console.log('    POST /api/load          → Reload from .dev-clash/ cache (instant)');
    console.log('    GET  /api/graph         → Current in-memory graph snapshot');
    console.log('    GET  /api/summary       → Gemini global repo summary');
    console.log('    POST /api/query         → Semantic search + Gemini RAG');
    console.log('    POST /api/query/stream  → Same, streamed over SSE');
    console.log('  Agent / MCP Endpoints:');
    console.log('    POST /api/agent-sync    → HTTP context bridge for any AI agent');
    console.log('    POST /api/mcp           → Full MCP protocol (Claude Desktop, Cursor)');
    console.log('  FileSystem Endpoints:');
    console.log('    GET  /api/fs/read       → Read raw file content');
    console.log('    GET  /api/fs/list       → List directory contents');
    console.log('    POST /api/fs/open       → Open in VS Code / default OS app');
    console.log('    GET  /health            → Health check');
    console.log('════════════════════════════════════════════════════════════');
});
