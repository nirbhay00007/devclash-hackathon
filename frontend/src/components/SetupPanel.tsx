import { useState } from 'react';

type OS    = 'windows' | 'mac' | 'linux';
type Agent = 'claude' | 'cursor' | 'antigravity';

// ─── Data ─────────────────────────────────────────────────────────────────────

const OLLAMA_MAP: Record<OS, { url: string; label: string; size: string; cmd?: string }> = {
  windows: { url: 'https://ollama.com/download/OllamaSetup.exe',    label: 'Download for Windows (.exe)', size: '~80 MB' },
  mac:     { url: 'https://ollama.com/download/Ollama-darwin.zip',  label: 'Download for macOS (.zip)',   size: '~60 MB' },
  linux:   { url: '', label: 'Install via curl', size: 'one-liner', cmd: 'curl -fsSL https://ollama.com/install.sh | sh' },
};

const MODELS = [
  { id: 'qwen2.5-coder:3b',  icon: '🧠', title: 'qwen2.5-coder:3b',  sub: 'Code Summarization Engine',  size: '1.9 GB', cmd: 'ollama pull qwen2.5-coder:3b',  color: '#f97316' },
  { id: 'nomic-embed-text',  icon: '🔢', title: 'nomic-embed-text',   sub: 'Vector Embedding Model',     size: '274 MB', cmd: 'ollama pull nomic-embed-text',   color: '#0ea5e9' },
];

const AGENTS: Record<Agent, { icon: string; label: string; desc: string; file: string; config: string; tip: string }> = {
  claude: {
    icon: '🧠', label: 'Claude Desktop', desc: 'Point Claude to the local MCP server — it will automatically call search_codebase before responding.',
    file: 'Windows: %APPDATA%\\Claude\\claude_desktop_config.json\nmacOS: ~/Library/Application Support/Claude/claude_desktop_config.json',
    config: `{
  "mcpServers": {
    "dev-clash-memory": {
      "url": "http://localhost:3001/api/mcp",
      "description": "DEV_CLASH AI Codebase Memory"
    }
  }
}`,
    tip: 'Restart Claude Desktop after saving. A 🔧 tool icon confirms the connection.',
  },
  cursor: {
    icon: '⚡', label: 'Cursor IDE', desc: 'Add the MCP server in Cursor settings. Type "@dev-clash" in the AI chat to activate codebase memory.',
    file: 'Cursor → Settings → MCP tab  or  Cmd/Ctrl+Shift+P → Open User Settings (JSON)',
    config: `{
  "mcp.servers": [
    {
      "name": "dev-clash-memory",
      "url": "http://localhost:3001/api/mcp"
    }
  ]
}`,
    tip: 'Cursor auto-detects the server. Type @dev-clash in chat to invoke codebase memory.',
  },
  antigravity: {
    icon: '🚀', label: 'Antigravity', desc: 'Antigravity calls search_codebase automatically before each coding session — zero config needed after setup.',
    file: 'Windows: C:\\Users\\<you>\\.gemini\\mcp.json\nmacOS/Linux: ~/.gemini/mcp.json',
    config: `{
  "servers": {
    "dev-clash": {
      "url": "http://localhost:3001/api/mcp",
      "description": "Permanent codebase memory"
    }
  }
}`,
    tip: 'Antigravity will use the vector index without you having to ask — always context-aware.',
  },
};

