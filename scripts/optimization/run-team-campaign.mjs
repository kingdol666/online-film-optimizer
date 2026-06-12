import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createDepartmentTeamTask, finalizeDepartmentTeamTask } from './lib/department-workflow.mjs';
import { readJson } from './lib/goal-request.mjs';

function parseArgs(argv) {
  const args = {
    target: 'examples/targets/bopet_new_grade_a.json',
    baseDir: null,
    maxIters: 12,
    seed: 20260610,
    goalText: null,
    goalRequest: null,
    productGrade: null,
    reasoningMode: null
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') args.target = argv[++i];
    else if (arg === '--base-dir') args.baseDir = argv[++i];
    else if (arg === '--max-iters') args.maxIters = Number(argv[++i]);
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--goal-text') args.goalText = argv[++i];
    else if (arg === '--goal-request') args.goalRequest = argv[++i];
    else if (arg === '--product-grade') args.productGrade = argv[++i];
    else if (arg === '--reasoning-mode') args.reasoningMode = argv[++i];
  }
  return args;
}

function runNode(script, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`command_failed:${script}:code=${code}\n${stderr}`));
    });
  });
}

function readLatestRunDir(campaignRoot) {
  if (!fs.existsSync(campaignRoot)) return null;
  const dirs = fs.readdirSync(campaignRoot)
    .map((name) => path.join(campaignRoot, name))
    .filter((fullPath) => fs.statSync(fullPath).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || null;
}

async function main() {
  const args = parseArgs(process.argv);
  const goalText = args.goalText || '获得厚度均匀、双折射稳定、可进入真实产线 shadow validation 的新产品配方';
  const rawGoalRequest = args.goalRequest ? readJson(path.resolve(args.goalRequest)) : null;
  const productScopedGoalRequest = args.productGrade
    ? { ...(rawGoalRequest || {}), goal_text: rawGoalRequest?.goal_text || goalText, product_grade: args.productGrade }
    : rawGoalRequest;
  if (args.reasoningMode) {
    if (!productScopedGoalRequest) {
      if (!args.goalText) {
        throw new Error('reasoning_mode_requires_goal_text_or_goal_request');
      }
    }
  }
  const effectiveGoalRequest = args.reasoningMode
    ? {
        ...(productScopedGoalRequest || { goal_text: goalText }),
        execution: {
          ...((productScopedGoalRequest || {}).execution || {}),
          reasoning_mode: args.reasoningMode
        }
      }
    : productScopedGoalRequest;

  const { taskWorkspace, goalRequest } = createDepartmentTeamTask({
    goalText,
    goalRequest: effectiveGoalRequest,
    targetFile: args.target,
    baseDir: args.baseDir
  });

  const goalRequestPath = path.join(taskWorkspace.taskDir, 'goal_request.json');
  const campaignScript = path.resolve('scripts/optimization/run-sim-campaign.mjs');
  await runNode(campaignScript, [
    '--target', args.target,
    '--goal-request', goalRequestPath,
    '--base-dir', taskWorkspace.campaignRoot,
    '--max-iters', String(args.maxIters),
    '--seed', String(args.seed),
    '--product-grade', goalRequest.product_grade,
    '--reasoning-mode', goalRequest.execution?.reasoning_mode || 'deterministic'
  ], process.cwd());

  const latestRunDir = readLatestRunDir(taskWorkspace.campaignRoot);
  if (!latestRunDir) throw new Error('no_campaign_run_generated');

  const runSummaryPath = path.join(latestRunDir, 'run_summary.json');
  const runSummary = readJson(runSummaryPath);
  const recipePath = path.join(latestRunDir, '06_recipe', 'recipe_release_recommendation.json');
  const recipeRecommendation = readJson(recipePath);

  const finalSummary = finalizeDepartmentTeamTask({
    taskWorkspace,
    campaignDir: latestRunDir,
    runSummary,
    bestRecipe: recipeRecommendation,
    runtime: {
      launch_mode: goalRequest.execution?.reasoning_mode === 'claude_cli'
        ? 'team_claude_cli'
        : 'team_deterministic',
      reasoning_mode: goalRequest.execution?.reasoning_mode || 'deterministic',
      request_id: goalRequest.request_id,
      product_grade: goalRequest.product_grade,
      goal_text: goalRequest.goal_text
    }
  });

  console.log(JSON.stringify({
    task_id: taskWorkspace.taskId,
    task_dir: taskWorkspace.taskDir,
    goal_text: goalRequest.goal_text,
    campaign_dir: latestRunDir,
    run_summary: runSummary,
    best_recipe: recipeRecommendation,
    final_summary: finalSummary
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
