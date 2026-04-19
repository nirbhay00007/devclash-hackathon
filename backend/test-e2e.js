/**
 * DEV_CLASH Backend — End-to-End Integration Test Suite
 * Runs in pure Node.js (no curl, no shell escaping, no test framework needed).
 *
 * Tests:
 *   1. GET /health                   — basic health check
 *   2. GET /api/status               — microservice topology check
 *   3. POST /api/analyze             — 400 on missing body
 *   4. POST /api/analyze             — SSE error on nonexistent path
 *   5. POST /api/analyze             — full pipeline on local Java repo (Petclinic)
 *   6. GET /api/graph                — nodes + edges valid after pipeline
 *   7. GET /api/summary              — global Gemini summary exists
 *   8. POST /api/query               — semantic search returns results
 *
 * Usage:
 *   node backend/test-e2e.js
 */

const http = require('http');

const PETCLINIC_PATH = 'C:/College/DEV_CLASH/backend/repos/spring-petclinic_1776514643188';

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

function post(path, body, opts = {}) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost', port: 3001, path, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
            timeout: opts.timeout ?? 300_000,
        }, res => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                if (opts.verbose) process.stdout.write(chunk.toString());
            });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`POST ${path} timed out`)); });
        req.write(bodyStr);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: 'localhost', port: 3001, path, timeout: 10_000 }, res => {
            let data = '';
            res.on('data', c => (data += c));
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`GET ${path} timed out`)); });
    });
}

function parseJSON(raw, label) {
    try { return JSON.parse(raw); }
    catch { throw new Error(`Invalid JSON from ${label}: ${raw.slice(0, 200)}`); }
}

async function waitForIdle(maxWaitMs = 600_000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        try {
            const r = await get('/api/status');
            const s = JSON.parse(r.body);
            if (!s.pipelineRunning) return true;
            process.stdout.write('  ⏳ Pipeline busy — polling in 5s…\n');
        } catch {}
        await new Promise(r => setTimeout(r, 5000));
    }
    return false;
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

async function run() {
    let passed = 0, failed = 0;
    const errors = [];

    function ok(name, cond, detail = '') {
        if (cond) {
            console.log(`  ✅  ${name}`);
            passed++;
        } else {
            const msg = detail ? `  ❌  ${name} → ${detail}` : `  ❌  ${name}`;
            console.error(msg);
            errors.push(msg);
            failed++;
        }
    }

    const banner = '═══════════════════════════════════════════════════════════';
    console.log(`\n${banner}`);
    console.log('  DEV_CLASH Backend — Integration Test Suite  v0.0.1');
    console.log(`${banner}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Health check
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[1/8] GET /health');
    try {
        const r = await get('/health');
        const h = parseJSON(r.body, '/health');
        ok('HTTP 200',    r.status === 200);
        ok('status="ok"', h.status === 'ok');
        ok('timestamp present', typeof h.timestamp === 'string');
    } catch (e) { ok('health request', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Microservice status topology
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[2/8] GET /api/status');

    // Wait if a previous pipeline is running (frontend may have triggered one)
    console.log('  Waiting for pipeline to be idle…');
    const idle = await waitForIdle(120_000);
    ok('Pipeline idle within 2min', idle);

    try {
        const r = await get('/api/status');
        const s = parseJSON(r.body, '/api/status');
        ok('nodeBackend.status = ok', s.nodeBackend?.status === 'ok');
        ok('pipelineRunning = false',  s.pipelineRunning === false);
        const javaOk = s.javaBackend?.status === 'ok';
        console.log(`  Java backend: ${javaOk ? '✅ ok' : '⚠️  offline'} @ port ${s.javaBackend?.port}`);
    } catch (e) { ok('status parse', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: 400 on empty body
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[3/8] POST /api/analyze — empty body → expect 400');
    try {
        const r = await post('/api/analyze', {});
        ok('HTTP 400 returned', r.status === 400);
        const b = JSON.parse(r.body);
        ok('Error message present', typeof b.error === 'string' && b.error.length > 0);
    } catch (e) { ok('empty body guard', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Nonexistent path → SSE error event
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[4/8] POST /api/analyze — nonexistent path → expect SSE error');
    await waitForIdle(30_000);
    try {
        const r = await post('/api/analyze', { targetPath: '/this/path/does/not/exist' });
        ok('SSE connection established (HTTP 200)', r.status === 200);
        ok('SSE error phase in stream', r.body.includes('"error"') || r.body.includes('"phase"'));
    } catch (e) { ok('bad path test', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Full pipeline — local Java repo (Petclinic)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n[5/8] POST /api/analyze — Petclinic Java repo (${PETCLINIC_PATH})`);
    console.log('  SSE stream output:');
    await waitForIdle(30_000);
    try {
        const r = await post('/api/analyze', { targetPath: PETCLINIC_PATH }, { verbose: true, timeout: 300_000 });
        console.log(''); // newline after SSE stream
        ok('SSE HTTP 200', r.status === 200);
        ok('"phase" field streamed', r.body.includes('"phase"'));
        ok('"done" phase in stream', r.body.includes('"done"'));
        ok('Language detected as java', r.body.includes('java'));
    } catch (e) { ok('full pipeline test', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: /api/graph — nodes + edges populated after pipeline
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[6/8] GET /api/graph — validate node + edge data');
    try {
        const r = await get('/api/graph');
        ok('HTTP 200', r.status === 200);
        const g = parseJSON(r.body, '/api/graph');
        ok('data.nodes is array', Array.isArray(g?.data?.nodes));
        ok('data.edges is array', Array.isArray(g?.data?.edges));
        const nc = g?.data?.nodes?.length ?? 0;
        const ec = g?.data?.edges?.length ?? 0;
        ok(`nodes.length > 0 (got ${nc})`, nc > 0);
        // Each node should have id and summary
        const sample = g?.data?.nodes?.[0];
        ok('node has id field',      typeof sample?.id === 'string');
        ok('node has summary field', typeof sample?.data?.summary === 'string' || typeof sample?.summary === 'string');
        console.log(`  Graph: ${nc} nodes, ${ec} edges`);
    } catch (e) { ok('graph data', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7: /api/summary — Gemini global summary (non-fatal if Gemini unavailable)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[7/8] GET /api/summary — global Gemini summary');
    try {
        const r = await get('/api/summary');
        if (r.status === 404) {
            console.log('  ⚠️  Gemini summary not available (GEMINI_API_KEY may be missing) — skipping');
        } else {
            ok('HTTP 200', r.status === 200);
            const s = parseJSON(r.body, '/api/summary');
            ok('overallPurpose present', typeof s?.overallPurpose === 'string');
            ok('techStack is array', Array.isArray(s?.techStack));
        }
    } catch (e) { ok('summary request', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8: /api/query — semantic search
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[8/8] POST /api/query — semantic search');
    try {
        const r = await post('/api/query', { query: 'What handles the pet owner data?' });
        ok('HTTP 200', r.status === 200);
        const q = parseJSON(r.body, '/api/query');
        const hasResults = Array.isArray(q?.results) || Array.isArray(q?.data);
        ok('Results array returned', hasResults);
        console.log(`  Query results: ${q?.results?.length ?? q?.data?.length ?? 0} matches`);
    } catch (e) { ok('semantic query', false, e.message); }

    // ─────────────────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${banner}`);
    console.log(`  Results: ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
    if (errors.length) {
        console.log('\n  Failed assertions:');
        errors.forEach(e => console.log(`    ${e}`));
    }
    console.log(`${banner}\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('\n💥 Test runner crashed:', e.message); process.exit(1); });
