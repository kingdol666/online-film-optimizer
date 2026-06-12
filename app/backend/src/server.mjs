import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { createServer } from 'node:http';
import simulatorRoutes from './routes/simulator.routes.mjs';
import campaignRoutes from './routes/campaign.routes.mjs';
import orchestratorRoutes from './routes/orchestrator.routes.mjs';
import { initOrchestratorWebSocket } from './transport/orchestrator-ws-server.mjs';

const app = express();
const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 4317);
const FRONTEND_DIR = path.resolve(process.cwd(), '..', 'frontend', 'static');

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'online-optimizer-backend',
      time: new Date().toISOString()
    }
  });
});

app.use('/api/simulator', simulatorRoutes);
app.use('/api/campaign', campaignRoutes);
app.use('/api/orchestrator', orchestratorRoutes);
app.use('/', express.static(FRONTEND_DIR));

app.use((error, req, res, next) => {
  const status =
    error.message === 'campaign_already_running'
      ? 409
      : error.message?.startsWith('run_not_found:')
        ? 404
        : error.statusCode || 500;
  res.status(status).json({
    success: false,
    code: error.code || 'internal_error',
    status,
    error: error.message || 'internal_error'
  });
});

const server = createServer(app);
initOrchestratorWebSocket(server);

server.listen(PORT, () => {
  console.log(`online-optimizer backend listening on http://127.0.0.1:${PORT}`);
  console.log(`orchestrator websocket listening on ws://127.0.0.1:${PORT}/ws/orchestrator`);
});
