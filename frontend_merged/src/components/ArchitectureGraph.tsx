import { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import CustomNode from './CustomNode';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BackendNode {
  id: string;
  position: { x: number; y: number };
  data: {
    label: string;
    fullPath: string;
    summary?: string;
    risk?: 'low' | 'medium' | 'high';
    complexity?: 'low' | 'medium' | 'high';
    isEntryPoint?: boolean;
    isOrphan?: boolean;
    keyExports?: string[];
    patterns?: string[];
    externalDeps?: string[];
    fanIn?: number;
    fanOut?: number;
    layer?: string;
    repoId?: string;
    repoColor?: string;
    repoLabel?: string;
    codeQuality?: string;
    responsibility?: string;
    commitChurn?: number;
  };
}

export interface BackendEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  crossRepo?: boolean;
}

interface Props {
  backendNodes: BackendNode[];
  backendEdges: BackendEdge[];
  onNodeSelect?: (node: BackendNode | null) => void;
}

// ─── Auto-layout: multi-repo clustered tree ─────────────────────────────────

const NODE_W = 160;
const NODE_H = 40;

/**
 * Groups nodes by repo, lays out each repo with Dagre as a separate cluster,
 * then positions clusters in a radial pattern around the center.
 * Cross-repo edges connect across cluster boundaries.
 */
interface RepoLayout {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function applyMultiRepoLayout(
  nodes: BackendNode[],
  edges: BackendEdge[],
): { nodes: BackendNode[]; groups: RepoLayout[] } {
  if (nodes.length === 0) return { nodes, groups: [] };

  const groups: RepoLayout[] = [];

  // Group by repo
  const repoGroups = new Map<string, BackendNode[]>();
  nodes.forEach(n => {
    const rid = n.data.repoId ?? '__default__';
    if (!repoGroups.has(rid)) repoGroups.set(rid, []);
    repoGroups.get(rid)!.push(n);
  });

  const repoIds = Array.from(repoGroups.keys());
  const positioned = new Map<string, { x: number; y: number }>();

  if (repoIds.length <= 1) {
    // Single repo — standard Dagre tree
    const laidNodes = applySingleRepoLayout(nodes, edges);
    
    // Compute bounding box for single repo group
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    laidNodes.forEach(n => {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + NODE_W);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + NODE_H);
    });

    groups.push({
      id: nodes[0]?.data.repoId ?? 'default',
      label: nodes[0]?.data.repoLabel ?? 'Repository',
      color: nodes[0]?.data.repoColor ?? '#6366f1',
      x: minX - 40,
      y: minY - 60,
      width: (maxX - minX) + 80,
      height: (maxY - minY) + 100,
    });

    return { nodes: laidNodes, groups };
  }

  // Multi-repo: lay out each cluster, then place clusters radially
  const clusterLayouts = new Map<string, { nodes: BackendNode[]; width: number; height: number }>();

  repoIds.forEach(rid => {
    const repoNodes = repoGroups.get(rid)!;
    const repoNodeIds = new Set(repoNodes.map(n => n.id));
    const repoEdges = edges.filter(e => repoNodeIds.has(e.source) && repoNodeIds.has(e.target));

    const laid = applySingleRepoLayout(repoNodes, repoEdges);

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    laid.forEach(n => {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + NODE_W);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + NODE_H);
    });

    // Normalize to origin
    laid.forEach(n => {
      n.position.x -= minX;
      n.position.y -= minY;
    });

    clusterLayouts.set(rid, {
      nodes: laid,
      width: maxX - minX,
      height: maxY - minY,
    });
  });

  // Place clusters in a grid arrangement
  const totalClusters = repoIds.length;
  const cols = Math.ceil(Math.sqrt(totalClusters));
  const spacingX = 800;
  const spacingY = 600;

  repoIds.forEach((rid, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const cluster = clusterLayouts.get(rid)!;

    // Center clusters in their grid cells
    const offsetX = col * spacingX - (cols * spacingX) / 2 + (spacingX - cluster.width) / 2;
    const offsetY = row * spacingY - (Math.ceil(totalClusters / cols) * spacingY) / 2 + (spacingY - cluster.height) / 2;

    cluster.nodes.forEach(n => {
      positioned.set(n.id, {
        x: n.position.x + offsetX,
        y: n.position.y + offsetY,
      });
    });

    groups.push({
      id: rid,
      label: cluster.nodes[0]?.data.repoLabel ?? rid,
      color: cluster.nodes[0]?.data.repoColor ?? '#6366f1',
      x: offsetX - 40,
      y: offsetY - 60,
      width: cluster.width + 80,
      height: cluster.height + 100,
    });
  });

  return {
    nodes: nodes.map(n => ({
      ...n,
      position: positioned.get(n.id) ?? n.position,
    })),
    groups
  };
}

