import { useState, useRef, useEffect, useCallback } from 'react';
import ArchitectureGraph from './components/ArchitectureGraph';
import type { BackendNode, BackendEdge } from './components/ArchitectureGraph';
import NodeDetailPanel from './components/NodeDetailPanel';
import SetupPage from './components/SetupPage';
import ScanVisualizer from './components/ScanVisualizer';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GlobalSummary {
  overallPurpose: string;
  techStack: string[];
  architecturalStyle: string;
  coreSubsystems: { name: string; description: string; files: string[] }[];
  complexityHotspots: string[];
  suggestedImprovements: string[];
  recommendedOnboardingPath?: string[];
}

interface QueryAnalysis {
  explanation: string;
  recommendations: string[];
  learningPath: string[];
}

type RepoStatus = 'idle' | 'running' | 'done' | 'error';

interface RepoEntry {
  id:       string;
  path:     string;
  label:    string;
  color:    string;
  status:   RepoStatus;
  progress: number;
  log:      string[];
  nodes:    BackendNode[];
  edges:    BackendEdge[];
  summary:  GlobalSummary | null;
}

type AppTab    = 'home' | 'repos' | 'graph' | 'arch' | 'query' | 'setup';

const API = 'http://localhost:3001';
const REPO_COLORS = ['#f97316','#0ea5e9','#22c55e','#7c3aed','#ec4899','#d97706'];
let colorIdx = 0;
const nextColor = () => REPO_COLORS[colorIdx++ % REPO_COLORS.length];

function makeRepo(path: string): RepoEntry {
  const label = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
  return { id: crypto.randomUUID(), path, label, color: nextColor(), status: 'idle', progress: 0, log: [], nodes: [], edges: [], summary: null };
}


// ─── Svc status ───────────────────────────────────────────────────────────────

interface SvcStatus { ok: boolean; latency?: number; }
interface SysStatus { node: SvcStatus; java: SvcStatus; ollama: SvcStatus; }

