import { Handle, Position } from '@xyflow/react';

const RISK_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  high:   { bg: '#fef2f2', color: '#ef4444', border: '#fca5a5', label: 'High'   },
  medium: { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'Med'    },
  low:    { bg: '#f0fdf4', color: '#16a34a', border: '#86efac', label: 'Low'    },
};

const LAYER_ICON: Record<string, string> = {
  presentation: '🖼', business_logic: '⚙️', data_access: '🗄',
  infrastructure: '🔧', utility: '🔩', config: '⚡', unknown: '📄',
};

export default function CustomNode({ data, id, selected }: { data: any; id: string; selected?: boolean }) {
  const { onToggle, collapsed, isDimmed } = data;
  const icon = LAYER_ICON[data.layer as string] ?? '📄';
 
  let cls = 'file-node shadow-2xl ';
  if (data.isEntryPoint)  cls += 'file-node--entry';
  else if (data.isOrphan) cls += 'file-node--orphan';
  else                    cls += `file-node--${data.risk ?? 'low'}`;
  
  if (selected)           cls += ' selected';
  if (isDimmed)           cls += ' dimmed';

  const filename = data.label.split(/[/\\]/).pop();

  return (
    <div className={cls}>
      {/* Custom Premium Tooltip */}
      <div className="node-tooltip">
        <div className="tooltip-title"><span>{icon}</span> File Metadata</div>
        <div className="tooltip-filename">{filename}</div>
        
        <div className="tooltip-section">
          <div className="tooltip-label">Full Path</div>
          <div className="tooltip-value">{data.fullPath}</div>
        </div>

        {data.repoUrl && (
          <div className="tooltip-section">
            <div className="tooltip-label">Git Source</div>
            <div className="tooltip-value">{data.repoUrl}</div>
          </div>
        )}

        <div className="tooltip-section">
          <div className="tooltip-label">Repository</div>
          <div className="tooltip-value">{data.repoLabel || data.repoId || 'Local'}</div>
        </div>
      </div>

      {/* Expand/Collapse Toggle */}
      <button 
        className="node-toggle"
        onClick={(e) => { e.stopPropagation(); onToggle(id); }}
        style={{
          position: 'absolute',
          top: -8,
          right: -8,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--white)',
          border: '1px solid var(--orange-border)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 800,
          color: 'var(--orange)',
          boxShadow: 'var(--shadow-sm)',
          zIndex: 10,
        }}
      >
        {collapsed ? '+' : '−'}
      </button>
 
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
 
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', overflow: 'hidden' }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span className="node-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filename}</span>
      </div>
 
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
