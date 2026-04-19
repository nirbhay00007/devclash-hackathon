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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Dagre from '@dagrejs/dagre';

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
function applyMultiRepoLayout(
  nodes: BackendNode[],
  edges: BackendEdge[],
): BackendNode[] {
  if (nodes.length === 0) return nodes;

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
    return applySingleRepoLayout(nodes, edges);
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
  });

  return nodes.map(n => ({
    ...n,
    position: positioned.get(n.id) ?? n.position,
  }));
}

function applySingleRepoLayout(nodes: BackendNode[], edges: BackendEdge[]): BackendNode[] {
  if (nodes.length === 0) return nodes;

  const cols = Math.ceil(Math.sqrt(nodes.length));
  const SPACING_X = NODE_W + 80;
  const SPACING_Y = NODE_H + 60;

  return nodes.map((n, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    return {
      ...n,
      position: {
        x: col * SPACING_X,
        y: row * SPACING_Y,
      }
    };
  });
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
const edgeIntraHover = { stroke: '#6366f1', strokeWidth: 3 };
const edgeCross = { stroke: '#f97316', strokeWidth: 2.5, strokeDasharray: '8 4' };
const edgeCrossHover = { stroke: '#ea580c', strokeWidth: 3.5, strokeDasharray: '8 4' };

const markerIntra = { type: 'arrowclosed' as const, color: '#94a3b8', width: 12, height: 12 };
const markerIntraHover = { type: 'arrowclosed' as const, color: '#6366f1', width: 14, height: 14 };
const markerCross = { type: 'arrowclosed' as const, color: '#f97316', width: 14, height: 14 };
const markerCrossHover = { type: 'arrowclosed' as const, color: '#ea580c', width: 16, height: 16 };

const nodeTypes = { custom: CustomNode };

// ─── Component ───────────────────────────────────────────────────────────────

export default function ArchitectureGraph({
  backendNodes,
  backendEdges,
  onNodeSelect,
}: Props) {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const hasInitialized = useRef(false);

  // Initial Collapse: Disabled temporarily to debug visibility
  /*
  useEffect(() => {
    if (!hasInitialized.current && backendNodes.length > 0) {
      const parentIds = new Set(backendEdges.map(e => e.source));
      setCollapsedNodeIds(parentIds);
      hasInitialized.current = true;
    }
  }, [backendNodes, backendEdges]);
  */

  const onToggle = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // Detect cross-repo edges
  const allEdgesBeforeCollapse = useMemo(() => {
    const cross = detectCrossRepoEdges(backendNodes, backendEdges);
    return [...backendEdges, ...cross];
  }, [backendNodes, backendEdges]);

  // Compute visibility based on collapse state
  // [DISABLED] Forcing all nodes to be visible to troubleshoot the 'not showing' issue
  const { visibleNodes, visibleEdges } = useMemo(() => {
    return {
      visibleNodes: backendNodes,
      visibleEdges: allEdgesBeforeCollapse
    };
  }, [backendNodes, allEdgesBeforeCollapse]);

  // Detect cross-repo edges for currently visible graph
  const allEdges = visibleEdges;

  // Auto-layout
  const laidOutNodes = useMemo(
    () => applyMultiRepoLayout(visibleNodes, allEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleNodes.length, allEdges.length],
  );

  const initialNodes: Node[] = useMemo(() =>
    laidOutNodes.map(n => ({
      id: n.id,
      type: 'custom',
      position: n.position,
      sourcePosition: 'bottom' as any,
      targetPosition: 'top' as any,
      data: {
        ...n.data,
        onToggle,
        collapsed: collapsedNodeIds.has(n.id)
      }
    }))
    , [laidOutNodes, onToggle, collapsedNodeIds]);

  const initialEdges: Edge[] = useMemo(() =>
    allEdges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: !!e.crossRepo,
      type: 'default',
      style: e.crossRepo 
          ? { stroke: '#f97316', strokeWidth: 3, opacity: 1 } 
          : { stroke: '#cbd5e1', strokeWidth: 1.5, opacity: 1 },
      markerEnd: e.crossRepo 
          ? { type: 'arrowclosed', color: '#f97316', width: 12, height: 12 }
          : { type: 'arrowclosed', color: '#cbd5e1', width: 10, height: 10 },
      zIndex: e.crossRepo ? 10 : 0,
      data: { crossRepo: !!e.crossRepo },
    }))
    , [allEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(initialEdges); }, [initialEdges, setEdges]);

  // Highlight connected edges in orange when a node is clicked
  const onNodeClick = useCallback((_evt: React.MouseEvent, node: Node) => {
    setEdges(eds => eds.map(e => {
      const isImmediate = e.source === node.id || e.target === node.id;
      const isCross = e.data?.crossRepo;
      return {
        ...e,
        style: isImmediate 
            ? { stroke: '#3b82f6', strokeWidth: 3, opacity: 1, strokeDasharray: '6 4' } 
            : (isCross ? { stroke: '#f97316', strokeWidth: 3, opacity: 1 } : { stroke: '#cbd5e1', strokeWidth: 1.5, opacity: 1 }),
        animated: isImmediate || isCross,
        markerEnd: isImmediate 
            ? { type: 'arrowclosed', color: '#3b82f6', width: 14, height: 14 } 
            : (isCross ? { type: 'arrowclosed', color: '#f97316', width: 12, height: 12 } : { type: 'arrowclosed', color: '#cbd5e1', width: 10, height: 10 }),
        zIndex: isImmediate ? 20 : (isCross ? 10 : 0),
      };
    }));
    const found = backendNodes.find(n => n.id === node.id) ?? null;
    onNodeSelect?.(found);
  }, [setEdges, backendNodes, onNodeSelect]);

  const onPaneClick = useCallback(() => {
    setEdges(eds => eds.map(e => {
      const isCross = e.data?.crossRepo;
      return {
        ...e,
        style: isCross ? { stroke: '#f97316', strokeWidth: 3, opacity: 1 } : { stroke: '#cbd5e1', strokeWidth: 1.5, opacity: 1 },
        animated: !!isCross,
        markerEnd: isCross ? { type: 'arrowclosed', color: '#f97316', width: 12, height: 12 } : { type: 'arrowclosed', color: '#cbd5e1', width: 10, height: 10 },
        zIndex: isCross ? 10 : 0,
      };
    }));
    onNodeSelect?.(null);
  }, [setEdges, onNodeSelect]);

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
      {/* Stats overlay */}
      <div className="graph-overlay">
        <div className="graph-overlay-title">🗺 Architecture Map</div>
        <div className="stat-row"><span>Files</span><span className="stat-val">{stats.files}</span></div>
        <div className="stat-row"><span>Dependencies</span><span className="stat-val">{stats.edges}</span></div>
        {stats.crossEdges > 0 && (
          <div className="stat-row"><span>Cross-repo links</span><span className="stat-val" style={{ color: '#f97316' }}>{stats.crossEdges}</span></div>
        )}
        <div className="stat-row"><span>Entry points</span><span className="stat-val" style={{ color: '#0ea5e9' }}>{stats.entries}</span></div>
        <div className="stat-row"><span>High risk</span><span className="stat-val" style={{ color: '#ef4444' }}>{stats.high}</span></div>
        <div className="stat-row"><span>Orphans</span><span className="stat-val" style={{ color: '#8b5cf6' }}>{stats.orphans}</span></div>

        {/* Legend */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <div className="section-label" style={{ marginTop: 0, marginBottom: 6 }}>Risk</div>
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

        {/* Edge types legend */}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <div className="section-label" style={{ marginTop: 0, marginBottom: 6 }}>Connections</div>
          <div className="legend-row" style={{ gap: 6 }}>
            <div style={{ width: 20, height: 2, background: '#94a3b8', borderRadius: 1 }} />
            <span style={{ fontSize: 10.5 }}>Intra-repo</span>
          </div>
          <div className="legend-row" style={{ gap: 6 }}>
            <div style={{ width: 20, height: 2, background: '#f97316', borderRadius: 1, backgroundImage: 'repeating-linear-gradient(90deg, #f97316 0, #f97316 4px, transparent 4px, transparent 6px)' }} />
            <span style={{ fontSize: 10.5, color: '#f97316', fontWeight: 600 }}>Cross-repo</span>
          </div>
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

        <div style={{ marginTop: 10, fontSize: 10.5, color: '#94a3b8', lineHeight: 1.6 }}>
          💡 Click a node to highlight connections.<br />
          {repos.length > 1 && '🔗 Orange dashed lines = cross-repo links.'}
        </div>
      </div>

      {/* React Flow */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.02}
        maxZoom={2.5}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
        <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 100, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, padding: '4px 8px', borderRadius: 4 }}>
          Rendered: {laidOutNodes.length} nodes | Total: {backendNodes.length}
        </div>
        <Controls style={{ bottom: 16, right: 16, left: 'auto', top: 'auto' }} showInteractive={false} />
        <MiniMap
          style={{ bottom: 16, right: 84 }}
          nodeColor={n => {
            const d = n.data as BackendNode['data'];
            if (d.isOrphan) return '#8b5cf6';
            if (d.isEntryPoint) return '#0ea5e9';
            if (d.risk === 'high') return '#ef4444';
            if (d.risk === 'medium') return '#f59e0b';
            if (d.repoColor) return d.repoColor;
            return '#22c55e';
          }}
          maskColor="rgba(248,250,252,0.75)"
        />
      </ReactFlow>
    </div>
  );
}
