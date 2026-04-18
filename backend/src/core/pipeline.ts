import { extractGraph, GraphNode } from './parser';
import { detectLanguage } from './langDetector';
import { cloneAndExtractJavaGraph, adaptJavaGraphToGraphNodes } from './javaBackendClient';
import { cloneRepoLocally } from './gitCloner';
import { summarizeFile } from '../ai/ollamaSummarizer';
import {
    clearVectorStore, persistVectorStore,
    addRichDocument, buildCompositeText,
} from '../storage/vectorStore';
import { globalGraph } from '../storage/graphStore';
import { generateGlobalRepoSummary, GlobalRepoSummary } from '../ai/geminiIntelligence';
import { initStore } from '../storage/persistentStore';
import { countGitChurn } from './gitAnalyzer';
import { Response } from 'express';
import path from 'path';
import fs from 'fs';

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
    language?: string;
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

// ─── Pipeline Options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
    /** Absolute local path — for TS/JS/Python repos already on disk */
    targetPath?: string;
    /** GitHub URL — for Java repos that must be cloned first */
    repoUrl?: string;
    /** Force a specific language, skipping auto-detection */
    language?: 'typescript' | 'javascript' | 'java' | 'auto';
}

const CONCURRENCY = 4;

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Unified polyglot ingestion pipeline.
 *
 * Phase 0  — Language detection + (if Java) clone via Spring Boot backend
 * Phase 1  — AST graph extraction + git churn
 * Phase 2  — Concurrent Ollama summarization (×4 parallel)
 * Phase 3  — Rich composite embedding into vector store
 * Phase 4  — Graph metrics (fan-in, fan-out, orphan, risk)
 * Phase 5  — Persist to .dev-clash/ inside repo
 * Phase 6  — Gemini holistic architectural analysis
 */
