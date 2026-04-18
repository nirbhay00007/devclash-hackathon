import { useState, useRef } from 'react';
import ArchitectureGraph from './components/ArchitectureGraph';

interface NodeData {
  id: string;
  data: {
    label: string; fullPath: string; summary: string;
    risk: 'low' | 'medium' | 'high'; complexity: 'low' | 'medium' | 'high';
    isEntryPoint: boolean; keyExports: string[]; patterns: string[];
    externalDeps: string[]; fanIn: number;
  };
}
interface GlobalSummary {
  overallPurpose: string; techStack: string[]; architecturalStyle: string;
  coreSubsystems: { name: string; description: string; files: string[] }[];
  complexityHotspots: string[]; entryPoints: string[]; suggestedImprovements: string[];
}
interface QueryAnalysis {
  explanation: string;
  subsystems: { name: string; description: string; files: string[] }[];
  highRiskFiles: string[]; learningPath: string[]; recommendations: string[];
}

const API = 'http://localhost:3001';

// ─── Color palette ───────────────────────────────────────────────────────────
const C = {
  orange:       '#f97316',
  orangeLight:  '#fff7ed',
  orangeBorder: '#fed7aa',
  yellow:       '#facc15',
  yellowLight:  '#fefce8',
  white:        '#ffffff',
  pageBg:       '#fffbf5',
  text:         '#1c0a00',
  textMuted:    '#92400e',
  textGray:     '#a3a3a3',
};

