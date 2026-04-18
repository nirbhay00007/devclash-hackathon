import { Project } from 'ts-morph';
import path from 'path';
import fs from 'fs';

export interface GraphNode {
    id: string;          // Absolute file path (normalized)
    imports: string[];   // Resolved absolute paths of local imports only
    rawImports: string[]; // All raw import specifiers (for library detection)
}

/**
 * Sweeps a target directory and computes an AST dependency graph.
 * Resolves relative imports to actual file paths so edges are meaningful.
 */
export function extractGraph(targetRepoPath: string): GraphNode[] {
    const project = new Project({ 
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
            allowJs: true,
            jsx: 1 // ts.JsxEmit.Preserve
        }
    });
    
    function walkDir(dir: string): string[] {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        
        const list = fs.readdirSync(dir);
        for (let file of list) {
            if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'build' || file === '.next') continue;
            
            file = path.join(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory()) {
                results = results.concat(walkDir(file));
            } else {
                if (/\.(js|jsx|ts|tsx)$/.test(file)) {
                    results.push(file);
                }
            }
        }
        return results;
    }

    const filesToParse = walkDir(targetRepoPath);
    for (const f of filesToParse) {
        project.addSourceFileAtPath(f);
    }

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

            // Only try to resolve relative imports
            if (spec.startsWith('.')) {
                const resolved = tryResolveImport(dir, spec, allPaths);
                if (resolved) {
                    resolvedImports.push(resolved);
                }
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
    // Try exact match first, then with extensions
    if (allPaths.has(base)) return base;
    for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (allPaths.has(candidate)) return candidate;
    }
    return null;
}
