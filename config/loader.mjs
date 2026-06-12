import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());

function boolFromEnv(value, fallback) {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function numFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  database: {
    path: process.env.DB_PATH || 'data/optimizer.db'
  },
  mime_types: {
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8'
  }
};

export const data = {
  dir: 'data',
  upload_dir: 'data/uploads',
  file_preview_max_chars: 20000
};

export const server = {
  port: numFromEnv(process.env.BACKEND_PORT, 4317),
  body_limit: process.env.BODY_LIMIT || '10mb'
};

export const websocket = {
  enabled: boolFromEnv(process.env.WS_ENABLED, true),
  url: process.env.PROCESS_WS_URL || '',
  reconnect_ms: numFromEnv(process.env.PROCESS_WS_RECONNECT_MS, 3000),
  timeout_ms: numFromEnv(process.env.PROCESS_WS_TIMEOUT_MS, 10000)
};

export const pipeline = {
  optimizer_filename: 'optimizer.md',
  report_filename: 'report.md'
};

export const engine = {
  max_steps: numFromEnv(process.env.DIAG_MAX_STEPS, 30)
};

export default {
  PROJECT_ROOT,
  config,
  data,
  server,
  websocket,
  pipeline,
  engine
};

