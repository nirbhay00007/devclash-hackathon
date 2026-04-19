const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', '.dev-clash');

console.log('\n=== .dev-clash/ directory contents ===');
if (!fs.existsSync(dir)) {
    console.log('ERROR: .dev-clash/ not found at', dir);
    process.exit(1);
}

const files = fs.readdirSync(dir);
files.forEach(f => {
    const fp = path.join(dir, f);
    const size = fs.statSync(fp).size;
    console.log(`  ${f}  (${(size / 1024).toFixed(1)} KB)`);
});

// Read meta
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
console.log('\n=== meta.json ===');
console.log(JSON.stringify(meta, null, 2));

// Count cache entries
const cache = JSON.parse(fs.readFileSync(path.join(dir, 'cache.json'), 'utf-8'));
console.log('\n=== cache.json ===');
console.log('  Cached file summaries:', Object.keys(cache).length);

// Count vectors and show first one's structure
const vectors = JSON.parse(fs.readFileSync(path.join(dir, 'vectors.json'), 'utf-8'));
console.log('\n=== vectors.json ===');
console.log('  Total vectors:', vectors.docs.length);
if (vectors.docs[0]) {
    const d = vectors.docs[0];
    console.log('\n  Sample doc (first vector):');
    console.log('    file:          ', d.fileBasename);
    console.log('    summary:       ', d.summary.slice(0, 80) + '...');
    console.log('    responsibility:', d.responsibility);
    console.log('    complexity:    ', d.complexity);
    console.log('    isEntryPoint:  ', d.isEntryPoint);
    console.log('    keyExports:    ', d.keyExports.slice(0, 4));
    console.log('    internalCalls: ', d.internalCalls.slice(0, 4));
    console.log('    patterns:      ', d.patterns);
    console.log('    externalDeps:  ', d.externalDeps);
    console.log('    compositeText:\n');
    console.log(d.compositeText.split('\n').map(l => '      ' + l).join('\n'));
    console.log('\n    vector dims:   ', d.vector.length);
}

// Show graph node count
const graph = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf-8'));
console.log('\n=== graph.json ===');
console.log('  Nodes:', graph.nodes.length, '| Edges:', graph.edges.length);
graph.nodes.forEach(n => {
    console.log(`\n  ${n.id.split('/').pop()}`);
    console.log(`    layer: ${n.layer} | quality: ${n.codeQuality} | complexity: ${n.complexity}`);
    console.log(`    risk: ${n.riskCategory} | fanIn: ${n.inboundEdgeCount} | fanOut: ${n.outboundEdgeCount} | orphan: ${n.isOrphan}`);
    console.log(`    responsibility: ${n.responsibility}`);
});

process.exit(0);
