import { WebSocketServer } from 'ws';
import { getSimulatorOverview } from '../services/simulator.service.mjs';

const DEFAULT_SNAPSHOT_INTERVAL_MS = 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30000;

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
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

async function sendSnapshot(ws) {
  try {
    const overview = await getSimulatorOverview();
    safeSend(ws, {
      type: 'simulator_snapshot',
      data: overview,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    safeSend(ws, {
      type: 'stream_error',
      data: { error: error.message || 'simulator_stream_error' },
      timestamp: new Date().toISOString()
    });
  }
}

export function initSimulatorWebSocket(httpServer, {
  path = '/ws/simulator',
  snapshotIntervalMs = Number(process.env.SIM_WS_SNAPSHOT_INTERVAL_MS || DEFAULT_SNAPSHOT_INTERVAL_MS),
  heartbeatIntervalMs = Number(process.env.SIM_WS_HEARTBEAT_INTERVAL_MS || DEFAULT_HEARTBEAT_INTERVAL_MS),
  heartbeatTimeoutMs = Number(process.env.SIM_WS_HEARTBEAT_TIMEOUT_MS || DEFAULT_HEARTBEAT_TIMEOUT_MS)
} = {}) {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on('connection', async (ws) => {
    const clientId = `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let lastPongAt = Date.now();
    let snapshotTimer = null;
    let heartbeatTimer = null;

    function cleanup() {
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      snapshotTimer = null;
      heartbeatTimer = null;
    }

    ws.on('message', (raw) => {
      const message = parseMessage(raw);
      if (!message) return;
      if (message.type === 'pong') {
        lastPongAt = Date.now();
        return;
      }
      if (message.type === 'ping') {
        lastPongAt = Date.now();
        safeSend(ws, {
          type: 'pong',
          data: { ts: Date.now(), echo: message.data || null },
          timestamp: new Date().toISOString()
        });
        return;
      }
      if (message.type === 'subscribe_simulator' || message.type === 'get_snapshot') {
        sendSnapshot(ws);
      }
    });

    ws.on('pong', () => {
      lastPongAt = Date.now();
    });

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    safeSend(ws, {
      type: 'hello',
      data: {
        client_id: clientId,
        protocol: 'simulator-websocket.v1',
        heartbeat_interval_ms: heartbeatIntervalMs,
        heartbeat_timeout_ms: heartbeatTimeoutMs,
        snapshot_interval_ms: snapshotIntervalMs
      },
      timestamp: new Date().toISOString()
    });

    await sendSnapshot(ws);

    snapshotTimer = setInterval(() => {
      sendSnapshot(ws);
    }, snapshotIntervalMs);

    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastPongAt > heartbeatTimeoutMs) {
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
