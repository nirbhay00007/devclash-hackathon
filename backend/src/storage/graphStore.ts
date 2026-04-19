import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Edge {
    source: string;
    target: string;
}

export interface NodeMetadata {
    id: string;                    // Absolute file path (normalized)
    repoId: string;                // Unique repo identifier (from frontend)
    repoLabel: string;             // Human-readable repo name
    repoPath: string;              // Root path of the repo this file belongs to
    repoUrl?: string;              // Git URL if available
    summary: string;               // LLM architectural summary
    responsibility: string;        // Single-line core responsibility
    isEntryPoint: boolean;
    keyExports: string[];
    internalCalls: string[];       // Key function names called internally
    complexity: 'low' | 'medium' | 'high';
    patterns: string[];
    externalDeps: string[];
    codeQuality: 'clean' | 'acceptable' | 'needs_refactor';
    layer: 'presentation' | 'business_logic' | 'data_access' | 'infrastructure' | 'utility' | 'config' | 'unknown';
    riskCategory: 'low' | 'medium' | 'high';
    inboundEdgeCount: number;      // Fan-in (computed post-ingestion)
    outboundEdgeCount: number;     // Fan-out (computed post-ingestion)
    commitChurn: number;           // Git commit frequency
    isOrphan: boolean;             // Zero fan-in && not entry point
}

// ─── Graph Store ──────────────────────────────────────────────────────────────

export class GraphStore {
    private nodes: Map<string, NodeMetadata> = new Map();
    private edges: Edge[] = [];

    addNode(node: Omit<NodeMetadata, 'inboundEdgeCount' | 'outboundEdgeCount' | 'isOrphan'>) {
        this.nodes.set(node.id, {
            ...node,
            inboundEdgeCount: 0,
            outboundEdgeCount: 0,
            isOrphan: false,
        });
    }

    addEdge(source: string, target: string) {
        // Avoid duplicate edges
        if (!this.edges.some(e => e.source === source && e.target === target)) {
            this.edges.push({ source, target });
        }
    }

    clear() {
        this.nodes.clear();
        this.edges = [];
    }

    /** Remove only the nodes and edges belonging to a specific repo */
    clearForRepo(repoId: string) {
        for (const [id, node] of this.nodes.entries()) {
            if (node.repoId === repoId) this.nodes.delete(id);
        }
        const repoNodeIds = new Set(
            Array.from(this.nodes.values())
                .filter(n => n.repoId !== repoId)
                .map(n => n.id)
        );
        // Keep edges where both endpoints still exist
        this.edges = this.edges.filter(
            e => !(e.source.startsWith('') || true) ||
                 (repoNodeIds.has(e.source) || repoNodeIds.has(e.target))
        );
        // Simpler: just remove edges where either node was from that repo
        const removedIds = new Set<string>();
        for (const [id, node] of Array.from(this.nodes.entries())) {
            if (node.repoId !== repoId) continue;
            removedIds.add(id);
        }
        // Re-clear correctly
        for (const [id, node] of Array.from(this.nodes.entries())) {
            if (node.repoId === repoId) { removedIds.add(id); this.nodes.delete(id); }
        }
        this.edges = this.edges.filter(e => !removedIds.has(e.source) && !removedIds.has(e.target));
    }

    /** Get all unique repoIds present in this graph */
    getRepoIds(): string[] {
        const ids = new Set<string>();
        this.nodes.forEach(n => ids.add(n.repoId));
        return Array.from(ids);
    }

