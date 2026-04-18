import ollama from 'ollama';
import { getStore, RichVectorDoc } from './persistentStore';

// ─── In-memory store (loaded from / saved to PersistentStore) ─────────────────

let _docs: RichVectorDoc[] = [];

export function initVectorStore(docs: RichVectorDoc[]) {
    _docs = docs;
}

export function clearVectorStore() {
    _docs = [];
}

export function persistVectorStore() {
    getStore().saveVectors(_docs);
}

// ─── Rich composite embedding text builder ────────────────────────────────────
//
// Instead of embedding only the LLM summary (1-2 sentences), we build a dense
// multi-field composite string that captures ALL known context about a file.
// This makes cosine similarity dramatically more accurate because the embedding
// vector encodes the full semantic fingerprint of the file — not just its summary.

export function buildCompositeText(
    filePath: string,
    summary: string,
    keyExports: string[],
    patterns: string[],
    externalDeps: string[],
    complexity: string,
    isEntryPoint: boolean,
    responsibility: string,
    internalCalls: string[],
    imports: string[]  // resolved paths of local import targets
): string {
    const basename = filePath.split('/').pop() ?? filePath;
    const importedModules = imports.map(p => p.split('/').pop()).filter(Boolean);

    return [
        `File: ${basename}`,
        `Purpose: ${summary}`,
        `Responsibility: ${responsibility || summary}`,
        `Entry Point: ${isEntryPoint ? 'yes' : 'no'}`,
        `Complexity: ${complexity}`,
        `Exports: ${keyExports.length ? keyExports.join(', ') : 'none'}`,
        `Internal Calls: ${internalCalls.length ? internalCalls.join(', ') : 'none'}`,
        `Design Patterns: ${patterns.length ? patterns.join(', ') : 'none'}`,
        `External Dependencies: ${externalDeps.length ? externalDeps.join(', ') : 'none'}`,
        `Imports From: ${importedModules.length ? importedModules.join(', ') : 'none'}`,
    ].join('\n');
}

// ─── Core: embed a single document into the in-memory store ──────────────────

export function getVectorStoreSize() { return _docs.length; }

export async function addRichDocument(doc: Omit<RichVectorDoc, 'vector'>) {
    // Idempotent: skip if already embedded this session
    if (_docs.some(d => d.filePath === doc.filePath)) return;

    try {
        const response = await ollama.embeddings({
            model: 'nomic-embed-text',
            prompt: doc.compositeText,
        });
        _docs.push({ ...doc, vector: response.embedding });
    } catch (err: any) {
        // Log the real error — silent swallowing hides misconfiguration
        console.warn(`[VectorStore] Embedding failed for ${doc.fileBasename}: ${err?.message ?? err}`);
        // Fallback: store without vector (keyword search still works)
        _docs.push({ ...doc, vector: [] });
    }
}

/**
 * Upsert (insert-or-replace) a single document in the in-memory vector store.
 * Used by the incremental memory sync (update_file_context MCP tool) so that
 * when an AI agent edits a file it can re-embed just that one entry without
 * running the entire ingestion pipeline.
 *
 * Steps:
 *   1. Remove the old entry for filePath if it exists.
 *   2. Re-embed the new compositeText using Ollama nomic-embed-text.
 *   3. Insert the updated doc.
 *   4. Persist the updated store to disk immediately.
 */
