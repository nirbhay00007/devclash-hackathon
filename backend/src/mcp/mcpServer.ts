/**
 * DEV_CLASH — MCP (Model Context Protocol) Server
 *
 * Exposes the local DEV_CLASH knowledge graph as a native MCP tool so that
 * Claude Desktop, Cursor, and any MCP-compatible AI agent can query your
 * codebase as permanent, local, zero-token-cost memory.
 *
 * How it works:
 *   1. User points their AI agent to this MCP server.
 *   2. Agent calls `search_codebase` with a natural-language task description.
 *   3. MCP server runs the semantic search locally (Ollama nomic-embed-text).
 *   4. Returns compressed, prompt-ready Markdown context to the agent.
 *   5. Agent now understands the EXACT relevant files without reading the full codebase.
 *
 * Usage:
 *   The MCP server starts automatically alongside the main Express backend.
 *   See setup/CLAUDE_INTEGRATION.md for connecting Claude Desktop.
 */

import { semanticSearch, SearchResult } from '../storage/vectorStore';
import { globalGraph, NodeMetadata, Edge } from '../storage/graphStore';
import path from 'path';

// ─── Tool Definitions ─────────────────────────────────────────────────────────
// These are the tools Claude/Cursor sees in its tool-calling interface.

export const MCP_TOOLS = [
    {
        name: 'search_codebase',
        description:
            'Search the locally indexed codebase for files relevant to a task or question. ' +
            'Returns pre-summarized file context to minimize token usage. ' +
            'Always call this BEFORE reading any file directly.',
        inputSchema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'Describe what you are trying to do or find in the codebase.',
                },
                maxResults: {
                    type: 'number',
                    description: 'Max number of relevant files to return (default: 6, max: 15)',
                },
            },
            required: ['task'],
        },
    },
    {
        name: 'get_architecture_summary',
        description:
            'Returns the high-level architecture overview of the currently indexed repository. ' +
            'Use this at the start of any coding session to understand the codebase structure.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_file_context',
        description:
            'Returns the AI-generated summary and full metadata for a specific file. ' +
            'Cheaper than reading the raw file content — use this first.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'The absolute file path or file basename to look up.',
                },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'get_dependency_graph',
        description:
            'Returns the import/dependency relationships for a specific file. ' +
            'Use this to understand what a file depends on (fanOut) and what depends on it (fanIn).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'The absolute file path or basename to get dependencies for.',
                },
            },
            required: ['filePath'],
        },
    },
];

// ─── Tool Implementations ─────────────────────────────────────────────────────

