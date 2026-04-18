import { extractGraph } from './parser';
import { summarizeFile } from '../ai/ollamaSummarizer';
import {
    initVectorStore, clearVectorStore, persistVectorStore,
    addRichDocument, buildCompositeText,
} from '../storage/vectorStore';
import { globalGraph } from '../storage/graphStore';
import { generateGlobalRepoSummary, GlobalRepoSummary } from '../ai/geminiIntelligence';
import { initStore, getStore } from '../storage/persistentStore';
import { countGitChurn } from './gitAnalyzer';
import { Response } from 'express';
import path from 'path';

// ─── Concurrency Semaphore ────────────────────────────────────────────────────

function createSemaphore(concurrency: number) {
    let running = 0;
    const queue: (() => void)[] = [];

    function next() {
        if (queue.length > 0 && running < concurrency) {
            running++;
            queue.shift()!();
        }
    }

    return async function limit<T>(fn: () => Promise<T>): Promise<T> {
        await new Promise<void>(resolve => { queue.push(resolve); next(); });
        try { return await fn(); } finally { running--; next(); }
    };
}

// ─── SSE Helper ───────────────────────────────────────────────────────────────

type ProgressEvent = {
    phase: string;
    message: string;
    progress?: number;
    total?: number;
    done?: number;
};

function sendSSE(res: Response | null, event: ProgressEvent) {
    if (!res) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
}

// ─── Global run state ─────────────────────────────────────────────────────────

let _lastGlobalSummary: GlobalRepoSummary | null = null;
let _isRunning = false;

export function getLastGlobalSummary() { return _lastGlobalSummary; }
export function isPipelineRunning()    { return _isRunning; }

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const CONCURRENCY = 4;

/**
 * Full ingestion pipeline.
 *
 *  Phase 1 — AST graph extraction + git churn (sync, ms)
 *  Phase 2 — Concurrent Ollama summarization (main bottleneck, parallelised)
 *  Phase 3 — Rich composite embedding into vector store (parallel with phase 2)
 *  Phase 4 — Graph metrics computation (sync, instant)
 *  Phase 5 — Persist graph + vectors to .dev-clash/ inside the repo (async disk write)
 *  Phase 6 — Gemini holistic summary (single call, after all local work)
 */
