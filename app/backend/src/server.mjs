import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import simulatorRoutes from './routes/simulator.routes.mjs';
import { initSimulatorWebSocket } from './transport/simulator-ws-server.mjs';

const app = express();
const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 4317);

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'online-optimizer-backend',
      time: new Date().toISOString(),
      websocket: '/ws/simulator'
    }
  });
});

app.use('/api/simulator', simulatorRoutes);

app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  res.status(status).json({
    success: false,
    code: error.code || 'internal_error',
    status,
    error: error.message || 'internal_error'
  });
});

const server = createServer(app);
initSimulatorWebSocket(server);

server.listen(PORT, () => {
  console.log(`online-optimizer backend listening on http://127.0.0.1:${PORT}`);
  console.log(`simulator websocket listening on ws://127.0.0.1:${PORT}/ws/simulator`);
});
