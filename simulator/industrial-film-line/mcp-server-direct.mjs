#!/usr/bin/env node
/**
 * Direct MCP Server — 直接导入模拟器类，不依赖 HTTP 代理层
 * 
 * 这个服务器直接通过 stdio 与 Claude Code 通信，
 * 内部直接调用 IndustrialFilmLineSimulator 实例的方法。
 * 
 * 架构: Claude Code ↔ MCP (stdio) ↔ IndustrialFilmLineSimulator (in-process)
 */

import { IndustrialFilmLineSimulator, deterministicSafetyGate } from './line-simulator.mjs';
import { listProductProfiles, getProductSafetyLimits } from './product-catalog.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 创建模拟器实例（使用默认配置）
const simulator = new IndustrialFilmLineSimulator({
  stateFile: path.join(__dirname, '..', '..', 'workspace', 'runtime', 'simulator-state.json')
});

// ──────────────────────────────────────────────
// MCP Tool definitions
// ──────────────────────────────────────────────

const tools = [
  { 
    name: 'film_line_list_products', 
    description: 'List supported simulated product/material grades with target templates and process notes for product-specific recipe development.', 
    inputSchema: { type: 'object', properties: {} } 
  },
  { 
    name: 'film_line_reset', 
    description: 'Reset the simulated biaxial film line to a baseline recipe and return the current state.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        campaignId: { type: 'string' }, 
        productGrade: { type: 'string' } 
      } 
    } 
  },
  { 
    name: 'film_line_get_state', 
    description: 'Read compact simulator state including recipe, line state, alarms, tick, waste, and setpoints.', 
    inputSchema: { type: 'object', properties: {} } 
  },
  { 
    name: 'film_line_get_ledger', 
    description: 'Read the simulator ledger including apply, rollback, and candidate recipe events.', 
    inputSchema: { type: 'object', properties: {} } 
  },
  { 
    name: 'film_line_get_snapshot', 
    description: 'Read current process snapshot including setpoints, process values, alarm state, and stable timing.', 
    inputSchema: { type: 'object', properties: {} } 
  },
  { 
    name: 'film_line_list_writable_parameters', 
    description: 'List all writable process setpoints with current value, hard min/max, per-action max delta, and ramp limit.', 
    inputSchema: { type: 'object', properties: {} } 
  },
  { 
    name: 'film_line_get_online_quality', 
    description: 'Read online thickness and birefringence metrics/profiles from the simulated inspection system.', 
    inputSchema: { type: 'object', properties: {} } 
  },
  { 
    name: 'film_line_run_until_stable', 
    description: 'Advance the simulated line until a stable no-alarm window is reached, then return snapshot and online quality.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        minStableTicks: { type: 'number', minimum: 1 }, 
        maxTicks: { type: 'number', minimum: 1 } 
      } 
    } 
  },
  { 
    name: 'film_line_preview_proposal', 
    description: 'Run deterministic safety preview for a parameter delta proposal without applying it.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        proposal: { type: 'object' } 
      }, 
      required: ['proposal'] 
    } 
  },
  { 
    name: 'film_line_preview_setpoints', 
    description: 'Build and safety-preview a setpoint request from tag/target pairs. The simulator computes current and delta internally.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        changes: { 
          type: 'array', 
          minItems: 1, 
          items: { 
            type: 'object', 
            required: ['tag', 'target'], 
            properties: { 
              tag: { type: 'string' }, 
              target: { type: 'number' }, 
              ramp_limit_per_min: { type: 'number' } 
            } 
          } 
        }, 
        campaignId: { type: 'string' }, 
        experimentId: { type: 'string' }, 
        sourcePlan: { type: 'string' }, 
        expectedLagMinutes: { type: 'number' } 
      }, 
      required: ['changes'] 
    } 
  },
  { 
    name: 'film_line_apply_proposal', 
    description: 'Apply a safety-gated parameter delta proposal to the simulated line and return an execution receipt.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        proposal: { type: 'object' } 
      }, 
      required: ['proposal'] 
    } 
  },
  { 
    name: 'film_line_apply_setpoints', 
    description: 'Build, safety-check, and apply tag/target setpoint changes. Rejected requests return a receipt with executed=false.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        changes: { 
          type: 'array', 
          minItems: 1, 
          items: { 
            type: 'object', 
            required: ['tag', 'target'], 
            properties: { 
              tag: { type: 'string' }, 
              target: { type: 'number' }, 
              ramp_limit_per_min: { type: 'number' } 
            } 
          } 
        }, 
        campaignId: { type: 'string' }, 
        experimentId: { type: 'string' }, 
        sourcePlan: { type: 'string' }, 
        expectedLagMinutes: { type: 'number' } 
      }, 
      required: ['changes'] 
    } 
  },
  { 
    name: 'film_line_tick', 
    description: 'Advance simulator time by N ticks and return compact state.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        count: { type: 'number', minimum: 1 } 
      } 
    } 
  },
  { 
    name: 'film_line_rollback', 
    description: 'Rollback to the last known good recipe and return rollback receipt.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        reason: { type: 'string' } 
      } 
    } 
  },
  { 
    name: 'film_line_save_candidate_recipe', 
    description: 'Save current setpoints as a candidate recipe record in the simulator ledger.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        recipeId: { type: 'string' }, 
        metadata: { type: 'object' } 
      }, 
      required: ['recipeId'] 
    } 
  },
  { 
    name: 'film_line_load_recipe_baseline', 
    description: 'Load a remembered best recipe as the active rollback baseline and current setpoints.', 
    inputSchema: { 
      type: 'object', 
      properties: { 
        recipeId: { type: 'string' }, 
        setpoints: { type: 'object' }, 
        reason: { type: 'string' } 
      }, 
      required: ['recipeId', 'setpoints'] 
    } 
  }
];