export async function runIngestionPipeline(
    targetPath: string,
    sseRes: Response | null = null
) {
    if (_isRunning) throw new Error('Pipeline is already running.');
    _isRunning = true;
    const startMs = Date.now();

    try {
        // ── Init per-repo persistent store ────────────────────────────────────
        const store = initStore(targetPath);
        console.log(`[Pipeline] Store dir: ${store.dirPath}`);

        // ── Reset in-memory state ─────────────────────────────────────────────
        globalGraph.clear();
        clearVectorStore();
        _lastGlobalSummary = null;

        // ── Phase 1: AST + Git Churn ──────────────────────────────────────────
        sendSSE(sseRes, { phase: 'parse', message: 'Extracting AST dependency graph…' });
        console.log(`[Phase 1] Target: ${targetPath}`);

        const rawNodes = extractGraph(targetPath);
        const churnMap = countGitChurn(targetPath);

        console.log(`[Phase 1] Found ${rawNodes.length} source files.`);
        sendSSE(sseRes, {
            phase: 'parse',
            message: `Found ${rawNodes.length} source files. Starting AI summarization (×${CONCURRENCY} parallel)…`,
            total: rawNodes.length,
            done: 0,
            progress: 0,
        });

        // ── Phase 2 & 3: Summarize + Embed (concurrent) ───────────────────────
        const limit = createSemaphore(CONCURRENCY);
        let done = 0;

        // Collect everything needed for Gemini's global call
        const geminiPayload: Array<{
            path: string; summary: string; responsibility: string;
            complexity: string; patterns: string[]; external_deps: string[];
            is_entry_point: boolean; key_exports: string[];
            layer: string; code_quality: string;
        }> = [];

        await Promise.all(rawNodes.map(node => limit(async () => {
            // ── Summarize ─────────────────────────────────────────────────────
            const s = await summarizeFile(node.id);

            // ── Graph node ────────────────────────────────────────────────────
            globalGraph.addNode({
                id:            node.id,
                summary:       s.summary,
                responsibility: s.responsibility,
                isEntryPoint:  s.is_entry_point,
                keyExports:    s.key_exports,
                internalCalls: s.internal_calls,
                complexity:    s.complexity,
                patterns:      s.patterns,
                externalDeps:  s.external_deps,
                codeQuality:   s.code_quality,
                layer:         s.layer,
                riskCategory:  'low',   // recomputed in Phase 4
                commitChurn:   churnMap[node.id] || 0,
            });
            node.imports.forEach(t => globalGraph.addEdge(node.id, t));

            // ── Rich vector embedding ─────────────────────────────────────────
            const compositeText = buildCompositeText(
                node.id,
                s.summary,
                s.key_exports,
                s.patterns,
                s.external_deps,
                s.complexity,
                s.is_entry_point,
                s.responsibility,
                s.internal_calls,
                node.imports,
            );

            await addRichDocument({
                filePath:     node.id,
                fileBasename: path.basename(node.id),
                compositeText,
                summary:      s.summary,
                keyExports:   s.key_exports,
                patterns:     s.patterns,
                externalDeps: s.external_deps,
                complexity:   s.complexity,
                isEntryPoint: s.is_entry_point,
                responsibility: s.responsibility,
                internalCalls:  s.internal_calls,
            });

            // ── Gemini batch collection ───────────────────────────────────────
            geminiPayload.push({
                path:         node.id,
                summary:      s.summary,
                responsibility: s.responsibility,
                complexity:   s.complexity,
                patterns:     s.patterns,
                external_deps: s.external_deps,
                is_entry_point: s.is_entry_point,
                key_exports:  s.key_exports,
                layer:        s.layer,
                code_quality: s.code_quality,
            });

            done++;
            const progress = Math.round((done / rawNodes.length) * 78);
            console.log(`  [${done}/${rawNodes.length}] ${path.basename(node.id)}`);
            sendSSE(sseRes, {
                phase: 'summarize',
                message: `[${done}/${rawNodes.length}] ${path.basename(node.id)}`,
                progress, total: rawNodes.length, done,
            });
        })));

        // ── Phase 4: Graph Metrics ─────────────────────────────────────────────
        globalGraph.computeMetrics();
        console.log('[Phase 4] Graph metrics computed.');

        // ── Phase 5: Persist to .dev-clash/ ───────────────────────────────────
        sendSSE(sseRes, { phase: 'persist', message: 'Persisting analysis to disk…', progress: 80 });

        const durationSoFar = Date.now() - startMs;
        store.saveGraph(globalGraph.getAllNodes(), globalGraph.getAllEdges(), durationSoFar);
        persistVectorStore();   // saves to .dev-clash/vectors.json

        store.saveMeta({
            repoPath:    targetPath,
            repoHash:    store.dirPath,
            analyzedAt:  new Date().toISOString(),
            fileCount:   rawNodes.length,
            durationMs:  durationSoFar,
        });

        sendSSE(sseRes, { phase: 'persist', message: 'Analysis persisted to .dev-clash/', progress: 83 });

        // ── Phase 6: Gemini Global Summary ────────────────────────────────────
        sendSSE(sseRes, {
            phase: 'gemini',
            message: 'Sending full context to Gemini for architectural analysis…',
            progress: 85,
        });

        console.log('[Phase 6] Calling Gemini…');
        try {
            _lastGlobalSummary = await generateGlobalRepoSummary(geminiPayload);
            if (_lastGlobalSummary?.complexityHotspots) {
                globalGraph.applyGeminiRiskAnnotations(_lastGlobalSummary.complexityHotspots);
            }
            console.log('[Phase 6] Gemini summary complete.');
            sendSSE(sseRes, { phase: 'gemini', message: 'Gemini analysis complete.', progress: 98 });
        } catch (err: any) {
            console.warn('[Phase 6] Gemini failed (non-fatal):', err?.message ?? err);
            sendSSE(sseRes, {
                phase: 'gemini',
                message: 'Gemini unavailable — local analysis still complete.',
                progress: 98,
            });
        }

        const totalMs = Date.now() - startMs;
        sendSSE(sseRes, {
            phase: 'done',
            message: `Pipeline complete. ${rawNodes.length} files in ${(totalMs / 1000).toFixed(1)}s.`,
            progress: 100,
        });
        console.log(`[Pipeline] Done in ${totalMs}ms.`);

    } finally {
        _isRunning = false;
    }
}
