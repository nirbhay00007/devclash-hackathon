import { Project } from 'ts-morph';
import path from 'path';
import fs from 'fs';

export interface GraphNode {
    id: string;          // Absolute file path (normalized)
    imports: string[];   // Resolved absolute paths of local imports only
    rawImports: string[]; // All raw import specifiers (for library detection)
}

// ─── File walker (language-agnostic) ──────────────────────────────────────────

const TS_JS_EXTS   = /\.(js|jsx|ts|tsx)$/;
const ALL_SRC_EXTS = /\.(js|jsx|ts|tsx|java|kt|py|go|rb|c|cpp|cs|php|swift|rs)$/;
const SKIP_DIRS    = new Set(['node_modules', 'dist', '.git', 'build', '.next', 'target', '__pycache__', '.gradle', 'vendor']);

function walkDir(dir: string, extFilter: RegExp): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const file of fs.readdirSync(dir)) {
        if (SKIP_DIRS.has(file)) continue;
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            results = results.concat(walkDir(full, extFilter));
        } else if (extFilter.test(full)) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Sweeps a target directory and computes an AST dependency graph.
 * For TS/JS: uses ts-morph to resolve actual import edges.
 * For all other languages (Java, Python, Go…): returns file-level nodes with
 * empty imports — enough for Ollama summarization to work as a fallback.
 */
export function extractGraph(targetRepoPath: string): GraphNode[] {
    const tsJsFiles = walkDir(targetRepoPath, TS_JS_EXTS);

    // If there are TS/JS files, run the full AST parser on them
    if (tsJsFiles.length > 0) {
        return extractTsJsGraph(tsJsFiles);
    }

    // Fallback: any supported source files as bare nodes (no import edges)
    const allFiles = walkDir(targetRepoPath, ALL_SRC_EXTS);
    return allFiles.map(f => ({
        id: normalizePath(f),
        imports: [],
        rawImports: [],
    }));
}

/**
 * TS/JS-only AST graph with resolved import edges (uses ts-morph).
 */
function extractTsJsGraph(filesToParse: string[]): GraphNode[] {
    const project = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: true, jsx: 1 },
    });
    for (const f of filesToParse) project.addSourceFileAtPath(f);

    const sourceFiles = project.getSourceFiles();
    const allPaths = new Set(sourceFiles.map(f => normalizePath(f.getFilePath())));

    const nodes: GraphNode[] = [];
    for (const sourceFile of sourceFiles) {
        const filePath = normalizePath(sourceFile.getFilePath());
        const dir = path.dirname(filePath);
        const rawImports: string[] = [];
        const resolvedImports: string[] = [];

        for (const imp of sourceFile.getImportDeclarations()) {
            const spec = imp.getModuleSpecifierValue();
            rawImports.push(spec);
            if (spec.startsWith('.')) {
                const resolved = tryResolveImport(dir, spec, allPaths);
                if (resolved) resolvedImports.push(resolved);
            }
        }
        nodes.push({ id: filePath, imports: resolvedImports, rawImports });
    }
    return nodes;
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

function tryResolveImport(dir: string, spec: string, allPaths: Set<string>): string | null {
    const base = normalizePath(path.resolve(dir, spec));
    if (allPaths.has(base)) return base;
    for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (allPaths.has(candidate)) return candidate;
    }
    return null;
}
