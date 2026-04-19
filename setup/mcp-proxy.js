#!/usr/bin/env node
/**
 * DEV_CLASH MCP Proxy — stdio ↔ HTTP bridge
 *
 * Claude Desktop communicates with MCP servers over stdio (stdin/stdout) using
 * newline-delimited JSON-RPC 2.0. This tiny proxy forwards those messages to
 * the DEV_CLASH HTTP /api/mcp endpoint and pipes the response back.
 *
 * Usage (set in claude_desktop_config.json):
 *   "command": "node",
 *   "args": ["C:/path/to/DEV_CLASH/setup/mcp-proxy.js"]
 */

const http  = require('http');
const https = require('https');

const DEV_CLASH_URL = process.env.DEV_CLASH_URL || 'http://localhost:3001';
const url = new URL(DEV_CLASH_URL + '/api/mcp');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function postJson(body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const lib     = url.protocol === 'https:' ? https : http;

        const req = lib.request({
            hostname: url.hostname,
            port:     url.port || (url.protocol === 'https:' ? 443 : 80),
            path:     url.pathname,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 30_000,
        }, res => {
            let data = '';
            res.on('data',  chunk => (data += chunk));
            res.on('end',   ()    => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Non-JSON from DEV_CLASH: ' + data.slice(0, 200))); }
            });
        });

        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('DEV_CLASH request timed out')); });
        req.write(payload);
        req.end();
    });
}

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

// ─── Main stdio loop ──────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg;
        try { msg = JSON.parse(trimmed); }
        catch { continue; }

        // Notifications have no id — just forward and don't expect a response
        const isNotification = msg.id === undefined || msg.id === null;

        postJson(msg)
            .then(response => {
                if (!isNotification) send(response);
            })
            .catch(err => {
                if (!isNotification) {
                    send({
                        jsonrpc: '2.0',
                        id: msg.id ?? null,
                        error: { code: -32603, message: 'DEV_CLASH proxy error: ' + err.message },
                    });
                }
            });
    }
});

process.stdin.on('end', () => process.exit(0));

// Surface startup errors to stderr so Claude Desktop can show them
process.on('uncaughtException', err => {
    process.stderr.write('MCP Proxy error: ' + err.message + '\n');
});
