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
import crypto from 'crypto';

// ─── Concurrency Semaphore ────────────────────────────────────────────────────
// Controls how many Ollama calls run in parallel. Higher = faster but uses more
// RAM/CPU. 4 is balanced for 4-core machines; bump to 8 if your machine can handle it.

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

export type ProgressEvent = {
    phase: string;
    message: string;
    progress?: number;
    total?: number;
    done?: number;
    language?: string;
    error?: boolean;
};

function sendSSE(res: Response | null, event: ProgressEvent) {
    if (!res) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
}

// ─── Global run state ─────────────────────────────────────────────────────────

let _lastGlobalSummary: GlobalRepoSummary | null = null;
const _runningRepos = new Set<string>(); // repoId → running

export function getLastGlobalSummary() { return _lastGlobalSummary; }
export function isPipelineRunning()    { return _runningRepos.size > 0; }
export function isRepoRunning(repoId: string) { return _runningRepos.has(repoId); }

// ─── Pipeline Options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
    /** Absolute local path — for repos already on disk */
    targetPath?: string;
    /** GitHub URL — cloned via git, then language auto-detected */
    repoUrl?: string;
    /** Force a specific language, skipping auto-detection */
    language?: 'typescript' | 'javascript' | 'java' | 'auto';
    /** Unique repo identifier from frontend (UUID) */
    repoId?: string;
    /** Human-readable repo name */
    repoLabel?: string;
}

// Concurrency: 4 parallel Ollama calls (safe for 4-core; increase to 8 on better machines)
const CONCURRENCY = 4;

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Unified polyglot ingestion pipeline.
 *
 * Phase 0  — Resolve input: local path OR GitHub URL clone + language detection
 * Phase 1  — AST graph extraction (TS/JS via ts-morph | Java via Spring Boot)
 * Phase 2  — Concurrent Ollama AI summarization (×CONCURRENCY parallel)
 * Phase 3  — Rich composite embedding → in-memory vector store
 * Phase 4  — Graph metrics: fan-in, fan-out, orphan, risk scoring
 * Phase 5  — Persist everything to .dev-clash/ cache on disk
 * Phase 6  — Gemini holistic architectural analysis (non-blocking)
 */
