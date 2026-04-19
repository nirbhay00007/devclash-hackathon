import ollama from 'ollama';
import fs from 'fs';
import crypto from 'crypto';
import { getStore } from '../storage/persistentStore';

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface FileSummary {
    summary: string;               // 1–2 sentence architectural purpose (WHAT and WHY)
    responsibility: string;        // Single-line core responsibility (for embedding)
    is_entry_point: boolean;       // Main entry / top-level orchestrator
    key_exports: string[];         // Exported functions / classes / constants
    internal_calls: string[];      // Key internal function names called within this file
    complexity: 'low' | 'medium' | 'high';
    patterns: string[];            // Design patterns detected
    external_deps: string[];       // npm / maven package names used
    code_quality: 'clean' | 'acceptable' | 'needs_refactor';
    layer: 'presentation' | 'business_logic' | 'data_access' | 'infrastructure' | 'utility' | 'config' | 'unknown';
}

export interface Subsystem {
    name: string;
    description: string;
    files: string[];
}

export interface GlobalRepoSummary {
    overallPurpose: string;        // One-paragraph executive summary
    techStack: string[];           // Frameworks + libraries detected
    architecturalStyle: string;    // e.g. "Layered MVC", "Event-driven microservices"
    coreSubsystems: Subsystem[];
    complexityHotspots: string[];  // Top N highest-complexity files
    entryPoints: string[];         // List of entry point files
    suggestedImprovements: string[];
    recommendedOnboardingPath: string[]; // Ordered list of 5-10 files a junior dev should read first
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software architect performing deep multi-language codebase analysis.
Analyze the provided source code file (TypeScript, JavaScript, Java, or other) and return ONLY a valid JSON object with EXACTLY these keys:
{
  "summary": "1-2 sentences describing this file's architectural role and purpose (WHAT it does and WHY it exists)",
  "responsibility": "One concise line: the single core responsibility this file owns",
  "is_entry_point": false,
  "key_exports": ["ExportedFunctionOrClassName"],
  "internal_calls": ["functionNameCalledInternally"],
  "complexity": "low|medium|high",
  "patterns": ["PatternName"],
  "external_deps": ["library-or-package-name"],
  "code_quality": "clean|acceptable|needs_refactor",
  "layer": "presentation|business_logic|data_access|infrastructure|utility|config|unknown"
}

Rules:
- "summary" = WHAT the file does architecturally and WHY it exists in the system
- "responsibility" = single crisp statement of the one thing this file owns
- "is_entry_point" = true only if this file bootstraps the app or is a top-level orchestrator
- "key_exports" = publicly exported symbols (functions, classes, interfaces, constants)
- "internal_calls" = significant method/function names CALLED inside this file
- "complexity" = low (<100 LOC, simple), medium (100-300 LOC or moderate branching), high (>300 LOC or heavy abstraction)
- "patterns" = real patterns only: Singleton, Factory, Observer, Repository, Middleware, Strategy, Decorator, Facade, Command, MVC, etc.
- "external_deps" = package/library names only (not relative imports) — empty array if none
- "code_quality" = clean (well-structured), acceptable (works but minor issues), needs_refactor (high coupling/complexity/duplication)
- "layer" = which architectural layer this file belongs to
- For Java files: treat class annotations (@Service, @Controller, @Repository) as strong layer signals
- Return ONLY valid JSON. No markdown fences, no prose, no explanation.`;

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 48_000;  // ~12k tokens — safe for 8k context with system prompt
const MAX_RETRIES    = 2;
const OLLAMA_TIMEOUT_MS = 60_000; // 60s per file max — prevent stalled model hanging pipeline

// ─── Core Summarizer ─────────────────────────────────────────────────────────

export async function summarizeFile(filePath: string): Promise<FileSummary> {
    // ── 1. Read file ──────────────────────────────────────────────────────────
    let code: string;
    try {
        code = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return fallback(`Cannot read file: ${filePath}`);
    }

    if (!code.trim()) return fallback('File is empty.');

    // ── 2. Intelligent truncation (preserve header + tail) ────────────────────
    if (Buffer.byteLength(code) > MAX_FILE_BYTES) {
        const lines = code.split('\n');
        code = [
            ...lines.slice(0, 350),
            '',
            '// ═══ FILE TRUNCATED — SHOWING TAIL FOR CONTEXT ═══',
            '',
            ...lines.slice(-60),
        ].join('\n');
    }

    // ── 3. Cache check (SHA-256 of content, not path) ─────────────────────────
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    const store = getStore();
    const cached = store.getCached(filePath, hash);
    if (cached) return cached;

    // ── 4. Call Ollama with timeout ───────────────────────────────────────────
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await Promise.race([
                ollama.chat({
                    model: 'qwen2.5-coder:3b',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user',   content: `File: ${filePath}\n\n${code}` },
                    ],
                    format: 'json',
                    options: {
                        temperature:  0.05,
                        num_ctx:      8192,
                        num_predict:  600,   // Hard cap — prevents runaway generation
                    },
                }),
                timeoutPromise(OLLAMA_TIMEOUT_MS, filePath),
            ]);

            const parsed = JSON.parse(result.message.content) as FileSummary;
            const validated = validate(parsed);

            // Write-through cache
            store.setCached(filePath, hash, validated);
            return validated;

        } catch (err) {
            lastError = err;
            if (attempt < MAX_RETRIES) await sleep(500 * (attempt + 1));
        }
    }

    console.error(`[Ollama] All retries exhausted for ${filePath}:`, lastError);
    return fallback('Error generating summary after retries.');
}

// ─── Validation & Fallback ────────────────────────────────────────────────────

const COMPLEXITY_VALUES   = ['low', 'medium', 'high'] as const;
const CODE_QUALITY_VALUES = ['clean', 'acceptable', 'needs_refactor'] as const;
const LAYER_VALUES        = ['presentation','business_logic','data_access','infrastructure','utility','config','unknown'] as const;

function validate(raw: Partial<FileSummary>): FileSummary {
    return {
        summary:        (typeof raw.summary === 'string' && raw.summary.trim()) ? raw.summary.trim() : 'No summary available.',
        responsibility: (typeof raw.responsibility === 'string' && raw.responsibility.trim()) ? raw.responsibility.trim() : 'Unknown responsibility.',
        is_entry_point: Boolean(raw.is_entry_point),
        key_exports:    Array.isArray(raw.key_exports)    ? raw.key_exports.filter(s => typeof s === 'string')    : [],
        internal_calls: Array.isArray(raw.internal_calls) ? raw.internal_calls.filter(s => typeof s === 'string') : [],
        complexity:     COMPLEXITY_VALUES.includes(raw.complexity as any)   ? raw.complexity!   : 'low',
        patterns:       Array.isArray(raw.patterns)       ? raw.patterns.filter(s => typeof s === 'string')       : [],
        external_deps:  Array.isArray(raw.external_deps)  ? raw.external_deps.filter(s => typeof s === 'string')  : [],
        code_quality:   CODE_QUALITY_VALUES.includes(raw.code_quality as any) ? raw.code_quality! : 'acceptable',
        layer:          LAYER_VALUES.includes(raw.layer as any)               ? raw.layer!        : 'unknown',
    };
}

function fallback(reason: string): FileSummary {
    return {
        summary:        reason,
        responsibility: reason,
        is_entry_point: false,
        key_exports:    [],
        internal_calls: [],
        complexity:     'low',
        patterns:       [],
        external_deps:  [],
        code_quality:   'acceptable',
        layer:          'unknown',
    };
}

function timeoutPromise(ms: number, label: string): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`[Ollama] Timeout (${ms}ms) for ${label}`)), ms)
    );
}

export async function ollamaEmbed(text: string): Promise<number[]> {
    try {
        const response = await ollama.embeddings({
            model: 'nomic-embed-text',
            prompt: text,
        });
        return response.embedding;
    } catch (err: any) {
        console.error(`[Ollama] Embedding failed: ${err.message}`);
        throw err;
    }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Global Repo Summary ──────────────────────────────────────────────────────

export async function generateGlobalRepoSummary(
    allFileSummaries: Array<{
        path: string;
        summary: string;
        complexity: string;
        patterns: string[];
        external_deps: string[];
        is_entry_point: boolean;
        key_exports: string[];
    }>
): Promise<GlobalRepoSummary> {
    // Build a compact representation to avoid token overflow
    const compactContext = allFileSummaries.map(f => ({
        path: f.path,
        summary: f.summary,
        complexity: f.complexity,
        patterns: f.patterns,
        deps: f.external_deps,
        entry: f.is_entry_point,
    }));

    const prompt = `You are a Principal Software Architect performing a holistic codebase review.
Analyze ALL the file summaries below and generate a comprehensive architectural overview.

FILE SUMMARIES (${compactContext.length} files):
${JSON.stringify(compactContext, null, 2)}

Return a JSON object with EXACTLY this structure:
{
  "overallPurpose": "One paragraph describing what this codebase does and its primary goals",
  "techStack": ["Framework1", "Library2"],
  "architecturalStyle": "e.g. Layered Architecture / Event-Driven / Microservices / MVC",
  "coreSubsystems": [
    { "name": "SubsystemName", "description": "What this group does", "files": ["path/to/file.ts"] }
  ],
  "complexityHotspots": ["path/to/most/complex/file.ts"],
  "entryPoints": ["path/to/entry.ts"],
  "suggestedImprovements": ["Specific improvement 1", "Specific improvement 2"],
  "recommendedOnboardingPath": ["path/to/start.ts", "path/to/core.ts"]
}

Rules:
- Group files into 3-7 meaningful logical subsystems.
- "complexityHotspots" = top 5 highest-complexity files that need the most attention.
- "suggestedImprovements" = concrete, prioritized recommendations.
- "recommendedOnboardingPath" = ordered chronological listing of 5-10 files a beginner should read to understand the system.
- Return ONLY valid JSON. No markdown formatting or extra text.`;

    try {
        const result = await ollama.chat({
            model: 'qwen2.5-coder:3b',
            messages: [
                { role: 'user', content: prompt }
            ],
            format: 'json',
            options: {
                temperature: 0.05,
                num_ctx: 16384,
                num_predict: 2048,
            },
        });
        
        return JSON.parse(result.message.content) as GlobalRepoSummary;
    } catch (err: any) {
        console.error(`[Ollama] Global summary failed: ${err.message}`);
        throw err;
    }
}
