import { useState } from 'react';

type OS    = 'windows' | 'mac' | 'linux';
type Agent = 'claude' | 'cursor' | 'antigravity';

const OS_LINKS: Record<OS, { label: string; size: string; icon: string; fakeLink: boolean }> = {
  windows: { label: 'Download CodeMap_Installer.exe', size: 'v1.0.0 · ~6 MB', icon: '🪟', fakeLink: true },
  mac:     { label: 'Download for macOS (.dmg)',      size: 'v1.0.0 · ~12 MB', icon: '🍎', fakeLink: true },
  linux:   { label: 'curl -fsSL https://codemap.ai/install.sh', size: '', icon: '🐧', fakeLink: false },
};

const AGENTS: Record<Agent, { icon: string; label: string; desc: string; file: string; config: string; tip: string }> = {
  claude: {
    icon: '🧠', label: 'Claude Desktop', desc: 'Point Claude to the MCP server. A 🔧 tool icon confirms connection.',
    file: 'Windows: %APPDATA%\\Claude\\claude_desktop_config.json\nmacOS: ~/Library/Application Support/Claude/claude_desktop_config.json',
    config: `{
  "mcpServers": {
    "dev-clash-memory": {
      "url": "http://localhost:3001/api/mcp"
    }
  }
}`,
    tip: 'Restart Claude Desktop after saving.',
  },
  cursor: {
    icon: '⚡', label: 'Cursor IDE', desc: 'Add MCP in Cursor settings. Type @dev-clash in AI chat to activate.',
    file: 'Cursor → Settings → MCP tab',
    config: `{
  "mcp.servers": [{
    "name": "dev-clash-memory",
    "url": "http://localhost:3001/api/mcp"
  }]
}`,
    tip: 'Type @dev-clash in chat to invoke codebase memory.',
  },
  antigravity: {
    icon: '🚀', label: 'Antigravity', desc: 'Zero config — Antigravity calls search_codebase automatically.',
    file: 'C:\\Users\\<you>\\.gemini\\mcp.json  or  ~/.gemini/mcp.json',
    config: `{
  "servers": {
    "dev-clash": {
      "url": "http://localhost:3001/api/mcp"
    }
  }
}`,
    tip: 'Always context-aware — no prompting needed.',
  },
};

const MCP_TOOLS = [
  { name: 'search_codebase',          color: '#22c55e', desc: 'Semantic search over all indexed files.' },
  { name: 'get_architecture_summary', color: '#0ea5e9', desc: 'High-level repo overview & tech stack.' },
  { name: 'get_file_context',         color: '#f59e0b', desc: 'AI summary for a file — cheaper than raw reads.' },
  { name: 'get_dependency_graph',     color: '#a78bfa', desc: 'Fan-in/fan-out graph — who imports what.' },
  { name: 'update_file_context',      color: '#f43f5e', desc: 'Re-embeds a file after editing, keeps memory fresh.' },
];