export async function executeMcpTool(
    toolName: string,
    input: Record<string, any>,
    lastGlobalSummary: any,
): Promise<string> {
    switch (toolName) {

        // ── Tool 1: search_codebase ──────────────────────────────────────────
        case 'search_codebase': {
            const task = String(input.task ?? '').trim();
            const maxResults = Math.min(Math.max(1, Number(input.maxResults) || 6), 15);

            if (!task) return 'Error: task parameter is required.';

            const results = await semanticSearch(task, maxResults);
            if (results.length === 0) {
                return (
                    'No relevant files found in the local index. ' +
                    'The repository may not have been analyzed yet. ' +
                    'Ask the user to run the analysis pipeline first.'
                );
            }

            return buildAgentContext(task, results);
        }

        // ── Tool 2: get_architecture_summary ─────────────────────────────────
        case 'get_architecture_summary': {
            const nodes = globalGraph.getAllNodes();
            if (nodes.length === 0) {
                return 'No repository has been analyzed yet. Ask the user to analyze a repository first.';
            }

            const entryPoints = nodes.filter(n => n.isEntryPoint).map(n => path.basename(n.id));
            const highRisk    = nodes.filter(n => n.riskCategory === 'high').map(n => path.basename(n.id));
            const orphans     = nodes.filter(n => n.isOrphan).map(n => path.basename(n.id));
            const layers      = [...new Set(nodes.map(n => n.layer ?? 'unknown'))];

            const edges = globalGraph.getAllEdges();

            let md = `# Repository Architecture Summary\n\n`;
            md += `**Total Files Analyzed:** ${nodes.length}\n`;
            md += `**Total Dependencies:** ${edges.length}\n`;
            md += `**Architectural Layers:** ${layers.join(', ')}\n\n`;

            if (lastGlobalSummary?.overallPurpose) {
                md += `## Overall Purpose\n${lastGlobalSummary.overallPurpose}\n\n`;
            }
            if (lastGlobalSummary?.techStack?.length) {
                md += `## Tech Stack\n${lastGlobalSummary.techStack.join(', ')}\n\n`;
            }

            md += `## Entry Points (${entryPoints.length})\n`;
            md += entryPoints.length ? entryPoints.map(f => `- ${f}`).join('\n') : '- None detected';
            md += '\n\n';

            if (highRisk.length) {
                md += `## ⚠️ High-Risk Files (${highRisk.length})\n`;
                md += highRisk.map(f => `- ${f}`).join('\n');
                md += '\n\n';
            }

            if (orphans.length) {
                md += `## 🔍 Orphan Files (no connections) — ${orphans.length}\n`;
                md += orphans.map(f => `- ${f}`).join('\n');
                md += '\n\n';
            }

            if (lastGlobalSummary?.onboardingPath?.length) {
                md += `## Recommended Onboarding Order\n`;
                lastGlobalSummary.onboardingPath.forEach((step: string, i: number) => {
                    md += `${i + 1}. ${step}\n`;
                });
            }

            return md;
        }

        // ── Tool 3: get_file_context ──────────────────────────────────────────
        case 'get_file_context': {
            const query = String(input.filePath ?? '').trim();
            if (!query) return 'Error: filePath is required.';

            // Try exact match first, fall back to basename match
            let node: NodeMetadata | undefined = globalGraph.getNode(query) ?? undefined;
            if (!node) {
                const allNodes = globalGraph.getAllNodes();
                node = allNodes.find((n: NodeMetadata) =>
                    path.basename(n.id).toLowerCase() === path.basename(query).toLowerCase()
                ) ?? allNodes.find((n: NodeMetadata) => n.id.toLowerCase().includes(query.toLowerCase()));
            }

            if (!node) {
                return `File "${query}" not found in the index. It may not have been analyzed yet.`;
            }

            let md = `# File: ${path.basename(node.id)}\n\n`;
            md += `**Full Path:** \`${node.id}\`\n`;
            md += `**Layer:** ${node.layer ?? 'unknown'} | **Complexity:** ${node.complexity ?? 'unknown'}\n`;
            md += `**Risk:** ${node.riskCategory} | **Entry Point:** ${node.isEntryPoint ? 'Yes' : 'No'}\n`;
            md += `**Fan-In (used by):** ${node.inboundEdgeCount ?? 0} files | **Fan-Out (depends on):** ${node.outboundEdgeCount ?? 0} files\n\n`;
            md += `## AI Summary\n${node.summary}\n\n`;
            md += `## Responsibility\n${node.responsibility ?? 'Not specified'}\n\n`;
            if (node.keyExports?.length) md += `## Key Exports\n${node.keyExports.join(', ')}\n\n`;
            if (node.internalCalls?.length) md += `## Internal Calls\n${node.internalCalls.join(', ')}\n\n`;
            if (node.patterns?.length) md += `## Design Patterns\n${node.patterns.join(', ')}\n\n`;
            if (node.externalDeps?.length) md += `## External Dependencies\n${node.externalDeps.join(', ')}\n\n`;
            if (node.commitChurn) md += `## Commit Churn\n${node.commitChurn} commits (${node.commitChurn > 20 ? 'frequently changed — be careful' : 'stable'})\n`;

            return md;
        }

        // ── Tool 4: get_dependency_graph ──────────────────────────────────────
        case 'get_dependency_graph': {
            const query = String(input.filePath ?? '').trim();
            if (!query) return 'Error: filePath is required.';

            const allNodes = globalGraph.getAllNodes();
            const target = allNodes.find(n =>
                n.id === query ||
                path.basename(n.id).toLowerCase() === path.basename(query).toLowerCase() ||
                n.id.toLowerCase().includes(query.toLowerCase())
            );

            if (!target) return `File "${query}" not found in the index.`;

            const allEdges = globalGraph.getAllEdges();
            const outgoing = allEdges.filter(e => e.source === target.id).map(e => e.target);
            const incoming = allEdges.filter(e => e.target === target.id).map(e => e.source);

            let md = `# Dependency Graph for ${path.basename(target.id)}\n\n`;
            md += `## Files That Depend On This (fan-in: ${incoming.length})\n`;
            md += incoming.length
                ? incoming.map(f => `- ${path.basename(f)} (\`${f}\`)`).join('\n')
                : '- None (this file is not imported by any other file)';

            md += `\n\n## Files This Depends On (fan-out: ${outgoing.length})\n`;
            md += outgoing.length
                ? outgoing.map(f => `- ${path.basename(f)} (\`${f}\`)`).join('\n')
                : '- None (this file has no local imports)';

            return md;
        }

        default:
            return `Unknown tool: ${toolName}`;
    }
}

// ─── Helper: Build compressed agent context string ────────────────────────────

function buildAgentContext(task: string, results: SearchResult[]): string {
    const totalTokensEstimate = results.reduce((acc, r) => acc + r.summary.length / 4, 0);
    const savedTokensEstimate = results.length * 2000; // avg file is ~2k tokens raw

    let md = `<dev_clash_memory>\n`;
    md += `<!-- DEV_CLASH Local AI Index — Permanent Repository Memory -->\n`;
    md += `<!-- Task: ${task} -->\n`;
    md += `<!-- Token estimate: ~${Math.round(totalTokensEstimate)} (saved ~${savedTokensEstimate} vs raw files) -->\n\n`;

    results.forEach((r, i) => {
        md += `## [${i + 1}/${results.length}] ${path.basename(r.filePath)}\n`;
        md += `**Path:** \`${r.filePath}\`\n`;
        md += `**Relevance Score:** ${(r.score * 100).toFixed(1)}%\n`;
        md += `**Summary:** ${r.summary}\n`;
        if (r.responsibility) md += `**Responsibility:** ${r.responsibility}\n`;
        if (r.complexity)     md += `**Complexity:** ${r.complexity}\n`;
        if (r.isEntryPoint)   md += `**⚡ Entry Point:** Yes\n`;
        if (r.keyExports?.length)    md += `**Exports:** ${r.keyExports.join(', ')}\n`;
        if (r.internalCalls?.length) md += `**Calls:** ${r.internalCalls.join(', ')}\n`;
        md += `\n`;
    });

    md += `</dev_clash_memory>\n`;
    md += `\n> 💡 Use \`get_file_context\` for deeper info on any file above.\n`;
    md += `> Use \`get_dependency_graph\` to trace import chains.\n`;

    return md;
}
