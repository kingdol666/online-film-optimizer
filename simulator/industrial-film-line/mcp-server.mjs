#!/usr/bin/env node
/**
 * MCP Server — HTTP proxy to simulator HTTP (localhost:8877).
 * Uses official @modelcontextprotocol/sdk
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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
  try {
    await httpRequest('GET', '/sim/health');
    return;
  } catch {}

  spawn('node', [SIM_SERVER_PATH], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SIM_PORT: String(SIM_PORT) }
  }).unref();

  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise(r => setTimeout(r, 500));
    try {
      await httpRequest('GET', '/sim/health');
      return;
    } catch {}
  }
  throw new Error(`simulator HTTP did not start on :${SIM_PORT} within 15s`);
}

// ──────────────────────────────────────────────
// MCP tool → HTTP endpoint mapping
// ──────────────────────────────────────────────

async function callTool(name, args = {}) {
  const routes = {
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

  const route = routes[name];
  if (!route) throw new Error(`Unknown tool: ${name}`);

  let body = args;
  if (route.bodyTransform) {
    body = route.bodyTransform(args);
  }
  return httpRequest(route.method, route.path, route.method === 'POST' ? body : null);
}

// ──────────────────────────────────────────────
// Create MCP Server with official SDK
// ──────────────────────────────────────────────

const server = new McpServer({
  name: "industrial-film-line-simulator",
  version: "0.2.0",
});

// Register all tools
server.tool(
  "film_line_list_products",
  "List supported simulated product/material grades with target templates and process notes for product-specific recipe development.",
  {},
  async () => {
    const result = await callTool("film_line_list_products");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_reset",
  "Reset the simulated biaxial film line to a baseline recipe and return the current state.",
  { campaignId: z.string().optional(), productGrade: z.string().optional() },
  async (args) => {
    const result = await callTool("film_line_reset", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_get_state",
  "Read compact simulator state including recipe, line state, alarms, tick, waste, and setpoints.",
  {},
  async () => {
    const result = await callTool("film_line_get_state");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_get_ledger",
  "Read the simulator ledger including apply, rollback, and candidate recipe events.",
  {},
  async () => {
    const result = await callTool("film_line_get_ledger");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_get_snapshot",
  "Read current process snapshot including setpoints, process values, alarm state, and stable timing.",
  {},
  async () => {
    const result = await callTool("film_line_get_snapshot");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_list_writable_parameters",
  "List all writable process setpoints with current value, hard min/max, per-action max delta, and ramp limit.",
  {},
  async () => {
    const result = await callTool("film_line_list_writable_parameters");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_get_online_quality",
  "Read online thickness and birefringence metrics/profiles from the simulated inspection system.",
  {},
  async () => {
    const result = await callTool("film_line_get_online_quality");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_run_until_stable",
  "Advance the simulated line until a stable no-alarm window is reached, then return snapshot and online quality.",
  { minStableTicks: z.number().min(1).optional(), maxTicks: z.number().min(1).optional() },
  async (args) => {
    const result = await callTool("film_line_run_until_stable", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_preview_proposal",
  "Run deterministic safety preview for a parameter delta proposal without applying it.",
  { proposal: z.object({}).passthrough() },
  async (args) => {
    const result = await callTool("film_line_preview_proposal", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_preview_setpoints",
  "Build and safety-preview a setpoint request from tag/target pairs. The simulator computes current and delta internally.",
  {
    changes: z.array(z.object({
      tag: z.string(),
      target: z.number(),
      ramp_limit_per_min: z.number().optional()
    })).min(1),
    campaignId: z.string().optional(),
    experimentId: z.string().optional(),
    sourcePlan: z.string().optional(),
    expectedLagMinutes: z.number().optional()
  },
  async (args) => {
    const result = await callTool("film_line_preview_setpoints", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_apply_proposal",
  "Apply a safety-gated parameter delta proposal to the simulated line and return an execution receipt.",
  { proposal: z.object({}).passthrough() },
  async (args) => {
    const result = await callTool("film_line_apply_proposal", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_apply_setpoints",
  "Build, safety-check, and apply tag/target setpoint changes. Rejected requests return a receipt with executed=false.",
  {
    changes: z.array(z.object({
      tag: z.string(),
      target: z.number(),
      ramp_limit_per_min: z.number().optional()
    })).min(1),
    campaignId: z.string().optional(),
    experimentId: z.string().optional(),
    sourcePlan: z.string().optional(),
    expectedLagMinutes: z.number().optional()
  },
  async (args) => {
    const result = await callTool("film_line_apply_setpoints", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_tick",
  "Advance simulator time by N ticks and return compact state.",
  { count: z.number().min(1).optional() },
  async (args) => {
    const result = await callTool("film_line_tick", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_rollback",
  "Rollback to the last known good recipe and return rollback receipt.",
  { reason: z.string().optional() },
  async (args) => {
    const result = await callTool("film_line_rollback", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_save_candidate_recipe",
  "Save current setpoints as a candidate recipe record in the simulator ledger.",
  { recipeId: z.string(), metadata: z.object({}).passthrough().optional() },
  async (args) => {
    const result = await callTool("film_line_save_candidate_recipe", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "film_line_load_recipe_baseline",
  "Load a remembered best recipe as the active rollback baseline and current setpoints.",
  {
    recipeId: z.string(),
    setpoints: z.object({}).passthrough(),
    reason: z.string().optional()
  },
  async (args) => {
    const result = await callTool("film_line_load_recipe_baseline", args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────

async function main() {
  await ensureSimulatorHttp();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server startup failed:", err.message);
  process.exit(1);
});