function applySingleRepoLayout(nodes: BackendNode[], _edges: BackendEdge[]): BackendNode[] {
  if (nodes.length === 0) return nodes;

  // Matrix-style layout
  const sorted = [...nodes].sort((a, b) => {
    if (a.data.isEntryPoint !== b.data.isEntryPoint) return a.data.isEntryPoint ? -1 : 1;
    const riskMap: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const rA = riskMap[a.data.risk ?? 'low'];
    const rB = riskMap[b.data.risk ?? 'low'];
    if (rA !== rB) return rA - rB;
    return a.data.label.localeCompare(b.data.label);
  });

  const cols = Math.max(2, Math.ceil(Math.sqrt(sorted.length)));
  const gapX = 240;
  const gapY = 100;

  return sorted.map((n, i) => ({
    ...n,
    position: {
      x: (i % cols) * gapX,
      y: Math.floor(i / cols) * gapY,
    },
  }));
}

// ─── Cross-repo edge detection ──────────────────────────────────────────────

/**
 * Detects cross-repository connections based on shared external deps,
 * matching file names, or overlapping exports/internal calls.
 */
function detectCrossRepoEdges(
  nodes: BackendNode[],
  existingEdges: BackendEdge[],
): BackendEdge[] {
  const crossEdges: BackendEdge[] = [];
  const existingIds = new Set(existingEdges.map(e => e.id));

  // Build lookup: basename → nodes from different repos
  const byBasename = new Map<string, BackendNode[]>();
  nodes.forEach(n => {
    const base = n.data.label.replace(/\.(ts|tsx|js|jsx|py|java|go|rs)$/, '');
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base)!.push(n);
  });

  // 1. Same basename across repos → likely shared types/interfaces
  byBasename.forEach(group => {
    const repoIds = new Set(group.map(n => n.data.repoId));
    if (repoIds.size <= 1) return;

    // Connect first occurrence in each repo
    const byRepo = new Map<string, BackendNode>();
    group.forEach(n => {
      const rid = n.data.repoId ?? '';
      if (!byRepo.has(rid)) byRepo.set(rid, n);
    });
    const representatives = Array.from(byRepo.values());
    for (let i = 0; i < representatives.length - 1; i++) {
      const edgeId = `cross-${representatives[i].id}-${representatives[i + 1].id}`;
      if (!existingIds.has(edgeId)) {
        crossEdges.push({ id: edgeId, source: representatives[i].id, target: representatives[i + 1].id, crossRepo: true });
        existingIds.add(edgeId);
      }
    }
  });

  // 2. Shared external deps → likely integration points
  const byExtDep = new Map<string, BackendNode[]>();
  nodes.forEach(n => {
    (n.data.externalDeps ?? []).forEach(dep => {
      if (!byExtDep.has(dep)) byExtDep.set(dep, []);
      byExtDep.get(dep)!.push(n);
    });
  });

  byExtDep.forEach(group => {
    const repos = new Set(group.map(n => n.data.repoId));
    if (repos.size <= 1) return;
    // Link entry points from each repo that share this dep
    const entries = group.filter(n => n.data.isEntryPoint || (n.data.fanIn ?? 0) > 2);
    if (entries.length < 2) return;

    const byRepo = new Map<string, BackendNode>();
    entries.forEach(n => {
      const rid = n.data.repoId ?? '';
      if (!byRepo.has(rid)) byRepo.set(rid, n);
    });
    const reps = Array.from(byRepo.values());
    for (let i = 0; i < reps.length - 1; i++) {
      const edgeId = `dep-${reps[i].id}-${reps[i + 1].id}`;
      if (!existingIds.has(edgeId)) {
        crossEdges.push({ id: edgeId, source: reps[i].id, target: reps[i + 1].id, crossRepo: true });
        existingIds.add(edgeId);
      }
    }
  });

  // 3. Check if any existing edges already cross repos (import resolution)
  const nodeRepoMap = new Map<string, string>();
  nodes.forEach(n => nodeRepoMap.set(n.id, n.data.repoId ?? ''));
  existingEdges.forEach(e => {
    const srcRepo = nodeRepoMap.get(e.source);
    const tgtRepo = nodeRepoMap.get(e.target);
    if (srcRepo && tgtRepo && srcRepo !== tgtRepo) {
      e.crossRepo = true;
    }
  });

  return crossEdges;
}

