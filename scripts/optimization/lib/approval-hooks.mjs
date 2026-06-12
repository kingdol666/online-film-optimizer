import fs from 'node:fs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function decideApprovalMode({ config, goalRequest, provider }) {
  const manualApprovalRequired = Boolean(goalRequest.execution?.manual_approval_required);
  const autoApproveSimulator = config.orchestrator.auto_approve_simulator && provider === 'simulated-line';
  return {
    manual_approval_required: manualApprovalRequired,
    default_status: manualApprovalRequired && !autoApproveSimulator ? 'pending' : 'approved',
    auto_approved: !manualApprovalRequired || autoApproveSimulator
  };
}

export async function waitForApprovalDecision({
  approvalFile,
  pollMs,
  timeoutMs,
  onTick
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (typeof onTick === 'function') await onTick();
    const approval = readJson(approvalFile);
    if (approval.approval_status !== 'pending') return approval;
    await sleep(pollMs);
  }
  const latest = readJson(approvalFile);
  return {
    ...latest,
    approval_status: latest.approval_status === 'pending' ? 'expired' : latest.approval_status,
    approval_source: latest.approval_source || 'timeout'
  };
}