export default function SetupPage() {
  const [os, setOs]         = useState<OS>('windows');
  const [agent, setAgent]   = useState<Agent>('claude');
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 2000); });
  };

  const [downloading, setDownloading] = useState(false);
  const handleDownload = () => {
    setDownloading(true);
    setTimeout(() => {
      setDownloading(false);
      alert('In a production environment, this would start downloading CodeMap_Installer.exe');
    }, 1500);
  };

  const ag = AGENTS[agent];

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--gray-50)' }}>

      {/* ── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--gray-200)', padding: '32px 48px 28px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 4px 14px rgba(249,115,22,0.35)' }}>⚙</div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--black)', letterSpacing: '-0.6px', marginBottom: 3 }}>
                Setup & <span style={{ color: 'var(--orange)' }}>MCP Guide</span>
              </h1>
              <p style={{ fontSize: 14, color: 'var(--gray-500)' }}>4 steps to give your AI agent permanent codebase memory.</p>
            </div>
          </div>
          {/* Summary pills */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {[
              { val: '~90%', lbl: 'Token Savings' },
              { val: '100%', lbl: 'Local & Private' },
              { val: '5',    lbl: 'MCP Tools' },
              { val: '3',    lbl: 'Supported Agents' },
            ].map(s => (
              <div key={s.lbl} style={{ padding: '8px 18px', borderRadius: 99, background: 'var(--orange-light)', border: '1px solid var(--orange-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--orange)' }}>{s.val}</span>
                <span style={{ fontSize: 12, color: '#92400e', fontWeight: 500, paddingLeft: 6, borderLeft: '1px solid var(--orange-border)' }}>{s.lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 4-COLUMN CARD GRID ───────────────────────────────────────────────── */}
      <div style={{ padding: '32px 48px 48px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24, alignItems: 'start' }}>

          {/* ╔══════════════════════════════╗
              ║  CARD 1 — Install Bridge     ║
              ╚══════════════════════════════╝ */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 }}>1</div>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.3px' }}>Download Local Bridge</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--gray-500)', lineHeight: 1.65 }}>A single lightweight executable that automatically bootstraps your local AI engine and models.</p>
            </div>
            
            <div style={{ padding: '16px 22px', display: 'flex', gap: 6 }}>
              {(['windows','mac','linux'] as OS[]).map(o => (
                <button key={o} onClick={() => setOs(o)} className={`os-btn${os===o?' active':''}`} style={{ flex:1, textAlign:'center', padding:'7px 0' }}>
                  {OS_LINKS[o].icon} {o.charAt(0).toUpperCase() + o.slice(1)}
                </button>
              ))}
            </div>
            
            <div style={{ padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {os === 'linux' ? (
                <div style={{ position:'relative', background:'#0d1117', borderRadius:12, padding:'12px 14px' }}>
                  <code style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#79c0ff', display:'block' }}>{OS_LINKS[os].label}</code>
                  <button className="copy-btn" onClick={() => navigator.clipboard.writeText(OS_LINKS[os].label)}>{copied==='linux'?'✓':'Copy'}</button>
                </div>
              ) : (
                <button onClick={handleDownload} disabled={downloading}
                  style={{ display:'flex', alignItems:'center', gap:10, background:'var(--orange)', color:'#fff', borderRadius:12, padding:'13px 16px', border:'none', cursor:downloading?'wait':'pointer', fontWeight:700, fontSize:13.5, boxShadow:'0 4px 14px rgba(249,115,22,0.3)', transition:'all 0.2s' }}>
                  <span style={{ fontSize:18 }}>{downloading ? '⏳' : '⬇️'}</span>
                  <span style={{ flex:1, textAlign:'left' }}>{downloading ? 'Downloading...' : OS_LINKS[os].label}</span>
                  <span style={{ fontSize:11, opacity:0.7 }}>{OS_LINKS[os].size}</span>
                </button>
              )}
              
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', marginTop: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>What the installer does automatically:</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: 'var(--gray-500)', lineHeight: 1.6 }}>
                  <li>Checks for Java and Node.js existence</li>
                  <li>Silently installs the Ollama ML Engine if missing</li>
                  <li>Pulls `qwen2.5-coder:3b` and `nomic-embed-text` locally</li>
                  <li>Starts the `localhost:3001` MCP daemon</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ╔══════════════════════════════╗
              ║  CARD 2 — Centralized Cache  ║
              ╚══════════════════════════════╝ */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 }}>2</div>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.3px' }}>Universal Embedded Memory</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--gray-500)', lineHeight: 1.65 }}>The client aggregates LLM embeddings consistently offline to drastically reduce token costs.</p>
            </div>
            
            <div style={{ padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 12, padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 16 }}>🗄️</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--black)' }}>Standardized Caching Path</span>
                </div>
                <code style={{ display: 'block', padding: '8px 10px', background: 'var(--white)', border: '1px dashed var(--gray-300)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray-600)', wordBreak: 'break-all' }}>
                  C:\Users\%USERNAME%\.dev-clash\data
                </code>
                <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--gray-500)', lineHeight: 1.5 }}>
                  Because embeddings are cached universally, any AI agent (like Cursor or Claude) can access your codebase knowledge graph instantly—zero external API costs.
                </p>
              </div>
            </div>
          </div>

          {/* ╔══════════════════════════════╗
              ║  CARD 3 — Connect Agent      ║
              ╚══════════════════════════════╝ */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 }}>3</div>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.3px' }}>Connect Agent</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--gray-500)', lineHeight: 1.65 }}>One config file gives your AI agent permanent memory of your entire codebase.</p>
            </div>
            {/* Agent selector */}
            <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.entries(AGENTS) as [Agent, typeof AGENTS[Agent]][]).map(([key, val]) => (
                <div key={key} onClick={() => setAgent(key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1.5px solid', borderColor: agent===key?'var(--orange)':'var(--gray-200)', background: agent===key?'var(--orange-light)':'var(--gray-50)', cursor: 'pointer', transition: 'all 0.12s' }}>
                  <span style={{ fontSize: 18 }}>{val.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: agent===key?'var(--orange)':'var(--black)' }}>{val.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)', lineHeight: 1.5 }}>{val.desc}</div>
                  </div>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${agent===key?'var(--orange)':'var(--gray-200)'}`, background: agent===key?'var(--orange)':'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {agent===key && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                </div>
              ))}
            </div>
            {/* Config */}
            <div style={{ padding: '0 22px', marginBottom: 10 }}>
              <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Config file</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gray-500)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{ag.file}</div>
              </div>
              <div style={{ position: 'relative', background: '#0d1117', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
                <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#79c0ff', margin: 0, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{ag.config}</pre>
                <button className="copy-btn" onClick={() => copy(`agent-${agent}`, ag.config)}>{copied===`agent-${agent}`?'✓ Copied':'Copy'}</button>
              </div>
            </div>
            <div style={{ padding: '0 22px 22px' }}>
              <div style={{ background: 'var(--orange-light)', border: '1px solid var(--orange-border)', borderRadius: 8, padding: '9px 13px', fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
                💡 {ag.tip}
              </div>
            </div>
          </div>

          {/* ╔══════════════════════════════╗
              ║  CARD 4 — MCP Tools + Stats  ║
              ╚══════════════════════════════╝ */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--black)', color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 }}>4</div>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.3px' }}>MCP Tools</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--gray-500)', lineHeight: 1.65 }}>5 tools your AI agent can call to access deep codebase knowledge.</p>
            </div>
            <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MCP_TOOLS.map(t => (
                <div key={t.name} style={{ display: 'flex', gap: 10, padding: '9px 12px', borderRadius: 9, border: '1px solid var(--gray-100)', background: 'var(--gray-50)', alignItems: 'flex-start' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0, marginTop: 4, boxShadow: `0 0 7px ${t.color}` }} />
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color: t.color, marginBottom: 2 }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--gray-500)', lineHeight: 1.55 }}>{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* HTTP Bridge */}
            <div style={{ padding: '0 22px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>HTTP Bridge (no MCP needed)</div>
              <div style={{ position: 'relative', background: '#0d1117', border: '1px solid #21262d', borderRadius: 9, padding: '10px 12px' }}>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#79c0ff', display: 'block', marginBottom: 4 }}>POST http://localhost:3001/api/query</code>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8b949e', display: 'block' }}>{'{ "query": "Where is auth handled?" }'}</code>
                <button className="copy-btn" onClick={() => copy('http', 'POST http://localhost:3001/api/query')}>{copied==='http'?'✓':'Copy'}</button>
              </div>
            </div>
            {/* Token savings bar */}
            <div style={{ padding: '0 22px 22px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Token Usage Comparison</div>
              {[
                { label: 'Without CodeMap AI', pct: 100, color: '#ef4444', note: '~2,000 tokens/read' },
                { label: 'With MCP Memory',   pct: 10,  color: '#22c55e', note: '~150 tokens/read' },
              ].map(row => (
                <div key={row.label} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>{row.label}</span>
                    <span style={{ fontSize: 11, color: row.color, fontWeight: 700 }}>{row.note}</span>
                  </div>
                  <div style={{ background: 'var(--gray-100)', borderRadius: 99, height: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${row.pct}%`, background: row.color, borderRadius: 99, boxShadow: `0 0 8px ${row.color}60` }} />
                  </div>
                </div>
              ))}
              <div style={{ textAlign: 'center', padding: '11px 12px', background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #86efac', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                ≈ 90% fewer tokens · Permanent memory
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
