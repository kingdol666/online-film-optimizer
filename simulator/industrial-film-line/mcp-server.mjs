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

function httpRequest(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlPath, SIM_BASE);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
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
// Tool definitions (data-driven)
// ──────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: 'film_line_list_products',
    description: 'List supported simulated product/material grades with target templates and process notes for product-specific recipe development.',
    method: 'GET',
    path: '/sim/products',
    schema: {}
  },
  {
    name: 'film_line_reset',
    description: 'Reset the simulated biaxial film line to a baseline recipe and return the current state.',
    method: 'POST',
    path: '/sim/reset',
    schema: { campaignId: z.string().optional(), productGrade: z.string().optional() }
  },
  {
    name: 'film_line_get_state',
    description: 'Read compact simulator state including recipe, line state, alarms, tick, waste, and setpoints.',
    method: 'GET',
    path: '/sim/state',
    schema: {}
  },
  {
    name: 'film_line_get_ledger',
    description: 'Read the simulator ledger including apply, rollback, and candidate recipe events.',
    method: 'GET',
    path: '/sim/ledger',
    schema: {}
  },
  {
    name: 'film_line_get_snapshot',
    description: 'Read current process snapshot including setpoints, process values, alarm state, and stable timing.',
    method: 'GET',
    path: '/sim/snapshot',
    schema: {}
  },
  {
    name: 'film_line_list_writable_parameters',
    description: 'List all writable process setpoints with current value, hard min/max, per-action max delta, and ramp limit.',
    method: 'GET',
    path: '/sim/writable-parameters',
    schema: {}
  },
  {
    name: 'film_line_get_online_quality',
    description: 'Read online thickness and birefringence metrics/profiles from the simulated inspection system.',
    method: 'GET',
    path: '/sim/online-quality',
    schema: {}
  },
  {
    name: 'film_line_run_until_stable',
    description: 'Advance the simulated line until a stable no-alarm window is reached, then return snapshot and online quality.',
    method: 'POST',
    path: '/sim/run-until-stable',
    schema: { minStableTicks: z.number().min(1).optional(), maxTicks: z.number().min(1).optional() }
  },
  {
    name: 'film_line_preview_proposal',
    description: 'Run deterministic safety preview for a parameter delta proposal without applying it.',
    method: 'POST',
    path: '/sim/proposal/preview',
    schema: { proposal: z.object({}).passthrough() },
    bodyTransform: (args) => args.proposal
  },
  {
    name: 'film_line_preview_setpoints',
    description: 'Build and safety-preview a setpoint request from tag/target pairs. The simulator computes current and delta internally.',
    method: 'POST',
    path: '/sim/setpoints/preview',
    schema: {
      changes: z.array(z.object({
        tag: z.string(),
        target: z.number(),
        ramp_limit_per_min: z.number().optional()
      })).min(1),
      campaignId: z.string().optional(),
      experimentId: z.string().optional(),
      sourcePlan: z.string().optional(),
      expectedLagMinutes: z.number().optional()
    }
  },
  {
    name: 'film_line_apply_proposal',
    description: 'Apply a safety-gated parameter delta proposal to the simulated line and return an execution receipt.',
    method: 'POST',
    path: '/sim/apply',
    schema: { proposal: z.object({}).passthrough() },
    bodyTransform: (args) => args.proposal
  },
  {
    name: 'film_line_apply_setpoints',
    description: 'Build, safety-check, and apply tag/target setpoint changes. Rejected requests return a receipt with executed=false.',
    method: 'POST',
    path: '/sim/setpoints/apply',
    schema: {
      changes: z.array(z.object({
        tag: z.string(),
        target: z.number(),
        ramp_limit_per_min: z.number().optional()
      })).min(1),
      campaignId: z.string().optional(),
      experimentId: z.string().optional(),
      sourcePlan: z.string().optional(),
      expectedLagMinutes: z.number().optional()
    }
  },
  {
    name: 'film_line_tick',
    description: 'Advance simulator time by N ticks and return compact state.',
    method: 'POST',
    path: '/sim/tick',
    schema: { count: z.number().min(1).optional() },
    bodyTransform: (args) => ({ count: args.count || 1 })
  },
  {
    name: 'film_line_rollback',
    description: 'Rollback to the last known good recipe and return rollback receipt.',
    method: 'POST',
    path: '/sim/rollback',
    schema: { reason: z.string().optional() },
    bodyTransform: (args) => ({ reason: args.reason || 'mcp rollback' })
  },
  {
    name: 'film_line_save_candidate_recipe',
    description: 'Save current setpoints as a candidate recipe record in the simulator ledger.',
    method: 'POST',
    path: '/sim/recipe/save-candidate',
    schema: { recipeId: z.string(), metadata: z.object({}).passthrough().optional() }
  },
  {
    name: 'film_line_load_recipe_baseline',
    description: 'Load a remembered best recipe as the active rollback baseline and current setpoints.',
    method: 'POST',
    path: '/sim/recipe/load-baseline',
    schema: {
      recipeId: z.string(),
      setpoints: z.object({}).passthrough(),
      reason: z.string().optional()
    }
  }
];

// ──────────────────────────────────────────────
// HTTP proxy call
// ──────────────────────────────────────────────

async function callHttpTool(def, args = {}) {
  // Extract the caller's role tag and forward as the x-agent-role header so the
  // HTTP server's role gate (server.mjs) can authorize: process may write, others read-only.
  const { agentRole, agent_role, ...rest } = args;
  const role = agentRole || agent_role || null;
  const body = def.bodyTransform ? def.bodyTransform(rest) : rest;
  const headers = role ? { 'x-agent-role': role } : {};
  return httpRequest(def.method, def.path, def.method === 'POST' ? body : null, headers);
}

function formatResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

// ──────────────────────────────────────────────
// Create and register MCP Server
// ──────────────────────────────────────────────

const server = new McpServer({
  name: "industrial-film-line-simulator",
  version: "0.2.0",
});

for (const def of TOOL_DEFS) {
  // Augment every tool with the caller-identity tag. The HTTP server (server.mjs)
  // authorizes line writes ONLY for role=process; reads are open to all roles.
  // Every agent MUST pass its role on every call.
  def.schema = {
    ...def.schema,
    agentRole: z.string().optional().describe(
      "IDENTITY TAG (required for writes): which agent role is calling — 'pi' | 'rd' | 'quality' | 'process'. " +
      "Server-side authorization: line writes are allowed ONLY for role=process (then still pass the five-gate threshold check); " +
      "Quality/R&D/PI are read-only analysis/design experts and CANNOT write setpoints. Pass your role on every call."
    )
  };
}

for (const def of TOOL_DEFS) {
  server.tool(
    def.name,
    def.description,
    def.schema,
    async (args) => formatResult(await callHttpTool(def, args))
  );
}

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
