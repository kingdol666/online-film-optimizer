// History Service — CRUD operations for diagnosis run history

import { db, stmts } from '../db/database.mjs';
import { getRunRealtimeSnapshot, listRuns } from './diagnosis.service.mjs';

export function getAllRuns(auth) {
  return listRuns(auth).map(run => ({
    ...run,
    liveStatus: run.engineStatus || run.status,
  }));
}

export function getRunWithLogs(runId, auth) {
  const snapshot = getRunRealtimeSnapshot(runId, auth);
  const run = snapshot?.run;
  if (!run) return null;
  const logs = stmts.getLogsByRunId.all(runId);
  return {
    ...run,
    engineStatus: snapshot?.liveStatus || run.engineStatus || run.status,
    liveStatus: snapshot?.liveStatus || run.engineStatus || run.status,
    hasActiveEngineRun: snapshot?.hasActiveEngineRun || false,
    currentQuestion: snapshot?.currentQuestion || null,
    logs,
  };
}

export function deleteRun(runId, auth) {
  const run = getRunRealtimeSnapshot(runId, auth)?.run;
  if (!run) {
    const err = new Error('Run not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM diagnosis_logs WHERE run_id = ?').run(runId);
  stmts.deleteEventStreamByRunId.run(runId);
  db.prepare('DELETE FROM diagnostic_runs WHERE run_id = ?').run(runId);
  return true;
}
