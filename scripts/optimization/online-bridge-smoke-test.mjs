import http from 'node:http';
import crypto from 'node:crypto';
import { IndustrialFilmLineSimulator } from '../../simulator/industrial-film-line/line-simulator.mjs';
import { ONLINE_ACTIONS, ONLINE_BRIDGE_PROTOCOL_VERSION } from './lib/online-bridge-protocol.mjs';

function encodeServerFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length < 126) {
    return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  }
  if (body.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}

function decodeClientFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    if (!masked) throw new Error('client_frame_not_masked');
    if (buffer.length - cursor < 4 + length) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    const payload = Buffer.alloc(length);
    for (let i = 0; i < length; i += 1) {
      payload[i] = buffer[cursor + i] ^ mask[i % 4];
    }
    cursor += length;
    offset = cursor;
    if (opcode === 0x1) frames.push(payload.toString('utf8'));
    if (opcode === 0x8) frames.push(null);
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function buildResponse(request, data) {
  return {
    protocol_version: ONLINE_BRIDGE_PROTOCOL_VERSION,
    kind: 'response',
    request_id: request.request_id,
    action: request.action,
    line_id: request.line_id,
    ok: true,
    data,
    timestamp: new Date().toISOString(),
    meta: { source: 'mock-online-bridge' }
  };
}

function createMockBridgeServer() {
  const simulator = new IndustrialFilmLineSimulator({
    seed: 20260611,
    campaignId: 'CMP-ONLINE-BRIDGE-SMOKE',
    stateFile: 'workspace/runtime/online-bridge-smoke-state.json'
  });
  const server = http.createServer();

  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws/online-line') {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n'));

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeClientFrames(buffer);
      buffer = decoded.remaining;
      for (const frame of decoded.frames) {
        if (frame === null) {
          socket.end();
          continue;
        }
        const request = JSON.parse(frame);
        const payload = request.payload || {};
        let data;
        if (request.action === ONLINE_ACTIONS.HEARTBEAT) {
          data = { ok: true, capabilities: ['snapshot', 'inspection', 'historian', 'safety', 'approval', 'write', 'recipe'] };
        } else if (request.action === ONLINE_ACTIONS.RESET) {
          data = simulator.reset({ campaignId: payload.campaign_id, productGrade: payload.product_grade });
        } else if (request.action === ONLINE_ACTIONS.COMPACT_STATE) {
          data = simulator.getState();
        } else if (request.action === ONLINE_ACTIONS.SNAPSHOT) {
          data = { snapshot: simulator.getSnapshot() };
        } else if (request.action === ONLINE_ACTIONS.ONLINE_QUALITY) {
          data = { online_quality: simulator.getOnlineQuality() };
        } else if (request.action === ONLINE_ACTIONS.WRITABLE_PARAMETERS) {
          data = { parameters: simulator.getWritableParameters() };
        } else if (request.action === ONLINE_ACTIONS.RUN_UNTIL_STABLE) {
          data = { window: simulator.runUntilStable(payload) };
        } else if (request.action === ONLINE_ACTIONS.SAFETY_PREVIEW) {
          data = { safety_gate_result: simulator.preview(payload.proposal) };
        } else if (request.action === ONLINE_ACTIONS.REQUEST_APPROVAL) {
          data = { manual_approval_required: false, default_status: 'approved', auto_approved: true, approval_source: 'mock-online-bridge' };
        } else if (request.action === ONLINE_ACTIONS.APPLY_PROPOSAL) {
          data = { receipt: simulator.apply(payload.proposal) };
        } else if (request.action === ONLINE_ACTIONS.ROLLBACK_RECIPE) {
          data = { receipt: simulator.rollback(payload.reason) };
        } else if (request.action === ONLINE_ACTIONS.LOAD_RECIPE_BASELINE) {
          data = { receipt: simulator.loadRecipeBaseline({ recipeId: payload.recipe_id || payload.recipeId, setpoints: payload.setpoints, reason: payload.reason }) };
        } else if (request.action === ONLINE_ACTIONS.SAVE_CANDIDATE_RECIPE) {
          data = { record: simulator.saveCandidateRecipe({ recipeId: payload.recipe_id || payload.recipeId, metadata: payload.metadata }) };
        } else if (request.action === ONLINE_ACTIONS.HISTORIAN_WINDOW) {
          data = { historian_window: { samples: [], source: 'mock-online-bridge' } };
        } else {
          data = { unsupported_action: request.action };
        }
        socket.write(encodeServerFrame(buildResponse(request, data)));
      }
    });
  });

  return server;
}

async function main() {
  const server = createMockBridgeServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  process.env.ONLINE_ENABLED = 'true';
  process.env.LINE_PROVIDER = 'real-line';
  process.env.PROCESS_WS_URL = `ws://127.0.0.1:${port}/ws/online-line`;
  process.env.LINE_ID = 'mock-line-01';

  const { loadPlatformConfig } = await import('./lib/platform-config.mjs');
  const { createLineAdapter } = await import('./lib/line-adapters.mjs');
  const config = loadPlatformConfig({ projectRoot: process.cwd() });
  const goalRequest = {
    request_id: 'REQ-ONLINE-BRIDGE-SMOKE',
    campaign_id: 'CMP-ONLINE-BRIDGE-SMOKE',
    product_grade: 'BOPET_NEW_GRADE_A',
    execution: { provider: 'real-line', manual_approval_required: false }
  };
  const adapter = createLineAdapter({ config, cwd: process.cwd(), goalRequest });
  await adapter.start();
  try {
    await adapter.reset();
    const before = await adapter.runUntilStable({ minStableTicks: 2, maxTicks: 8 });
    const writable = await adapter.listWritableParameters();
    const current = before.snapshot.setpoints.td_zone_2_temp;
    const proposal = {
      campaign_id: goalRequest.campaign_id,
      experiment_id: 'EXP-ONLINE-001',
      source_plan: 'online_bridge_smoke',
      setpoint_changes: [
        {
          tag: 'td_zone_2_temp',
          current,
          target: Number((current + 0.5).toFixed(5)),
          delta: 0.5,
          ramp_limit_per_min: 0.6
        }
      ],
      rollback_recipe: before.snapshot.recipe_id,
      expected_lag_minutes: 8
    };
    const gate = await adapter.checkSafetyGate(proposal);
    const approval = await adapter.requestApproval({ proposal, safetyGate: gate });
    const receipt = await adapter.applyApprovedProposal(proposal);
    const after = await adapter.runUntilStable({ minStableTicks: 2, maxTicks: 12 });
    const saved = await adapter.saveCandidateRecipe({
      recipeId: 'RCP-ONLINE-SMOKE-CANDIDATE',
      metadata: { gate_allowed: gate.allowed }
    });
    console.log(JSON.stringify({
      ok: true,
      provider: config.orchestrator.provider,
      transport: 'websocket',
      writable_parameter_count: writable.length,
      gate,
      approval,
      receipt,
      before_metric: before.online_quality.metrics.birefringence_cv,
      after_metric: after.online_quality.metrics.birefringence_cv,
      saved
    }, null, 2));
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