// ─── Component ───────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('home');

  // Landing hero input
  const [heroPath, setHeroPath] = useState('');

  // Repos
  const [repos, setRepos]     = useState<RepoEntry[]>([]);
  const [newPath, setNewPath] = useState('');
  const abortRefs  = useRef<Map<string, AbortController>>(new Map());
  const termRefs   = useRef<Map<string, HTMLDivElement>>(new Map());

  // Graph
  const mergedNodes: BackendNode[] = repos.flatMap(r =>
    r.nodes.map(n => ({ ...n, data: { ...n.data, repoColor: r.color, repoLabel: r.label, repoId: r.id } }))
  );
  const mergedEdges: BackendEdge[] = repos.flatMap(r => r.edges);
  const activeSummary = repos.filter(r => r.summary).at(-1)?.summary ?? null;

  // Query
  const [query, setQuery]           = useState('');
  const [querying, setQuerying]     = useState(false);
  const [queryResult, setQueryResult] = useState<QueryAnalysis | null>(null);
  const [queryFiles, setQueryFiles]   = useState<{ path: string; score: number }[]>([]);

  // Selected node
  const [selectedNode, setSelectedNode] = useState<{ id: string; data: BackendNode['data'] } | null>(null);

  // System status
  const [sys, setSys] = useState<SysStatus>({ node: { ok: false }, java: { ok: false }, ollama: { ok: false } });

  // ─── Poll services ──────────────────────────────────────────────────────

  useEffect(() => {
    const poll = async () => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${API}/api/status`);
        const j = await r.json();
        setSys(s => ({ ...s, node: { ok: j?.nodeBackend?.status === 'ok', latency: Date.now() - t0 }, java: { ok: j?.javaBackend?.status === 'ok' } }));
      } catch { setSys(s => ({ ...s, node: { ok: false }, java: { ok: false } })); }
      try { await fetch('http://localhost:11434/api/tags'); setSys(s => ({ ...s, ollama: { ok: true } })); }
      catch { setSys(s => ({ ...s, ollama: { ok: false } })); }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll terminals
  useEffect(() => {
    repos.forEach(r => { const el = termRefs.current.get(r.id); if (el) el.scrollTop = el.scrollHeight; });
  }, [repos]);



  // ─── Repo management ────────────────────────────────────────────────────

  const addRepo = () => {
    const p = newPath.trim();
    if (!p) return;
    setRepos(rs => [...rs, makeRepo(p)]);
    setNewPath('');
  };

  const removeRepo = (id: string) => {
    abortRefs.current.get(id)?.abort();
    setRepos(rs => rs.filter(r => r.id !== id));
  };

  const updateRepo = useCallback((id: string, patch: Partial<RepoEntry>) => {
    setRepos(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  // ─── Ingest ─────────────────────────────────────────────────────────────

  const ingestRepo = useCallback(async (repo: RepoEntry) => {
    const { id, path } = repo;
    updateRepo(id, { status: 'running', progress: 0, log: [], nodes: [], edges: [], summary: null });
    const abort = new AbortController();
    abortRefs.current.set(id, abort);
    try {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: path }), signal: abort.signal,
      });
      if (!res.ok || !res.body) { updateRepo(id, { status: 'error', log: [`❌ HTTP ${res.status}`] }); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (const part of buf.split('\n\n').slice(0, -1)) {
          const line = part.trim().replace(/^data:\s*/, ''); if (!line) continue;
          try {
            const evt = JSON.parse(line);
            setRepos(rs => rs.map(r => {
              if (r.id !== id) return r;
              const nx = { ...r };
              if (evt.message)        nx.log = [...r.log.slice(-80), evt.message];
              if (evt.progress != null) nx.progress = evt.progress;
              if (evt.phase === 'result') {
                if (evt.graph?.nodes)    nx.nodes   = evt.graph.nodes;
                if (evt.graph?.edges)    nx.edges   = evt.graph.edges;
                if (evt.globalSummary)   nx.summary = evt.globalSummary;
                nx.status = 'done'; nx.progress = 100;
              }
              if (evt.phase === 'error') { nx.log = [...r.log, `❌ ${evt.message}`]; nx.status = 'error'; }
              return nx;
            }));
          } catch { /* non-JSON */ }
        }
        buf = buf.split('\n\n').pop() ?? '';
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') updateRepo(id, { status: 'error', log: [`❌ ${String(e)}`] });
    } finally {
      abortRefs.current.delete(id);
      setRepos(rs => rs.map(r => r.id === id && r.status === 'running' ? { ...r, status: 'done', progress: 100 } : r));
    }
  }, [updateRepo]);

  const stopRepo  = (id: string) => { abortRefs.current.get(id)?.abort(); updateRepo(id, { status: 'idle', log: [] }); };
  const runAll    = () => { repos.filter(r => r.status !== 'running').forEach(r => ingestRepo(r)); setActiveTab('graph'); };

  // ─── RAG Query ──────────────────────────────────────────────────────────

  const runQuery = async () => {
    if (!query.trim() || querying || mergedNodes.length === 0) return;
    setQuerying(true); setQueryResult(null); setQueryFiles([]);
    try {
      const res  = await fetch(`${API}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query.trim() }) });
      const json = await res.json();
      if (json.success) { setQueryResult(json.analysis); setQueryFiles(json.relevantFiles ?? []); }
    } catch { /* ignore */ }
    finally { setQuerying(false); }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  const totalFiles = mergedNodes.length;

  // Launch from hero input
  const launchFromHero = useCallback(() => {
    if (!heroPath.trim()) return;
    const repo = makeRepo(heroPath.trim());
    setRepos(prev => [...prev, repo]);
    setHeroPath('');
    setNewPath('');
    setActiveTab('repos');
    setTimeout(() => ingestRepo(repo), 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroPath]);

  // ── UNIFIED APP SHELL ────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── SINGLE UNIFIED NAV ── */}
      <nav className="app-nav">
        <span className="app-nav-logo" onClick={() => setActiveTab('home')}>CodeMap<span> AI</span></span>

        <div className="app-nav-tabs">
          {([
            { id: 'home',  label: 'Home' },
            { id: 'repos', label: 'Repositories' },
            { id: 'graph', label: 'Graph' },
            { id: 'arch',  label: 'Architecture' },
            { id: 'query', label: 'Query' },
            { id: 'setup', label: 'Setup & MCP' },
          ] as { id: AppTab; label: string }[]).map(t => (
            <button key={t.id}
              className={`app-nav-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {t.id === 'graph' && totalFiles > 0 && <span className="tab-count">{totalFiles}</span>}
            </button>
          ))}
        </div>

        <div className="app-nav-right">
          {[
            { label: 'API',      ok: sys.node.ok,   lat: sys.node.latency },
            { label: 'Java AST', ok: sys.java.ok,   lat: undefined },
            { label: 'Ollama',   ok: sys.ollama.ok, lat: undefined },
          ].map(s => (
            <div key={s.label} className={`status-pill ${s.ok ? 'ok' : 'error'}`}>
              <span className={`status-dot ${s.ok ? 'ok' : 'error'}`} />
              {s.label}
              {s.ok && s.lat ? <span style={{ fontSize: 10, opacity: 0.7 }}>{s.lat}ms</span> : null}
            </div>
          ))}
          {repos.length > 0 && (
            <button className="btn btn-orange btn-sm" onClick={runAll} disabled={repos.every(r => r.status === 'running')}>
              ▶ Run All
            </button>
          )}
        </div>
      </nav>



        {/* ── HOME TAB — landing hero content ── */}
      {activeTab === 'home' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--white)' }}>

        <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px 56px', minHeight: 'calc(100vh - 52px)' }}>
          <div className="hero" style={{ width: '100%' }}>
            {/* Eyebrow */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              <span className="hero-eyebrow">🧠 Local AI · Zero Cloud · Full Privacy</span>
            </div>

            {/* Headline */}
            <h1 className="hero-h1">
              CodeMap AI:
              <span className="hero-h1-orange">Visualize the invisible.</span>
            </h1>

            <p className="hero-sub">
              Transform complex codebases into interactive architectural maps. Understand dependencies, logic paths, and architectural intent — powered by local Ollama models and Gemini AI.
            </p>

            {/* Input */}
            <div className="hero-input-wrap">
              <div className="hero-input-icon">🔗</div>
              <input
                id="hero-path"
                className="hero-input"
                value={heroPath}
                onChange={e => setHeroPath(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && launchFromHero()}
                placeholder="https://github.com/org/repo  or  C:\path\to\project"
              />
              <button className="hero-input-btn" onClick={launchFromHero} disabled={!heroPath.trim()}>
                Initialize Architecture Discovery →
              </button>
            </div>

            <div className="hero-providers">
              <span>✓ GitHub</span>
              <span>✓ GitLab</span>
              <span>✓ Local paths</span>
              <span>✓ Multi-repo</span>
            </div>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="features">
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 8 }}>Everything you need to navigate any codebase</h2>
            <p style={{ fontSize: 15, color: 'var(--gray-500)' }}>From dependency graphs to semantic search — all running locally, zero data leaves your machine.</p>
          </div>
          <div className="features-grid">
            {[
              { icon: '🕸', bg: '#fff7ed', title: 'Automated Dependency Mapping', desc: 'Trace import graphs automatically. Discover dead paths, critical execution loops, and fan-in/out metrics without manual stepping.', code: <><strong>explore_paths</strong>() → Graph</> },
              { icon: '🧠', bg: '#f0f9ff', title: 'AI Intent Mapping', desc: 'Extract functional intent from legacy code blocks. Translate dense monoliths into readable domain concepts using local Ollama AI.', code: <><strong>analyze_intent</strong>(ast) → Insights</> },
              { icon: '⚠️', bg: '#fef2f2', title: 'Dependency Risk Analysis', desc: 'Identify cyclical dependencies and high-risk modules. Visualize technical debt impact before refactoring.', code: <><strong>calc_risk_score</strong>(graph) → Warning[]</> },
              { icon: '🔍', bg: '#f0fdf4', title: 'Semantic RAG Search', desc: 'Ask questions in plain English. Vector search + Gemini AI returns exactly the files relevant to your task in milliseconds.', code: <><strong>semantic_query</strong>(q) → Files[]</> },
              { icon: '🤖', bg: '#f5f3ff', title: 'MCP Agent Integration', desc: 'Connect Claude Desktop, Cursor, or Antigravity. Your AI agent gets permanent codebase memory with ~90% fewer tokens.', code: <><strong>mcp.search_codebase</strong>(task) → Context</> },
              { icon: '🔄', bg: '#fffbeb', title: 'Multi-Repo Merging', desc: 'Analyze frontend + backend + microservices simultaneously. Visualize cross-repository dependency relationships in one unified graph.', code: <><strong>merge_graphs</strong>(repos[]) → Map</> },
            ].map(f => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon" style={{ background: f.bg }}>{f.icon}</div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
                <div className="feature-code">{f.code}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="footer">
          <div><span className="footer-brand">CodeMap<span> AI</span></span><span style={{ marginLeft: 12 }}>Precision Mapping for <strong>Engineering Teams</strong>.</span></div>
          <div className="footer-links">
            {['Product', 'Security', 'Privacy', 'Terms', 'API'].map(l => (
              <span key={l} className="footer-link" onClick={() => { if (l === 'API') setActiveTab('setup'); }}>{l}</span>
            ))}
          </div>
          <div>© 2024 CodeMap AI</div>
        </footer>
      </div>
      )}


      {/* ── VISUALIZE: full-width ScanVisualizer when repos tab is active and a scan exists ── */}
      {activeTab === 'repos' && repos.length > 0 && (() => {
        const activeRepo = repos.find(r => r.status === 'running') ?? repos.at(-1)!;
        return (
          <div className="app-body" style={{ flexDirection: 'column' }}>
            {/* Top bar: add more repos + run all */}
            <div style={{ height: 44, borderBottom: '1px solid var(--gray-200)', background: 'var(--white)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', flexShrink: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gray-500)', marginRight: 4 }}>Repositories:</div>
              {repos.map(r => (
                <div key={r.id}
                  onClick={() => { /* future: switch active repo */ }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-full)', border: '1px solid', cursor: 'pointer',
                    background: r.id === activeRepo.id ? `${r.color}14` : 'var(--gray-50)',
                    borderColor: r.id === activeRepo.id ? r.color : 'var(--gray-200)',
                  }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: r.id === activeRepo.id ? r.color : 'var(--gray-500)' }}>{r.label}</span>
                  {r.status === 'running' && <span style={{ fontSize: 10, color: r.color }} className="spin">⟳</span>}
                  {r.status === 'done'    && <span style={{ fontSize: 10, color: '#22c55e' }}>✓</span>}
                  <button onClick={e => { e.stopPropagation(); removeRepo(r.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--gray-400)', cursor: 'pointer', fontSize: 11, padding: 0, marginLeft: 2 }}>✕</button>
                </div>
              ))}
              {/* Inline add */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <input className="input" style={{ width: 240, height: 30, fontSize: 12 }} value={newPath}
                  onChange={e => setNewPath(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addRepo()}
                  placeholder="Add path or GitHub URL…" />
                <button className="btn btn-outline btn-sm" onClick={addRepo} disabled={!newPath.trim()}>+ Add</button>
                <button className="btn btn-orange btn-sm" onClick={runAll} disabled={repos.every(r => r.status === 'running')}>▶ Run All</button>
              </div>
            </div>

            {/* ScanVisualizer fills the rest */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              <ScanVisualizer
                repo={activeRepo}
                onStop={() => stopRepo(activeRepo.id)}
                termRef={el => { if (el) termRefs.current.set(activeRepo.id, el); }}
              />
            </div>
          </div>
        );
      })()}

      {/* ── NORMAL LAYOUT (non-home, non-setup, repos empty or other tabs) ── */}
      {activeTab !== 'home' && !(activeTab === 'repos' && repos.length > 0) && (
      <div className="app-body">
        {/* ── LEFT PANEL — hidden for graph and setup tabs ── */}
        {activeTab !== 'graph' && activeTab !== 'setup' && (
          <aside className="side-panel">
            <div className="side-scroll">

              {/* ══ REPOS (empty state) ══════════════════════════════════ */}
              {activeTab === 'repos' && (
                <div className="fade-up">
                  {/* Hero header */}
                  <div className="panel-hero">
                    <div className="panel-hero-title">Initialize <span>Discovery</span></div>
                    <div className="panel-hero-sub">Add a local path or GitHub URL to begin mapping your codebase architecture.</div>
                  </div>
                  <div className="side-section">
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input className="input" style={{ flex: 1 }} value={newPath}
                        onChange={e => setNewPath(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addRepo()}
                        placeholder="C:\path\to\project  or  github.com/org/repo" />
                      <button className="btn btn-orange" onClick={addRepo} disabled={!newPath.trim()}>Add</button>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', lineHeight: 1.7 }}>
                      Or <span style={{ color: 'var(--orange)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setActiveTab('home')}>go back to the home page</span> to use the discovery launcher.
                    </div>
                  </div>
                  {/* How it works */}
                  <div className="side-section">
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>How it works</div>
                    {[
                      { n: '1', t: 'Add path', d: 'Point to any local folder or GitHub repo URL.' },
                      { n: '2', t: 'Run analysis', d: 'Ollama AI summarizes every file, Gemini maps architecture.' },
                      { n: '3', t: 'Explore graph', d: 'Interactive dependency tree with risk scoring and semantic search.' },
                    ].map(s => (
                      <div key={s.n} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>
                        <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--orange)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{s.n}</div>
                        <div><div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{s.t}</div><div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.55 }}>{s.d}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ══ ARCHITECTURE ════════════════════════════════════════ */}
              {activeTab === 'arch' && (
                <div className="fade-up">
                  {/* Hero header */}
                  <div className="panel-hero">
                    <div className="panel-hero-title">Architecture <span>Report</span></div>
                    <div className="panel-hero-sub">Gemini-powered structural analysis of your codebase.</div>
                    {activeSummary && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <span className="chip chip-orange" style={{ fontSize: 12 }}>{activeSummary.architecturalStyle}</span>
                        {activeSummary.techStack.slice(0,3).map(t => <span key={t} className="chip chip-sky" style={{ fontSize: 12 }}>{t}</span>)}
                      </div>
                    )}
                  </div>

                  {!activeSummary ? (
                    <div className="side-section" style={{ textAlign: 'center', color: 'var(--gray-400)', fontSize: 13, lineHeight: 1.75, padding: '40px 20px' }}>
                      🏛 Run a repository ingestion to generate the architecture report.
                    </div>
                  ) : (
                    <>
                      <div className="side-section">
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Overview</div>
                        <p style={{ fontSize: 13.5, color: 'var(--gray-700)', lineHeight: 1.8 }}>{activeSummary.overallPurpose}</p>
                      </div>

                      {activeSummary.coreSubsystems.length > 0 && (
                        <div className="side-section">
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Core Subsystems</div>
                          {activeSummary.coreSubsystems.map(s => (
                            <div key={s.name} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--gray-100)', alignItems: 'flex-start' }}>
                              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--orange-light)', border: '1px solid var(--orange-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>⬡</div>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{s.name}</div>
                                <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.6 }}>{s.description}</div>
                                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{s.files.length} files</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeSummary.complexityHotspots.length > 0 && (
                        <div className="side-section">
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>🔥 Hotspots</div>
                          {activeSummary.complexityHotspots.map((f, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--gray-100)', alignItems: 'center' }}>
                              <span style={{ minWidth: 22, height: 22, borderRadius: 5, background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>#{i+1}</span>
                              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.split(/[/\\]/).pop()}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeSummary.recommendedOnboardingPath && activeSummary.recommendedOnboardingPath.length > 0 && (
                        <div className="side-section">
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>📚 Onboarding Path</div>
                          {activeSummary.recommendedOnboardingPath.map((f, i) => (
                            <div key={f} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--gray-100)', alignItems: 'center' }}>
                              <span style={{ minWidth: 22, height: 22, borderRadius: 5, background: 'var(--orange-light)', border: '1px solid var(--orange-border)', color: 'var(--orange)', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</span>
                              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.split(/[/\\]/).pop()}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeSummary.suggestedImprovements.length > 0 && (
                        <div className="side-section">
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>💡 Improvements</div>
                          <ul style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {activeSummary.suggestedImprovements.map((imp, i) => (
                              <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.65 }}>
                                <span style={{ color: 'var(--orange)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>→</span>
                                {imp}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ══ QUERY ════════════════════════════════════════════════ */}
              {activeTab === 'query' && (
                <div className="fade-up">
                  {/* Hero header */}
                  <div className="panel-hero">
                    <div className="panel-hero-title">Semantic <span>Search</span></div>
                    <div className="panel-hero-sub">Ask any question about your codebase in plain English.</div>
                  </div>

                  <div className="side-section">
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Ask Anything</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input" style={{ flex: 1, fontSize: 13.5 }} value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && runQuery()}
                        placeholder='"Where is authentication handled?"'
                        disabled={querying || mergedNodes.length === 0} />
                      <button className="btn btn-orange" style={{ padding: '9px 14px' }} onClick={runQuery} disabled={querying || !query.trim() || mergedNodes.length === 0}>
                        {querying ? <span className="spin">⟳</span> : '→'}
                      </button>
                    </div>
                    {mergedNodes.length === 0 && (
                      <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--orange-light)', border: '1px solid var(--orange-border)', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                        ⚠ Add and run a repository first to enable semantic search.
                      </div>
                    )}
                  </div>

                  {queryFiles.length > 0 && (
                    <div className="side-section">
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Matched Files</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {queryFiles.slice(0, 6).map((f, i) => (
                          <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--gray-50)', border: '1px solid var(--gray-200)' }}>
                            <span style={{ minWidth: 22, height: 22, borderRadius: 5, background: 'var(--orange-light)', border: '1px solid var(--orange-border)', color: 'var(--orange)', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i+1}</span>
                            <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path.split(/[/\\]/).pop()}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--orange)' }}>{(f.score*100).toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {queryResult && (
                    <>
                      <div className="side-section" style={{ background: '#f0fdf4', borderLeft: '3px solid #22c55e' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>✦ Gemini Explanation</div>
                        <p style={{ fontSize: 13.5, color: '#166534', lineHeight: 1.8 }}>{queryResult.explanation}</p>
                      </div>
                      {queryResult.recommendations.length > 0 && (
                        <div className="side-section" style={{ background: '#fffbeb', borderLeft: '3px solid #f59e0b' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Recommendations</div>
                          <ul style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {queryResult.recommendations.map((r,i) => (
                              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#78350f', lineHeight: 1.65 }}>
                                <span style={{ color: '#d97706', fontWeight: 700, flexShrink: 0 }}>→</span>{r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {queryResult.learningPath.length > 0 && (
                        <div className="side-section">
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>📚 Learning Path</div>
                          {queryResult.learningPath.map((f,i) => (
                            <div key={f} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--gray-100)', alignItems: 'center' }}>
                              <span style={{ minWidth: 22, height: 22, borderRadius: 5, background: 'var(--orange-light)', border: '1px solid var(--orange-border)', color: 'var(--orange)', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</span>
                              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.split(/[/\\]/).pop()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ══ SETUP ── hidden from sidebar, rendered full-screen below ══ */}
            </div>
          </aside>
        )}

        {/* ── SETUP & MCP — full-screen when active ── */}
        {activeTab === 'setup' && <SetupPage />}


        {/* ── GRAPH CANVAS ── shown for repos/graph/arch/query */}
        {(activeTab === 'repos' || activeTab === 'graph' || activeTab === 'arch' || activeTab === 'query') && (
        <main className="graph-canvas" style={{ flex: 1 }}>
          {mergedNodes.length === 0 ? (
            <div className="graph-empty">
              <div className="graph-empty-icon">🕸</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>No graph yet</div>
              <div style={{ fontSize: 13, color: 'var(--gray-400)', maxWidth: 260, textAlign: 'center', lineHeight: 1.65 }}>
                Go to <strong style={{ color: 'var(--orange)', cursor: 'pointer' }} onClick={() => setActiveTab('repos')}>Repositories</strong>, add a path, and click <strong>Run All</strong>.
              </div>
            </div>
          ) : (
            <ArchitectureGraph
              backendNodes={mergedNodes}
              backendEdges={mergedEdges}
              onNodeSelect={n => setSelectedNode(
                n ? { id: n.id, data: { ...n.data, codeQuality: (n.data.codeQuality as any) } } : null
              )}
            />
          )}
          <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        </main>
        )}
      </div>
      )}
    </div>
  );
}
