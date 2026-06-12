import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensurePlatformServices } from './lib/service-guard.mjs';
import { McpClient } from './lib/mcp-client.mjs';
import { loadPlatformConfig } from './lib/platform-config.mjs';
import { getJson } from '../../app/backend/src/lib/http-json.mjs';

const REQUIRED_MCP_TOOLS = [
  'film_line_get_state',
  'film_line_get_snapshot',
  'film_line_get_online_quality',
  'film_line_run_until_stable',
  'film_line_preview_proposal',
  'film_line_apply_proposal',
  'film_line_rollback',
  'film_line_save_candidate_recipe',
  'film_line_load_recipe_baseline'
];

function summarizeOrchestratorStatus(status) {
  const data = status?.data || status || {};
  const activeRun = data?.activeRun || null;
  const latestTask = data?.latestTask || null;
  const latestRun = data?.latestRun || null;
  const runtimeConfig = data?.runtimeConfig || null;

  return {
    active_run: activeRun ? {
      id: activeRun.id || null,
      status: activeRun.status || null,
      launch_mode: activeRun.launchMode || null,
      reasoning_mode: activeRun.reasoningMode || null,
      product_grade: activeRun.productGrade || null,
      goal_text: activeRun.goalText || null,
      started_at: activeRun.startedAt || null,
      finished_at: activeRun.finishedAt || null,
      exit_code: activeRun.exitCode ?? null
    } : null,
    latest_task: latestTask ? {
      task_id: latestTask.taskId || null,
      status: latestTask.status || null,
      product_grade: latestTask.productGrade || null,
      goal_text: latestTask.goalText || null,
      latest_campaign_id: latestTask.latestCampaign?.campaignId || null,
      latest_campaign_status: latestTask.latestCampaign?.runSummary?.status || null
    } : null,
    latest_run: latestRun ? {
      run_id: latestRun.runId || null,
      status: latestRun.status || null,
      product_grade: latestRun.productGrade || null,
      target_reached: latestRun.targetReached ?? null,
      best_score: latestRun.bestScore ?? null
    } : null,
    runtime_config: runtimeConfig
  };
}

function parseArgs(argv) {
  const args = {
    goalText: '',
    productGrade: '',
    launchMode: 'auto',
    maxIters: null,
    maxTurns: null,
    seed: 20260612,
    reasoningMode: 'deterministic',
    checkOnly: false,
    skipFrontend: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--goal-text') args.goalText = argv[++i];
    else if (arg === '--product-grade') args.productGrade = argv[++i];
    else if (arg === '--launch-mode') args.launchMode = argv[++i];
    else if (arg === '--max-iters') args.maxIters = Number(argv[++i]);
    else if (arg === '--max-turns') args.maxTurns = Number(argv[++i]);
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--reasoning-mode') args.reasoningMode = argv[++i];
    else if (arg === '--check-only') args.checkOnly = true;
    else if (arg === '--skip-frontend') args.skipFrontend = true;
  }
  return args;
}

function commandExists(command) {
  try {
    const result = spawn(command, ['--version'], {
      stdio: 'ignore'
    });
    return new Promise((resolve) => {
      result.on('error', () => resolve(false));
      result.on('close', (code) => resolve(code === 0));
    });
  } catch {
    return Promise.resolve(false);
  }
}

function resolveLaunchMode({ requestedMode, claudeCliReady }) {
  if (requestedMode && requestedMode !== 'auto') return requestedMode;
  return claudeCliReady ? 'claude_sdk' : 'team_deterministic';
}

function buildLaunchSpec({ projectRoot, args, launchMode }) {
  const commonArgs = [];
  if (args.productGrade) commonArgs.push('--product-grade', args.productGrade);
  if (args.goalText) commonArgs.push('--goal-text', args.goalText);
  if (Number.isFinite(args.maxIters) && args.maxIters > 0) commonArgs.push('--max-iters', String(args.maxIters));
  if (Number.isFinite(args.seed) && args.seed > 0) commonArgs.push('--seed', String(args.seed));
  if (args.reasoningMode) commonArgs.push('--reasoning-mode', args.reasoningMode);

  if (launchMode === 'claude_sdk') {
    if (Number.isFinite(args.maxTurns) && args.maxTurns > 0) {
      commonArgs.push('--max-turns', String(args.maxTurns));
    }
    return {
      command: process.execPath,
      args: ['scripts/optimization/run-claude-sdk-skill.mjs', ...commonArgs]
    };
  }

  return {
    command: process.execPath,
    args: ['scripts/optimization/run-team-campaign.mjs', ...commonArgs]
  };
}

async function checkRuntimeReady({ projectRoot, config, skipFrontend }) {
  await ensurePlatformServices({
    projectRoot,
    backendPort: config.ports.backend,
    frontendPort: config.ports.frontend,
    simPort: config.ports.simulator,
    ensureFrontend: !skipFrontend
  });

  const backendBase = `http://127.0.0.1:${config.ports.backend}`;
  const simulatorBase = `http://127.0.0.1:${config.ports.simulator}`;
  const frontendBase = `http://127.0.0.1:${config.ports.frontend}`;
  const mcp = new McpClient({ cwd: projectRoot, ensureServices: false });
  await mcp.start();
  try {
    const toolNames = await mcp.assertReady(REQUIRED_MCP_TOOLS);
    const checks = [
      getJson(`${backendBase}/api/health`),
      getJson(`${backendBase}/api/orchestrator/status`),
      getJson(`${simulatorBase}/sim/state`)
    ];
    if (!skipFrontend) {
      checks.push(fetch(frontendBase).then((res) => res.ok).catch(() => false));
    }

    const [backendHealth, orchestratorStatus, simulatorState, frontendOk] = await Promise.all(checks);

    return {
      mcp_tools_checked: toolNames,
      backend_health: backendHealth,
      orchestrator_status: summarizeOrchestratorStatus(orchestratorStatus),
      simulator_state: simulatorState,
      frontend_ready: skipFrontend ? 'skipped' : frontendOk
    };
  } finally {
    await mcp.stop();
  }
}

function runChild({ command, args, cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`skill_entry_child_failed:${command}:code=${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(process.cwd());
  const config = loadPlatformConfig({ projectRoot });
  const claudeCliReady = await commandExists(process.env.CLAUDE_CLI_PATH || 'claude');
  const launchMode = resolveLaunchMode({
    requestedMode: args.launchMode,
    claudeCliReady
  });

  const runtimeCheck = await checkRuntimeReady({
    projectRoot,
    config,
    skipFrontend: args.skipFrontend
  });

  const preflight = {
    ok: true,
    mode: 'closed-loop-skill-entry',
    launch_mode: launchMode,
    goal_text: args.goalText || null,
    product_grade: args.productGrade || null,
    claude_cli_ready: claudeCliReady,
    backend_port: config.ports.backend,
    frontend_port: config.ports.frontend,
    simulator_port: config.ports.simulator,
    runtime_check: runtimeCheck
  };

  console.log(JSON.stringify(preflight, null, 2));

  if (args.checkOnly) return;
  if (!args.goalText) {
    throw new Error('missing_goal_text_for_skill_entry');
  }

  const spec = buildLaunchSpec({
    projectRoot,
    args,
    launchMode
  });

  const env = {
    ...process.env,
    ONLINE_OPTIMIZER_SKILL_ENTRY: '1',
    ONLINE_OPTIMIZER_AGENTTEAM_MODE: launchMode === 'claude_sdk' ? 'claude_sdk_subagents' : 'team_filebus'
  };

  await runChild({
    command: spec.command,
    args: spec.args,
    cwd: projectRoot,
    env
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
