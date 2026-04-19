import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  data?: QueryAnalysis;
  files?: { path: string; score: number }[];
  isSystemIntro?: boolean;
}

type RepoStatus = 'idle' | 'running' | 'done' | 'error';

interface RepoEntry {
  id: string;
  path: string;
  label: string;
  color: string;
  status: RepoStatus;
  progress: number;
  log: string[];
  nodes: BackendNode[];
  edges: BackendEdge[];
  summary: GlobalSummary | null;
}

type AppTab = 'home' | 'repos' | 'graph' | 'query' | 'setup';

const API = 'http://localhost:3001';
const REPO_COLORS = ['#f97316', '#0ea5e9', '#22c55e', '#7c3aed', '#ec4899', '#d97706'];
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
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [newPath, setNewPath] = useState('');
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  const termRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Graph
  const mergedNodes: BackendNode[] = repos.flatMap(r =>
    r.nodes.map(n => ({ ...n, data: { ...n.data, repoColor: r.color, repoLabel: r.label, repoId: r.id } }))
  );
  const mergedEdges: BackendEdge[] = repos.flatMap(r => r.edges);

  // Query
  const [query, setQuery] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [querying, setQuerying] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Graph Filter
  const [graphFilterRepoId, setGraphFilterRepoId] = useState<string | null>(null);

  // Filter nodes & edges before rendering based on user selection
  const displayedNodes = useMemo(() => {
    if (!graphFilterRepoId) return mergedNodes;
    return mergedNodes.filter((n: BackendNode) => n.data.repoId === graphFilterRepoId);
  }, [mergedNodes, graphFilterRepoId]);

  const displayedEdges = useMemo(() => {
    if (!graphFilterRepoId) return mergedEdges;
    // For single repo view, only show intra-repo edges to reduce noise
    const allowed = new Set(displayedNodes.map((n: BackendNode) => n.id));
    return mergedEdges.filter((e: BackendEdge) => allowed.has(e.source) && allowed.has(e.target));
  }, [mergedEdges, displayedNodes, graphFilterRepoId]);

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
    updateRepo(id, { status: 'running', progress: 0, log: [], nodes: [], edges: [], summary: null, scanTotal: 0, scanDone: 0 } as any);
    const abort = new AbortController();
    abortRefs.current.set(id, abort);
    try {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: path, repoId: id, repoLabel: repo.label }), signal: abort.signal,
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
              const nx = { ...r } as any;
              if (evt.message) nx.log = [...r.log.slice(-80), evt.message];
              if (evt.progress != null) nx.progress = evt.progress;
              // Capture total + done counts directly from SSE stream
              if (evt.total != null && evt.total > 0) nx.scanTotal = evt.total;
              if (evt.done  != null) nx.scanDone  = evt.done;
              // Capture capture graph data (nodes/edges) whenever provided for live updates
              if (evt.nodes) nx.nodes = evt.nodes;
              if (evt.edges) nx.edges = evt.edges;

              if (evt.phase === 'done') {
                nx.status = 'done'; nx.progress = 100;
                if (evt.globalSummary) nx.summary = evt.globalSummary;
                if (nx.nodes.length > 0) { nx.scanTotal = nx.nodes.length; nx.scanDone = nx.nodes.length; }
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

  const stopRepo = (id: string) => { abortRefs.current.get(id)?.abort(); updateRepo(id, { status: 'idle', log: [] }); };
  // ✅ FIX: no longer auto-navigates to graph — stays on repos tab so user can see scan progress
  const runAll = () => { repos.filter(r => r.status !== 'running').forEach(r => ingestRepo(r)); };

  // ─── RAG Query ──────────────────────────────────────────────────────────

  const exportSummary = () => {
    const summary = repos[0]?.summary;
    if (!summary) return;
    const md = `# Repository Architecture Report\n\n## Overview\n${summary.overallPurpose}\n\n## Tech Stack\n${summary.techStack.join(', ')}\n\n## Architectural Style\n${summary.architecturalStyle}\n\n## Core Subsystems\n${summary.coreSubsystems.map(s => `### ${s.name}\n${s.description}\n**Files:** ${s.files.join(', ')}`).join('\n\n')}\n\n## Complexity Hotspots\n${summary.complexityHotspots.map(h => `- ${h}`).join('\n')}\n\n## Onboarding Path\n${(summary.recommendedOnboardingPath || []).map(p => `- ${p}`).join('\n')}\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'architecture_report.md';
    a.click(); URL.revokeObjectURL(url);
  };

  const generateMissingSummary = async () => {
    if (generatingSummary || !repos[0]) return;
    setGeneratingSummary(true);
    try {
      const payload: any = {};
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await fetch(`${API}/api/summary/generate`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });

      if (!res.ok) {
        const errText = await res.text();
        try {
          const errJson = JSON.parse(errText);
          throw new Error(errJson.error || `HTTP ${res.status}`);
        } catch {
          throw new Error(`Server returned unexpected response (HTTP ${res.status})`);
        }
      }

      const json = await res.json();
      if (json.success && json.summary) {
        setRepos(prev => prev.map((r, i) => i === 0 ? { ...r, summary: json.summary } : r));
      } else {
        alert(json.error || 'Failed to generate summary.');
      }
    } catch (e: any) { 
      console.error('[GenerateSummary]', e);
      alert(e.message || 'Error occurred while generating summary.'); 
    }
    finally { setGeneratingSummary(false); }
  };

  useEffect(() => {
    if (repos.length > 0 && messages.length === 0) {
      setMessages([{ id: crypto.randomUUID(), role: 'assistant', isSystemIntro: true }]);
    }
  }, [repos.length, messages.length]);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages]);

  const runQuery = async () => {
    if (!query.trim() || querying || mergedNodes.length === 0) return;
    const userMsg = query.trim();
    setQuery('');
    setQuerying(true);
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: userMsg }]);
    try {
      const payload: any = { query: userMsg };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await fetch(`${API}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        // analysis may be null if Gemini is unavailable — still show file results
        const msgData = json.analysis ?? (json.results?.length > 0 ? {
          explanation: `Found ${json.results.length} relevant files for "${userMsg}". Gemini analysis unavailable — add an API key above to enable AI explanations.`,
          recommendations: [],
          learningPath: []
        } : null);
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', data: msgData ?? undefined, files: json.relevantFiles ?? [] }]);
      } else {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: json.error || 'Search failed. Run a repository scan first.' }]);
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: `Connection error: ${e.message}` }]);
    }
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
            { id: 'home', label: 'Home' },
            { id: 'repos', label: 'Repositories' },
            { id: 'graph', label: 'Graph' },
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
            { label: 'API', ok: sys.node.ok, lat: sys.node.latency },
            { label: 'Java AST', ok: sys.java.ok, lat: undefined },
            { label: 'Ollama', ok: sys.ollama.ok, lat: undefined },
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
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-full)', border: '1px solid', cursor: 'pointer',
                    background: r.id === activeRepo.id ? `${r.color}14` : 'var(--gray-50)',
                    borderColor: r.id === activeRepo.id ? r.color : 'var(--gray-200)',
                  }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: r.id === activeRepo.id ? r.color : 'var(--gray-500)' }}>{r.label}</span>
                  {r.status === 'running' && <span style={{ fontSize: 10, color: r.color }} className="spin">⟳</span>}
                  {r.status === 'done' && <span style={{ fontSize: 10, color: '#22c55e' }}>✓</span>}
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
                scanTotal={(activeRepo as any).scanTotal ?? 0}
                scanDone={(activeRepo as any).scanDone ?? 0}
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
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>Files <strong>{repos.reduce((acc, r) => acc + r.nodes.length, 0)}</strong></span>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>Deps <strong>{repos.reduce((acc, r) => acc + r.edges.length, 0)}</strong></span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8, marginTop: 12 }}>
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


                {/* ══ QUERY ════════════════════════════════════════════════ */}
                {activeTab === 'query' && (
                  <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {/* Hero header */}
                    <div className="panel-hero">
                      <div className="panel-hero-title">AI <span>Chat</span></div>
                      <div className="panel-hero-sub">Ask anything about your codebase in plain English.</div>
                    </div>

                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                      <input className="input" type="password" style={{ fontSize: 12.5 }} value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder="Gemini API Key (optional — overrides .env)" />
                    </div>

                    {/* Chat messages */}
                    <div className="chat-scroll-area" ref={chatScrollRef} style={{ padding: '16px 16px 8px' }}>
                      {messages.map(m => (
                        <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', width: '100%' }}>
                          
                          {/* System intro card */}
                          {m.isSystemIntro && (
                            <div className="summary-card">
                              <div className="summary-card-label">✦ Architecture Summary</div>
                              {repos[0]?.summary ? (
                                <>
                                  <p style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.65, marginBottom: 12 }}>{repos[0].summary.overallPurpose}</p>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>📚 Onboarding Path</div>
                                  <ol style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 12, color: '#64748b', lineHeight: 1.7 }}>
                                    {(repos[0].summary.recommendedOnboardingPath || []).map((p, i) => (
                                      <li key={i} style={{ marginBottom: 2 }}>{p.split(/[/\\]/).pop()}</li>
                                    ))}
                                  </ol>
                                  <button className="btn-export" onClick={exportSummary}>
                                    <span>↓</span> Export Architecture Report (.md)
                                  </button>
                                </>
                              ) : (
                                <>
                                  <p style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.65, marginBottom: 12 }}>
                                    No summary generated yet. Ensure your Gemini API Key is entered above, then generate.
                                  </p>
                                  <button className="btn-generate" onClick={generateMissingSummary} disabled={generatingSummary}>
                                    {generatingSummary ? <><span className="spin">⟳</span> Generating...</> : <><span>⚡</span> Generate Comprehensive Summary</>}
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* User bubble */}
                          {m.text && m.role === 'user' && (
                            <div className="chat-bubble-user">{m.text}</div>
                          )}

                          {/* Assistant error/info text */}
                          {m.text && m.role === 'assistant' && (
                            <div className="chat-bubble-ai">{m.text}</div>
                          )}

                          {/* AI analysis block */}
                          {m.data && (
                            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, width: '100%' }}>
                              <div style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>✦ AI Analysis</div>
                              <p style={{ fontSize: 12.5, color: '#166534', lineHeight: 1.65, margin: 0 }}>{m.data.explanation}</p>
                              {m.data.recommendations && m.data.recommendations.length > 0 && (
                                <>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 5 }}>Recommendations</div>
                                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#b45309', lineHeight: 1.65 }}>
                                    {m.data.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                                  </ul>
                                </>
                              )}
                            </div>
                          )}

                          {/* File references */}
                          {m.files && m.files.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: '100%' }}>
                              {m.files.slice(0, 4).map((f: any, i: number) => (
                                <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f8fafc', padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 11, color: '#475569' }}>
                                  <span style={{ color: '#f97316', fontWeight: 700, fontSize: 10 }}>{(f.score * 100).toFixed(0)}%</span>
                                  <span style={{ fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{f.path.split(/[/\\]/).pop()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Typing indicator */}
                      {querying && (
                        <div style={{ display: 'flex', gap: 4, padding: '6px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '2px 10px 10px 10px', width: 'fit-content' }}>
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </div>
                      )}

                      {/* Empty state */}
                      {messages.length === 0 && mergedNodes.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8' }}>
                          <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No repositories scanned yet</div>
                          <div style={{ fontSize: 12, lineHeight: 1.6 }}>Go to <strong style={{ color: '#f97316', cursor: 'pointer' }} onClick={() => setActiveTab('repos')}>Repositories</strong> and run a scan first.</div>
                        </div>
                      )}
                    </div>

                    {/* Chat input */}
                    <div className="chat-input-bar" style={{ padding: '12px 16px' }}>
                      <input
                        className="chat-input"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && runQuery()}
                        placeholder={mergedNodes.length === 0 ? 'Run a repository scan first…' : 'Ask anything about your codebase…'}
                        disabled={querying || mergedNodes.length === 0}
                      />
                      <button className="chat-send-btn" onClick={runQuery} disabled={querying || !query.trim() || mergedNodes.length === 0}>
                        {querying ? <span className="spin" style={{ fontSize: 14 }}>⟳</span> : '↑'}
                      </button>
                    </div>
                  </div>
                )}

                {/* ══ SETUP ── hidden from sidebar, rendered full-screen below ══ */}
              </div>
            </aside>
          )}

          {/* ── SETUP & MCP — full-screen when active ── */}
          {activeTab === 'setup' && <SetupPage />}


          {/* ── GRAPH CANVAS ── shown for repos/graph/arch/query */}
          {(activeTab === 'repos' || activeTab === 'graph' || activeTab === 'query') && (
            <main className="graph-canvas" style={{ flex: 1, position: 'relative' }}>
              {mergedNodes.length === 0 ? (
                <div className="graph-empty">
                  <div className="graph-empty-icon">🕸</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>No graph yet</div>
                  <div style={{ fontSize: 13, color: 'var(--gray-400)', maxWidth: 260, textAlign: 'center', lineHeight: 1.65 }}>
                    Go to <strong style={{ color: 'var(--orange)', cursor: 'pointer' }} onClick={() => setActiveTab('repos')}>Repositories</strong>, add a path, and click <strong>Run All</strong>.
                  </div>
                </div>
              ) : (
                <>
                  {/* Repository Filter Toggle */}
                  {repos.length > 1 && (
                    <div style={{
                      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
                      background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)',
                      padding: '4px', borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                      display: 'flex', gap: 4, alignItems: 'center'
                    }}>
                      <button
                        onClick={() => setGraphFilterRepoId(null)}
                        style={{
                          padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: graphFilterRepoId === null ? '#f97316' : 'transparent',
                          color: graphFilterRepoId === null ? '#fff' : '#64748b',
                          transition: 'all 0.2s',
                        }}
                      >
                        All Repositories (Unified)
                      </button>
                      <div style={{ width: 1, height: 16, background: '#e2e8f0' }} />
                      {repos.map(r => (
                        <button
                          key={r.id}
                          onClick={() => setGraphFilterRepoId(r.id)}
                          style={{
                            padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
                            background: graphFilterRepoId === r.id ? '#f8fafc' : 'transparent',
                            color: graphFilterRepoId === r.id ? '#0f172a' : '#64748b',
                            display: 'flex', alignItems: 'center', gap: 6,
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color }} />
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <ArchitectureGraph
                    backendNodes={displayedNodes}
                    backendEdges={displayedEdges}
                    onNodeSelect={n => setSelectedNode(
                      n ? { id: n.id, data: { ...n.data, codeQuality: (n.data.codeQuality as any) } } : null
                    )}
                  />
                </>
              )}
              <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
            </main>
          )}
        </div>
      )}
    </div>
  );
}
