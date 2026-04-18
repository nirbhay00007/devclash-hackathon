import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import CustomNode from './CustomNode';

// Local type aliases compatible with @xyflow/react v12
type RFNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: any;
};
type RFEdge = {
  id: string;
  source: string;
  target: string;
  style?: React.CSSProperties;
  animated?: boolean;
};

export default function ArchitectureGraph({ backendNodes }: { backendNodes: any[] }) {
  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);

  const initialNodes: RFNode[] = useMemo(() => {
    return backendNodes.map((n, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      return {
        id: n.id || n.data?.fullPath || `node-${i}`,
        type: 'custom',
        position: { x: col * 360, y: row * 220 },
        data: n.data,
      };
    });
  }, [backendNodes]);

  const initialEdges: RFEdge[] = useMemo(() => {
    const edges: RFEdge[] = [];
    backendNodes.forEach((n, i) => {
      if (i > 0) {
        edges.push({
          id: `e-${i - 1}-${i}`,
          source: backendNodes[i - 1].id || `node-${i - 1}`,
          target: n.id || `node-${i}`,
          style: { stroke: '#cbd5e1', strokeWidth: 2 },
          animated: false,
        });
      }
    });
    return edges;
  }, [backendNodes]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: RFNode) => {
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.source === node.id || edge.target === node.id) {
            return { ...edge, style: { stroke: '#fb923c', strokeWidth: 3 }, animated: true };
          }
          return { ...edge, style: { stroke: '#cbd5e1', strokeWidth: 2 }, animated: false };
        })
      );
    },
    [setEdges]
  );

  const onPaneClick = useCallback(() => {
    setEdges((eds) =>
      eds.map((edge) => ({ ...edge, style: { stroke: '#cbd5e1', strokeWidth: 2 }, animated: false }))
    );
  }, [setEdges]);

  const controllerCount = backendNodes.filter(
    (n) => n.data?.label?.includes('Controller') || n.data?.patterns?.includes('Controller')
  ).length;
  const serviceCount = backendNodes.filter(
    (n) => n.data?.label?.includes('Service') || n.data?.patterns?.includes('Service')
  ).length;
  const highRiskCount = backendNodes.filter((n) => n.data?.risk === 'high').length;

  return (
    <div style={{ width: '100%', height: '640px', display: 'flex', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
      {/* Sidebar */}
      <aside style={{
        width: '240px',
        minWidth: '240px',
        padding: '28px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        background: '#ffffff',
        borderRight: '1px solid #fed7aa',
        boxShadow: '4px 0 16px rgba(249,115,22,0.06)',
        zIndex: 10,
      }}>
        <div>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '1rem', fontWeight: 700, margin: 0, color: '#1c0a00', letterSpacing: '-0.02em' }}>
            🗺 Architecture Map
          </h2>
          <p style={{ fontSize: '0.75rem', color: '#92400e', margin: '6px 0 0', lineHeight: 1.5 }}>
            {backendNodes.length} nodes visualized
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <StatRow label="Controllers" value={controllerCount} color="#f97316" />
          <StatRow label="Services" value={serviceCount} color="#d97706" />
          <StatRow label="High Risk" value={highRiskCount} color="#dc2626" />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: 0 }} />

        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Legend
          </p>
          <LegendItem color="#fb923c" label="Controller" />
          <LegendItem color="#facc15" label="Service" />
          <LegendItem color="#e2e8f0" label="Other" />
        </div>

        <div style={{ marginTop: 'auto', fontSize: '0.7rem', color: '#d97706', lineHeight: 1.6, background: '#fff7ed', padding: '8px 10px', borderRadius: 8 }}>
          💡 Click a node to highlight its connections
        </div>
      </aside>

      {/* Graph */}
      <div style={{ flexGrow: 1, position: 'relative', background: '#fffbf5' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick as any}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          defaultEdgeOptions={{ style: { stroke: '#cbd5e1', strokeWidth: 2 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
          <Controls style={{ bottom: 24, right: 24, left: 'auto', top: 'auto' }} />
          <MiniMap
            style={{ bottom: 24, left: 'auto', right: 80, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}
            nodeColor={(n) => {
              const lbl: string = n.data?.label ?? '';
              if (lbl.includes('Controller')) return '#fb923c';
              if (lbl.includes('Service')) return '#facc15';
              return '#94a3b8';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{label}</span>
      <span style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: '0.9rem',
        color,
        background: `${color}18`,
        padding: '2px 8px',
        borderRadius: '6px',
      }}>
        {value}
      </span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: 12, height: 12, borderRadius: 3, background: color, border: color === '#e2e8f0' ? '1px solid #cbd5e1' : 'none', flexShrink: 0 }} />
      <span style={{ fontSize: '0.8rem', color: '#475569' }}>{label}</span>
    </div>
  );
}
