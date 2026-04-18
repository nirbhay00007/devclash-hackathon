const http = require('http');

http.get('http://localhost:3001/api/graph', (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    const j = JSON.parse(data);
    if (!j.success) { console.error('Error:', j.error); process.exit(1); }
    const nodes = j.data.nodes;
    const edges = j.data.edges;
    console.log(`\nGraph snapshot: ${nodes.length} nodes, ${edges.length} edges\n`);
    nodes.forEach((n) => {
      const d = n.data;
      console.log(`  📄 ${d.label}`);
      console.log(`     risk: ${d.risk} | complexity: ${d.complexity} | fanIn: ${d.fanIn} | entry: ${d.isEntryPoint} | orphan: ${d.isOrphan} | churn: ${d.commitChurn}`);
      console.log(`     exports: [${(d.keyExports || []).slice(0, 3).join(', ')}]`);
      console.log(`     patterns: [${(d.patterns || []).join(', ')}]`);
      console.log(`     summary: ${(d.summary || '').slice(0, 90)}…`);
      console.log('');
    });
    console.log(`Edges (${edges.length}):`);
    edges.forEach((e) => console.log(`  ${e.source.split('/').pop()} → ${e.target.split('/').pop()}`));
    process.exit(0);
  });
}).on('error', (e) => { console.error(e.message); process.exit(1); });
