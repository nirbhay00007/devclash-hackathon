const http = require('http');

const body = JSON.stringify({ targetPath: 'C:/College/DEV_CLASH/backend/src' });

const req = http.request(
  {
    hostname: 'localhost',
    port: 3001,
    path: '/api/analyze',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    console.log('HTTP Status:', res.statusCode);
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk.toString();
      // Print each SSE event as it arrives
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.replace(/^data:\s*/, '').trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.phase === 'result') {
            console.log('\n=== RESULT ===');
            console.log('Nodes:', evt.graph?.nodes?.length ?? 0);
            console.log('Global summary purpose:', evt.globalSummary?.overallPurpose?.slice(0, 120) ?? 'N/A');
          } else {
            console.log(`[${evt.phase}] ${evt.message ?? ''} ${evt.progress != null ? `(${evt.progress}%)` : ''}`);
          }
        } catch {}
      }
    });
    res.on('end', () => {
      console.log('\n✅ Pipeline stream complete.');
      process.exit(0);
    });
  }
);

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.write(body);
req.end();
