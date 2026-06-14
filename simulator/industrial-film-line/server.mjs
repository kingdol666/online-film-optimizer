import http from 'node:http';
import { IndustrialFilmLineSimulator } from './line-simulator.mjs';
import { listProductProfiles } from './product-catalog.mjs';

const simulator = new IndustrialFilmLineSimulator();
const port = Number(process.env.SIM_PORT || 8877);

// ─── Role-based write authorization (the team's hard "卡控") ───────────────
// MCP/HTTP is the "hand"; the team is the "brain". Every caller MUST identify
// itself with agent_role (header `x-agent-role`, query `?agent_role=`, or body
// field `agent_role`/`agentRole`). Only the `process` role may WRITE to the line.
// Reads (incl. safety preview, which does not change state) are open to all roles.
// This is the single chokepoint behind BOTH the MCP proxy and any direct HTTP caller.
const WRITE_PATHS = new Set([
  '/sim/reset', '/sim/apply', '/sim/setpoints/apply', '/sim/tick',
  '/sim/run-until-stable', '/sim/rollback',
  '/sim/recipe/save-candidate', '/sim/recipe/load-baseline'
]);
const WRITE_AUTHORIZED_ROLE = 'process';
const accessLog = [];

function recordAccess({ role, method, path, verdict, reason }) {
  const entry = { ts: new Date().toISOString(), role: role || 'unspecified', method, path, verdict, reason: reason || null };
  accessLog.push(entry);
  if (accessLog.length > 2000) accessLog.shift();
  console.log(`[access] ${verdict} role=${entry.role} ${method} ${path}${reason ? ' :: ' + reason : ''}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (error) { reject(error); }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Read POST body ONCE (so the role gate and the handler share it)
    let body = {};
    if (req.method === 'POST') {
      try { body = await readBody(req); }
      catch (e) { return send(res, 400, { error: 'bad_json', message: e.message }); }
    }

    // Identify the caller: header > query > body
    const role = req.headers['x-agent-role']
      || url.searchParams.get('agent_role')
      || url.searchParams.get('agentRole')
      || body.agent_role
      || body.agentRole
      || null;

    const isWrite = WRITE_PATHS.has(url.pathname);

    // ── ROLE GATE: only `process` may write ──
    if (isWrite) {
      if (role !== WRITE_AUTHORIZED_ROLE) {
        recordAccess({ role, method: req.method, path: url.pathname, verdict: 'DENIED', reason: `non_process_write (caller=${role || 'unspecified'})` });
        return send(res, 403, {
          error: 'forbidden',
          reason: `only the process role may write to the line — caller '${role || 'unspecified'}' is not authorized. Quality/R&D/PI are read-only analysis/design experts; line setpoints are imported and fine-tuned ONLY by the process role.`,
          caller: role || 'unspecified',
          path: url.pathname,
          hint: "pass header 'x-agent-role: process' (or body agent_role='process') for sanctioned execution-path writes"
        });
      }
      recordAccess({ role, method: req.method, path: url.pathname, verdict: 'allowed_process_write' });
      // NOTE: process writes then still pass through the simulator's existing
      // five-gate (catalog/range/delta/ramp/rollback) threshold check inside apply().
      // The run-level cadence (settling interval) is enforced by the cadence
      // enforcer (workspace/.../lib/doe-cadence.mjs) at the orchestration layer.
    } else {
      recordAccess({ role, method: req.method, path: url.pathname, verdict: 'read_ok' });
    }

    // ── Routes (POST handlers use the pre-read `body`) ──
    if (req.method === 'GET' && url.pathname === '/sim/products') return send(res, 200, listProductProfiles());
    if (req.method === 'POST' && url.pathname === '/sim/reset') return send(res, 200, simulator.reset(body));
    if (req.method === 'GET' && url.pathname === '/sim/state') return send(res, 200, simulator.getState());
    if (req.method === 'GET' && url.pathname === '/sim/writable-parameters') return send(res, 200, simulator.getWritableParameters());
    if (req.method === 'GET' && url.pathname === '/sim/snapshot') return send(res, 200, simulator.getSnapshot());
    if (req.method === 'GET' && url.pathname === '/sim/online-quality') return send(res, 200, simulator.getOnlineQuality());
    if (req.method === 'POST' && url.pathname === '/sim/proposal/preview') return send(res, 200, simulator.preview(body));
    if (req.method === 'POST' && url.pathname === '/sim/setpoints/preview') return send(res, 200, simulator.previewSetpoints(body));
    if (req.method === 'POST' && url.pathname === '/sim/apply') return send(res, 200, simulator.apply(body));
    if (req.method === 'POST' && url.pathname === '/sim/setpoints/apply') return send(res, 200, simulator.applySetpoints(body));
    if (req.method === 'POST' && url.pathname === '/sim/tick') return send(res, 200, simulator.tickForward(body.count || 1));
    if (req.method === 'POST' && url.pathname === '/sim/run-until-stable') return send(res, 200, simulator.runUntilStable(body));
    if (req.method === 'POST' && url.pathname === '/sim/rollback') return send(res, 200, simulator.rollback(body.reason));
    if (req.method === 'POST' && url.pathname === '/sim/recipe/save-candidate') return send(res, 200, simulator.saveCandidateRecipe(body));
    if (req.method === 'POST' && url.pathname === '/sim/recipe/load-baseline') return send(res, 200, simulator.loadRecipeBaseline(body));
    if (req.method === 'GET' && url.pathname === '/sim/ledger') return send(res, 200, simulator.getLedger());
    if (req.method === 'GET' && url.pathname === '/sim/access-log') return send(res, 200, { access_log: accessLog.slice(-100), write_authorized_role: WRITE_AUTHORIZED_ROLE, write_paths: [...WRITE_PATHS] });
    if (req.method === 'GET' && url.pathname === '/sim/health') return send(res, 200, { status: 'ok', service: 'simulator-http', campaign_id: simulator.getState().campaign_id, role_enforcement: true });
    send(res, 404, { error: 'not_found', path: url.pathname });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`industrial-film-line simulator listening on http://localhost:${port} (role-enforcement ON: writes require agent_role=process)`);
});
