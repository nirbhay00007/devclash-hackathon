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
            {d?.risk && <span style={{ padding:'1px 7px', borderRadius:'var(--r-full)', background: risk.bg, color: risk.color, border:`1px solid ${risk.border}`, fontSize:10.5, fontWeight:600 }}>{risk.label}</span>}
            {d?.isEntryPoint && <span className="chip chip-sky" style={{ fontSize:10 }}>Entry</span>}
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d?.label ?? '—'}</div>
          <div style={{ fontSize:10.5, color:'var(--gray-400)', fontFamily:'var(--font-mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>{d?.fullPath ?? ''}</div>
        </div>
        <button className="dp-close" onClick={onClose}>✕</button>
      </div>

      {d && (
        <div className="dp-body">
          <div className="metric-grid">
            <div className="metric-box"><div className="metric-val" style={{ color:'var(--orange)' }}>{d.fanIn??0}</div><div className="metric-lbl">Fan-In</div></div>
            <div className="metric-box"><div className="metric-val" style={{ color:'#7c3aed' }}>{d.fanOut??0}</div><div className="metric-lbl">Fan-Out</div></div>
            <div className="metric-box"><div className="metric-val" style={{ color: d.commitChurn?'#d97706':'var(--gray-300)' }}>{d.commitChurn??0}</div><div className="metric-lbl">Churn</div></div>
          </div>

          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            {d.layer && <span className="chip chip-gray">{LAYER[d.layer]??d.layer}</span>}
            {d.complexity && <span className={`chip chip-${d.complexity==='high'?'red':d.complexity==='medium'?'amber':'green'}`}>{d.complexity} complexity</span>}
            {d.codeQuality && Q[d.codeQuality] && <span className="chip chip-gray" style={{ color: Q[d.codeQuality].color }}>{Q[d.codeQuality].label}</span>}
          </div>

          {d.summary && (<><div className="dp-label">Summary</div><p style={{ fontSize:12.5, color:'var(--gray-500)', lineHeight:1.75 }}>{d.summary}</p></>)}
          {d.responsibility && d.responsibility !== d.summary && (<><div className="dp-label">Responsibility</div><p style={{ fontSize:12, color:'var(--gray-500)', lineHeight:1.65, fontStyle:'italic' }}>{d.responsibility}</p></>)}

          {(d.keyExports?.length??0)>0 && (<><div className="dp-label">Key Exports</div><div className="tag-pile">{d.keyExports!.map(e=><span key={e} className="mono-tag">{e}</span>)}</div></>)}
          {(d.patterns?.length??0)>0 && (<><div className="dp-label">Design Patterns</div><div className="tag-pile">{d.patterns!.map(p=><span key={p} className="pattern-tag">🏷 {p}</span>)}</div></>)}
          {(d.externalDeps?.length??0)>0 && (<><div className="dp-label">External Deps</div><div className="tag-pile">{d.externalDeps!.map(dep=><span key={dep} className="dep-tag">{dep}</span>)}</div></>)}

          <button className="btn btn-outline btn-sm" style={{ width:'100%', marginTop:6 }} onClick={() => vscOpen(d.fullPath)}>📂 Open in VS Code</button>
        </div>
      )}
    </div>
  );
}
