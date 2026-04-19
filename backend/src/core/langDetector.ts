import fs from 'fs';
import path from 'path';

// ─── Language Detection ───────────────────────────────────────────────────────

type Language = 'typescript' | 'javascript' | 'java' | 'python' | 'unknown';

interface LangProfile {
    language: Language;
    fileCount: number;
    entryPoints: string[];
}

const LANG_EXTENSIONS: Record<Language, string[]> = {
    typescript:  ['.ts', '.tsx'],
    javascript:  ['.js', '.jsx', '.mjs'],
    java:        ['.java'],
    python:      ['.py'],
    unknown:     [],
};

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target', '.mvn']);

function countExtensions(dir: string): Map<string, number> {
    const counts = new Map<string, number>();
    
    function walk(d: string) {
        if (!fs.existsSync(d)) return;
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            const fp = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(fp);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1);
            }
        }
    }
    
    walk(dir);
    return counts;
}

/**
 * Detects the primary language of a repository by counting source files.
 * Returns a profile with the dominant language and file count.
 */
export function detectLanguage(repoPath: string): LangProfile {
    const counts = countExtensions(repoPath);
    
    const scores: Record<Language, number> = {
        typescript:  0,
        javascript:  0,
        java:        0,
        python:      0,
        unknown:     0,
    };
    
    for (const [lang, exts] of Object.entries(LANG_EXTENSIONS) as [Language, string[]][]) {
        for (const ext of exts) {
            scores[lang] += counts.get(ext) ?? 0;
        }
    }
    
    // TypeScript beats JavaScript if both are present (TS repos often include .js too)
    if (scores.typescript > 0 && scores.javascript > 0) {
        scores.javascript = Math.floor(scores.javascript * 0.3);
    }
    
    let dominant: Language = 'unknown';
    let maxScore = 0;
    for (const [lang, score] of Object.entries(scores) as [Language, number][]) {
        if (lang === 'unknown') continue;
        if (score > maxScore) {
            maxScore = score;
            dominant = lang as Language;
        }
    }
    
    // Find likely entry points
    const entryPoints: string[] = [];
    ['index.ts', 'index.js', 'main.ts', 'app.ts', 'server.ts', 'App.java', 'Main.java', 'main.py', 'app.py'].forEach(f => {
        const candidates = findFile(repoPath, f);
        if (candidates) entryPoints.push(candidates);
    });
    
    const fileCount = maxScore;
    console.log(`[LangDetect] ${repoPath} → Primary: ${dominant} (${fileCount} files) | Scores:`, scores);
    
    return { language: dominant, fileCount, entryPoints };
}

function findFile(dir: string, name: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        if (IGNORE_DIRS.has(e.name)) continue;
        const fp = path.join(dir, e.name);
        if (e.isFile() && e.name === name) return fp;
        if (e.isDirectory()) {
            const found = findFile(fp, name);
            if (found) return found;
        }
    }
    return null;
}
