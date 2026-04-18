// Full backend flow validation — every layer, every endpoint
const BASE = 'http://localhost:3001';

let passed = 0, failed = 0;

async function check(label, fn) {
    try {
        await fn();
        console.log(`  ✅  ${label}`);
        passed++;
    } catch (e) {
        console.log(`  ❌  ${label} — ${e.message}`);
        failed++;
    }
}

async function post(path, body) {
    const r = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    return { status: r.status, data };
}

async function get(path) {
    const r = await fetch(`${BASE}${path}`);
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    return { status: r.status, data };
}

async function run() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║        DEV_CLASH — Full Backend Flow Validation               ║
╚═══════════════════════════════════════════════════════════════╝`);

    // ── Layer 1: Health & Status ─────────────────────────────────────────────
    console.log('\n[1/8] HEALTH & STATUS');
    await check('/health returns ok',           async () => { const {data:d} = await get('/health'); if (d.status !== 'ok') throw new Error('not ok'); });
    await check('/api/status has nodeBackend',   async () => { const {data:d} = await get('/api/status'); if (!d.nodeBackend) throw new Error('missing nodeBackend'); });
    await check('/api/status has javaBackend',   async () => { const {data:d} = await get('/api/status'); if (!d.javaBackend || typeof d.javaBackend.status !== 'string') throw new Error('missing javaBackend'); });
    await check('/api/status isPipelineIdle',    async () => { const {data:d} = await get('/api/status'); if (typeof d.pipelineRunning !== 'boolean') throw new Error('missing pipelineRunning'); });

    // ── Warm-up: reload cached repo so graph/vector tests are stable ──────────
    console.log('\n[SETUP] Loading cached repo into memory...');
    const CACHED_REPO = 'C:/College/DEV_CLASH/backend/repos/spring-petclinic_1776513993551';
    let warmUpOk = false;
    try {
        const wu = await post('/api/load', { targetPath: CACHED_REPO });
        warmUpOk = wu.data.success === true;
        console.log(`  ✅  Loaded ${wu.data.vectorCount ?? 0} vectors, ${wu.data.data?.nodes?.length ?? 0} nodes from cache`);
    } catch (e) {
        console.log(`  ⚠️  Cache load failed (${e.message}) — graph/query tests will be skipped`);
    }

    // ── Layer 2: Graph Data ──────────────────────────────────────────────────
    console.log('\n[2/8] GRAPH DATA');
    let graphData;
    await check('/api/graph returns nodes array',  async () => { const {data:d} = await get('/api/graph'); graphData = d.data; if (!Array.isArray(d.data.nodes)) throw new Error('not array'); });
    await check('/api/graph returns edges array',  async () => { if (!Array.isArray(graphData?.edges)) throw new Error('not array'); });
    await check('/api/graph nodes have id+summary', async () => {
        const n = graphData?.nodes?.[0];
        if (!n?.id) throw new Error('missing id');
        if (!n?.data?.summary) throw new Error('missing summary');
    });
    await check('/api/graph includes risk metadata', async () => {
        const n = graphData?.nodes?.[0];
        if (!n?.data?.risk) throw new Error('missing risk');
    });
    console.log(`     Graph loaded: ${graphData?.nodes?.length ?? 0} nodes, ${graphData?.edges?.length ?? 0} edges`);

    // ── Layer 3: Semantic Search / RAG ───────────────────────────────────────
    console.log('\n[3/8] SEMANTIC SEARCH (Vector + Fallback)');
    let queryData;
    await check('/api/query returns HTTP 200',     async () => { const r = await post('/api/query', { query: 'How does the OwnerController handle requests?' }); queryData = r.data; });
    await check('/api/query returns results array', async () => { if (!Array.isArray(queryData?.results)) throw new Error('results not array'); });
    await check('/api/query results have score',   async () => { const r = queryData?.results?.[0]; if (typeof r?.score !== 'number') throw new Error('missing score'); });
    await check('/api/query returns success flag', async () => { if (!queryData?.success) throw new Error('success=false'); });
    console.log(`     Query returned: ${queryData?.results?.length ?? 0} matches | Gemini: ${queryData?.gemini ?? false}`);

    // ── Layer 4: Agent HTTP Bridge ───────────────────────────────────────────
    console.log('\n[4/8] AGENT HTTP BRIDGE (/api/agent-sync)');
    let agentData;
    await check('/api/agent-sync returns HTTP 200',        async () => { const r = await post('/api/agent-sync', { task: 'How does persistence work in this codebase?' }); agentData = r.data; });
    await check('/api/agent-sync has optimized_prompt_context', async () => { if (typeof agentData?.optimized_prompt_context !== 'string') throw new Error('missing field'); });
    await check('/api/agent-sync has token_estimate',      async () => { if (typeof agentData?.token_estimate !== 'number') throw new Error('missing token estimate'); });
    await check('/api/agent-sync has instructions array',  async () => { if (!Array.isArray(agentData?.instructions)) throw new Error('missing instructions'); });
    console.log(`     Agent sync: ${agentData?.token_estimate ?? 0} token estimate, ${agentData?.files_searched ?? 0} files in index`);

    // ── Layer 5: MCP Protocol ────────────────────────────────────────────────
    console.log('\n[5/8] MCP PROTOCOL (/api/mcp)');
    let toolsList;
    await check('MCP initialize returns serverInfo',  async () => { const {data:d} = await post('/api/mcp', { jsonrpc:'2.0', method:'initialize', id:1 }); if (!d.result?.serverInfo?.name) throw new Error('no serverInfo'); });
    await check('MCP initialize returns protocolVersion', async () => { const {data:d} = await post('/api/mcp', { jsonrpc:'2.0', method:'initialize', id:2 }); if (!d.result?.protocolVersion) throw new Error('no protocolVersion'); });
    await check('MCP tools/list returns 5 tools',    async () => { const {data:d} = await post('/api/mcp', { jsonrpc:'2.0', method:'tools/list', id:3 }); toolsList = d.result?.tools; if (toolsList?.length !== 5) throw new Error(`Expected 5, got ${toolsList?.length}`); });
    await check('MCP tool search_codebase present',  async () => { if (!toolsList?.find(t => t.name === 'search_codebase')) throw new Error('missing tool'); });
    await check('MCP tool get_architecture_summary', async () => { if (!toolsList?.find(t => t.name === 'get_architecture_summary')) throw new Error('missing tool'); });
    await check('MCP tool get_file_context present', async () => { if (!toolsList?.find(t => t.name === 'get_file_context')) throw new Error('missing tool'); });
    await check('MCP tool get_dependency_graph',     async () => { if (!toolsList?.find(t => t.name === 'get_dependency_graph')) throw new Error('missing tool'); });
    await check('MCP tool update_file_context',      async () => { if (!toolsList?.find(t => t.name === 'update_file_context')) throw new Error('missing tool — incremental sync tool'); });
    await check('MCP tools/call returns text content', async () => {
        const {data:d} = await post('/api/mcp', { jsonrpc:'2.0', method:'tools/call', params:{ name:'search_codebase', arguments:{ task:'database and repositories' } }, id:4 });
        if (d.result?.content?.[0]?.type !== 'text') throw new Error('wrong content type');
    });
    await check('MCP unknown method returns error', async () => {
        const r = await fetch(`${BASE}/api/mcp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', method:'unknown/method', id:5 }) });
        const d = await r.json();
        if (!d.error) throw new Error('should return JSON-RPC error');
    });
    await check('MCP notifications/initialized returns 204', async () => {
        const r = await fetch(`${BASE}/api/mcp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' }) });
        if (r.status !== 204) throw new Error(`Expected 204, got ${r.status}`);
    });
    await check('/api/notify-changes missing files → 400', async () => {
        const r = await fetch(`${BASE}/api/notify-changes`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
        if (r.ok) throw new Error('should 400');
    });
    await check('/api/notify-changes processes files array', async () => {
        const {data:d} = await post('/api/notify-changes', { files: ['C:/College/DEV_CLASH/backend/package.json'] });
        if (!d.success) throw new Error('success=false');
        if (!Array.isArray(d.results)) throw new Error('no results array');
    });
    console.log(`     Tools: ${toolsList?.map(t => t.name).join(', ')}`);

    // ── Layer 6: FileSystem API ──────────────────────────────────────────────
    console.log('\n[6/8] FILESYSTEM API');
    let fsData;
    await check('/api/fs/list returns items array',       async () => { const {data:d} = await get('/api/fs/list?path=C:/College/DEV_CLASH/backend/src'); fsData = d; if (!Array.isArray(d.items)) throw new Error('not array'); });
    await check('/api/fs/list folders sorted first',      async () => { const first = fsData?.items?.[0]; if (!first?.isDirectory) throw new Error('first item not folder'); });
    await check('/api/fs/read returns file content',      async () => { const {data:d} = await get('/api/fs/read?path=C:/College/DEV_CLASH/backend/package.json'); if (!d.content?.includes('"name"')) throw new Error('unexpected content'); });
    await check('/api/fs/read rejects directory',         async () => { const r = await fetch(`${BASE}/api/fs/read?path=C:/College/DEV_CLASH/backend/src`); if (r.ok) throw new Error('should fail for directories'); });
    await check('/api/fs/list missing path → 400',        async () => { const r = await fetch(`${BASE}/api/fs/list`); if (r.ok) throw new Error('should fail'); });
    console.log(`     FS: ${fsData?.items?.length ?? 0} items in src/`);

    // ── Layer 7: Error Handling ──────────────────────────────────────────────
    console.log('\n[7/8] ERROR HANDLING');
    await check('/api/query missing body → 400',      async () => { const r = await fetch(`${BASE}/api/query`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); if (r.ok) throw new Error('should 400'); });
    await check('/api/query empty query → 400',       async () => { const r = await fetch(`${BASE}/api/query`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{"query":""}' }); if (r.ok) throw new Error('should 400'); });
    await check('/api/agent-sync missing task → 400', async () => { const r = await fetch(`${BASE}/api/agent-sync`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); if (r.ok) throw new Error('should 400'); });
    await check('Unknown route → 404',                async () => { const r = await fetch(`${BASE}/api/nonexistent`); if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`); });

    // ── Layer 8: Gemini Summary (optional) ──────────────────────────────────
    console.log('\n[8/8] GEMINI SUMMARY (optional)');
    const summaryRes = await fetch(`${BASE}/api/summary`);
    if (summaryRes.status === 404) {
        console.log('  ⚠️  Gemini summary not available (GEMINI_API_KEY missing — expected)');
    } else if (summaryRes.ok) {
        const d = await summaryRes.json();
        await check('/api/summary returns data', async () => { if (!d.data) throw new Error('missing data'); });
        console.log('  ✅  Gemini summary available');
    }

    // ── Final Results ────────────────────────────────────────────────────────
    const total = passed + failed;
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  Results: ${String(passed).padStart(2)} passed  |  ${String(failed).padStart(2)} failed  |  ${String(total).padStart(2)} total${' '.repeat(25)}║
╚═══════════════════════════════════════════════════════════════╝
`);

    if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
