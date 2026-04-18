import http from 'http';
import path from 'path';

// ─── Types (mirrors Java GraphResponse) ──────────────────────────────────────

export interface JavaNode {
    id: string;     // Class name (e.g. "GraphService", from Java Node.id)
}

export interface JavaEdge {
    from: string;   // Source class name
    to: string;     // Target class name
}

export interface JavaGraphResponse {
    nodes: JavaNode[];
    edges: JavaEdge[];
    clonedPath: string;   // Local disk path where the repo was cloned
}

// ─── Config ───────────────────────────────────────────────────────────────────

const JAVA_BACKEND_HOST = process.env.JAVA_BACKEND_HOST ?? 'localhost';
const JAVA_BACKEND_PORT = Number(process.env.JAVA_BACKEND_PORT ?? 8080);
const JAVA_BACKEND_TIMEOUT_MS = 120_000; // 2 minutes — cloning can be slow

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function isJavaBackendAlive(): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.request(
            { hostname: JAVA_BACKEND_HOST, port: JAVA_BACKEND_PORT, path: '/repo/health', method: 'GET', timeout: 3000 },
            res => resolve(res.statusCode === 200)
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

// ─── Core Client ──────────────────────────────────────────────────────────────

/**
 * Calls the Java Spring Boot backend to:
 * 1. Clone the GitHub repo to a local temp folder.
 * 2. Parse all .java files with JavaParser AST.
 * 3. Return class-level dependency graph (nodes + edges).
 *
 * The returned `clonedPath` can then be passed directly into our
 * Ollama summarisation pipeline as if it were a local repo.
 */
export async function cloneAndExtractJavaGraph(repoUrl: string): Promise<JavaGraphResponse> {
    const alive = await isJavaBackendAlive();
    if (!alive) {
        throw new Error(
            `Java backend is not reachable at ${JAVA_BACKEND_HOST}:${JAVA_BACKEND_PORT}. ` +
            `Start it with: cd java-backend && mvnw.cmd spring-boot:run`
        );
    }

    const encodedUrl = encodeURIComponent(repoUrl);

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: JAVA_BACKEND_HOST,
                port: JAVA_BACKEND_PORT,
                path: `/repo/graph?url=${encodedUrl}`,
                method: 'POST',
                timeout: JAVA_BACKEND_TIMEOUT_MS,
            },
            res => {
                let data = '';
                res.on('data', chunk => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`Java backend returned HTTP ${res.statusCode}: ${data}`));
                    }
                    try {
                        const json = JSON.parse(data) as JavaGraphResponse;
                        resolve(json);
                    } catch {
                        reject(new Error(`Java backend returned non-JSON: ${data.slice(0, 200)}`));
                    }
                });
            }
        );

        req.on('error', err => reject(new Error(`Java backend connection error: ${err.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Java backend timed out after ${JAVA_BACKEND_TIMEOUT_MS / 1000}s`));
        });
        req.end();
    });
}

// ─── Adapter: Java graph → our GraphNode format ────────────────────────────────

import { GraphNode } from './parser';

/**
 * Adapts the raw JavaParser output into the same `GraphNode[]` format
 * that the rest of the ML pipeline (Ollama, vector store, graph store)
 * already understands — making Java repos a full first-class citizen.
 */
import fs from 'fs';

function fastFindJavaFiles(dir: string, fileMap: Map<string, string>) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!['.git', 'target', 'build', 'node_modules', 'test'].includes(entry.name)) {
                fastFindJavaFiles(path.join(dir, entry.name), fileMap);
            }
        } else if (entry.name.endsWith('.java')) {
            const className = entry.name.replace('.java', '');
            fileMap.set(className, path.join(dir, entry.name).replace(/\\/g, '/'));
        }
    }
}

export function adaptJavaGraphToGraphNodes(
    javaResponse: JavaGraphResponse,
    repoBasePath: string
): GraphNode[] {
    // 1. Scan the repo on disk to find where each Java class ACTUALLY lives.
    const realFileMap = new Map<string, string>();
    try { fastFindJavaFiles(repoBasePath, realFileMap); } catch {}

    // Build a node map: className → absolute path
    const nodeMap = new Map<string, string>();
    for (const node of javaResponse.nodes) {
        // Look up the physical file path, fallback to synthetic if not found
        const actualPath = realFileMap.get(node.id) || path.join(repoBasePath, `${node.id}.java`).replace(/\\/g, '/');
        nodeMap.set(node.id, actualPath);
    }

    // Build edge map: id → Set of import ids
    const importMap = new Map<string, Set<string>>();
    for (const edge of javaResponse.edges) {
        if (!importMap.has(edge.from)) importMap.set(edge.from, new Set());
        importMap.get(edge.from)!.add(edge.to);
    }

    // Produce final GraphNode[]
    const graphNodes: GraphNode[] = [];
    for (const node of javaResponse.nodes) {
        const id = nodeMap.get(node.id)!;
        const rawImports = Array.from(importMap.get(node.id) ?? []);
        const imports = rawImports
            .map(n => nodeMap.get(n))
            .filter(Boolean) as string[];

        graphNodes.push({ id, imports, rawImports });
    }

    return graphNodes;
}
