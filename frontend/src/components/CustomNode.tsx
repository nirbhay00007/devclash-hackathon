import { Handle, Position } from '@xyflow/react';

interface NodeData {
  label: string;
  summary?: string;
  risk?: 'low' | 'medium' | 'high';
  isEntryPoint?: boolean;
  isOrphan?: boolean;
  fanIn?: number;
  repoColor?: string;
  repoLabel?: string;
  layer?: string;
  complexity?: 'low' | 'medium' | 'high';
  patterns?: string[];
}

const RISK_STYLE = {
  high:   { bg: '#fef2f2', color: '#ef4444', border: '#fca5a5', label: 'High'   },
  medium: { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'Med'    },
  low:    { bg: '#f0fdf4', color: '#16a34a', border: '#86efac', label: 'Low'    },
};

const LAYER_ICON: Record<string, string> = {
  presentation: '🖼', business_logic: '⚙️', data_access: '🗄',
  infrastructure: '🔧', utility: '🔩', config: '⚡', unknown: '📄',
};

export default function CustomNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const r   = RISK_STYLE[data.risk ?? 'low'];
  const icon = LAYER_ICON[data.layer ?? 'unknown'] ?? '📄';

  let cls = 'file-node ';
  if (data.isEntryPoint)  cls += 'file-node--entry';
  else if (data.isOrphan) cls += 'file-node--orphan';
  else                    cls += `file-node--${data.risk ?? 'low'}`;
  if (selected)           cls += ' selected';

  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0.5 }} />

      {/* Repo strip */}
      {data.repoColor && (
        <div className="node-repo-strip" style={{ background: data.repoColor }} />
      )}

      {/* Name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <span style={{ fontSize: 10 }}>{icon}</span>
        <span className="node-name">{data.label}</span>
      </div>

      {/* Summary */}
      {data.summary && <div className="node-summary">{data.summary}</div>}

      {/* Tags */}
      <div className="node-tags">
        <span className="node-tag" style={{ background: r.bg, color: r.color, borderColor: r.border }}>
          {r.label} risk
        </span>
        {data.isEntryPoint && (
          <span className="node-tag" style={{ background:'#f0f9ff', color:'#0ea5e9', borderColor:'#bae6fd' }}>entry</span>
        )}
        {data.isOrphan && (
          <span className="node-tag" style={{ background:'#f5f3ff', color:'#7c3aed', borderColor:'#ddd6fe' }}>orphan</span>
        )}
        {(data.fanIn ?? 0) > 0 && (
          <span className="node-tag" style={{ background:'#f9fafb', color:'#6b7280', borderColor:'#e5e7eb' }}>
            ↙ {data.fanIn}
          </span>
        )}
        {data.repoLabel && (
          <span className="node-tag"
            style={{ background:`${data.repoColor}18`, color: data.repoColor, borderColor:`${data.repoColor}50` }}>
            {data.repoLabel}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0.5 }} />
    </div>
  );
}