export default function App() {
  const [targetPath, setTargetPath] = useState('C:\\College\\DEV_CLASH\\backend\\src');
  const [query, setQuery]           = useState('');
  const [status, setStatus]         = useState<string[]>([]);
  const [progress, setProgress]     = useState(0);
  const [running, setRunning]       = useState(false);
  const [nodes, setNodes]           = useState<NodeData[]>([]);
  const [globalSummary, setGlobalSummary] = useState<GlobalSummary | null>(null);
  const [queryResult, setQueryResult]     = useState<QueryAnalysis | null>(null);
  const [queryFiles, setQueryFiles]       = useState<{ path: string; score: number }[]>([]);
  const [querying, setQuerying]     = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const startAnalysis = async () => {
    if (running) return;
    setRunning(true); setStatus([]); setProgress(0); setNodes([]); setGlobalSummary(null); setQueryResult(null);
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath }), signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) { setStatus(p => [...p, `❌ HTTP ${res.status}`]); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim().replace(/^data:\s*/, ''); if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.message)  setStatus(p => [...p.slice(-60), evt.message]);
            if (evt.progress != null) setProgress(evt.progress);
            if (evt.phase === 'result') {
              if (evt.graph?.nodes) setNodes(evt.graph.nodes);
              if (evt.globalSummary) setGlobalSummary(evt.globalSummary);
            }
            if (evt.phase === 'error') setStatus(p => [...p, `❌ ${evt.message}`]);
          } catch { /* noop */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setStatus(p => [...p, `❌ ${String(e)}`]);
    } finally { setRunning(false); setProgress(100); }
  };

  const stopAnalysis = () => {
    abortRef.current?.abort(); setStatus(p => [...p, '⏹ Cancelled.']); setRunning(false);
  };

  const runQuery = async () => {
    if (!query.trim() || querying) return;
    setQuerying(true); setQueryResult(null); setQueryFiles([]);
    try {
      const res  = await fetch(`${API}/api/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const json = await res.json();
      if (json.success) { setQueryResult(json.analysis); setQueryFiles(json.relevantFiles ?? []); }
      else alert(json.error ?? 'Query failed.');
    } catch (e) { alert(`Query error: ${e}`); }
    finally { setQuerying(false); }
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: C.pageBg, minHeight: '100vh' }}>

      {/* ── HEADER ── */}
      <header style={{
        background: C.white,
        borderBottom: `2px solid ${C.orangeBorder}`,
        padding: '0 40px', height: 64,
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 12px rgba(249,115,22,0.08)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.orange} 0%, ${C.yellow} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, boxShadow: '0 4px 12px rgba(249,115,22,0.3)',
          }}>🧠</div>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: '1.15rem', color: C.text, letterSpacing: '-0.02em' }}>
            CodeMap <span style={{ color: C.orange }}>AI</span>
          </span>
        </div>

        {/* Tagline pill */}
        <div style={{ marginLeft: 16, background: C.orangeLight, color: C.textMuted, borderRadius: 99, padding: '3px 12px', fontSize: '0.72rem', fontWeight: 600, border: `1px solid ${C.orangeBorder}` }}>
          Ollama + Gemini
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {nodes.length > 0 && (
            <span style={{ background: C.yellow, color: '#78350f', fontWeight: 700, borderRadius: 99, padding: '3px 12px', fontSize: '0.75rem' }}>
              {nodes.length} nodes mapped
            </span>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 24px 80px' }}>

        {/* Hero text */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '2.2rem', fontWeight: 700, color: C.text, margin: '0 0 10px', letterSpacing: '-0.03em' }}>
            AI Codebase Navigator
          </h1>
          <p style={{ color: C.textMuted, fontSize: '0.95rem', margin: 0 }}>
            Ingest any codebase → visualize its architecture → ask questions in natural language
          </p>
        </div>

        {/* ── STEP 1: Ingest ── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <StepBadge n={1} /> 
            <h2 style={stepTitle}>Ingest Repository</h2>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <input
              id="repo-path"
              value={targetPath}
              onChange={e => setTargetPath(e.target.value)}
              placeholder="Absolute path to repo root…"
              style={inputStyle}
              disabled={running}
            />
            <button
              id="run-btn"
              onClick={running ? stopAnalysis : startAnalysis}
              style={{
                ...btnStyle,
                background: running
                  ? '#fef2f2'
                  : `linear-gradient(135deg, ${C.orange} 0%, ${C.yellow} 100%)`,
                color: running ? '#dc2626' : C.white,
                boxShadow: running ? 'none' : '0 4px 14px rgba(249,115,22,0.35)',
                minWidth: 160,
              }}
            >
              {running ? `⏹ Stop  ${progress}%` : '▶  Run Analysis'}
            </button>
          </div>

          {/* Progress bar */}
          {running && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: '0.75rem', color: C.textGray }}>Analyzing…</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: C.orange }}>{progress}%</span>
              </div>
              <div style={{ background: C.orangeLight, borderRadius: 99, height: 8, overflow: 'hidden', border: `1px solid ${C.orangeBorder}` }}>
                <div style={{
                  height: '100%', width: `${progress}%`,
                  background: `linear-gradient(90deg, ${C.orange}, ${C.yellow})`,
                  transition: 'width 0.4s ease', borderRadius: 99,
                }} />
              </div>
            </div>
          )}

          {/* Terminal log */}
          {status.length > 0 && (
            <div style={{
              marginTop: 14, background: '#1c0a00', color: '#fed7aa',
              borderRadius: 10, padding: '14px 18px',
              fontFamily: 'monospace', fontSize: 12,
              maxHeight: 176, overflowY: 'auto', lineHeight: 1.75,
            }}>
              {status.map((s, i) => (
                <div key={i} style={{ color: s.startsWith('❌') ? '#f87171' : s.startsWith('✅') ? '#4ade80' : '#fed7aa' }}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── STEP 2: Global Summary ── */}
        {globalSummary && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <StepBadge n={2} />
              <h2 style={stepTitle}>Global Architecture</h2>
            </div>

            <p style={{ lineHeight: 1.8, color: '#44200a', fontSize: '0.92rem', margin: 0 }}>{globalSummary.overallPurpose}</p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <Badge label={globalSummary.architecturalStyle} bg="#ede9fe" color="#5b21b6" />
              {globalSummary.techStack.map(t => <Badge key={t} label={t} bg="#e0f2fe" color="#0369a1" />)}
            </div>

            {globalSummary.coreSubsystems.length > 0 && (
              <>
                <SLabel>Subsystems</SLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, marginTop: 10 }}>
                  {globalSummary.coreSubsystems.map(s => (
                    <div key={s.name} style={{ background: C.orangeLight, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.orangeBorder}` }}>
                      <strong style={{ fontSize: '0.85rem', color: C.text }}>{s.name}</strong>
                      <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: C.textMuted, lineHeight: 1.6 }}>{s.description}</p>
                      <p style={{ margin: '6px 0 0', fontSize: '0.7rem', color: C.textGray, fontFamily: 'monospace' }}>{s.files.length} files</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {globalSummary.suggestedImprovements.length > 0 && (
              <>
                <SLabel>💡 Improvements</SLabel>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {globalSummary.suggestedImprovements.map((imp, i) => (
                    <li key={i} style={{ fontSize: '0.88rem', color: '#44200a', marginBottom: 6, lineHeight: 1.7 }}>{imp}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* ── STEP 3: Semantic Query ── */}
        {nodes.length > 0 && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <StepBadge n={3} />
              <h2 style={stepTitle}>Semantic Query</h2>
              <span style={{ marginLeft: 4, fontSize: '0.75rem', color: C.textGray }}>Vector Search + Gemini RAG</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <input
                id="query-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runQuery()}
                placeholder='e.g. "Where is authentication handled?"'
                style={{ ...inputStyle, flex: 1 }}
                disabled={querying}
              />
              <button
                id="ask-btn"
                onClick={runQuery}
                disabled={querying || !query.trim()}
                style={{ ...btnStyle, background: C.yellow, color: '#78350f', boxShadow: '0 4px 12px rgba(250,204,21,0.35)', minWidth: 100 }}
              >
                {querying ? '⏳' : '🔍 Ask'}
              </button>
            </div>

            {queryFiles.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: C.textGray }}>Top matches:</span>
                {queryFiles.slice(0, 5).map(f => (
                  <span key={f.path} style={{ background: C.orangeLight, borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', fontFamily: 'monospace', color: C.textMuted }}>
                    {f.path.split('/').pop()} <strong style={{ color: C.orange }}>({(f.score * 100).toFixed(0)}%)</strong>
                  </span>
                ))}
              </div>
            )}

            {queryResult && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ResultBox bg="#f0fdf4" border="#bbf7d0" titleColor="#166534" title="Gemini Explanation" text={queryResult.explanation} />
                {queryResult.recommendations.length > 0 && (
                  <div style={{ background: C.yellowLight, border: `1px solid #fde68a`, borderRadius: 10, padding: '14px 16px' }}>
                    <strong style={{ fontSize: '0.85rem', color: '#92400e' }}>Recommendations</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {queryResult.recommendations.map((r, i) => (
                        <li key={i} style={{ fontSize: '0.85rem', color: '#451a03', marginBottom: 4, lineHeight: 1.65 }}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {queryResult.learningPath.length > 0 && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: C.text }}>📚 Learning Path</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {queryResult.learningPath.map((f, i) => (
                        <span key={f} style={{ background: '#eff6ff', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontFamily: 'monospace', color: '#1e40af' }}>
                          {i + 1}. {f.split('/').pop()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: Architecture Graph ── */}
        {nodes.length > 0 && (
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', background: `linear-gradient(135deg, ${C.orange} 0%, ${C.yellow} 100%)`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <StepBadge n={4} dark />
              <h2 style={{ ...stepTitle, color: C.white, margin: 0 }}>Architecture Graph</h2>
              <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.25)', color: C.white, borderRadius: 99, padding: '3px 12px', fontSize: '0.75rem', fontWeight: 700 }}>
                {nodes.length} nodes
              </span>
            </div>
            <ArchitectureGraph backendNodes={nodes} />
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Tiny components ─────────────────────────────────────────────────────────

function StepBadge({ n, dark }: { n: number; dark?: boolean }) {
  return (
    <span style={{
      background: dark ? 'rgba(255,255,255,0.3)' : `linear-gradient(135deg, #f97316, #facc15)`,
      color: dark ? '#fff' : '#fff',
      fontWeight: 700, fontSize: '0.72rem',
      width: 26, height: 26, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: dark ? 'none' : '0 2px 8px rgba(249,115,22,0.35)',
    }}>{n}</span>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: '20px 0 0', fontSize: '0.75rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{children}</h3>;
}

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return <span style={{ background: bg, color, borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600 }}>{label}</span>;
}

function ResultBox({ bg, border, titleColor, title, text }: { bg: string; border: string; titleColor: string; title: string; text: string }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 16px' }}>
      <strong style={{ fontSize: '0.85rem', color: titleColor }}>{title}</strong>
      <p style={{ margin: '8px 0 0', fontSize: '0.88rem', lineHeight: 1.75, color: '#1a2e1a' }}>{text}</p>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: 16,
  padding: '24px',
  marginBottom: 20,
  boxShadow: '0 2px 12px rgba(249,115,22,0.08)',
  border: '1px solid #fed7aa',
};

const stepTitle: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1c0a00', letterSpacing: '-0.01em',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: '0.88rem',
  border: '1px solid #fed7aa', borderRadius: 8, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'monospace',
  background: '#fffbf5', color: '#1c0a00',
  transition: 'border-color 0.2s, box-shadow 0.2s',
};

const btnStyle: React.CSSProperties = {
  padding: '10px 22px', fontSize: '0.88rem', fontWeight: 700,
  border: 'none', borderRadius: 8, cursor: 'pointer',
  fontFamily: "'Inter', sans-serif", transition: 'opacity 0.15s, transform 0.1s',
};