const MCP_TOOLS = [
  { name: 'search_codebase',           color: '#22c55e', desc: 'Semantic search over all indexed files. Call BEFORE reading any file.' },
  { name: 'get_architecture_summary',  color: '#0ea5e9', desc: 'High-level repo overview: tech stack, entry points, subsystems.' },
  { name: 'get_file_context',          color: '#f59e0b', desc: 'AI summary + metadata for one file — cheaper than opening it raw.' },
  { name: 'get_dependency_graph',      color: '#a78bfa', desc: 'Fan-in / fan-out graph showing who imports what.' },
  { name: 'update_file_context',       color: '#f43f5e', desc: 'Re-embeds a file after editing. Keeps memory in sync automatically.' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SetupPanel() {
  const [os, setOs]         = useState<OS>('windows');
  const [agent, setAgent]   = useState<Agent>('claude');
  const [copied, setCopied] = useState<string | null>(null);
  const [ollamaOk, setOllamaOk]   = useState<boolean | null>(null);
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const checkOllama = async () => {
    setChecking(true);
    try {
      const res  = await fetch('http://localhost:11434/api/tags');
      const json = await res.json();
      const names: string[] = (json.models ?? []).map((m: { name: string }) => m.name);
      setOllamaOk(true);
      const status: Record<string, boolean> = {};
      MODELS.forEach(m => { status[m.id] = names.some(n => n.includes(m.id.split(':')[0])); });
      setModelStatus(status);
    } catch {
      setOllamaOk(false);
    } finally {
      setChecking(false);
    }
  };

  const ag = AGENTS[agent];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── HEADER BANNER ─────────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%)', borderBottom: '1px solid var(--orange-border)', padding: '24px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, boxShadow: '0 4px 12px rgba(249,115,22,0.35)' }}>⚙</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.3px' }}>Setup & MCP Guide</div>
            <div style={{ fontSize: 12, color: '#92400e' }}>4 steps to full AI codebase memory</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: 'rgba(249,115,22,0.1)', border: '1px solid var(--orange-border)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--orange)' }}>~90%</div>
            <div style={{ fontSize: 10.5, color: '#92400e', fontWeight: 600 }}>Token Savings</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(249,115,22,0.1)', border: '1px solid var(--orange-border)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--orange)' }}>100%</div>
            <div style={{ fontSize: 10.5, color: '#92400e', fontWeight: 600 }}>Local & Private</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(249,115,22,0.1)', border: '1px solid var(--orange-border)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--orange)' }}>5</div>
            <div style={{ fontSize: 10.5, color: '#92400e', fontWeight: 600 }}>MCP Tools</div>
          </div>
        </div>
      </div>

      {/* ── STEP 1: INSTALL OLLAMA ─────────────────────────────────────────────── */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>1</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.2px' }}>Install Ollama</div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['windows', 'mac', 'linux'] as OS[]).map(o => (
            <button key={o} onClick={() => setOs(o)}
              className={`os-btn${os === o ? ' active' : ''}`}
              style={{ flex: 1, textAlign: 'center' }}>
              {o === 'windows' ? '🪟 Win' : o === 'mac' ? '🍎 Mac' : '🐧 Linux'}
            </button>
          ))}
        </div>

        {OLLAMA_MAP[os].cmd ? (
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginBottom: 8 }}>Run in your terminal:</div>
            <div style={{ position: 'relative', background: '#0d1117', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#79c0ff' }}>{OLLAMA_MAP[os].cmd}</code>
              <button className="copy-btn" onClick={() => copy('ollama-linux', OLLAMA_MAP[os].cmd!)}>
                {copied === 'ollama-linux' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <a href={OLLAMA_MAP[os].url} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--orange)', color: 'var(--white)', borderRadius: 10, padding: '12px 16px', textDecoration: 'none', fontWeight: 700, fontSize: 13.5, boxShadow: '0 4px 14px rgba(249,115,22,0.3)', transition: 'background 0.15s' }}>
            <span style={{ fontSize: 18 }}>⬇️</span>
            <span style={{ flex: 1 }}>{OLLAMA_MAP[os].label}</span>
            <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 400 }}>{OLLAMA_MAP[os].size}</span>
          </a>
        )}
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--gray-400)', lineHeight: 1.65 }}>
          Ollama runs AI models entirely on your hardware. <strong style={{ color: 'var(--gray-500)' }}>Your code never leaves your machine.</strong>
        </div>
      </div>

      {/* ── STEP 2: PULL MODELS ───────────────────────────────────────────────── */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>2</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.2px' }}>Pull AI Models</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray-400)' }}>Run once, stays local</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {MODELS.map(m => (
            <div key={m.id} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: '12px 14px', background: 'var(--gray-50)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 700, color: 'var(--black)' }}>{m.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{m.sub} · {m.size}</div>
                </div>
                {modelStatus[m.id] !== undefined && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: modelStatus[m.id] ? '#f0fdf4' : '#fef2f2', color: modelStatus[m.id] ? '#16a34a' : '#dc2626', border: `1px solid ${modelStatus[m.id] ? '#86efac' : '#fca5a5'}` }}>
                    {modelStatus[m.id] ? '✓ Installed' : '✗ Missing'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: '8px 12px', gap: 8 }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#79c0ff' }}>{m.cmd}</code>
                <button className="copy-btn" style={{ position: 'static' }} onClick={() => copy(m.id, m.cmd)}>
                  {copied === m.id ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={checkOllama} disabled={checking}
          style={{ width: '100%', padding: '10px', border: '1.5px solid var(--gray-200)', borderRadius: 8, background: 'var(--white)', fontSize: 13, fontWeight: 600, color: checking ? 'var(--gray-400)' : 'var(--black)', cursor: checking ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s', fontFamily: 'var(--font)' }}>
          {checking ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Checking…</> : '🔍 Check Ollama & Models'}
        </button>

        {ollamaOk !== null && (
          <div style={{ marginTop: 10, background: ollamaOk ? '#f0fdf4' : '#fef2f2', border: `1px solid ${ollamaOk ? '#86efac' : '#fca5a5'}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: ollamaOk ? '#15803d' : '#b91c1c', marginBottom: ollamaOk ? 8 : 0 }}>
              <span>{ollamaOk ? '✓' : '✗'}</span>
              {ollamaOk ? 'Ollama is running' : 'Ollama offline — run: ollama serve'}
            </div>
            {ollamaOk && (
              <div style={{ display: 'flex', gap: 8 }}>
                {MODELS.map(m => (
                  <span key={m.id} style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: modelStatus[m.id] ? '#dcfce7' : '#fee2e2', color: modelStatus[m.id] ? '#15803d' : '#b91c1c', border: `1px solid ${modelStatus[m.id] ? '#86efac' : '#fca5a5'}` }}>
                    {modelStatus[m.id] ? '✓' : '✗'} {m.title.split(':')[0]}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── STEP 3: CONNECT AGENT ──────────────────────────────────────────────── */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>3</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.2px' }}>Connect Your AI Agent</div>
        </div>

        {/* Agent cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {(Object.entries(AGENTS) as [Agent, typeof AGENTS[Agent]][]).map(([key, val]) => (
            <div key={key} onClick={() => setAgent(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1.5px solid', borderColor: agent === key ? 'var(--orange)' : 'var(--gray-200)', background: agent === key ? '#fff7ed' : 'var(--gray-50)', cursor: 'pointer', transition: 'all 0.15s' }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{val.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: agent === key ? 'var(--orange)' : 'var(--black)', marginBottom: 2 }}>{val.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--gray-400)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val.desc}</div>
              </div>
              <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${agent === key ? 'var(--orange)' : 'var(--gray-200)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: agent === key ? 'var(--orange)' : 'transparent' }}>
                {agent === key && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--white)' }} />}
              </div>
            </div>
          ))}
        </div>

        {/* Config file path */}
        <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Config file</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--gray-500)', whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{ag.file}</div>
        </div>

        {/* Config code block */}
        <div style={{ position: 'relative', background: '#0d1117', border: '1px solid #21262d', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#79c0ff', margin: 0, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{ag.config}</pre>
          <button className="copy-btn" onClick={() => copy(`agent-${agent}`, ag.config)}>
            {copied === `agent-${agent}` ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        {/* Tip */}
        <div style={{ background: 'var(--orange-light)', border: '1px solid var(--orange-border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
          💡 {ag.tip}
        </div>
      </div>

      {/* ── STEP 4: MCP TOOLS ─────────────────────────────────────────────────── */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>4</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.2px' }}>MCP Tools Your Agent Gets</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MCP_TOOLS.map(t => (
            <div key={t.name} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--gray-100)', background: 'var(--gray-50)', alignItems: 'flex-start' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0, marginTop: 5, boxShadow: `0 0 6px ${t.color}` }} />
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: t.color, marginBottom: 3 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.55 }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HTTP BRIDGE ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--black)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
          🔌 <span>HTTP Agent Bridge</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray-400)', marginLeft: 2 }}>For agents without MCP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <code style={{ flex: 1, background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--black)' }}>
            POST http://localhost:3001/api/query
          </code>
          <button className="copy-btn" style={{ position: 'static' }} onClick={() => copy('http', 'POST http://localhost:3001/api/query')}>
            {copied === 'http' ? '✓' : 'Copy'}
          </button>
        </div>
        <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8b949e', lineHeight: 1.75 }}>
          {'{ "query": "Where is authentication handled?" }'}
          <br />
          <span style={{ color: '#3fb950' }}>// → Returns Markdown context ready for any AI system prompt</span>
        </div>
      </div>

      {/* ── TOKEN SAVINGS ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--black)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
          📉 Token Savings Breakdown
        </div>
        {[
          { label: 'Without DEV_CLASH', pct: 100, color: '#ef4444', note: '~2,000 tokens / file read' },
          { label: 'With MCP Memory',   pct: 10,  color: '#22c55e', note: '~150 tokens / summary' },
        ].map(row => (
          <div key={row.label} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gray-700)' }}>{row.label}</span>
              <span style={{ fontSize: 11.5, color: row.color, fontWeight: 700 }}>{row.note}</span>
            </div>
            <div style={{ background: 'var(--gray-100)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${row.pct}%`, background: row.color, borderRadius: 99, boxShadow: `0 0 8px ${row.color}60`, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        ))}
        <div style={{ textAlign: 'center', padding: '12px', background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #86efac', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#15803d' }}>
          ≈ 90% fewer tokens · Permanent memory · No re-reads
        </div>
      </div>
    </div>
  );
}