    /**
     * Computes graph metrics after all nodes & edges are populated:
     *  - fan-in (inboundEdgeCount): how many files depend on this file
     *  - fan-out (outboundEdgeCount): how many files this file depends on
     *  - riskCategory: derived from complexity + fan-in + code_quality
     *  - isOrphan: no consumers && not an entry point
     */
    computeMetrics() {
        // Reset counters
        for (const node of this.nodes.values()) {
            node.inboundEdgeCount = 0;
            node.outboundEdgeCount = 0;
            node.isOrphan = false;
        }

        for (const edge of this.edges) {
            const target = this.nodes.get(edge.target);
            if (target) target.inboundEdgeCount++;
            const source = this.nodes.get(edge.source);
            if (source) source.outboundEdgeCount++;
        }

        for (const node of this.nodes.values()) {
            // Risk scoring matrix:
            // HIGH: high complexity OR needs_refactor AND fanIn > 2 (central & messy)
            // HIGH: codeQuality === needs_refactor AND fanIn > 3 (many dependents, bad code)
            // MEDIUM: medium complexity OR fanIn > 1
            // LOW: everything else
            const codeIsProblematic = node.codeQuality === 'needs_refactor';
            const highCoupling = node.inboundEdgeCount > 3;
            const centralNode = node.inboundEdgeCount > 1;

            if ((node.complexity === 'high' && highCoupling) || (codeIsProblematic && highCoupling)) {
                node.riskCategory = 'high';
            } else if (node.complexity === 'high' || codeIsProblematic || centralNode) {
                node.riskCategory = 'medium';
            } else {
                node.riskCategory = 'low';
            }

            // Orphan: nothing imports this, and it's not an application entry point
            if (node.inboundEdgeCount === 0 && !node.isEntryPoint && this.nodes.size > 1) {
                node.isOrphan = true;
            }
        }
    }

    /** Override risk labels with Gemini's expert annotations */
    applyGeminiRiskAnnotations(highRiskFiles: string[]) {
        const riskSet = new Set(highRiskFiles.map(f => f.replace(/\\/g, '/')));
        for (const node of this.nodes.values()) {
            if (riskSet.has(node.id)) node.riskCategory = 'high';
        }
    }

    getNode(id: string): NodeMetadata | undefined {
        return this.nodes.get(id);
    }

    getAllNodes(): NodeMetadata[] {
        return Array.from(this.nodes.values());
    }

    getAllEdges(): Edge[] {
        return [...this.edges];
    }

    /**
     * Serializes the graph for the React Flow frontend.
     * Grid layout with entry points sorted to the front.
     * Optionally filters to only include nodes & internal edges for a specific repoId.
     */
    exportForReactFlow(repoId?: string) {
        this.computeMetrics();

        // 1. Filter Nodes
        let nodesArr = Array.from(this.nodes.values());
        if (repoId) {
            nodesArr = nodesArr.filter(n => n.repoId === repoId);
        }

        // Sort: entry points first, then by risk (high→low), then alphabetically
        nodesArr.sort((a, b) => {
            if (a.isEntryPoint !== b.isEntryPoint) return a.isEntryPoint ? -1 : 1;
            const riskOrder = { high: 0, medium: 1, low: 2 };
            if (a.riskCategory !== b.riskCategory) return riskOrder[a.riskCategory] - riskOrder[b.riskCategory];
            return a.id.localeCompare(b.id);
        });

        const cols = Math.max(3, Math.ceil(Math.sqrt(nodesArr.length)));

        const reactFlowNodes = nodesArr.map((n, i) => ({
            id: n.id,
            position: {
                x: (i % cols) * 300 + (Math.random() * 30 - 15),
                y: Math.floor(i / cols) * 180 + (Math.random() * 20 - 10),
            },
            data: {
                label: path.basename(n.id),
                fullPath: n.id,
                repoId: n.repoId,
                repoLabel: n.repoLabel,
                repoPath: n.repoPath,
                repoUrl: n.repoUrl,
                summary: n.summary,
                responsibility: n.responsibility,
                risk: n.riskCategory,
                complexity: n.complexity,
                codeQuality: n.codeQuality,
                layer: n.layer,
                isEntryPoint: n.isEntryPoint,
                isOrphan: n.isOrphan,
                keyExports: n.keyExports,
                internalCalls: n.internalCalls,
                patterns: n.patterns,
                externalDeps: n.externalDeps,
                fanIn: n.inboundEdgeCount,
                fanOut: n.outboundEdgeCount,
                commitChurn: n.commitChurn,
            },
        }));

        // 2. Filter Edges (only if both source and target are in our filtered nodes list)
        const allowedNodeIds = new Set(nodesArr.map(n => n.id));
        const filteredEdges = this.edges.filter(e => allowedNodeIds.has(e.source) && allowedNodeIds.has(e.target));

        const reactFlowEdges = filteredEdges.map(e => ({
            id: `e-${e.source}-${e.target}`,
            source: e.source,
            target: e.target,
            animated: false,
        }));

        return { nodes: reactFlowNodes, edges: reactFlowEdges };
    }
}

export const globalGraph = new GraphStore();
