import { Router } from 'express';
import {
  approveRun,
  getLatestOrchestratorTask,
  getOrchestratorRun,
  getOrchestratorStatus,
  getOrchestratorTask,
  pauseRun,
  resumeRun,
  rollbackRun,
  runOrchestrator,
  terminateRun
} from '../services/orchestrator.service.mjs';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ success: true, data: getOrchestratorStatus() });
});

router.get('/stream', (req, res) => {
  res.status(410).json({
    success: false,
    error: 'sse_stream_deprecated',
    websocket: '/ws/orchestrator'
  });
});

router.get('/tasks/latest', (req, res) => {
  res.json({ success: true, data: getLatestOrchestratorTask() });
});

router.get('/tasks/:taskId', (req, res, next) => {
  try {
    res.json({ success: true, data: getOrchestratorTask(req.params.taskId) });
  } catch (error) {
    next(error);
  }
});

router.get('/runs/:runId', (req, res, next) => {
  try {
    res.json({ success: true, data: getOrchestratorRun(req.params.runId) });
  } catch (error) {
    next(error);
  }
});

router.post('/run', (req, res, next) => {
  try {
    const { goalText, goalRequest, productGrade, reasoningMode, launchMode, maxIters, seed } = req.body || {};
    res.json({
      success: true,
      data: runOrchestrator({ goalText, goalRequest, productGrade, reasoningMode, launchMode, maxIters, seed })
    });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/approve', (req, res, next) => {
  try {
    const { approvalStatus, approver, note } = req.body || {};
    res.json({
      success: true,
      data: approveRun(req.params.runId, { approvalStatus, approver, note })
    });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/pause', (req, res, next) => {
  try {
    res.json({ success: true, data: pauseRun(req.params.runId) });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/resume', (req, res, next) => {
  try {
    res.json({ success: true, data: resumeRun(req.params.runId) });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/rollback', (req, res, next) => {
  try {
    res.json({ success: true, data: rollbackRun(req.params.runId) });
  } catch (error) {
    next(error);
  }
});

router.post('/runs/:runId/terminate', (req, res, next) => {
  try {
    res.json({ success: true, data: terminateRun(req.params.runId) });
  } catch (error) {
    next(error);
  }
});

export default router;
