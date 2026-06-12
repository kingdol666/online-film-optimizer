#!/usr/bin/env node
import { spawn } from 'node:child_process';

const server = spawn(process.execPath, ['simulator/industrial-film-line/mcp-server.mjs'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
});

let nextId = 1;
let buffer = Buffer.alloc(0);
const pending = new Map();

function send(message) {
  const payload = JSON.stringify(message);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
}

function request(method, params = {}) {
  const id = nextId;
  nextId += 1;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function parseToolText(response) {
  const text = response.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : response.result;
}

server.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error(`Invalid MCP header: ${header}`);
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8'));
    buffer = buffer.subarray(bodyEnd);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message);
    }
  }
});

server.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

async function main() {
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'film-line-mcp-smoke-test', version: '0.1.0' }
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

  const listed = await request('tools/list');
  const toolNames = listed.result.tools.map((tool) => tool.name);
  for (const required of ['film_line_list_writable_parameters', 'film_line_run_until_stable', 'film_line_preview_setpoints', 'film_line_apply_setpoints']) {
    if (!toolNames.includes(required)) throw new Error(`Missing MCP tool: ${required}`);
  }

  await request('tools/call', { name: 'film_line_reset', arguments: { campaignId: 'CMP-MCP-SMOKE' } });
  const writable = parseToolText(await request('tools/call', {
    name: 'film_line_list_writable_parameters',
    arguments: {}
  }));
  if (writable.length < 12) throw new Error(`Expected all writable process parameters, got ${writable.length}`);

  const stable = parseToolText(await request('tools/call', {
    name: 'film_line_run_until_stable',
    arguments: { minStableTicks: 6, maxTicks: 40 }
  }));
  const beforeQuality = stable.online_quality;
  const tdZone2 = writable.find((p) => p.tag === 'td_zone_2_temp');
  const target = tdZone2.current + 0.8;

  const gate = parseToolText(await request('tools/call', {
    name: 'film_line_preview_setpoints',
    arguments: {
      experimentId: 'EXP-MCP-001',
      sourcePlan: 'mcp_smoke_test',
      changes: [{ tag: 'td_zone_2_temp', target }]
    }
  }));
  if (!gate.safety_gate_result.allowed) throw new Error(`Expected allowed safety gate, got ${JSON.stringify(gate)}`);

  const rejected = parseToolText(await request('tools/call', {
    name: 'film_line_preview_setpoints',
    arguments: {
      experimentId: 'EXP-MCP-REJECT',
      sourcePlan: 'mcp_smoke_test',
      changes: [{ tag: 'td_zone_2_temp', target: tdZone2.max + 10 }]
    }
  }));
  if (rejected.safety_gate_result.allowed) throw new Error('Expected out-of-bounds setpoint request to be rejected');

  const receipt = parseToolText(await request('tools/call', {
    name: 'film_line_apply_setpoints',
    arguments: {
      experimentId: 'EXP-MCP-001',
      sourcePlan: 'mcp_smoke_test',
      changes: [{ tag: 'td_zone_2_temp', target }]
    }
  }));
  if (!receipt.receipt.executed || !receipt.receipt.write_confirmed) throw new Error(`Proposal was not executed: ${JSON.stringify(receipt)}`);

  const after = parseToolText(await request('tools/call', {
    name: 'film_line_run_until_stable',
    arguments: { minStableTicks: 6, maxTicks: 40 }
  }));

  const quality = parseToolText(await request('tools/call', {
    name: 'film_line_get_online_quality',
    arguments: {}
  }));

  console.log(JSON.stringify({
    ok: true,
    tools: toolNames,
    writable_parameter_count: writable.length,
    gate,
    rejected_gate: rejected.safety_gate_result,
    receipt,
    stable_after: after.stable,
    metric_change: {
      birefringence_cv_before: beforeQuality.metrics.birefringence_cv,
      birefringence_cv_after: quality.metrics.birefringence_cv
    },
    final_metrics: quality.metrics
  }, null, 2));
}

main()
  .finally(() => server.kill())
  .catch((error) => {
    server.kill();
    console.error(error);
    process.exit(1);
  });
