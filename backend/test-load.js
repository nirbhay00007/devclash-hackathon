// Tests the /api/load endpoint — should be INSTANT (no Ollama calls, pure disk read)
const http = require('http');

const body = JSON.stringify({ targetPath: 'C:/College/DEV_CLASH/backend/src' });
const start = Date.now();

const req = http.request(
  {
    hostname: 'localhost', port: 3001,
    path: '/api/load', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  },
  (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const elapsed = Date.now() - start;
      const j = JSON.parse(data);
      if (!j.success) { console.error('LOAD FAILED:', j.error); process.exit(1); }

      console.log(`\n✅ /api/load responded in ${elapsed}ms (source: ${j.source})`);
      console.log(`\n📊 Loaded: ${j.data.nodes.length} nodes | ${j.data.edges.length} edges`);
      console.log(`📦 Vectors reloaded: ${j.vectorCount}`);
      console.log(`\n🗂  Meta:`);
      console.log(`   Repo:       ${j.meta.repoPath}`);
      console.log(`   Analyzed:   ${j.meta.analyzedAt}`);
      console.log(`   Files:      ${j.meta.fileCount}`);
      console.log(`   Duration:   ${(j.meta.durationMs / 1000).toFixed(1)}s (original analysis time)`);

      console.log('\n📄 Node sample (pipeline.ts):');
      const pipe = j.data.nodes.find(n => n.data.label === 'pipeline.ts');
      if (pipe) {
        const d = pipe.data;
        console.log(`   responsibility: ${d.responsibility}`);
        console.log(`   layer:          ${d.layer}`);
        console.log(`   codeQuality:    ${d.codeQuality}`);
        console.log(`   risk:           ${d.risk}`);
        console.log(`   fanIn:          ${d.fanIn} | fanOut: ${d.fanOut}`);
        console.log(`   keyExports:     ${d.keyExports.join(', ')}`);
        console.log(`   internalCalls:  ${(d.internalCalls || []).slice(0, 5).join(', ')}`);
        console.log(`   isOrphan:       ${d.isOrphan}`);
      }
      process.exit(0);
    });
  }
);
req.on('error', e => { console.error(e.message); process.exit(1); });
req.write(body);
req.end();
