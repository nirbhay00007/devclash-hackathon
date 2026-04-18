import { useState, useRef } from 'react';

// ─── Types (mirrors backend schemas) ─────────────────────────────────────────

interface NodeData {
  id: string;
  data: {
    label: string;
    fullPath: string;
    summary: string;
    risk: 'low' | 'medium' | 'high';
    complexity: 'low' | 'medium' | 'high';
    isEntryPoint: boolean;
    keyExports: string[];
    patterns: string[];
    externalDeps: string[];
    fanIn: number;
  };
}

interface GlobalSummary {
  overallPurpose: string;
  techStack: string[];
  architecturalStyle: string;
  coreSubsystems: { name: string; description: string; files: string[] }[];
  complexityHotspots: string[];
  entryPoints: string[];
  suggestedImprovements: string[];
}

interface QueryAnalysis {
  explanation: string;
  subsystems: { name: string; description: string; files: string[] }[];
  highRiskFiles: string[];
  learningPath: string[];
  recommendations: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API = 'http://localhost:3001';
const RISK_COLOR = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
const COMPLEXITY_COLOR = { low: '#6366f1', medium: '#f59e0b', high: '#ef4444' };

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [targetPath, setTargetPath] = useState('C:\\College\\DEV_CLASH\\backend\\src');
  const [query, setQuery] = useState('');

  const [status, setStatus] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [globalSummary, setGlobalSummary] = useState<GlobalSummary | null>(null);
  const [queryResult, setQueryResult] = useState<QueryAnalysis | null>(null);
  const [queryFiles, setQueryFiles] = useState<{ path: string; score: number }[]>([]);
  const [querying, setQuerying] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // ── Ingestion via SSE ────────────────────────────────────────────────────

