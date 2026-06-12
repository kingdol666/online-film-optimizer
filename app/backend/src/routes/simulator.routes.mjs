import { Router } from 'express';
import {
  applySetpoints,
  getSimulatorOverview,
  listSimulatorProducts,
  previewSetpoints,
  resetSimulator,
  runUntilStable
} from '../services/simulator.service.mjs';

const router = Router();

router.get('/overview', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getSimulatorOverview() });
  } catch (error) {
    next(error);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    res.json({ success: true, data: await listSimulatorProducts() });
  } catch (error) {
    next(error);
  }
});

router.post('/reset', async (req, res, next) => {
  try {
    res.json({ success: true, data: await resetSimulator(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

router.post('/stabilize', async (req, res, next) => {
  try {
    res.json({ success: true, data: await runUntilStable(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

router.post('/preview-setpoints', async (req, res, next) => {
  try {
    res.json({ success: true, data: await previewSetpoints(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

router.post('/apply-setpoints', async (req, res, next) => {
  try {
    res.json({ success: true, data: await applySetpoints(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

export default router;
