import http from 'node:http';
import fs from 'node:fs';
import { IndustrialFilmLineSimulator } from './line-simulator.mjs';
import { listProductProfiles } from './product-catalog.mjs';

const simulator = new IndustrialFilmLineSimulator();
const port = Number(process.env.SIM_PORT || 8877);

// ─── Credential-bound role authentication (anti-impersonation) ────────────
// A role claim is valid ONLY with its matching secret token. An agent may
// authenticate ONLY as its own role (token-bound) — it cannot impersonate
// another role. The `emergency` role is restricted to safety rollback only.
let ROLE_TOKENS = {};
let READ_ROLES = new Set(['pi', 'rd', 'quality', 'process']);
let WRITE_ROLE = 'process';
let EMERGENCY_SCOPE = new Set(['/sim/rollback']);
try {
  const cfgPath = process.env.ROLE_TOKENS_PATH || 'workspace/optimization-tasks/config/role-tokens.json';
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  ROLE_TOKENS = cfg.roles || {};
  if (cfg.read_roles) READ_ROLES = new Set(cfg.read_roles);
  if (cfg.write_role) WRITE_ROLE = cfg.write_role;
  if (cfg.emergency_scope) EMERGENCY_SCOPE = new Set(cfg.emergency_scope);
} catch (e) {
  console.warn('[role] could not load role-tokens.json — ALL writes will be rejected:', e.message);
}

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

    // ── Caller authentication: a role claim is valid ONLY with its matching token ──
    const claimedRole = req.headers['x-agent-role']
      || url.searchParams.get('agent_role') || url.searchParams.get('agentRole')
      || body.agent_role || body.agentRole || null;
    const presentedToken = req.headers['x-role-token']
      || url.searchParams.get('role_token') || url.searchParams.get('roleToken')
      || body.role_token || body.roleToken || null;

    let auth = { role: claimedRole, authenticated: false, reason: claimedRole ? 'no_token' : 'no_role' };
    if (claimedRole && presentedToken) {
      if (ROLE_TOKENS[claimedRole] && ROLE_TOKENS[claimedRole] === presentedToken) {
        auth = { role: claimedRole, authenticated: true };
      } else {
        auth = { role: claimedRole, authenticated: false, reason: 'token_mismatch' };
      }
    }
    const { role, authenticated } = auth;
    const isWrite = WRITE_PATHS.has(url.pathname);
    // Emergency carve-out: only the `emergency` role, only on safety rollback, and only if authenticated.
    const isEmergencyWrite = (role === 'emergency' && authenticated && EMERGENCY_SCOPE.has(url.pathname));

    // ── ROLE GATE ──
    if (isWrite && !isEmergencyWrite) {
      if (!authenticated) {
        recordAccess({ role, method: req.method, path: url.pathname, verdict: 'DENIED', reason: `unauthenticated (claimed='${role || '?'}', ${auth.reason})` });
        return send(res, 403, {
          error: 'forbidden',
          reason: `caller is not authenticated. Pass your OWN role + its secret token (x-agent-role + x-role-token). A role claim without its matching token — or a token from another role — is rejected. Impersonation is blocked.`,
          caller: role || 'unspecified', auth_reason: auth.reason, path: url.pathname
        });
      }
      if (role !== WRITE_ROLE) {
        recordAccess({ role, method: req.method, path: url.pathname, verdict: 'DENIED', reason: `non_process_write (authenticated as '${role}')` });
        return send(res, 403, {
          error: 'forbidden',
          reason: `authenticated as '${role}', but only the '${WRITE_ROLE}' role may write setpoints. Quality/R&D/PI are read-only. You cannot write even by presenting another role's credentials — each token is bound to one role.`,
          caller: role, path: url.pathname
        });
      }
      recordAccess({ role, method: req.method, path: url.pathname, verdict: 'allowed_process_write' });
      // Process writes still pass the simulator's five-gate threshold check inside apply().
    } else if (isEmergencyWrite) {
      recordAccess({ role, method: req.method, path: url.pathname, verdict: 'allowed_emergency_rollback' });
    } else {
      recordAccess({ role, method: req.method, path: url.pathname, verdict: authenticated ? 'read_ok' : 'read_unauthenticated' });
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
    if (req.method === 'GET' && url.pathname === '/sim/access-log') return send(res, 200, { access_log: accessLog.slice(-100), auth_model: 'credential_bound (agentRole + roleToken pair; anti-impersonation)', write_role: WRITE_ROLE, read_roles: [...READ_ROLES], emergency_scope: [...EMERGENCY_SCOPE], write_paths: [...WRITE_PATHS] });
    if (req.method === 'GET' && url.pathname === '/sim/health') return send(res, 200, { status: 'ok', service: 'simulator-http', campaign_id: simulator.getState().campaign_id, role_enforcement: 'credential_bound', write_role: WRITE_ROLE, emergency_role: 'emergency (rollback only)' });
    send(res, 404, { error: 'not_found', path: url.pathname });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`industrial-film-line simulator listening on http://localhost:${port} (credential-bound role auth ON: write_role=${WRITE_ROLE}; emergency=${[...EMERGENCY_SCOPE].join(',')} only; impersonation blocked by token-binding)`);
});
