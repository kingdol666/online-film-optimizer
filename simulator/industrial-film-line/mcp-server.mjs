#!/usr/bin/env node
/**
 * MCP Server — HTTP proxy to simulator HTTP (localhost:8877).
 *
 * All film_line_* tools are forwarded to the shared simulator HTTP server.
 * If the simulator HTTP is not reachable at startup, this server spawns it
 * as a child process, waits for it to be ready, and then begins serving.
 *
 * Architecture:
 *   Claude Code ↔ MCP (stdio) ↔ simulator HTTP (:8877) ↔ IndustrialFilmLineSimulator
 *   Dashboard ↔ Backend (:4317) ↔ simulator HTTP (:8877) ↔ same simulator instance
 *
 * This ensures MCP and Dashboard see the SAME simulator state.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_BASE = process.env.SIM_BASE_URL || 'http://127.0.0.1:8877';
const SIM_PORT = Number(process.env.SIM_PORT || 8877);
const SIM_SERVER_PATH = path.join(__dirname, 'server.mjs');

// ──────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────

function httpRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlPath, SIM_BASE);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ──────────────────────────────────────────────
// Startup: ensure simulator HTTP is reachable
// ──────────────────────────────────────────────

async function ensureSimulatorHttp() {
  // Quick check
  try {
    await httpRequest('GET', '/sim/health');
    return; // already up
  } catch {}

  // Spawn simulator HTTP as a detached background process
  spawn('node', [SIM_SERVER_PATH], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SIM_PORT: String(SIM_PORT) }
  }).unref();

  // Wait up to 15s for it to come up
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise(r => setTimeout(r, 500));
    try {
      await httpRequest('GET', '/sim/health');
      return; // up now
    } catch {}
  }
  throw new Error(`simulator HTTP did not start on :${SIM_PORT} within 15s`);
}

// ──────────────────────────────────────────────
// MCP Tool definitions (same as before)
// ──────────────────────────────────────────────

const tools = [
  { name: 'film_line_list_products',          description: 'List supported simulated product/material grades with target templates and process notes for product-specific recipe development.',     inputSchema: { type: 'object', properties: {} } },
  { name: 'film_line_reset',                  description: 'Reset the simulated biaxial film line to a baseline recipe and return the current state.',                                         inputSchema: { type: 'object', properties: { campaignId: { type: 'string' }, productGrade: { type: 'string' } } } },
  { name: 'film_line_get_state',              description: 'Read compact simulator state including recipe, line state, alarms, tick, waste, and setpoints.',                                  inputSchema: { type: 'object', properties: {} } },
  { name: 'film_line_get_ledger',             description: 'Read the simulator ledger including apply, rollback, and candidate recipe events.',                                              inputSchema: { type: 'object', properties: {} } },
  { name: 'film_line_get_snapshot',           description: 'Read current process snapshot including setpoints, process values, alarm state, and stable timing.',                              inputSchema: { type: 'object', properties: {} } },
  { name: 'film_line_list_writable_parameters', description: 'List all writable process setpoints with current value, hard min/max, per-action max delta, and ramp limit.',                 inputSchema: { type: 'object', properties: {} } },
  { name: 'film_line_get_online_quality',     description: 'Read online thickness and birefringence metrics/profiles from the simulated inspection system.',                                 inputSchema: { type: 'object', properties: {} } },
  { name: 'film_line_run_until_stable',       description: 'Advance the simulated line until a stable no-alarm window is reached, then return snapshot and online quality.',                  inputSchema: { type: 'object', properties: { minStableTicks: { type: 'number', minimum: 1 }, maxTicks: { type: 'number', minimum: 1 } } } },
  { name: 'film_line_preview_proposal',       description: 'Run deterministic safety preview for a parameter delta proposal without applying it.',                                            inputSchema: { type: 'object', properties: { proposal: { type: 'object' } }, required: ['proposal'] } },
  { name: 'film_line_preview_setpoints',      description: 'Build and safety-preview a setpoint request from tag/target pairs. The simulator computes current and delta internally.',        inputSchema: { type: 'object', properties: { changes: { type: 'array', minItems: 1, items: { type: 'object', required: ['tag','target'], properties: { tag: {type:'string'}, target: {type:'number'}, ramp_limit_per_min: {type:'number'} } } }, campaignId: {type:'string'}, experimentId: {type:'string'}, sourcePlan: {type:'string'}, expectedLagMinutes: {type:'number'} }, required: ['changes'] } },
  { name: 'film_line_apply_proposal',         description: 'Apply a safety-gated parameter delta proposal to the simulated line and return an execution receipt.',                             inputSchema: { type: 'object', properties: { proposal: { type: 'object' } }, required: ['proposal'] } },
  { name: 'film_line_apply_setpoints',        description: 'Build, safety-check, and apply tag/target setpoint changes. Rejected requests return a receipt with executed=false.',             inputSchema: { type: 'object', properties: { changes: { type: 'array', minItems: 1, items: { type: 'object', required: ['tag','target'], properties: { tag: {type:'string'}, target: {type:'number'}, ramp_limit_per_min: {type:'number'} } } }, campaignId: {type:'string'}, experimentId: {type:'string'}, sourcePlan: {type:'string'}, expectedLagMinutes: {type:'number'} }, required: ['changes'] } },
  { name: 'film_line_tick',                   description: 'Advance simulator time by N ticks and return compact state.',                                                                     inputSchema: { type: 'object', properties: { count: { type: 'number', minimum: 1 } } } },
  { name: 'film_line_rollback',               description: 'Rollback to the last known good recipe and return rollback receipt.',                                                            inputSchema: { type: 'object', properties: { reason: { type: 'string' } } } },
  { name: 'film_line_save_candidate_recipe',  description: 'Save current setpoints as a candidate recipe record in the simulator ledger.',                                                  inputSchema: { type: 'object', properties: { recipeId: { type: 'string' }, metadata: { type: 'object' } }, required: ['recipeId'] } },
  { name: 'film_line_load_recipe_baseline',   description: 'Load a remembered best recipe as the active rollback baseline and current setpoints.',                                          inputSchema: { type: 'object', properties: { recipeId: { type: 'string' }, setpoints: { type: 'object' }, reason: { type: 'string' } }, required: ['recipeId', 'setpoints'] } }
];

// ──────────────────────────────────────────────
// MCP tool → HTTP endpoint mapping
// ──────────────────────────────────────────────

const ROUTES = {
  'film_line_list_products':          { method: 'GET',  path: '/sim/products' },
  'film_line_reset':                  { method: 'POST', path: '/sim/reset' },
  'film_line_get_state':              { method: 'GET',  path: '/sim/state' },
  'film_line_get_ledger':             { method: 'GET',  path: '/sim/ledger' },
  'film_line_get_snapshot':           { method: 'GET',  path: '/sim/snapshot' },
  'film_line_list_writable_parameters': { method: 'GET',  path: '/sim/writable-parameters' },
  'film_line_get_online_quality':     { method: 'GET',  path: '/sim/online-quality' },
  'film_line_run_until_stable':       { method: 'POST', path: '/sim/run-until-stable' },
  'film_line_preview_proposal':       { method: 'POST', path: '/sim/proposal/preview', bodyTransform: (args) => args.proposal },
  'film_line_preview_setpoints':      { method: 'POST', path: '/sim/setpoints/preview' },
  'film_line_apply_proposal':         { method: 'POST', path: '/sim/apply',           bodyTransform: (args) => args.proposal },
  'film_line_apply_setpoints':        { method: 'POST', path: '/sim/setpoints/apply' },
  'film_line_tick':                   { method: 'POST', path: '/sim/tick',            bodyTransform: (args) => ({ count: args.count || 1 }) },
  'film_line_rollback':               { method: 'POST', path: '/sim/rollback',        bodyTransform: (args) => ({ reason: args.reason || 'mcp rollback' }) },
  'film_line_save_candidate_recipe':  { method: 'POST', path: '/sim/recipe/save-candidate' },
  'film_line_load_recipe_baseline':   { method: 'POST', path: '/sim/recipe/load-baseline' },
};

async function callTool(name, args = {}) {
  const route = ROUTES[name];
  if (!route) throw new Error(`Unknown tool: ${name}`);

  let body = args;
  if (route.bodyTransform) {
    body = route.bodyTransform(args);
  }
  return httpRequest(route.method, route.path, route.method === 'POST' ? body : null);
}

// ──────────────────────────────────────────────
// JSON-RPC wire protocol
// ──────────────────────────────────────────────

function send(message) {
  const payload = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function resultContent(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params } = message;

  if (method === 'notifications/initialized') return;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'industrial-film-line-simulator', version: '0.2.0' }
      }
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    try {
      const value = await callTool(params?.name, params?.arguments || {});
      send({ jsonrpc: '2.0', id, result: resultContent(value) });
    } catch (error) {
      sendError(id, -32000, error.message);
    }
    return;
  }
  if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
}

// ──────────────────────────────────────────────
// Main: startup → listen on stdin
// ──────────────────────────────────────────────

async function main() {
  // SET UP STDIN LISTENER FIRST — before any async work.
  // This prevents a race condition where Claude Code sends the initialize
  // frame while ensureSimulatorHttp() is still awaiting, causing a 30s timeout.
  let buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = buffer.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;

      const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.subarray(bodyEnd);
      try {
        handle(JSON.parse(body));
      } catch (error) {
        sendError(null, -32700, error.message);
      }
    }
  });

  // Only after the listener is ready, perform startup health check.
  await ensureSimulatorHttp();
}

main().catch((err) => {
  sendError(null, -32603, `MCP server startup failed: ${err.message}`);
  process.exit(1);
});
