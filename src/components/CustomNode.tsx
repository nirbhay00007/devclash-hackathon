import { Handle, Position } from '@xyflow/react';

export default function CustomNode({ data }: { data: any }) {
  const isController = data?.label?.includes('Controller') || data?.patterns?.includes('Controller');
  const isService    = data?.label?.includes('Service')    || data?.patterns?.includes('Service');

  const nodeTypeClass = isController ? 'node-controller'
                      : isService    ? 'node-service'
                      : 'node-default';

  const riskColor = data?.risk === 'high' ? '#dc2626'
                  : data?.risk === 'medium' ? '#d97706'
                  : '#16a34a';

  const icon = isController ? '🎛️' : isService ? '⚙️' : '📄';

  return (
    <div className={`custom-node-wrapper ${nodeTypeClass}`}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#f97316', width: 8, height: 8, border: '2px solid #fff' }}
      />

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span className="node-title">{data?.label ?? 'Unknown'}</span>
      </div>

      {/* Summary */}
      {data?.summary && (
        <div style={{ fontSize: '0.72rem', color: '#92400e', lineHeight: 1.5, marginBottom: 8 }}>
          {data.summary.slice(0, 80)}{data.summary.length > 80 ? '…' : ''}
        </div>
      )}

      {/* Tags row */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {/* Risk chip */}
        <span style={{
          background: `${riskColor}18`,
          color: riskColor,
          borderRadius: 4,
          padding: '2px 7px',
          fontSize: '0.65rem',
          fontWeight: 700,
          border: `1px solid ${riskColor}30`,
        }}>
          {data?.risk ?? 'low'} risk
        </span>

        {/* Entry point */}
        {data?.isEntryPoint && (
          <span style={{
            background: '#fff7ed',
            color: '#c2410c',
            borderRadius: 4,
            padding: '2px 7px',
            fontSize: '0.65rem',
            fontWeight: 700,
          }}>
            entry
          </span>
        )}

        {/* Fan-in */}
        {data?.fanIn > 0 && (
          <span style={{
            background: '#fefce8',
            color: '#854d0e',
            borderRadius: 4,
            padding: '2px 7px',
            fontSize: '0.65rem',
            fontWeight: 600,
          }}>
            ↙ {data.fanIn}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#facc15', width: 8, height: 8, border: '2px solid #fff' }}
      />
    </div>
  );
}
