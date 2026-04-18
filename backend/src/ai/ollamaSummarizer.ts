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
    external_deps: string[];       // npm package names used
    code_quality: 'clean' | 'acceptable' | 'needs_refactor'; // Rough code quality
    layer: 'presentation' | 'business_logic' | 'data_access' | 'infrastructure' | 'utility' | 'config' | 'unknown';
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software architect performing deep codebase analysis.
Analyze the provided source code and return ONLY a valid JSON object with EXACTLY these keys:
{
  "summary": "1-2 sentences describing this file's architectural role and purpose (WHAT it does and WHY it exists)",
  "responsibility": "One concise line: the single core responsibility this file owns",
  "is_entry_point": false,
  "key_exports": ["ExportedFunctionName", "ExportedClassName"],
  "internal_calls": ["functionNameCalledInternally", "anotherInternalCall"],
  "complexity": "low|medium|high",
  "patterns": ["PatternName"],
  "external_deps": ["library-name"],
  "code_quality": "clean|acceptable|needs_refactor",
  "layer": "presentation|business_logic|data_access|infrastructure|utility|config|unknown"
}

Rules:
- "summary" = WHAT the file does architecturally and WHY it exists in the system
- "responsibility" = single crisp statement of the one thing this file owns
- "is_entry_point" = true only if this file bootstraps the application or is a top-level orchestrator
- "key_exports" = only publicly exported symbols (functions, classes, types, constants)
- "internal_calls" = significant function/method names used inside this file (not imports, what is called)
- "complexity" = low (<100 LOC, simple), medium (100-300 LOC or moderate branching), high (>300 LOC or heavy abstraction)
- "patterns" = real software patterns only: Singleton, Factory, Observer, Repository, Middleware, Strategy, Decorator, Facade, Command, etc.
- "external_deps" = npm package names (not relative imports) — empty array if none
- "code_quality" = clean (well-structured), acceptable (works but has minor issues), needs_refactor (high coupling/complexity/duplication)
- "layer" = which architectural layer this file belongs to
- Return ONLY valid JSON. No markdown fences, no prose, no explanation.`;

// ─── Core function ────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 60_000;
const MAX_RETRIES = 2;

export async function summarizeFile(filePath: string): Promise<FileSummary> {
    let code: string;
    try {
        code = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return fallback('Cannot read file.');
    }

    if (Buffer.byteLength(code) > MAX_FILE_BYTES) {
        // Intelligent truncation: preserve file header (imports/exports) + body start + tail
        const lines = code.split('\n');
        code = [
            ...lines.slice(0, 400),
            '',
            '// ═══ FILE TRUNCATED — SHOWING TAIL ═══',
            '',
            ...lines.slice(-80),
        ].join('\n');
    }

    const hash = crypto.createHash('sha256').update(code).digest('hex');

    // Use repo-scoped cache via PersistentStore
    const store = getStore();
    const cached = store.getCached(filePath, hash);
    if (cached) return cached;

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await ollama.chat({
                model: 'qwen2.5-coder:3b',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: code },
                ],
                format: 'json',
                options: { temperature: 0.05, num_ctx: 8192 },
            });

            const parsed = JSON.parse(response.message.content) as FileSummary;

            const result: FileSummary = {
                summary:        parsed.summary        || 'No summary available.',
                responsibility: parsed.responsibility || parsed.summary || 'Unknown responsibility.',
                is_entry_point: Boolean(parsed.is_entry_point),
                key_exports:    Array.isArray(parsed.key_exports)    ? parsed.key_exports    : [],
                internal_calls: Array.isArray(parsed.internal_calls) ? parsed.internal_calls : [],
                complexity:     (['low', 'medium', 'high'] as const).includes(parsed.complexity) ? parsed.complexity : 'low',
                patterns:       Array.isArray(parsed.patterns)       ? parsed.patterns       : [],
                external_deps:  Array.isArray(parsed.external_deps)  ? parsed.external_deps  : [],
                code_quality:   (['clean', 'acceptable', 'needs_refactor'] as const).includes(parsed.code_quality) ? parsed.code_quality : 'acceptable',
                layer:          (['presentation','business_logic','data_access','infrastructure','utility','config','unknown'] as const).includes(parsed.layer) ? parsed.layer : 'unknown',
            };

            // Write-through cache
            store.setCached(filePath, hash, result);
            return result;
        } catch (err) {
            lastError = err;
            if (attempt < MAX_RETRIES) await sleep(300 * (attempt + 1));
        }
    }

    console.error(`[Ollama] All retries exhausted for ${filePath}:`, lastError);
    return fallback('Error generating summary after retries.');
}

function fallback(reason: string): FileSummary {
    return {
        summary: reason,
        responsibility: reason,
        is_entry_point: false,
        key_exports: [],
        internal_calls: [],
        complexity: 'low',
        patterns: [],
        external_deps: [],
        code_quality: 'acceptable',
        layer: 'unknown',
    };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
