import { useMemo } from 'react';

interface RepoEntry {
  id: string;
  path: string;
  label: string;
  color: string;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  log: string[];
  nodes: { id: string }[];
  edges: { id: string }[];
}

interface Props {
  repo: RepoEntry;
  scanTotal: number;
  scanDone: number;
  onStop: () => void;
  termRef?: (el: HTMLDivElement | null) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tagify(line: string): { ts: string; tag: string; tagColor: string; rest: string } {
  const tsMatch = line.match(/^(\d{2}:\d{2}:\d{2})/);
  const ts = tsMatch ? tsMatch[1] : new Date().toLocaleTimeString('en-GB');

  let tag = 'INFO'; let tagColor = '#8b949e';
  if (line.includes('✅') || line.includes('[SUCCESS]') || line.toLowerCase().includes('done') || line.startsWith('✓')) {
    tag = 'SUCCESS'; tagColor = '#22c55e';
  } else if (line.includes('❌') || line.includes('[ERROR]')) {
    tag = 'ERROR'; tagColor = '#f85149';
  } else if (line.includes('[WARN]') || line.includes('⚠') || line.toLowerCase().includes('warn')) {
    tag = 'WARN'; tagColor = '#f59e0b';
  } else if (line.toLowerCase().includes('gemini') || line.toLowerCase().includes('summariz') || line.toLowerCase().includes('embed')) {
    tag = 'AI'; tagColor = '#bc8cff';
  } else if (line.toLowerCase().includes('mapp') || line.toLowerCase().includes('graph') || line.toLowerCase().includes('edge') || line.toLowerCase().includes('node')) {
    tag = 'MAPPING'; tagColor = '#f97316';
  } else if (line.toLowerCase().includes('pars') || line.toLowerCase().includes('ast') || line.toLowerCase().includes('analyz')) {
    tag = 'PARSE'; tagColor = '#79c0ff';
  }

  const rest = line.replace(/^✅\s?|^❌\s?|^✓\s?|^\d{2}:\d{2}:\d{2}\s?/, '').trim();
  return { ts, tag, tagColor, rest };
}

// ─── Circular Progress SVG ───────────────────────────────────────────────────

function CircularProgress({ pct, total, scanned, color }: { pct: number; total: number; scanned: number; color: string }) {
  const R_OUTER = 120;
  const R_INNER = 90;
  const CX = 140; const CY = 140;
  const circumOuter = 2 * Math.PI * R_OUTER;
  const circumInner = 2 * Math.PI * R_INNER;
  const dashOuter = (pct / 100) * circumOuter;
  const DOTS = 60;

  // Show the directly-tracked count from SSE, not a pct-derived estimate
  const displayScanned = scanned;
  const displayTotal   = total > 0 ? total : null; // null = unknown

  return (
    <div style={{ position: 'relative', width: 280, height: 280, flexShrink: 0 }}>
      <svg width="280" height="280" style={{ transform: 'rotate(-90deg)' }}>
        {/* Dotted outer ring */}
        {Array.from({ length: DOTS }).map((_, i) => {
          const angle = (i / DOTS) * 2 * Math.PI;
          const x = CX + R_OUTER * Math.cos(angle);
          const y = CY + R_OUTER * Math.sin(angle);
          const filled = i < Math.round((pct / 100) * DOTS);
          return <circle key={i} cx={x} cy={y} r={2} fill={filled ? color : '#e5e7eb'} />;
        })}

        {/* Inner track */}
        <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="#f3f4f6" strokeWidth={10} />

        {/* Inner progress arc */}
        <circle
          cx={CX} cy={CY} r={R_INNER}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${dashOuter} ${circumInner}`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      </svg>

      {/* Center text */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 900, color: 'var(--black)', letterSpacing: '-1px', lineHeight: 1 }}>
          {displayScanned}
          {displayTotal !== null
            ? <span style={{ fontSize: 18, color: '#d1d5db', fontWeight: 500 }}>/{displayTotal}</span>
            : <span style={{ fontSize: 18, color: '#d1d5db', fontWeight: 500 }}>/—</span>
          }
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Files</div>
        {pct > 0 && pct < 100 && (
          <div style={{ fontSize: 11, fontWeight: 600, color, marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Analyzing…
          </div>
        )}
        {pct === 100 && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Complete ✓
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ScanVisualizer({ repo, scanTotal, scanDone, onStop, termRef }: Props) {
  const { label, path, color, status, progress, log, nodes, edges } = repo;

  // Rough estimates
  const estSeconds = useMemo(() => {
    if (progress === 0 || progress >= 100) return null;
    const elapsed = 1; // assume 1s per % as rough heuristic
    const remaining = ((100 - progress) / Math.max(progress, 1)) * elapsed * progress;
    return Math.round(remaining);
  }, [progress]);

  const mmss = (s: number) => {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  // Sidebar nav items
  const sideItems = [
    { icon: '🔍', label: 'Search', count: null, active: true },
  ];

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>

      {/* ── LEFT MINI-SIDEBAR ─────────────────────────────────── */}
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--gray-200)', background: '#fafafa', display: 'flex', flexDirection: 'column', padding: '16px 0' }}>
        {/* Repo info */}
        <div style={{ padding: '0 14px 14px', borderBottom: '1px solid var(--gray-200)', marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Project Root</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--black)' }}>{label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {path.split(/[/\\]/).filter(Boolean).slice(-2).join('/')}
            </div>
          </div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '0 8px' }}>
          {sideItems.map(item => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
              borderRadius: '6px', marginBottom: 2, cursor: 'pointer',
              background: item.active ? '#fff7ed' : 'transparent',
              color: item.active ? 'var(--orange)' : '#374151',
              fontWeight: item.active ? 700 : 500, fontSize: 13,
              transition: 'background 0.1s',
            }}>
              <span style={{ fontSize: 13 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.count != null && item.count > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: item.active ? 'var(--orange)' : '#9ca3af' }}>{item.count}</span>
              )}
            </div>
          ))}
        </div>


      </div>

      {/* ── CENTER: SCANNER ──────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--white)', borderRight: '1px solid var(--gray-200)', minWidth: 0 }}>
        {/* Engine status header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>Engine Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'running' ? color : status === 'done' ? '#22c55e' : '#ef4444',
              boxShadow: `0 0 0 3px ${status === 'running' ? `${color}30` : status === 'done' ? '#22c55e30' : '#ef444430'}`,
              animation: status === 'running' ? 'pulse-ok 1.5s infinite' : 'none',
            }} />
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--black)' }}>
              {status === 'running' ? 'Active Scan Sequence' : status === 'done' ? 'Scan Complete' : status === 'error' ? 'Scan Failed' : 'Ready'}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9ca3af', lineHeight: 1.9 }}>
            <div>ID:&nbsp;&nbsp;&nbsp;&nbsp;{repo.id.slice(0, 8).toUpperCase()}-A</div>
            <div>MODE:&nbsp;&nbsp;Deep Analysis</div>
            <div>TARGET: {path.replace(/\\/g, '/')}</div>
          </div>
        </div>

        {/* Circular ring */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '20px' }}>
          <CircularProgress pct={progress} total={scanTotal} scanned={scanDone} color={color} />
        </div>

        {/* Bottom stats bar */}
        <div style={{ borderTop: '1px solid var(--gray-200)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 0 }}>
          {[
            { label: 'Est. Time Remaining', val: status === 'done' ? '00:00' : estSeconds != null ? mmss(estSeconds) : '—:——', mono: true },
            { label: 'Files Found', val: `${nodes.length}`, mono: true },
            { label: 'Dependencies', val: `${edges.length}`, mono: true },
          ].map((s, i) => (
            <div key={s.label} style={{ flex: 1, borderLeft: i > 0 ? '1px solid var(--gray-200)' : 'none', paddingLeft: i > 0 ? 20 : 0, paddingRight: 20 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', fontFamily: s.mono ? 'var(--font-mono)' : 'var(--font)', letterSpacing: s.mono ? '-0.5px' : 0 }}>{s.val}</div>
            </div>
          ))}

          {/* Pause/Stop button */}
          <div style={{ flexShrink: 0 }}>
            {status === 'running' ? (
              <button onClick={onStop} style={{ padding: '8px 16px', borderRadius: 6, border: '1.5px solid var(--gray-200)', background: 'var(--white)', fontSize: 10.5, fontWeight: 700, color: '#374151', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                ⏸ Pause Scan
              </button>
            ) : status === 'done' ? (
              <span style={{ padding: '6px 14px', borderRadius: 6, border: '1.5px solid #86efac', background: '#f0fdf4', fontSize: 10.5, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                ✓ Complete
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── RIGHT: LIVE EXECUTION LOG ──────────────────────────── */}
      <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--white)' }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 15 }}>{'{ }'}</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--black)' }}>Live Execution Log</span>
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: color, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            Real-Time Mapping Events
          </div>
        </div>

        {/* Log lines */}
        <div
          ref={termRef}
          style={{ flex: 1, overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          {log.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              Waiting for scan to start…
            </div>
          ) : [...log].reverse().map((line, i) => {
            const { ts, tag, tagColor, rest } = tagify(line);
            return (
              <div key={i} style={{
                padding: '6px 20px',
                borderBottom: '1px solid var(--gray-50)',
                background: i === 0 ? `${tagColor}08` : 'transparent',
                display: 'grid',
                gridTemplateColumns: '68px 60px 1fr',
                alignItems: 'flex-start',
                gap: 8,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9ca3af', paddingTop: 1, flexShrink: 0 }}>{ts}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: tagColor, letterSpacing: '0.03em', flexShrink: 0, paddingTop: 1 }}>[{tag}]</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: i === 0 ? '#111827' : '#4b5563', lineHeight: 1.5, wordBreak: 'break-all' }}>{rest}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