  const startAnalysis = async () => {
    if (running) return;
    setRunning(true);
    setStatus([]);
    setProgress(0);
    setNodes([]);
    setGlobalSummary(null);
    setQueryResult(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        setStatus(p => [...p, `❌ HTTP ${res.status}: ${res.statusText}`]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Split on SSE double-newline boundary
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim().replace(/^data:\s*/, '');
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.message) setStatus(p => [...p.slice(-60), evt.message]);
            if (evt.progress != null) setProgress(evt.progress);
            if (evt.phase === 'result') {
              if (evt.graph?.nodes) setNodes(evt.graph.nodes);
              if (evt.globalSummary) setGlobalSummary(evt.globalSummary);
            }
            if (evt.phase === 'error') {
              setStatus(p => [...p, `❌ ${evt.message}`]);
            }
          } catch { /* non-JSON SSE comment */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setStatus(p => [...p, `❌ ${String(e)}`]);
      }
    } finally {
      setRunning(false);
      setProgress(100);
    }
  };

  const stopAnalysis = () => {
    abortRef.current?.abort();
    setStatus(p => [...p, '⏹ Cancelled by user.']);
    setRunning(false);
  };

  // ── Semantic Query ────────────────────────────────────────────────────────

  const runQuery = async () => {
    if (!query.trim() || querying) return;
    setQuerying(true);
    setQueryResult(null);
    setQueryFiles([]);

    try {
      const res = await fetch(`${API}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setQueryResult(json.analysis);
        setQueryFiles(json.relevantFiles ?? []);
      } else {
        alert(json.error ?? 'Query failed.');
      }
    } catch (e) {
      alert(`Query error: ${e}`);
    } finally {
      setQuerying(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: '32px 24px', color: '#1a1a1a' }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>🧠 DEV_CLASH — AI Codebase Navigator</h1>
      <p style={{ color: '#666', marginTop: 6, marginBottom: 28 }}>
        Local Ollama (Qwen2.5 + Nomic) → global Gemini analysis
      </p>

      {/* ── Analyze Panel ── */}
      <section style={card}>
        <h2 style={sectionTitle}>① Ingest Repository</h2>
        <input
          value={targetPath}
          onChange={e => setTargetPath(e.target.value)}
          placeholder="Absolute path to repository root…"
          style={input}
          disabled={running}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button onClick={startAnalysis} disabled={running} style={{ ...btn, background: '#111', color: '#fff', flex: 1 }}>
            {running ? `⏳ Processing… ${progress}%` : '▶ Run Ingestion Pipeline'}
          </button>
          {running && (
            <button onClick={stopAnalysis} style={{ ...btn, background: '#fee2e2', color: '#991b1b' }}>
              ⏹ Stop
            </button>
          )}
        </div>

        {/* Progress bar */}
        {running && (
          <div style={{ marginTop: 14, background: '#f3f4f6', borderRadius: 99, height: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#6366f1', transition: 'width 0.3s ease' }} />
          </div>
        )}

        {/* Log terminal */}
        {status.length > 0 && (
          <div style={{ marginTop: 14, background: '#0f172a', color: '#94a3b8', borderRadius: 8, padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, maxHeight: 180, overflowY: 'auto' }}>
            {status.map((s, i) => <div key={i}>{s}</div>)}
          </div>
        )}
      </section>

      {/* ── Global Summary ── */}
      {globalSummary && (
        <section style={card}>
          <h2 style={sectionTitle}>② Global Architecture (Gemini)</h2>
          <p style={{ marginTop: 8, lineHeight: 1.7, color: '#333' }}>{globalSummary.overallPurpose}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Tag label={globalSummary.architecturalStyle} color="#6366f1" />
            {globalSummary.techStack.map(t => <Tag key={t} label={t} color="#0891b2" />)}
          </div>

          {globalSummary.coreSubsystems.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 10, fontSize: 14, fontWeight: 600 }}>Subsystems</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {globalSummary.coreSubsystems.map(s => (
                  <div key={s.name} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
                    <strong style={{ fontSize: 13 }}>{s.name}</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{s.description}</p>
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                      {s.files.length} file{s.files.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {globalSummary.suggestedImprovements.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 8, fontSize: 14, fontWeight: 600 }}>💡 Improvements</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {globalSummary.suggestedImprovements.map((imp, i) => (
                  <li key={i} style={{ fontSize: 13, color: '#374151', marginBottom: 4, lineHeight: 1.6 }}>{imp}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ── Query Panel ── */}
      {nodes.length > 0 && (
        <section style={card}>
          <h2 style={sectionTitle}>③ Semantic Query (Vector Search + Gemini RAG)</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runQuery()}
              placeholder='e.g. "Where is authentication handled?"'
              style={{ ...input, flex: 1 }}
              disabled={querying}
            />
            <button onClick={runQuery} disabled={querying || !query.trim()} style={{ ...btn, background: '#6366f1', color: '#fff', whiteSpace: 'nowrap' }}>
              {querying ? '⏳ Asking…' : '🔍 Ask'}
            </button>
          </div>

          {queryFiles.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
              <strong>Top matched files:</strong>{' '}
              {queryFiles.slice(0, 5).map(f => (
                <span key={f.path} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 6px', marginRight: 6, fontFamily: 'monospace' }}>
                  {f.path.split('/').pop()} ({(f.score * 100).toFixed(0)}%)
                </span>
              ))}
            </div>
          )}

          {queryResult && (
            <div style={{ marginTop: 16 }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '14px 16px' }}>
                <strong style={{ fontSize: 13, color: '#166534' }}>Gemini Explanation</strong>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.7, color: '#1a2e1a' }}>{queryResult.explanation}</p>
              </div>

              {queryResult.recommendations.length > 0 && (
                <div style={{ marginTop: 10, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '14px 16px' }}>
                  <strong style={{ fontSize: 13, color: '#92400e' }}>Recommendations</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    {queryResult.recommendations.map((r, i) => (
                      <li key={i} style={{ fontSize: 13, color: '#451a03', marginBottom: 4, lineHeight: 1.6 }}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {queryResult.learningPath.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <strong style={{ fontSize: 13 }}>📚 Learning Path</strong>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    {queryResult.learningPath.map((f, i) => (
                      <span key={f} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, padding: '3px 8px', fontSize: 12, fontFamily: 'monospace' }}>
                        {i + 1}. {f.split('/').pop()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── File Cards ── */}
      {nodes.length > 0 && (
        <section style={card}>
          <h2 style={sectionTitle}>④ File Analysis ({nodes.length} files)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, marginTop: 14 }}>
            {nodes.map(node => (
              <FileCard key={node.id} node={node} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FileCard({ node }: { node: NodeData }) {
  const d = node.data;
  const riskC = RISK_COLOR[d.risk] ?? '#94a3b8';
  const cpxC = COMPLEXITY_COLOR[d.complexity] ?? '#94a3b8';

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', background: '#fff', borderTop: `3px solid ${riskC}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</span>
        {d.isEntryPoint && <Tag label="Entry" color="#0891b2" small />}
        <Tag label={d.complexity} color={cpxC} small />
        <Tag label={`risk:${d.risk}`} color={riskC} small />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#4b5563', lineHeight: 1.6 }}>{d.summary}</p>
      {d.keyExports.length > 0 && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
          ⬡ {d.keyExports.slice(0, 4).join(', ')}{d.keyExports.length > 4 ? ' …' : ''}
        </p>
      )}
      {d.patterns.length > 0 && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>
          🏷 {d.patterns.join(', ')}
        </p>
      )}
      {d.fanIn > 0 && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>
          ↙ {d.fanIn} inbound edge{d.fanIn !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

function Tag({ label, color, small }: { label: string; color: string; small?: boolean }) {
  return (
    <span style={{
      background: `${color}18`,
      color,
      border: `1px solid ${color}44`,
      borderRadius: 4,
      padding: small ? '1px 6px' : '2px 8px',
      fontSize: small ? 10 : 12,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '24px',
  marginBottom: 20,
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  color: '#111',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 8,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'monospace',
};

const btn: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

export default App;