export async function runIngestionPipeline(
    options: PipelineOptions,
    sseRes: Response | null = null
) {
    if (_isRunning) throw new Error('Pipeline is already running.');
    _isRunning = true;
    const startMs = Date.now();

    try {
        let targetPath: string;
        let rawNodes: GraphNode[];
        let detectedLanguage: string;

        // ── Phase 0: Resolve path & extract raw graph ─────────────────────────
        sendSSE(sseRes, { phase: 'init', message: 'Detecting repository language…', progress: 2 });

        if (options.repoUrl) {
            // ─ GitHub URL path ────────────────────────────────────────────────
            // Step 1: Clone shallowly to a local temp folder using Node git
            sendSSE(sseRes, {
                phase: 'clone',
                message: `Cloning ${options.repoUrl}… (this may take 30-60s)`,
                progress: 5,
            });
            console.log(`[Phase 0] GitHub clone: ${options.repoUrl}`);

            // Shallow clone locally using Node (fast, no Java needed for TS/JS repos)
            targetPath = cloneRepoLocally(options.repoUrl);

            // Step 2: Detect language of the freshly-cloned repo
            const profile = detectLanguage(targetPath);
            detectedLanguage = profile.language;

            sendSSE(sseRes, {
                phase: 'clone',
                message: `Cloned → ${targetPath}. Detected: ${profile.language} (${profile.fileCount} files).`,
                language: profile.language,
                progress: 12,
            });

            if (profile.language === 'java') {
                // ── Java path: parse via Spring Boot AST service ───────────────
                sendSSE(sseRes, {
                    phase: 'parse',
                    message: 'Java repo detected — routing to Java AST backend…',
                    language: 'java',
                    progress: 14,
                });
                try {
                    const javaResponse = await cloneAndExtractJavaGraph(options.repoUrl);
                    rawNodes = adaptJavaGraphToGraphNodes(javaResponse, targetPath);
                } catch (javaErr: any) {
                    console.warn('[Phase 0] Java backend unavailable, falling back to file-level scan:', javaErr.message);
                    rawNodes = extractGraph(targetPath);
                }
            } else {
                // ── TS/JS/Python path: use our native AST parser ──────────────
                rawNodes = extractGraph(targetPath);
            }

        } else if (options.targetPath) {
            // ─ Local path: detect language, use native parser ─────────────────
            targetPath = path.resolve(options.targetPath);
            const profile = detectLanguage(targetPath);
            detectedLanguage = profile.language;

            if (!['typescript', 'javascript'].includes(profile.language) && profile.fileCount === 0) {
                throw new Error(
                    `No supported source files found in "${targetPath}". ` +
                    `Detected language: ${profile.language}. ` +
                    `For Java repos, provide a "repoUrl" instead of a "targetPath".`
                );
            }

            sendSSE(sseRes, {
                phase: 'parse',
                message: `Detected ${profile.language} repo (${profile.fileCount} files). Extracting AST…`,
                language: profile.language,
                progress: 5,
            });
            console.log(`[Phase 0] Local ${profile.language} repo: ${targetPath}`);

            rawNodes = extractGraph(targetPath);
        } else {
            throw new Error('Pipeline requires either "targetPath" or "repoUrl".');
        }

        // ── Init per-repo persistent store ────────────────────────────────────
        const store = initStore(targetPath);

        // ── Reset in-memory state ─────────────────────────────────────────────
        globalGraph.clear();
        clearVectorStore();
        _lastGlobalSummary = null;

        // ── Phase 1: Git Churn ────────────────────────────────────────────────
        const churnMap = countGitChurn(targetPath);

        console.log(`[Phase 1] ${rawNodes.length} source files found.`);
        sendSSE(sseRes, {
            phase: 'parse',
            message: `Found ${rawNodes.length} source files (${detectedLanguage}). Running AI summarization (×${CONCURRENCY} parallel)…`,
            language: detectedLanguage,
            total: rawNodes.length,
            done: 0,
            progress: 15,
        });

        // ── Phases 2 & 3: Summarize + Embed (concurrent) ─────────────────────
        const limit = createSemaphore(CONCURRENCY);
        let done = 0;

        const geminiPayload: Array<{
            path: string; summary: string; responsibility: string;
            complexity: string; patterns: string[]; external_deps: string[];
            is_entry_point: boolean; key_exports: string[];
            layer: string; code_quality: string;
        }> = [];

        await Promise.all(rawNodes.map(node => limit(async () => {
            const s = await summarizeFile(node.id);

            globalGraph.addNode({
                id:             node.id,
                summary:        s.summary,
                responsibility: s.responsibility,
                isEntryPoint:   s.is_entry_point,
                keyExports:     s.key_exports,
                internalCalls:  s.internal_calls,
                complexity:     s.complexity,
                patterns:       s.patterns,
                externalDeps:   s.external_deps,
                codeQuality:    s.code_quality,
                layer:          s.layer,
                riskCategory:   'low',
                commitChurn:    churnMap[node.id] || 0,
            });
            node.imports.forEach(t => globalGraph.addEdge(node.id, t));

            const compositeText = buildCompositeText(
                node.id, s.summary, s.key_exports, s.patterns,
                s.external_deps, s.complexity, s.is_entry_point,
                s.responsibility, s.internal_calls, node.imports,
            );

            await addRichDocument({
                filePath:       node.id,
                fileBasename:   path.basename(node.id),
                compositeText,
                summary:        s.summary,
                keyExports:     s.key_exports,
                patterns:       s.patterns,
                externalDeps:   s.external_deps,
                complexity:     s.complexity,
                isEntryPoint:   s.is_entry_point,
                responsibility: s.responsibility,
                internalCalls:  s.internal_calls,
            });

            geminiPayload.push({
                path:            node.id,
                summary:         s.summary,
                responsibility:  s.responsibility,
                complexity:      s.complexity,
                patterns:        s.patterns,
                external_deps:   s.external_deps,
                is_entry_point:  s.is_entry_point,
                key_exports:     s.key_exports,
                layer:           s.layer,
                code_quality:    s.code_quality,
            });

            done++;
            const progress = 15 + Math.round((done / rawNodes.length) * 63);
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

        // ── Phase 5: Persist ──────────────────────────────────────────────────
        sendSSE(sseRes, { phase: 'persist', message: 'Persisting analysis to disk…', progress: 80 });

        const durationSoFar = Date.now() - startMs;
        store.saveGraph(globalGraph.getAllNodes(), globalGraph.getAllEdges(), durationSoFar);
        persistVectorStore();
        store.saveMeta({
            repoPath:   targetPath,
            repoHash:   store.dirPath,
            analyzedAt: new Date().toISOString(),
            fileCount:  rawNodes.length,
            durationMs: durationSoFar,
            language:   detectedLanguage,
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
            message: `Pipeline complete. ${rawNodes.length} files in ${(totalMs / 1000).toFixed(1)}s. Language: ${detectedLanguage}`,
            progress: 100,
            language: detectedLanguage,
        });
        console.log(`[Pipeline] Done in ${totalMs}ms. Lang: ${detectedLanguage}`);

    } finally {
        _isRunning = false;
    }
}
