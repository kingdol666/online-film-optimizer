import path from 'node:path';
import { McpClient } from './lib/mcp-client.mjs';
import { getJson } from '../../app/backend/src/lib/http-json.mjs';

const PROJECT_ROOT = path.resolve(process.cwd());
const BACKEND_BASE = `http://127.0.0.1:${process.env.BACKEND_PORT || 4317}`;
const FRONTEND_BASE = `http://127.0.0.1:${process.env.FRONTEND_PORT || 5418}`;
const SIM_BASE = `http://127.0.0.1:${process.env.SIM_PORT || 8877}`;

async function main() {
  const mcp = new McpClient({ cwd: PROJECT_ROOT, ensureServices: true });
  await mcp.start();
  try {
    const toolNames = await mcp.assertReady([
      'film_line_get_state',
      'film_line_get_online_quality',
      'film_line_preview_setpoints',
      'film_line_apply_setpoints',
      'film_line_run_until_stable'
    ]);

    const [backendHealth, simulatorState, frontendOk] = await Promise.all([
      getJson(`${BACKEND_BASE}/api/health`),
      getJson(`${SIM_BASE}/sim/state`),
      fetch(FRONTEND_BASE).then((res) => res.ok)
    ]);

    await mcp.callTool('film_line_reset', {
      campaignId: 'CMP-SELF-CHECK',
      productGrade: 'BOPET_NEW_GRADE_A'
    });
    await mcp.callTool('film_line_run_until_stable', {
      minStableTicks: 6,
      maxTicks: 40
    });

    const beforeOverviewResponse = await getJson(`${BACKEND_BASE}/api/simulator/overview`);
    const beforeOverview = beforeOverviewResponse.data;
    const beforeMetric = beforeOverview.quality.metrics.birefringence_cv;
    const currentTdZone2 = beforeOverview.state.setpoints.td_zone_2_temp;
    const targetTdZone2 = Number((currentTdZone2 + 0.8).toFixed(1));

    const preview = await mcp.callTool('film_line_preview_setpoints', {
      experimentId: 'SELF-CHECK-001',
      sourcePlan: 'self_check',
      changes: [{ tag: 'td_zone_2_temp', target: targetTdZone2 }]
    });
    const receipt = await mcp.callTool('film_line_apply_setpoints', {
      experimentId: 'SELF-CHECK-001',
      sourcePlan: 'self_check',
      changes: [{ tag: 'td_zone_2_temp', target: targetTdZone2 }]
    });
    const stabilized = await mcp.callTool('film_line_run_until_stable', {
      minStableTicks: 6,
      maxTicks: 40
    });
    const afterOverviewResponse = await getJson(`${BACKEND_BASE}/api/simulator/overview`);
    const afterOverview = afterOverviewResponse.data;
    const afterMetric = afterOverview.quality.metrics.birefringence_cv;

    const orchestratorRunResponse = await fetch(`${BACKEND_BASE}/api/orchestrator/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goalText: '获得厚度均匀、双折射稳定、可进入真实产线 shadow validation 的新产品配方',
        maxIters: 3,
        seed: 20260610
      })
    });
    const orchestratorRun = await orchestratorRunResponse.json();
    if (!orchestratorRun.success) {
      throw new Error(orchestratorRun.error || 'orchestrator_run_failed');
    }

    let orchestratorStatus = null;
    for (let i = 0; i < 45; i += 1) {
      orchestratorStatus = await getJson(`${BACKEND_BASE}/api/orchestrator/status`);
      if (orchestratorStatus.data?.activeRun?.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const result = {
      ok: true,
      frontend_started: frontendOk,
      backend_health: backendHealth,
      simulator_state: simulatorState,
      mcp_tools_checked: toolNames,
      control_check: {
        preview_allowed: preview.safety_gate_result.allowed,
        executed: receipt.receipt.executed,
        before_td_zone_2_temp: currentTdZone2,
        after_td_zone_2_temp: afterOverview.state.setpoints.td_zone_2_temp,
        before_birefringence_cv: beforeMetric,
        after_birefringence_cv: afterMetric,
        stable_window_id: stabilized.window_id
      },
      orchestrator_check: {
        accepted: orchestratorRun.success,
        request_id: orchestratorRun.data.id,
        final_status: orchestratorStatus?.data?.activeRun?.status || null,
        latest_run_id: orchestratorStatus?.data?.latestRun?.runId || null,
        final_stage: orchestratorStatus?.data?.latestRun?.summary?.final_strategy_stage || null
      }
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mcp.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
