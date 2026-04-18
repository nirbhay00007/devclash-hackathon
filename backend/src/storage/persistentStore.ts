import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FileSummary } from '../ai/ollamaSummarizer';
import { NodeMetadata, Edge } from './graphStore';

// ─── Directory Structure ──────────────────────────────────────────────────────
//
//  {repoPath}/.dev-clash/
//    ├── meta.json        ← analysis metadata (timestamp, file count, repo hash)
//    ├── cache.json       ← SHA-256 hash → FileSummary (prevents re-summarizing unchanged files)
//    ├── graph.json       ← Full graph: all NodeMetadata + edges
//    └── vectors.json     ← All vector embeddings + rich composite metadata
//
// Everything is scoped PER REPO so multiple repos can coexist independently.

const DIR_NAME = '.dev-clash';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepoMeta {
    repoPath: string;
    repoHash: string;        // SHA-256 of the repoPath string (stable folder key)
    analyzedAt: string;      // ISO timestamp
    fileCount: number;
    durationMs: number;
    language?: string;       // Detected language (typescript, javascript, java, python…)
}

export interface PersistedGraph {
    meta: RepoMeta;
    nodes: NodeMetadata[];
    edges: Edge[];
}

export interface RichVectorDoc {
    // Identification
    filePath: string;
    fileBasename: string;
    // Rich composite context (embedded as a single dense text)
    compositeText: string;
    // Structured metadata stored alongside (for re-hydrating search results)
    summary: string;
    keyExports: string[];
    patterns: string[];
    externalDeps: string[];
    complexity: string;
    isEntryPoint: boolean;
    responsibility: string;
    internalCalls: string[];
    // The actual embedding vector
    vector: number[];
}

export interface PersistedVectors {
    meta: Pick<RepoMeta, 'repoPath' | 'analyzedAt'>;
    docs: RichVectorDoc[];
}

export interface SummaryCache {
    [cacheKey: string]: FileSummary;
}

// ─── PersistentStore class ────────────────────────────────────────────────────

export class PersistentStore {
    private readonly storeDir: string;
    private readonly metaPath: string;
    private readonly cachePath: string;
    private readonly graphPath: string;
    private readonly vectorsPath: string;
    private readonly repoPath: string;
    private readonly repoHash: string;

    private _cache: SummaryCache = {};

    constructor(repoPath: string) {
        this.repoPath = repoPath;
        this.repoHash = crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 12);
        this.storeDir = path.join(repoPath, DIR_NAME);
        this.metaPath = path.join(this.storeDir, 'meta.json');
        this.cachePath = path.join(this.storeDir, 'cache.json');
        this.graphPath = path.join(this.storeDir, 'graph.json');
        this.vectorsPath = path.join(this.storeDir, 'vectors.json');

        this._ensureDir();
        this._loadCache();
    }

    // ── Directory management ───────────────────────────────────────────────────

    private _ensureDir() {
        if (!fs.existsSync(this.storeDir)) {
            fs.mkdirSync(this.storeDir, { recursive: true });
            console.log(`[PersistentStore] Created store at: ${this.storeDir}`);
        }
    }

    get dirPath() { return this.storeDir; }

    // ── Cache (SHA-256 hash → FileSummary) ────────────────────────────────────

    private _loadCache() {
        try {
            if (fs.existsSync(this.cachePath)) {
                this._cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
                const count = Object.keys(this._cache).length;
                console.log(`[PersistentStore] Loaded ${count} cached summaries from repo store.`);
            }
        } catch { this._cache = {}; }
    }

    getCached(filePath: string, contentHash: string): FileSummary | null {
        const key = `${filePath}::${contentHash}`;
        return this._cache[key] ?? null;
    }

    setCached(filePath: string, contentHash: string, summary: FileSummary) {
        const key = `${filePath}::${contentHash}`;
        this._cache[key] = summary;
        // Write-through: keep cache fresh on disk
        try {
            fs.writeFileSync(this.cachePath, JSON.stringify(this._cache, null, 2));
        } catch {}
    }

    clearCache() {
        this._cache = {};
        try { fs.writeFileSync(this.cachePath, '{}'); } catch {}
    }

    // ── Graph Persistence ─────────────────────────────────────────────────────

    saveGraph(nodes: NodeMetadata[], edges: Edge[], durationMs: number) {
        const payload: PersistedGraph = {
            meta: {
                repoPath: this.repoPath,
                repoHash: this.repoHash,
                analyzedAt: new Date().toISOString(),
                fileCount: nodes.length,
                durationMs,
            },
            nodes,
            edges,
        };
        // Atomic-style write: write to tmp then rename
        const tmp = this.graphPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
        fs.renameSync(tmp, this.graphPath);
        console.log(`[PersistentStore] Saved graph → ${this.graphPath}`);
    }

    loadGraph(): PersistedGraph | null {
        try {
            if (fs.existsSync(this.graphPath)) {
                return JSON.parse(fs.readFileSync(this.graphPath, 'utf-8'));
            }
        } catch {}
        return null;
    }

    // ── Vector Store Persistence ──────────────────────────────────────────────

    saveVectors(docs: RichVectorDoc[]) {
        const payload: PersistedVectors = {
            meta: {
                repoPath: this.repoPath,
                analyzedAt: new Date().toISOString(),
            },
            docs,
        };
        const tmp = this.vectorsPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(payload));
        fs.renameSync(tmp, this.vectorsPath);
        console.log(`[PersistentStore] Saved ${docs.length} vectors → ${this.vectorsPath}`);
    }

    loadVectors(): RichVectorDoc[] {
        try {
            if (fs.existsSync(this.vectorsPath)) {
                const parsed: PersistedVectors = JSON.parse(fs.readFileSync(this.vectorsPath, 'utf-8'));
                console.log(`[PersistentStore] Loaded ${parsed.docs.length} vectors from repo store.`);
                return parsed.docs;
            }
        } catch {}
        return [];
    }

    // ── Meta ──────────────────────────────────────────────────────────────────

    saveMeta(meta: RepoMeta) {
        fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
    }

    loadMeta(): RepoMeta | null {
        try {
            if (fs.existsSync(this.metaPath)) {
                return JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
            }
        } catch {}
        return null;
    }
}

// ─── Singleton management (one store per active repo) ─────────────────────────

let _activeStore: PersistentStore | null = null;

export function initStore(repoPath: string): PersistentStore {
    _activeStore = new PersistentStore(repoPath);
    return _activeStore;
}

export function getStore(): PersistentStore {
    if (!_activeStore) throw new Error('[PersistentStore] Store not initialised. Call initStore(repoPath) first.');
    return _activeStore;
}
