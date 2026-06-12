import fs from 'node:fs';
import path from 'node:path';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function controlFilePath(runtimeDir, runId) {
  return path.join(runtimeDir, 'orchestrator-controls', `${runId}.json`);
}

export function initializeControlFile(runtimeDir, runId) {
  const filePath = controlFilePath(runtimeDir, runId);
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, {
      run_id: runId,
      pause_requested: false,
      rollback_requested: false,
      terminate_requested: false,
      updated_at: new Date().toISOString()
    });
  }
  return filePath;
}

export function readControlState(runtimeDir, runId) {
  const filePath = initializeControlFile(runtimeDir, runId);
  return readJson(filePath);
}

export function patchControlState(runtimeDir, runId, patch) {
  const filePath = initializeControlFile(runtimeDir, runId);
  const current = readJson(filePath);
  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString()
  };
  writeJson(filePath, next);
  return next;
}