// ──────────────────────────────────────────────
// Tool implementations (direct calls to simulator)
// ──────────────────────────────────────────────

function callTool(name, args = {}) {
  switch (name) {
    case 'film_line_list_products':
      return listProductProfiles();
    
    case 'film_line_reset':
      return simulator.reset(args);
    
    case 'film_line_get_state':
      return simulator.getState();
    
    case 'film_line_get_ledger':
      return simulator.getLedger();
    
    case 'film_line_get_snapshot':
      return simulator.getSnapshot();
    
    case 'film_line_list_writable_parameters':
      return simulator.getWritableParameters();
    
    case 'film_line_get_online_quality':
      return simulator.getOnlineQuality();
    
    case 'film_line_run_until_stable':
      return simulator.runUntilStable(args);
    
    case 'film_line_preview_proposal':
      return simulator.preview(args.proposal);
    
    case 'film_line_preview_setpoints':
      return simulator.previewSetpoints(args);
    
    case 'film_line_apply_proposal':
      return simulator.apply(args.proposal);
    
    case 'film_line_apply_setpoints':
      return simulator.applySetpoints(args);
    
    case 'film_line_tick':
      return simulator.tickForward(args.count || 1);
    
    case 'film_line_rollback':
      return simulator.rollback(args.reason);
    
    case 'film_line_save_candidate_recipe':
      return simulator.saveCandidateRecipe(args);
    
    case 'film_line_load_recipe_baseline':
      return simulator.loadRecipeBaseline(args);
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ──────────────────────────────────────────────
// JSON-RPC wire protocol (stdio)
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
      jsonrpc: '2.0', 
      id, 
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { 
          name: 'industrial-film-line-simulator', 
          version: '1.0.0' 
        }
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
      const value = callTool(params?.name, params?.arguments || {});
      send({ jsonrpc: '2.0', id, result: resultContent(value) });
    } catch (error) {
      sendError(id, -32000, error.message);
    }
    return;
  }
  
  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

// ──────────────────────────────────────────────
// Main: listen on stdin
// ──────────────────────────────────────────────

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

process.stdin.on('end', () => {
  process.exit(0);
});

// Log startup to stderr (won't interfere with stdio protocol)
process.stderr.write(`[MCP Server] Direct simulator MCP server started (v1.0.0)\n`);
process.stderr.write(`[MCP Server] Product: ${simulator.getState().product_grade}\n`);
process.stderr.write(`[MCP Server] Ready for tools/call requests\n`);
