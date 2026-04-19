const API = 'http://localhost:3001';

interface NodeData {
  label: string; fullPath: string; summary?: string; responsibility?: string;
  risk?: 'low' | 'medium' | 'high'; complexity?: 'low' | 'medium' | 'high';
  codeQuality?: string; layer?: string; isEntryPoint?: boolean; isOrphan?: boolean;
  keyExports?: string[]; patterns?: string[]; externalDeps?: string[];
  fanIn?: number; fanOut?: number; commitChurn?: number;
  repoColor?: string; repoLabel?: string;
}
interface Props { node: { id: string; data: NodeData } | null; onClose: () => void; }

const RISK = { high: { bg:'#fef2f2', color:'#dc2626', border:'#fca5a5', label:'High Risk' }, medium: { bg:'#fffbeb', color:'#d97706', border:'#fde68a', label:'Medium' }, low: { bg:'#f0fdf4', color:'#16a34a', border:'#86efac', label:'Low' } };
const LAYER: Record<string,string> = { presentation:'Presentation', business_logic:'Business Logic', data_access:'Data Access', infrastructure:'Infrastructure', utility:'Utility', config:'Config', unknown:'Unknown' };
const Q: Record<string,{color:string;label:string}> = { clean:{color:'#16a34a',label:'✓ Clean'}, acceptable:{color:'#0ea5e9',label:'~ OK'}, needs_refactor:{color:'#d97706',label:'⚠ Refactor'} };

async function vscOpen(p:string) { try { await fetch(`${API}/api/fs/open`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})}); } catch{} }

export default function NodeDetailPanel({ node, onClose }: Props) {
  const d = node?.data;
  const risk = RISK[d?.risk ?? 'low'];
  
  return (
    <div className={`detail-panel${node ? ' open' : ''}`}>
      <div className="dp-header">
        {d?.repoColor && <div style={{ width: 4, borderRadius: 99, background: d.repoColor, alignSelf: 'stretch', margin: '-14px 0 -14px 0', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:4 }}>
            {d?.repoLabel && <span className="chip chip-orange" style={{ fontSize: 10 }}>{d.repoLabel}</span>}
            {d?.isEntryPoint && <span className="chip chip-sky" style={{ fontSize:10 }}>Entry Point</span>}
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: 'var(--black)' }}>{d?.label ?? '—'}</div>
          <div style={{ fontSize:10, color:'var(--gray-400)', fontFamily:'var(--font-mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>{d?.fullPath ?? ''}</div>
        </div>
        <button className="dp-close" onClick={onClose}>✕</button>
      </div>

      {d && (
        <div className="dp-body" style={{ padding: '16px', overflowY: 'auto' }}>
          
          {/* Summary Section */}
          <div style={{ marginBottom: 20 }}>
            <div className="dp-label" style={{ marginBottom: 8, color: 'var(--orange)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>🤖 AI Summary</div>
            <p style={{ fontSize:12.5, color:'var(--gray-700)', lineHeight:1.7, margin: 0 }}>{d.summary}</p>
            {d.responsibility && d.responsibility !== d.summary && (
              <p style={{ fontSize:11.5, color:'var(--gray-500)', lineHeight:1.6, marginTop: 8, fontStyle:'italic', borderLeft: '2px solid var(--gray-200)', paddingLeft: 8 }}>{d.responsibility}</p>
            )}
          </div>

          {/* Technical Insights Grid */}
          <div className="dp-label" style={{ marginBottom: 10, color: 'var(--orange)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>🔍 Technical Insights</div>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '8px',
            marginBottom: 20 
          }}>
            <DetailRow label="Layer" value={LAYER[d.layer ?? 'unknown'] ?? d.layer} />
            <DetailRow label="Complexity" value={d.complexity ?? 'low'} />
            <DetailRow label="Risk" value={risk.label} highlight={d.risk === 'high'} />
            <DetailRow label="Code Quality" value={d.codeQuality ? (Q[d.codeQuality]?.label ?? d.codeQuality) : 'Acceptable'} />
          </div>

          {/* Metrics Row */}
          <div className="metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: 20 }}>
            <div className="metric-box" style={{ background: 'var(--gray-50)', padding: '10px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--gray-100)' }}>
              <div className="metric-val" style={{ color:'var(--orange)', fontSize: 16, fontWeight: 800 }}>{d.fanIn??0}</div>
              <div className="metric-lbl" style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', fontWeight: 600 }}>Fan-In</div>
            </div>
            <div className="metric-box" style={{ background: 'var(--gray-50)', padding: '10px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--gray-100)' }}>
              <div className="metric-val" style={{ color:'#7c3aed', fontSize: 16, fontWeight: 800 }}>{d.fanOut??0}</div>
              <div className="metric-lbl" style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', fontWeight: 600 }}>Fan-Out</div>
            </div>
            <div className="metric-box" style={{ background: 'var(--gray-50)', padding: '10px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--gray-100)' }}>
              <div className="metric-val" style={{ color: d.commitChurn?'#d97706':'var(--gray-300)', fontSize: 16, fontWeight: 800 }}>{d.commitChurn??0}</div>
              <div className="metric-lbl" style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', fontWeight: 600 }}>Churn</div>
            </div>
          </div>

          {/* Tags Sections */}
          {(d.keyExports?.length??0)>0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="dp-label" style={{ marginBottom: 8, fontSize: 11, fontWeight: 700, color: 'var(--gray-400)' }}>📦 Key Exports</div>
              <div className="tag-pile" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {d.keyExports!.slice(0, 10).map(e=><span key={e} className="mono-tag" style={{ background: 'var(--gray-100)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{e}</span>)}
              </div>
            </div>
          )}

          {(d.patterns?.length??0)>0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="dp-label" style={{ marginBottom: 8, fontSize: 11, fontWeight: 700, color: 'var(--gray-400)' }}>🏷 Design Patterns</div>
              <div className="tag-pile" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {d.patterns!.map(p=><span key={p} className="pattern-tag" style={{ background: 'var(--orange-light)', color: 'var(--orange)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>{p}</span>)}
              </div>
            </div>
          )}

          <button className="btn btn-orange btn-sm" style={{ width:'100%', marginTop:10, boxShadow: 'none' }} onClick={() => vscOpen(d.fullPath)}>
            📂 Open in VS Code
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ 
      background: 'var(--white)', 
      padding: '8px 10px', 
      borderRadius: '8px', 
      border: '1px solid var(--gray-100)',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }}>
      <span style={{ fontSize: '9px', color: 'var(--gray-400)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: '11.5px', fontWeight: 700, color: highlight ? 'var(--red)' : 'var(--black)', textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}