export async function runIngestionPipeline(
    options: PipelineOptions,
    sseRes: Response | null = null
) {
    const repoId    = options.repoId    ?? 'default';
    const repoLabel = options.repoLabel ?? (options.targetPath ? path.basename(options.targetPath) : 'repo');

    if (_runningRepos.has(repoId)) throw new Error(`Repo ${repoId} is already being ingested.`);
    _runningRepos.add(repoId);
    const startMs = Date.now();

    try {
        let targetPath: string = '';
        let rawNodes: GraphNode[] = [];
        let detectedLanguage = 'unknown';

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 0 — Resolve repository path & extract raw dependency graph
        // ═══════════════════════════════════════════════════════════════════════
        sendSSE(sseRes, { phase: 'init', message: 'Initialising pipeline…', progress: 2 });

        if (options.repoUrl) {
            // ── A. GitHub URL: shallow-clone locally first, then detect language ──
            sendSSE(sseRes, {
                phase: 'clone',
                message: `Cloning ${options.repoUrl}… (this may take 30-60s)`,
                progress: 4,
            });

            targetPath = cloneRepoLocally(options.repoUrl);
            const profile = detectLanguage(targetPath);
            detectedLanguage = profile.language;

            sendSSE(sseRes, {
                phase: 'clone',
                message: `Cloned → ${path.basename(targetPath)}. Detected: ${profile.language} (${profile.fileCount} source files).`,
                language: profile.language,
                progress: 12,
            });

            if (profile.language === 'java') {
                // Java: use Spring Boot AST backend for class-level dependency graph
                sendSSE(sseRes, {
                    phase: 'parse',
                    message: 'Java repo — invoking Spring Boot AST backend for dependency graph…',
                    language: 'java',
                    progress: 14,
                });
                try {
                    const javaResponse = await cloneAndExtractJavaGraph(options.repoUrl);
                    rawNodes = adaptJavaGraphToGraphNodes(javaResponse, targetPath);
                    sendSSE(sseRes, {
                        phase: 'parse',
                        message: `Java AST extracted. ${rawNodes.length} classes identified.`,
                        language: 'java',
                        progress: 20,
                    });
                } catch (javaErr: any) {
                    console.warn('[Phase 0] Java backend unavailable, falling back to file-level scan:', javaErr.message);
                    sendSSE(sseRes, {
                        phase: 'parse',
                        message: `Java AST backend offline — performing direct file scan. (${javaErr.message})`,
                        language: 'java',
                        progress: 16,
                    });
                    rawNodes = extractGraph(targetPath); // fallback: scan .java files as text
                }
            } else {
                // TS/JS/other: use native ts-morph AST parser
                rawNodes = extractGraph(targetPath);
                sendSSE(sseRes, {
                    phase: 'parse',
                    message: `TS/JS AST extracted. ${rawNodes.length} source files identified.`,
                    language: profile.language,
                    progress: 20,
                });
            }

        } else if (options.targetPath) {
            // ── B. Local path: detect language and parse accordingly ──────────
            targetPath = options.targetPath;
            const profile = detectLanguage(targetPath);
            detectedLanguage = profile.language;

            if (profile.fileCount === 0) {
                throw new Error(
                    `No supported source files found in "${targetPath}". ` +
                    `Detected language: ${profile.language}. ` +
                    `Ensure the path points to a repository root with source files.`
                );
            }

            sendSSE(sseRes, {
                phase: 'parse',
                message: `${profile.language} repo detected (${profile.fileCount} files). Extracting dependency graph…`,
                language: profile.language,
                progress: 8,
            });

            if (profile.language === 'java') {
                // Java local path: call /repo/local on Spring Boot AST backend
                try {
                    const javaResponse = await cloneAndExtractJavaGraph(targetPath, true); // true = local mode
                    rawNodes = adaptJavaGraphToGraphNodes(javaResponse, targetPath);
                    sendSSE(sseRes, {
                        phase: 'parse',
                        message: `Java AST extracted via AST backend. ${rawNodes.length} classes identified.`,
                        language: 'java',
                        progress: 16,
                    });
                } catch (javaErr: any) {
                    console.warn('[Phase 0] Java backend unavailable for local path, using file adapter:', javaErr.message);
                    // Fallback: use the Node-side fastFindJavaFiles to build synthetic nodes
                    rawNodes = adaptJavaGraphToGraphNodes({ nodes: [], edges: [], clonedPath: targetPath }, targetPath);
                    sendSSE(sseRes, {
                        phase: 'parse',
                        message: `Java backend offline — file-level scan. ${rawNodes.length} classes identified.`,
                        language: 'java',
                        progress: 16,
                    });
                }
            } else {
                // TS/JS: use ts-morph AST parser
                rawNodes = extractGraph(targetPath);
                sendSSE(sseRes, {
                    phase: 'parse',
                    message: `AST extracted. ${rawNodes.length} source files identified.`,
                    language: profile.language,
                    progress: 16,
                });
            }
        } else {
            throw new Error('Pipeline requires either "targetPath" (local repo) or "repoUrl" (GitHub URL).');
        }

        if (rawNodes.length === 0) {
            throw new Error(`Zero source files extracted from ${targetPath}. Check that the repo has supported source files.`);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 1 — Initialise per-repo store + in-memory state
        // ═══════════════════════════════════════════════════════════════════════
        const store = initStore(targetPath);
        // Clear only this repo's previous nodes (allow other repos to stay)
        globalGraph.clearForRepo(repoId);
        _lastGlobalSummary = null;

        const churnMap = countGitChurn(targetPath);
        const repoHash = crypto.createHash('sha256').update(targetPath).digest('hex').slice(0, 12);

        sendSSE(sseRes, {
            phase: 'summarize',
            message: `Found ${rawNodes.length} source files (${detectedLanguage}). Running AI summarization (×${CONCURRENCY} parallel)…`,
            language: detectedLanguage,
            total: rawNodes.length,
            done: 0,
            progress: 20,
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 2+3 — Concurrent Ollama summarization + vector store embedding
        // ═══════════════════════════════════════════════════════════════════════
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

            // Add node to in-memory graph
            globalGraph.addNode({
                id:             node.id,
                repoId,
                repoLabel,
                repoPath:       targetPath,
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
                commitChurn:    churnMap[node.id] ?? 0,
            });

            // Add all dependency edges
            node.imports.forEach(target => globalGraph.addEdge(node.id, target));

            // Build composite embedding text and add to vector store
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

            // Accumulate for Gemini global summary
            geminiPayload.push({
                path:           node.id,
                summary:        s.summary,
                responsibility: s.responsibility,
                complexity:     s.complexity,
                patterns:       s.patterns,
                external_deps:  s.external_deps,
                is_entry_point: s.is_entry_point,
                key_exports:    s.key_exports,
                layer:          s.layer,
                code_quality:   s.code_quality,
            });

            done++;
            const progress = 20 + Math.round((done / rawNodes.length) * 58);
            console.log(`  [${done}/${rawNodes.length}] ${path.basename(node.id)}`);
            sendSSE(sseRes, {
                phase: 'summarize',
                message: `[${done}/${rawNodes.length}] ${path.basename(node.id)}`,
                progress, total: rawNodes.length, done,
            });
        })));

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 4 — Graph Metrics (fan-in, fan-out, orphans, risk scoring)
        // ═══════════════════════════════════════════════════════════════════════
        globalGraph.computeMetrics();
        sendSSE(sseRes, { phase: 'metrics', message: 'Graph metrics computed.', progress: 79 });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 5 — Persist to disk (.dev-clash/ cache)
        // ═══════════════════════════════════════════════════════════════════════
        sendSSE(sseRes, { phase: 'persist', message: 'Persisting analysis to disk…', progress: 80 });

        const durationSoFar = Date.now() - startMs;
        store.saveGraph(globalGraph.getAllNodes(), globalGraph.getAllEdges(), durationSoFar);
        persistVectorStore();
        store.saveMeta({
            repoPath:   targetPath,
            repoHash,
            analyzedAt: new Date().toISOString(),
            fileCount:  rawNodes.length,
            durationMs: durationSoFar,
            language:   detectedLanguage,
        });

        sendSSE(sseRes, { phase: 'persist', message: 'Analysis persisted to .dev-clash/', progress: 84 });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 6 — Gemini Global Architectural Summary (non-fatal)
        // ═══════════════════════════════════════════════════════════════════════
        sendSSE(sseRes, {
            phase: 'gemini',
            message: 'Sending full context to Gemini for architectural analysis…',
            progress: 86,
        });

        try {
            _lastGlobalSummary = await generateGlobalRepoSummary(geminiPayload);
            if (_lastGlobalSummary?.complexityHotspots) {
                globalGraph.applyGeminiRiskAnnotations(_lastGlobalSummary.complexityHotspots);
            }
            sendSSE(sseRes, { phase: 'gemini', message: 'Gemini architectural analysis complete.', progress: 98 });
        } catch (err: any) {
            console.warn('[Phase 6] Gemini failed (non-fatal):', err?.message ?? err);
            sendSSE(sseRes, {
                phase: 'gemini',
                message: 'Gemini unavailable — local AI analysis still complete.',
                progress: 98,
            });
        }

        // ── Done ──────────────────────────────────────────────────────────────
        const totalMs = Date.now() - startMs;
        sendSSE(sseRes, {
            phase: 'done',
            message: `Pipeline complete. ${rawNodes.length} files analysed in ${(totalMs / 1000).toFixed(1)}s. Language: ${detectedLanguage}`,
            progress: 100,
            language: detectedLanguage,
        });
        console.log(`[Pipeline] ✅ Done in ${totalMs}ms | ${rawNodes.length} files | lang=${detectedLanguage}`);

    } finally {
        _runningRepos.delete(repoId);
    }
}
