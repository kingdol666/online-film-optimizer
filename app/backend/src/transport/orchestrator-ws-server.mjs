import { WebSocketServer } from 'ws';
import { getOrchestratorRealtimeSnapshot } from '../services/orchestrator.service.mjs';
import { getSimulatorOverview } from '../services/simulator.service.mjs';

const DEFAULT_SNAPSHOT_INTERVAL_MS = 1500;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30000;

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function makeErrorPayload(error) {
  return {
    type: 'stream_error',
    data: {
      error: error?.message || 'orchestrator_ws_error'
    },
    timestamp: new Date().toISOString()
  };
}

async function buildRealtimeSnapshot() {
  const overview = await getSimulatorOverview().catch(() => null);
  return getOrchestratorRealtimeSnapshot({ overview });
}

async function sendSnapshot(ws) {
  try {
    const snapshot = await buildRealtimeSnapshot();
    safeSend(ws, {
      type: 'orchestrator_snapshot',
      data: snapshot,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    safeSend(ws, makeErrorPayload(error));
  }
}

function parseMessage(raw) {
  try {
    return typeof raw === 'string'
      ? JSON.parse(raw)
      : JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return null;
  }
}

export function initOrchestratorWebSocket(httpServer, {
  path = '/ws/orchestrator',
  snapshotIntervalMs = Number(process.env.ORCHESTRATOR_WS_SNAPSHOT_INTERVAL_MS || DEFAULT_SNAPSHOT_INTERVAL_MS),
  heartbeatIntervalMs = Number(process.env.ORCHESTRATOR_WS_HEARTBEAT_INTERVAL_MS || DEFAULT_HEARTBEAT_INTERVAL_MS),
  heartbeatTimeoutMs = Number(process.env.ORCHESTRATOR_WS_HEARTBEAT_TIMEOUT_MS || DEFAULT_HEARTBEAT_TIMEOUT_MS)
} = {}) {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on('connection', async (ws, req) => {
    const clientId = `orch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const state = {
      clientId,
      lastPongAt: Date.now(),
      snapshotTimer: null,
      heartbeatTimer: null,
      remoteAddress: req.socket?.remoteAddress || null
    };

    const cleanup = () => {
      if (state.snapshotTimer) clearInterval(state.snapshotTimer);
      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      state.snapshotTimer = null;
      state.heartbeatTimer = null;
    };

    ws.on('message', (raw) => {
      const message = parseMessage(raw);
      if (!message) {
        safeSend(ws, makeErrorPayload(new Error('invalid_json_message')));
        return;
      }
      if (message.type === 'pong') {
        state.lastPongAt = Date.now();
        return;
      }
      if (message.type === 'ping') {
        state.lastPongAt = Date.now();
        safeSend(ws, {
          type: 'pong',
          data: {
            ts: Date.now(),
            echo: message.data || null
          },
          timestamp: new Date().toISOString()
        });
        return;
      }
      if (message.type === 'subscribe_orchestrator' || message.type === 'get_snapshot') {
        sendSnapshot(ws);
      }
    });

    ws.on('pong', () => {
      state.lastPongAt = Date.now();
    });

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    safeSend(ws, {
      type: 'hello',
      data: {
        client_id: clientId,
        protocol: 'orchestrator-websocket.v1',
        heartbeat_interval_ms: heartbeatIntervalMs,
        heartbeat_timeout_ms: heartbeatTimeoutMs,
        snapshot_interval_ms: snapshotIntervalMs
      },
      timestamp: new Date().toISOString()
    });

    await sendSnapshot(ws);

    state.snapshotTimer = setInterval(() => {
      sendSnapshot(ws);
    }, snapshotIntervalMs);

    state.heartbeatTimer = setInterval(() => {
      if (Date.now() - state.lastPongAt > heartbeatTimeoutMs) {
        safeSend(ws, {
          type: 'stream_error',
          data: {
            error: 'heartbeat_timeout',
            client_id: clientId
          },
          timestamp: new Date().toISOString()
        });
        ws.terminate();
        cleanup();
        return;
      }
      safeSend(ws, {
        type: 'ping',
        data: {
          ts: Date.now(),
          client_id: clientId
        },
        timestamp: new Date().toISOString()
      });
    }, heartbeatIntervalMs);
  });

  return wss;
}
