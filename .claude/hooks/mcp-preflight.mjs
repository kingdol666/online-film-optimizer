#!/usr/bin/env node
/**
 * MCP Startup Preflight Hook
 *
 * Runs on every UserPromptSubmit — ensures the simulator HTTP server and
 * backend are running so the full toolchain (frontend ↔ backend ↔ simulator)
 * is healthy. The MCP server itself is stdio-managed by Claude Code via .mcp.json.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
let PROJECT_ROOT;
if (process.env.CLAUDE_PROJECT_DIR) {
  PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR;
} else {
  // When running outside Claude Code (e.g., manual test), use cwd or resolve
  // relative to this script file: .claude/hooks/mcp-preflight.mjs → ../../ = project root
  PROJECT_ROOT = path.resolve(path.dirname(__filename), '../..');
}

const SIM_PORT = Number(process.env.SIM_PORT || 8877);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 4317);
const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`;

const SIM_SERVER_PATH = path.join(PROJECT_ROOT, 'simulator/industrial-film-line/server.mjs');
const BACKEND_SERVER_PATH = path.join(PROJECT_ROOT, 'app/backend/src/server.mjs');

/** Read all stdin, resolve to parsed JSON or empty object. */
function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}

/** Simple HTTP GET. */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${url}`)); });
    req.on('error', reject);
  });
}

/** Poll a port until responds or times out. */
async function waitForPort(port, maxWaitMs = 15000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 1500 }, () => resolve(true));
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {}
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** Spawn a node service as a detached background process. */
function spawnService(label, scriptPath) {
  const child = spawn('node', [scriptPath], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SIM_PORT: String(SIM_PORT), BACKEND_PORT: String(BACKEND_PORT) }
  });
  child.unref();
  return child.pid;
}

async function main() {
  await readStdin();

  const results = { simulator: 'already_running', backend: 'already_running' };

  // 1. Ensure simulator HTTP
  let simAlive = await waitForPort(SIM_PORT, 3000, 500);
  if (!simAlive) {
    spawnService('simulator-http', SIM_SERVER_PATH);
    simAlive = await waitForPort(SIM_PORT);
    results.simulator = simAlive ? 'started' : 'failed';
  }

  // 2. Ensure backend
  let backendAlive = await waitForPort(BACKEND_PORT, 3000, 500);
  if (!backendAlive) {
    spawnService('backend', BACKEND_SERVER_PATH);
    backendAlive = await waitForPort(BACKEND_PORT);
    results.backend = backendAlive ? 'started' : 'failed';
  }

  // 3. Verify backend health
  try {
    const health = await httpGet(`${BACKEND_BASE}/api/health`);
    results.backend_health = health.status === 200 && health.body?.success ? 'ok' : 'unhealthy';
  } catch {
    results.backend_health = 'unreachable';
  }

  // 4. Verify backend ↔ simulator proxy
  try {
    const overview = await httpGet(`${BACKEND_BASE}/api/simulator/overview`);
    results.backend_sim_bridge = overview.status === 200 ? 'ok' : 'degraded';
  } catch {
    results.backend_sim_bridge = 'unreachable';
  }

  const summary = [
    `Sim(${SIM_PORT}):${results.simulator}`,
    `Back(${BACKEND_PORT}):${results.backend}`,
    `Health:${results.backend_health}`,
    `SimBridge:${results.backend_sim_bridge}`
  ].join(' ');

  if (results.simulator === 'failed' || results.backend === 'failed') {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `MCP preflight failed: ${summary}`
    }));
    return;
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `MCP preflight OK: ${summary} | MCP server industrial-film-line-sim managed by .mcp.json (stdio auto-start). Sim HTTP healthy; MCP tools will be available once Claude Code spawns and connects the MCP server process.`
    }
  }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `MCP preflight crashed: ${err.message}`
  }));
});
