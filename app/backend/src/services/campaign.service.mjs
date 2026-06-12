import { getOrchestratorStatus, runOrchestrator } from './orchestrator.service.mjs';

export function getCampaignStatus() {
  const orchestrator = getOrchestratorStatus();
  return {
    activeCampaign: orchestrator.activeRun,
    latestRunDir: orchestrator.latestRun?.runDir || null,
    latestSummary: orchestrator.latestRun?.summary || null
  };
}

export function runClosedLoopCampaign({
  maxIters = 12,
  seed = 20260610
} = {}) {
  return runOrchestrator({
    maxIters,
    seed
  });
}