export async function upsertDocument(doc: Omit<RichVectorDoc, 'vector'>): Promise<'updated' | 'inserted' | 'error'> {
    // Remove stale entry
    const prevIdx = _docs.findIndex(d => d.filePath === doc.filePath);
    if (prevIdx !== -1) _docs.splice(prevIdx, 1);

    try {
        const response = await ollama.embeddings({
            model: 'nomic-embed-text',
            prompt: doc.compositeText,
        });
        _docs.push({ ...doc, vector: response.embedding });
    } catch (err: any) {
        console.warn(`[VectorStore] Upsert embedding failed for ${doc.fileBasename}: ${err?.message ?? err}`);
        _docs.push({ ...doc, vector: [] }); // keyword fallback still works
    }

    // Persist immediately so the update survives restarts
    try { getStore().saveVectors(_docs); } catch {}

    return prevIdx !== -1 ? 'updated' : 'inserted';
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function dot(A: number[], B: number[]): number {
    let s = 0;
    for (let i = 0; i < A.length; i++) s += A[i] * B[i];
    return s;
}

function norm(A: number[]): number {
    return Math.sqrt(dot(A, A));
}

function cosineSimilarity(A: number[], B: number[]): number {
    const d = norm(A) * norm(B);
    return d === 0 ? 0 : dot(A, B) / d;
}

// ─── Maximal Marginal Relevance (MMR) ─────────────────────────────────────────
//
// Standard top-K cosine search returns near-duplicate files (e.g., 3 files that
// all say "handles auth"). MMR trades off a bit of relevance for diversity,
// ensuring the returned set covers different facets of the query.
//
// lambda=1.0 → pure relevance (like standard cosine)
// lambda=0.5 → balanced (default, recommended)
// lambda=0.0 → pure diversity

function mmrSearch(
    queryVec: number[],
    docs: Array<{ doc: RichVectorDoc; score: number }>,
    k: number,
    lambda = 0.55
): RichVectorDoc[] {
    if (docs.length === 0) return [];

    const selected: Array<{ doc: RichVectorDoc; vec: number[] }> = [];
    const candidates = [...docs];

    while (selected.length < k && candidates.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const relevance = candidates[i].score;

            // Max similarity to already-selected documents
            const maxSim = selected.length === 0
                ? 0
                : Math.max(...selected.map(s => cosineSimilarity(candidates[i].doc.vector, s.vec)));

            const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
            if (mmrScore > bestScore) {
                bestScore = mmrScore;
                bestIdx = i;
            }
        }

        selected.push({ doc: candidates[bestIdx].doc, vec: candidates[bestIdx].doc.vector });
        candidates.splice(bestIdx, 1);
    }

    return selected.map(s => s.doc);
}

// ─── Public search API ────────────────────────────────────────────────────────

export interface SearchResult {
    filePath: string;
    fileBasename: string;
    summary: string;
    responsibility: string;
    keyExports: string[];
    internalCalls: string[];
    patterns: string[];
    complexity: string;
    isEntryPoint: boolean;
    score: number;
}

/** Keyword-based fallback search when vector embeddings are unavailable. */
function keywordSearch(query: string, maxResults: number): RichVectorDoc[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return _docs.slice(0, maxResults);

    return _docs
        .map(doc => {
            const haystack = (doc.compositeText + ' ' + doc.fileBasename).toLowerCase();
            const hits = terms.filter(t => haystack.includes(t)).length;
            return { doc, hits };
        })
        .filter(x => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, maxResults)
        .map(x => x.doc);
}

export async function semanticSearch(
    query: string,
    maxResults: number = 8,
    useMmr = true
): Promise<SearchResult[]> {
    if (_docs.length === 0) return [];

    // Attempt vector search; fall back to keyword search if Ollama embed fails
    let results: RichVectorDoc[];
    try {
        const response = await ollama.embeddings({ model: 'nomic-embed-text', prompt: query });
        const queryVec = response.embedding;

        // Only score docs that have a valid embedding vector
        const embeddable = _docs.filter(d => d.vector.length > 0);
        const scored = embeddable.map(doc => ({
            doc,
            score: cosineSimilarity(queryVec, doc.vector),
        })).sort((a, b) => b.score - a.score);

        results = useMmr
            ? mmrSearch(queryVec, scored, maxResults)
            : scored.slice(0, maxResults).map(s => s.doc);

        // If vector search returned nothing, use keyword fallback
        if (results.length === 0) results = keywordSearch(query, maxResults);

        return results.map(doc => ({
            filePath:       doc.filePath,
            fileBasename:   doc.fileBasename,
            summary:        doc.summary,
            responsibility: doc.responsibility,
            keyExports:     doc.keyExports,
            internalCalls:  doc.internalCalls,
            patterns:       doc.patterns,
            complexity:     doc.complexity,
            isEntryPoint:   doc.isEntryPoint,
            score:          cosineSimilarity(queryVec, doc.vector),
        }));
    } catch (err: any) {
        console.warn(`[VectorStore] Vector search failed (${err?.message}), using keyword fallback`);
        results = keywordSearch(query, maxResults);
        return results.map(doc => ({
            filePath:       doc.filePath,
            fileBasename:   doc.fileBasename,
            summary:        doc.summary,
            responsibility: doc.responsibility,
            keyExports:     doc.keyExports,
            internalCalls:  doc.internalCalls,
            patterns:       doc.patterns,
            complexity:     doc.complexity,
            isEntryPoint:   doc.isEntryPoint,
            score:          0.5, // synthetic score for keyword hits
        }));
    }
}

// Legacy shim — keeps index.ts imports working without changes
export { addRichDocument as addDocumentToVectorStore };