// ─── Edge styles ─────────────────────────────────────────────────────────────

const edgeIntra = { stroke: '#94a3b8', strokeWidth: 2 };
const edgeCross = { stroke: '#2563eb', strokeWidth: 2.5, strokeDasharray: '8 4' };

const markerIntra = { type: 'arrowclosed' as const, color: '#94a3b8', width: 12, height: 12 };
const markerIntraHover = { type: 'arrowclosed' as const, color: '#f97316', width: 14, height: 14 };
const markerCross = { type: 'arrowclosed' as const, color: '#2563eb', width: 14, height: 14 };

// ─── Custom Components ───────────────────────────────────────────────────────

function RepoGroupNode({ data }: { data: { label: string; color: string; width: number; height: number } }) {
  return (
    <div className="repo-group-node" style={{ 
      width: data.width, 
      height: data.height,
      borderColor: `${data.color}44`,
      background: `${data.color}08`
    }}>
      <div className="repo-group-header" style={{ borderColor: `${data.color}66` }}>
        <div className="repo-group-dot" style={{ background: data.color }} />
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { 
  custom: CustomNode,
  repoGroup: RepoGroupNode 
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ArchitectureGraph({
  backendNodes,
  backendEdges,
  onNodeSelect,
}: Props) {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const hasInitialized = useRef(false);

  // Initial Collapse: All parents (nodes with children) start compressed, EXCEPT ancestors of cross-repo nodes
  useEffect(() => {
    if (!hasInitialized.current && backendNodes.length > 0) {
      const parentIds = new Set(backendEdges.map(e => e.source));
      
      // Find cross-repo edges so we can auto-expand their nodes
      const cross = detectCrossRepoEdges(backendNodes, backendEdges);
      const crossNodeIds = new Set<string>();
      cross.forEach(e => { crossNodeIds.add(e.source); crossNodeIds.add(e.target); });

      // Trace back incoming edges to find all ancestors
      const toUncollapse = new Set<string>();
      const queue = Array.from(crossNodeIds);
      const visited = new Set<string>(queue);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        backendEdges.filter(e => e.target === curr).forEach(e => {
          if (!visited.has(e.source)) {
            visited.add(e.source);
            queue.push(e.source);
            toUncollapse.add(e.source); // Parent must be expanded to reveal child
          }
        });
      }

      // Remove ancestors from the collapse list so paths to cross-nodes are visible
      toUncollapse.forEach(id => parentIds.delete(id));

      setCollapsedNodeIds(parentIds);
      hasInitialized.current = true;
    }
  }, [backendNodes, backendEdges]);

  const onToggle = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const onReset = useCallback(() => {
    const parentIds = new Set(backendEdges.map(e => e.source));
    setCollapsedNodeIds(parentIds);
    setSelectedNodeId(null);
    onNodeSelect?.(null);
    
    // Smoothly refit the view after resetting state
    setTimeout(() => {
      rfInstance?.fitView({ duration: 800, padding: 0.15 });
    }, 50);
  }, [backendEdges, onNodeSelect, rfInstance]);

  // Detect cross-repo edges
  const allEdgesBeforeCollapse = useMemo(() => {
    const cross = detectCrossRepoEdges(backendNodes, backendEdges);
    return [...backendEdges, ...cross];
  }, [backendNodes, backendEdges]);

  // Compute visibility based on collapse state
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const visibleNodeIds = new Set<string>();
    const visited = new Set<string>();
    const stack: { id: string; hidden: boolean }[] = [];

    // Identify roots (entry points or nodes with no incoming edges)
    const roots = backendNodes.filter(n =>
      n.data?.isEntryPoint || !backendEdges.some(e => e.target === n.id)
    );

    roots.forEach(r => stack.push({ id: r.id, hidden: false }));

    while (stack.length > 0) {
      const { id, hidden } = stack.pop()!;
      if (visited.has(id)) {
        if (!hidden) visibleNodeIds.add(id);
        continue;
      }
      visited.add(id);

      if (!hidden) visibleNodeIds.add(id);

      const shouldHideChildren = hidden || collapsedNodeIds.has(id);
      backendEdges.filter(e => e.source === id).forEach(e => {
        stack.push({ id: e.target, hidden: shouldHideChildren });
      });
    }

    // Ensure orphans are visible
    backendNodes.forEach(n => {
      if (!visited.has(n.id)) visibleNodeIds.add(n.id);
    });

    return {
      visibleNodes: backendNodes.filter(n => visibleNodeIds.has(n.id)),
      visibleEdges: allEdgesBeforeCollapse.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
    };
  }, [backendNodes, backendEdges, allEdgesBeforeCollapse, collapsedNodeIds]);

  // Detect cross-repo edges for currently visible graph
  const allEdges = visibleEdges;

  // Auto-layout
  const { nodes: laidOutNodes, groups } = useMemo(
    () => applyMultiRepoLayout(visibleNodes, allEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleNodes.length, allEdges.length],
  );

  const initialNodes: Node[] = useMemo(() => {
    const fileNodes: Node[] = laidOutNodes.map(n => {
      const isDimmed = selectedNodeId !== null && selectedNodeId !== n.id && 
                       !allEdges.some(e => (e.source === selectedNodeId && e.target === n.id) || (e.target === selectedNodeId && e.source === n.id));

      return {
        id: n.id,
        type: 'custom',
        position: n.position,
        className: isDimmed ? 'dimmed' : '',
        data: {
          ...n.data,
          onToggle,
          collapsed: collapsedNodeIds.has(n.id),
          isDimmed
        }
      };
    });

    const groupNodes: Node[] = groups.map(g => ({
      id: `group-${g.id}`,
      type: 'repoGroup',
      position: { x: g.x, y: g.y },
      data: { label: g.label, color: g.color, width: g.width, height: g.height },
      selectable: false,
      draggable: false,
      zIndex: -10,
    }));

    return [...groupNodes, ...fileNodes];
  }
    , [laidOutNodes, groups, onToggle, collapsedNodeIds, selectedNodeId, allEdges]);

  const initialEdges: Edge[] = useMemo(() =>
    allEdges.map(e => {
      const isCross = !!e.crossRepo;
      const isSelected = selectedNodeId !== null && (e.source === selectedNodeId || e.target === selectedNodeId);
      const isDimmed = selectedNodeId !== null && !isSelected;

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: isSelected || isCross,
        type: 'default', // Curvy bezier edges
        className: isSelected ? 'edge-selected' : (isCross ? 'edge-cross-repo' : (isDimmed ? 'dimmed' : '')),
        style: isSelected ? { stroke: '#f97316', strokeWidth: 3.5 } : (isCross ? edgeCross : (isDimmed ? { opacity: 0.1 } : edgeIntra)),
        markerEnd: isSelected ? markerIntraHover : (isCross ? markerCross : markerIntra),
        label: isCross ? '⟷' : undefined,
        labelStyle: isCross ? { fontSize: 12, fill: '#2563eb', fontWeight: 700 } : undefined,
        labelBgStyle: isCross ? { fill: '#eff6ff', stroke: '#bfdbfe', strokeWidth: 1 } : undefined,
        labelBgPadding: isCross ? [4, 6] as [number, number] : undefined,
        zIndex: isSelected ? 100 : (isCross ? 10 : 0),
      };
    })
    , [allEdges, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(initialEdges); }, [initialEdges, setEdges]);

  const onNodeClick = useCallback((_evt: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    const found = backendNodes.find(n => n.id === node.id) ?? null;
    onNodeSelect?.(found);
  }, [backendNodes, onNodeSelect]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  // Stats
  const stats = useMemo(() => ({
    files: backendNodes.length,
    edges: backendEdges.length,
    crossEdges: allEdges.filter(e => e.crossRepo).length,
    entries: backendNodes.filter(n => n.data.isEntryPoint).length,
    high: backendNodes.filter(n => n.data.risk === 'high').length,
    orphans: backendNodes.filter(n => n.data.isOrphan).length,
  }), [backendNodes, backendEdges, allEdges]);

  // Collect unique repos
  const repos = useMemo(() => {
    const map = new Map<string, { color: string; label: string }>();
    backendNodes.forEach(n => {
      if (n.data.repoId && !map.has(n.data.repoId)) {
        map.set(n.data.repoId, { color: n.data.repoColor ?? '#6366f1', label: n.data.repoLabel ?? n.data.repoId });
      }
    });
    return Array.from(map.entries());
  }, [backendNodes]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Search & Stats overlay */}
      <div className="graph-overlay">
        <div className="stat-row"><span>Files</span><span className="stat-val">{stats.files}</span></div>
        <div className="stat-row"><span>Dependencies</span><span className="stat-val">{stats.edges}</span></div>
        {stats.crossEdges > 0 && (
          <div className="stat-row"><span>Cross-repo links</span><span className="stat-val" style={{ color: '#2563eb' }}>{stats.crossEdges}</span></div>
        )}
        <div className="stat-row"><span>Entry points</span><span className="stat-val" style={{ color: '#0ea5e9' }}>{stats.entries}</span></div>
        <div className="stat-row"><span>High risk</span><span className="stat-val" style={{ color: '#ef4444' }}>{stats.high}</span></div>

        {/* Legend */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <div className="section-label" style={{ marginTop: 0, marginBottom: 6 }}>Risk Levels</div>
          {[
            { color: '#ef4444', label: 'High risk' },
            { color: '#f59e0b', label: 'Medium risk' },
            { color: '#22c55e', label: 'Low risk' },
            { color: '#0ea5e9', label: 'Entry point' },
            { color: '#8b5cf6', label: 'Orphan' },
          ].map(l => (
            <div key={l.label} className="legend-row">
              <div className="legend-swatch" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>

        {/* Multi-repo legend */}
        {repos.length > 1 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
            <div className="section-label" style={{ marginTop: 0, marginBottom: 6 }}>Repositories</div>
            {repos.map(([id, { color, label }]) => (
              <div key={id} className="legend-row">
                <div className="repo-legend-dot" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 10.5, color: '#9ca3af', lineHeight: 1.6 }}>
          💡 Click a node to focus its connections.<br />
          {repos.length > 1 && '🔗 Blue dashed lines = cross-repo links.'}
        </div>

        <button 
          onClick={onReset}
          className="btn btn-outline btn-sm btn-reset-graph"
          style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 0' }}
          title="Reset graph to initial configuration (collapse all files)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Reset View
        </button>
      </div>

      {/* React Flow */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={setRfInstance}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.02}
        maxZoom={2.5}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
        <Controls style={{ bottom: 16, right: 16, left: 'auto', top: 'auto' }} showInteractive={false} />
        <MiniMap
          style={{ bottom: 16, right: 84 }}
          nodeColor={n => {
            const d = n.data as BackendNode['data'];
            if (d.isEntryPoint) return '#0ea5e9';
            if (d.repoColor) return d.repoColor;
            if (d.risk === 'high') return '#ef4444';
            if (d.risk === 'medium') return '#f59e0b';
            return '#22c55e';
          }}
          maskColor="rgba(248,250,252,0.75)"
        />
      </ReactFlow>
    </div>
  );
}
