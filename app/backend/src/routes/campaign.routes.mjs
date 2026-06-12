import { Router } from 'express';
import { getCampaignStatus, runClosedLoopCampaign } from '../services/campaign.service.mjs';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ success: true, data: getCampaignStatus() });
});

router.post('/run', (req, res, next) => {
  try {
    const { maxIters, seed } = req.body || {};
    res.json({
      success: true,
      data: runClosedLoopCampaign({ maxIters, seed })
    });
  } catch (error) {
    next(error);
  }
});

export default router;
