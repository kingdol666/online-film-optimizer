#!/usr/bin/env node
/**
 * Simple MCP verification test
 */
import { spawn } from 'node:child_process';

const server = spawn('node', ['simulator/industrial-film-line/mcp-server.mjs'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();

function send(msg) {
  const payload = JSON.stringify(msg);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
}

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

server.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const header = buffer.subarray(0, idx).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = Buffer.alloc(0); return; }
    const len = Number(match[1]);
    const start = idx + 4;
    if (buffer.length < start + len) return;
    const body = buffer.subarray(start, start + len).toString();
    buffer = buffer.subarray(start + len);
    const msg = JSON.parse(body);
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg);
    }
  }
});

server.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

async function main() {
  console.log('Testing MCP server...');
  
  // Initialize
  const initResult = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });
  console.log('✓ Initialize:', initResult.result.serverInfo.name);
  
  // Send initialized notification
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  
  // List tools
  const toolsResult = await request('tools/list');
  const tools = toolsResult.result.tools;
  console.log(`✓ Tools list: ${tools.length} tools available`);
  console.log('  Tools:', tools.map(t => t.name).join(', '));
  
  // Test a simple tool call
  const stateResult = await request('tools/call', {
    name: 'film_line_get_state',
    arguments: {}
  });
  const state = JSON.parse(stateResult.result.content[0].text);
  console.log('✓ film_line_get_state:', state.line_state);
  
  console.log('\n✅ All tests passed!');
  server.kill();
  process.exit(0);
}

setTimeout(() => {
  console.error('\n❌ Test timeout');
  server.kill();
  process.exit(1);
}, 10000);

main().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  server.kill();
  process.exit(1);
});
