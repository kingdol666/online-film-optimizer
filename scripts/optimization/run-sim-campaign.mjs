import fs from 'node:fs';
import path from 'node:path';
import {
  buildApprovalPacket,
  buildCoordinationIndex,
  buildExecutiveSummary,
  buildProcessAgentBrief,
  buildQualityReviewReport,
  buildRDAgentBrief,
  buildStrategyState,
  processEngineer,
  qualityEngineer,
  qualityLoss,
  rdEngineer,
  recipeRecommendation,
  summarizeExperiment
} from './role-engines.mjs';
import {
  buildStrategyStateFromDiagnosis,
  executeProcessRole,
  executeQualityRole,
  executeRDRole
} from './lib/claude-role-executor.mjs';
import { loadPlatformConfig } from './lib/platform-config.mjs';
import { createLineAdapter } from './lib/line-adapters.mjs';
import { goalRequestToProductTarget, normalizeGoalRequest, readJson } from './lib/goal-request.mjs';
import { initializeControlFile, patchControlState, readControlState } from './lib/orchestrator-control.mjs';
import { waitForApprovalDecision } from './lib/approval-hooks.mjs';
import { postRoleMessage } from './lib/department-workflow.mjs';
import { createTeamMessage } from './lib/team-message-protocol.mjs';
import {
  initializeBestRecipeMemory,
  readBestRecipeMemory,
  updateBestRecipeMemory
} from './lib/best-recipe-memory.mjs';
import { materializeTargetsFromDirectives } from './lib/natural-language-goal-parser.mjs';
import { uniqueNowId } from './lib/ids.mjs';

const DEFAULT_TARGET = 'examples/targets/bopet_new_grade_a.json';
const DEFAULT_BASE_DIR = 'workspace/optimization-campaigns';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function buildTrialEvidenceDir(runDir, iteration) {
  return path.join(runDir, '08_trial_evidence', `trial_${String(iteration).padStart(3, '0')}`);
}

function taskDirFromRunDir(runDir) {
  return path.dirname(path.dirname(runDir));
}

function parseArgs(argv) {
  const args = {
    target: DEFAULT_TARGET,
    baseDir: DEFAULT_BASE_DIR,
    maxIters: null,
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
    else if (arg === '--state-file') args.stateFile = argv[++i];
    else if (arg === '--goal-text') args.goalText = argv[++i];
    else if (arg === '--goal-request') args.goalRequest = argv[++i];
    else if (arg === '--product-grade') args.productGrade = argv[++i];
    else if (arg === '--reasoning-mode') args.reasoningMode = argv[++i];
  }
  return args;
}

function makeDirs(runDir) {
  for (const dir of ['00_objective', '01_snapshots', '02_quality', '03_rd_plan', '04_execution', '05_results', '06_recipe', '07_coordination']) {
    fs.mkdirSync(path.join(runDir, dir), { recursive: true });
  }
}

function buildReport({ runDir, target, summary, recommendation }) {
  const md = [
    '# 在线闭环优化 Campaign 报告',
    '',
    `- Campaign: ${summary.campaign_id}`,
    `- Product grade: ${target.product_grade}`,
    `- Iterations: ${summary.iterations}`,
    `- Final state: ${summary.final_quality_state}`,
    `- Final loss: ${summary.final_loss}`,
    `- Final stage: ${summary.final_strategy_stage}`,
    `- Candidate recipe: ${recommendation.candidate_recipe_id}`,
    `- Release status: ${recommendation.release_status}`,
    `- Goal reached: ${summary.goal_reached}`,
    `- Evidence root: 08_trial_evidence/`,
    '',
    '## 结论',
    '',
    summary.goal_reached
      ? '平台已达到本次用户目标解释下的在线优化目标，并输出最佳 recipe。'
      : summary.final_quality_state === 'PASS'
        ? '半自动闭环已在模拟环境达到在线代理质量目标，可进入真实产线 shadow validation 与离线性能验证。'
        : '闭环尚未完全达到目标，应继续优化、调整策略阶段或进入更严格的恢复治理。',
    '',
    '## 真实产线迁移前必须验证',
    '',
    '- approved write MCP 与真实审批系统联调。',
    '- 在线检测、historian、设备标签映射的一致性。',
    '- shadow mode 与实际质量标签闭环一致性。',
    '- safety gate 在真实 PLC / DCS 边界上的正确性。'
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), md + '\n');
}

async function maybeWaitForPause(runtimeDir, runId) {
  while (true) {
    const control = readControlState(runtimeDir, runId);
    if (!control.pause_requested) return control;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function latestDecisionCounts(history) {
  return {
    worse: history.filter((item) => item.experiment_result?.decision === 'worse').length,
    effective: history.filter((item) => item.experiment_result?.decision === 'effective').length,
    rejected: history.filter((item) => item.experiment_result?.decision === 'rejected').length
  };
}

function currentConsecutiveDecisionCount(history, decision) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.experiment_result?.decision !== decision) break;
    count += 1;
  }
  return count;
}

function countRecentPassWindows(history, windowSize) {
  return history
    .slice(-windowSize)
    .filter((item) => item?.post_quality_state === 'PASS')
    .length;
}

function countRecentDecisionsWithinCycle(history, {
  strategyCycleId,
  processIterationStart = 1,
  processIterationEnd = Infinity,
  decisions = []
}) {
  return history.filter((item) => (
    item?.strategy_cycle_id === strategyCycleId
    && item?.process_iteration_in_cycle >= processIterationStart
    && item?.process_iteration_in_cycle <= processIterationEnd
    && decisions.includes(item?.experiment_result?.decision)
  )).length;
}

function consecutiveDecisionCountWithinCycle(history, decision, strategyCycleId) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.strategy_cycle_id !== strategyCycleId) break;
    if (item?.experiment_result?.decision !== decision) break;
    count += 1;
  }
  return count;
}

function getProcessIterationsPerCycle(config, stage) {
  return Math.max(1, Number(config.orchestrator.process_iterations_per_strategy_cycle?.[stage] || 2));
}

function getNoProgressReplanThreshold(config, stage) {
  return Math.max(1, Number(config.orchestrator.no_progress_replan_threshold?.[stage] || 2));
}

function buildTeamDispatchPlan({
  iteration,
  cycleState,
  strategyState,
  diagnosis = null,
  cachedStrategyBundle = null,
  target,
  history = []
}) {
  const refreshStrategy = cycleState.plan_source === 'replanned';
  const activePlan = cachedStrategyBundle?.plan || null;
  const recentResponses = history.slice(-3).map((item) => ({
    iteration: item.iteration,
    strategy_cycle_id: item.strategy_cycle_id,
    process_iteration_in_cycle: item.process_iteration_in_cycle,
    role_sequence: refreshStrategy ? ['quality-engineer', 'rd-engineer', 'process-engineer'] : ['process-engineer'],
    selected_lever: item.plan?.candidate_parameters?.[0]?.name || null,
    decision: item.experiment_result?.decision || null
  }));
  return {
    dispatch_plan_version: '1.0.0',
    iteration,
    product_grade: target.product_grade,
    strategy_cycle_id: cycleState.strategy_cycle_id,
    process_iteration_in_cycle: cycleState.process_iteration_in_cycle,
    plan_source: cycleState.plan_source,
    replan_reason: cycleState.replan_reason,
    strategy_stage: strategyState?.stage || 'explore',
    team_lead_decision: refreshStrategy
      ? 'refresh quality baseline, ask R&D for strategy, then ask Process to execute bounded proposal'
      : 'keep active R&D strategy and ask Process to run the next bounded micro-tune',
    assigned_roles: refreshStrategy
      ? ['quality-engineer', 'rd-engineer', 'process-engineer']
      : ['process-engineer'],
    role_requests: refreshStrategy
      ? [
          {
            to: 'quality-engineer',
            purpose: 'quality-review',
            requested_actions: ['read stable snapshot', 'diagnose target gaps', 'recommend explore/exploit/recover']
          },
          {
            to: 'rd-engineer',
            purpose: 'rd-strategy',
            requested_actions: ['read quality review', 'rank product-aware levers', 'write active strategy for process']
          },
          {
            to: 'process-engineer',
            purpose: 'process-execution',
            requested_actions: ['read RD plan and quality review', 'write safety-gated proposal', 'preserve rollback baseline']
          }
        ]
      : [
          {
            to: 'process-engineer',
            purpose: 'process-micro-tune',
            requested_actions: ['continue active RD strategy', 'adjust bounded setpoint', 'collect stable after-window evidence']
          }
        ],
    shared_artifacts_to_read: [
      'goal_request.json',
      'product_target.json',
      'team/team_contract.json',
      'campaign_ledger.jsonl',
      '07_coordination/best_recipe_memory.json'
    ],
    active_strategy_digest: activePlan
      ? {
          objective: activePlan.objective,
          hypothesis: activePlan.hypothesis,
          selected_lever: activePlan.candidate_parameters?.[0]?.name || null,
          control_mode: activePlan.control_mode
        }
      : null,
    quality_digest: diagnosis
      ? {
          quality_state: diagnosis.quality_state,
          primary_quality_gap: diagnosis.primary_quality_gap,
          current_loss: diagnosis.current_loss
        }
      : null,
    recent_responses: recentResponses
  };
}

function buildRecoveryEvent({
  iteration,
  reason,
  strategyState,
  bestObserved
}) {
  return {
    type: 'recovery_transition',
    iteration,
    stage: strategyState?.stage || 'recover',
    reason,
    restored_recipe_id: bestObserved?.recipe_id || null,
    restored_experiment_id: bestObserved?.experiment_id || null,
    restored_loss: bestObserved?.loss ?? null,
    next_stage: 'explore',
    timestamp: new Date().toISOString()
  };
}

function materialFamilyFromTarget(target) {
  return String(target?.product_context?.material_family || '').toUpperCase() || 'DEFAULT';
}

function resolveCadenceConfig(config, target) {
  const family = materialFamilyFromTarget(target);
  const productCadence = config.orchestrator.cadence?.products?.[family] || {};
  return {
    quality_deep_review_every: {
      ...config.orchestrator.cadence?.quality_deep_review_every,
      ...productCadence.quality_deep_review_every
    },
    rd_full_replan_every: {
      ...config.orchestrator.cadence?.rd_full_replan_every,
      ...productCadence.rd_full_replan_every
    },
    settle_minutes: {
      ...config.orchestrator.cadence?.settle_minutes,
      ...productCadence.settle_minutes
    },
    before_window_bias_ticks: productCadence.before_window_bias_ticks
      ?? config.orchestrator.cadence?.before_window_bias_ticks
      ?? 0
  };
}

function cadenceEvery(map, stage, fallback = 1) {
  return Math.max(1, Number(map?.[stage] || fallback));
}

function buildCadencePlan({ iteration, stage, target, config }) {
  const cadence = resolveCadenceConfig(config, target);
  const qualityDeepEvery = cadenceEvery(cadence.quality_deep_review_every, stage, 1);
  const rdFullEvery = cadenceEvery(cadence.rd_full_replan_every, stage, 1);
  const settleMinutes = Math.max(1, Number(cadence.settle_minutes?.[stage] || 8));
  const settleTicks = Math.max(1, Math.round(settleMinutes / 2));
  return {
    iteration,
    stage,
    product_grade: target.product_grade,
    material_family: target.product_context?.material_family || null,
    process_settle_minutes: settleMinutes,
    process_settle_ticks: settleTicks,
    before_window_bias_ticks: cadence.before_window_bias_ticks,
    quality_review_mode: iteration % qualityDeepEvery === 0 ? 'deep_review' : 'fast_review',
    quality_review_every: qualityDeepEvery,
    rd_cycle_mode: iteration % rdFullEvery === 0 ? 'full_replan' : 'micro_tune',
    rd_full_replan_every: rdFullEvery,
    orchestration_note:
      stage === 'explore'
        ? '优先保证试验后充分稳定，再进入下一轮研发判断。'
        : stage === 'exploit'
          ? '优先围绕主杠杆微调，并通过质量深检定期确认稳定性。'
          : '恢复阶段延长稳定等待，优先确认回退后质量和设备状态恢复。'
  };
}

async function validateLoadedRecipeHold({
  adapter,
  target,
  previousQuality,
  history,
  strategyState,
  stableWindow,
  requiredWindows
}) {
  const result = {
    required_windows: requiredWindows,
    pass_windows: 0,
    observed_windows: [],
    stable_running_confirmed: false
  };
  let latestSnapshot = null;
  let latestQuality = null;
  let latestDiagnosis = null;

  for (let index = 1; index <= requiredWindows; index += 1) {
    const holdWindow = await adapter.runUntilStable(stableWindow);
    latestSnapshot = holdWindow.snapshot;
    latestQuality = holdWindow.online_quality;
    latestDiagnosis = qualityEngineer({
      snapshot: latestSnapshot,
      quality: latestQuality,
      target,
      previousQuality,
      history,
      strategyState
    });
    result.observed_windows.push({
      index,
      window_id: holdWindow.window_id,
      quality_state: latestDiagnosis.quality_state,
      loss: latestDiagnosis.current_loss,
      metrics: latestQuality.metrics
    });
    if (latestDiagnosis.quality_state !== 'PASS') {
      break;
    }
    result.pass_windows += 1;
  }

  result.stable_running_confirmed = result.pass_windows >= requiredWindows;
  return {
    ...result,
    latest_snapshot: latestSnapshot,
    latest_quality: latestQuality,
    latest_diagnosis: latestDiagnosis
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.stateFile) process.env.SIM_STATE_FILE = path.resolve(args.stateFile);

  const projectRoot = process.cwd();
  const config = loadPlatformConfig({ projectRoot });
  const rawGoalRequest = args.goalRequest
    ? readJson(path.resolve(args.goalRequest))
    : args.goalText
      ? { goal_text: args.goalText }
      : readJson(path.resolve(args.target));
  if (args.productGrade) rawGoalRequest.product_grade = args.productGrade;
  const goalRequest = normalizeGoalRequest({
    goalRequest: rawGoalRequest,
    targetFile: args.target,
    projectRoot
  });
  if (args.reasoningMode) {
    goalRequest.execution.reasoning_mode = args.reasoningMode;
  }
  let target = goalRequestToProductTarget(goalRequest);
  const reasoningMode = goalRequest.execution?.reasoning_mode || config.orchestrator.reasoning_mode || 'deterministic';
  const claudeRoleConfig = config.orchestrator.claude || {};

  const maxIters = args.maxIters || goalRequest.stop_criteria?.hard_iteration_cap || target.constraints.max_iterations || 10;
  const campaignId = `${target.campaign_id}-${uniqueNowId()}`;
  const runDir = path.resolve(args.baseDir, campaignId);
  const runId = path.basename(runDir);
  const taskDir = taskDirFromRunDir(runDir);
  const teamDir = path.join(taskDir, 'team');
  makeDirs(runDir);

  const runtimeDir = config.runtime_dir;
  initializeControlFile(runtimeDir, runId);
  patchControlState(runtimeDir, runId, {
    run_id: runId,
    pause_requested: false,
    rollback_requested: false,
    terminate_requested: false
  });

  writeJson(path.join(runDir, '00_objective', 'orchestrator_goal_request.json'), goalRequest);
  writeJson(path.join(runDir, '00_objective', 'product_target.json'), target);

  const adapter = createLineAdapter({ config, cwd: projectRoot, goalRequest });
  await adapter.start();

  const history = [];
  let previousQuality = null;
  let finalDiagnosis = null;
  let finalQuality = null;
  let finalLoss = Infinity;
  let bestObserved = null;
  let strategyState = null;
  let finalSnapshot = null;
  let finalExecutionState = 'completed';
  let stoppedReason = 'completed';
  const reasoningUsage = [];
  let strategyCycleId = 1;
  let processIterationInCycle = 0;
  let cachedStrategyBundle = null;
  let latestCycleState = null;
  const continuousControl = {
    passHoldWindow: Math.max(2, goalRequest.stop_criteria?.pass_hold_iterations || 2),
    maxConsecutiveWorse: Math.max(
      4,
      config.orchestrator.max_consecutive_worse,
      goalRequest.stop_criteria?.max_consecutive_worse_before_hard_stop || 0
    ),
    maxConsecutiveRejected: Math.max(3, goalRequest.stop_criteria?.max_consecutive_rejected || 3),
    maxStrategyCycles: Math.max(1, Number(goalRequest.stop_criteria?.max_strategy_cycles || config.orchestrator.max_strategy_cycles || 6))
  };

  try {
    await adapter.reset();
    const baselineWindow = await adapter.runUntilStable(config.orchestrator.stable_window.explore.before);
    const targetMaterialization = materializeTargetsFromDirectives({
      goalRequest,
      baselineMetrics: baselineWindow.online_quality.metrics,
      targetTemplate: target
    });
    goalRequest.targets = targetMaterialization.targets;
    goalRequest.goal_interpretation = targetMaterialization.interpretation;
    target = goalRequestToProductTarget(goalRequest);
    writeJson(path.join(runDir, '00_objective', 'orchestrator_goal_request.json'), goalRequest);
    writeJson(path.join(runDir, '00_objective', 'product_target.json'), target);
    writeJson(path.join(runDir, '00_objective', 'goal_interpretation.json'), targetMaterialization);
    initializeBestRecipeMemory(runDir, {
      recipe_id: baselineWindow.snapshot.recipe_id,
      experiment_id: baselineWindow.snapshot.experiment_id,
      setpoints: { ...baselineWindow.snapshot.setpoints },
      metrics: { ...baselineWindow.online_quality.metrics },
      loss: qualityLoss(baselineWindow.online_quality.metrics, target),
      source: 'campaign_reset_baseline'
    });

    for (let iteration = 1; iteration <= maxIters; iteration += 1) {
      const control = await maybeWaitForPause(runtimeDir, runId);
      if (control.terminate_requested) {
        finalExecutionState = 'terminated';
        stoppedReason = 'terminate_requested';
        break;
      }

      const iterId = String(iteration).padStart(3, '0');
      const trialEvidenceDir = buildTrialEvidenceDir(runDir, iteration);
      fs.mkdirSync(trialEvidenceDir, { recursive: true });
      const stageForWindow = strategyState?.stage || 'explore';
      const cadencePlan = buildCadencePlan({
        iteration,
        stage: stageForWindow,
        target,
        config
      });
      const processIterationsPerCycle = getProcessIterationsPerCycle(config, stageForWindow);
      const noProgressReplanThreshold = getNoProgressReplanThreshold(config, stageForWindow);
      const mustReplanForCycleStart = !cachedStrategyBundle;
      const reachedCycleProcessLimit = processIterationInCycle >= processIterationsPerCycle;
      const cycleConsecutiveIneffective = consecutiveDecisionCountWithinCycle(history, 'ineffective', strategyCycleId);
      const cycleConsecutiveRejected = consecutiveDecisionCountWithinCycle(history, 'rejected', strategyCycleId);
      const cycleConsecutiveWorse = consecutiveDecisionCountWithinCycle(history, 'worse', strategyCycleId);
      const cycleNoProgressCount = countRecentDecisionsWithinCycle(history, {
        strategyCycleId,
        decisions: ['ineffective', 'rejected', 'worse']
      });
      const mustReplanByNoProgress = cycleNoProgressCount >= noProgressReplanThreshold;
      const mustReplan = mustReplanForCycleStart
        || reachedCycleProcessLimit
        || mustReplanByNoProgress
        || cycleConsecutiveRejected >= continuousControl.maxConsecutiveRejected
        || cycleConsecutiveWorse >= continuousControl.maxConsecutiveWorse;
      if (mustReplan && !mustReplanForCycleStart) {
        strategyCycleId += 1;
        processIterationInCycle = 0;
        cachedStrategyBundle = null;
      }
      if (strategyCycleId > continuousControl.maxStrategyCycles) {
        stoppedReason = 'max_strategy_cycles_reached';
        break;
      }
      const cycleState = {
        strategy_cycle_id: strategyCycleId,
        process_iteration_in_cycle: processIterationInCycle + 1,
        max_process_iterations_in_cycle: processIterationsPerCycle,
        plan_source: mustReplan ? 'replanned' : 'carry_forward',
        replan_reason: mustReplanForCycleStart
          ? 'initial_cycle_plan'
          : reachedCycleProcessLimit
            ? 'process_cycle_limit_reached'
            : mustReplanByNoProgress
              ? 'no_progress_replan'
              : cycleConsecutiveRejected >= continuousControl.maxConsecutiveRejected
                ? 'repeated_rejection_replan'
                : cycleConsecutiveWorse >= continuousControl.maxConsecutiveWorse
                  ? 'repeated_worse_replan'
                  : 'carry_forward_strategy',
        cycle_consecutive_ineffective: cycleConsecutiveIneffective,
        cycle_consecutive_rejected: cycleConsecutiveRejected,
        cycle_consecutive_worse: cycleConsecutiveWorse,
        cycle_no_progress_count: cycleNoProgressCount
      };
      latestCycleState = cycleState;
      if (cadencePlan.before_window_bias_ticks > 0) {
        await adapter.runUntilStable({
          minStableTicks: cadencePlan.before_window_bias_ticks,
          maxTicks: cadencePlan.before_window_bias_ticks + 4
        });
      }
      const beforeWindow = await adapter.runUntilStable(config.orchestrator.stable_window[stageForWindow].before);
      const snapshot = beforeWindow.snapshot;
      const quality = beforeWindow.online_quality;
      let diagnosis;
      let diagnosisResult = null;
      let qualityReview;
      const currentLoss = qualityLoss(quality.metrics, target);
      const shouldRebuildStrategy = !cachedStrategyBundle || cycleState.plan_source === 'replanned';
      if (shouldRebuildStrategy) {
        try {
          diagnosisResult = await executeQualityRole({
            mode: reasoningMode,
            config: claudeRoleConfig,
            projectRoot,
            trialEvidenceDir,
            input: {
              snapshot,
              quality,
              target,
              previousQuality,
              history,
              strategyState,
              cadencePlan
            }
          });
        } catch (error) {
          diagnosisResult = {
            result: qualityEngineer({
              snapshot,
              quality,
              target,
              previousQuality,
              history,
              strategyState,
              cadencePlan
            }),
            baseline: null,
            reasoning: {
              mode: 'deterministic_fallback',
              role: 'quality',
              error: error.message
            }
          };
          writeJson(path.join(trialEvidenceDir, 'claude_quality_reasoning_error.json'), {
            error: error.message,
            fallback: diagnosisResult.result
          });
        }
        diagnosis = diagnosisResult.result;
        reasoningUsage.push({
          iteration,
          role: 'quality',
          ...diagnosisResult.reasoning
        });
        strategyState = buildStrategyStateFromDiagnosis({
          iteration,
          previousState: strategyState,
          diagnosis,
          history,
          config
        });
        qualityReview = buildQualityReviewReport({
          snapshot,
          target,
          quality,
          diagnosis,
          history,
          iteration,
          strategyState,
          cadencePlan,
          cycleState
        });
      } else {
        diagnosis = cachedStrategyBundle.diagnosis;
        qualityReview = buildQualityReviewReport({
          snapshot,
          target,
          quality,
          diagnosis,
          history,
          iteration,
          strategyState,
          cadencePlan,
          cycleState
        });
      }

      if (!bestObserved || currentLoss < bestObserved.loss) {
        bestObserved = {
          loss: currentLoss,
          recipe_id: snapshot.recipe_id,
          setpoints: { ...snapshot.setpoints },
          metrics: { ...quality.metrics },
          experiment_id: snapshot.experiment_id
        };
        updateBestRecipeMemory(runDir, (current) => ({
          ...current,
          active_baseline_recipe_id: bestObserved.recipe_id,
          active_baseline_source: 'best_observed_snapshot',
          best_observed_recipe: bestObserved,
          best_history: [...(current.best_history || []), bestObserved]
        }));
      }

      finalDiagnosis = diagnosis;
      finalQuality = quality;
      finalLoss = diagnosis.current_loss;

      const snapshotPath = path.join(runDir, '01_snapshots', `process_snapshot_${iterId}.json`);
      const qualityPath = path.join(runDir, '01_snapshots', `online_quality_${iterId}.json`);
      const diagnosisPath = path.join(runDir, '02_quality', `quality_diagnosis_${iterId}.json`);
      const qualityReviewPath = path.join(runDir, '07_coordination', `quality_review_${iterId}.json`);
      const strategyPath = path.join(runDir, '07_coordination', `strategy_state_${iterId}.json`);
      const cadencePath = path.join(runDir, '07_coordination', `cadence_plan_${iterId}.json`);
      const dispatchPlanPath = path.join(runDir, '07_coordination', `team_dispatch_plan_${iterId}.json`);
      const dispatchPlan = buildTeamDispatchPlan({
        iteration,
        cycleState,
        strategyState,
        diagnosis,
        cachedStrategyBundle,
        target,
        history
      });

      writeJson(snapshotPath, snapshot);
      writeJson(qualityPath, quality);
      writeJson(diagnosisPath, diagnosis);
      writeJson(qualityReviewPath, qualityReview);
      writeJson(strategyPath, strategyState);
      writeJson(cadencePath, cadencePlan);
      writeJson(dispatchPlanPath, dispatchPlan);
      writeJson(path.join(trialEvidenceDir, '01_before_window.json'), beforeWindow);
      writeJson(path.join(trialEvidenceDir, '02_snapshot.json'), snapshot);
      writeJson(path.join(trialEvidenceDir, '03_quality.json'), quality);
      writeJson(path.join(trialEvidenceDir, '04_diagnosis.json'), diagnosis);
      writeJson(path.join(trialEvidenceDir, '05_strategy_state.json'), strategyState);
      writeJson(path.join(trialEvidenceDir, '05b_cadence_plan.json'), cadencePlan);
      writeJson(path.join(trialEvidenceDir, '05c_cycle_state.json'), cycleState);
      writeJson(path.join(trialEvidenceDir, '05d_team_dispatch_plan.json'), dispatchPlan);
      writeJson(path.join(teamDir, 'team_state.json'), {
        task_id: path.basename(taskDir),
        current_iteration: iteration,
        strategy_cycle_id: cycleState.strategy_cycle_id,
        process_iteration_in_cycle: cycleState.process_iteration_in_cycle,
        current_stage: strategyState.stage,
        cadence_plan: cadencePlan,
        plan_source: cycleState.plan_source,
        replan_reason: cycleState.replan_reason,
        last_quality_state: diagnosis.quality_state,
        updated_at: new Date().toISOString()
      });
      postRoleMessage({
        taskWorkspace: {
          teamDir
        },
        role: 'quality-engineer',
        messageName: `quality_diagnosis_${iterId}`,
        payload: {
          stage: strategyState.stage,
          purpose: 'quality-diagnosis',
          summary: `quality_state=${diagnosis.quality_state}, primary_gap=${diagnosis.primary_quality_gap}`,
          inputs: [path.relative(runDir, dispatchPlanPath), path.relative(runDir, snapshotPath), path.relative(runDir, qualityPath), path.relative(runDir, diagnosisPath)],
          outputs: [path.relative(runDir, qualityReviewPath), path.relative(runDir, strategyPath)],
          risks: diagnosis.blocking_issues || [],
          next_action: diagnosis.strategy_recommendation?.next_stage || 'explore',
          artifact_refs: [path.relative(runDir, dispatchPlanPath), path.relative(runDir, snapshotPath), path.relative(runDir, qualityPath), path.relative(runDir, diagnosisPath)],
          requestedActions: dispatchPlan.role_requests.find((item) => item.to === 'quality-engineer')?.requested_actions || [],
          snapshot_path: path.relative(runDir, snapshotPath),
          quality_path: path.relative(runDir, qualityPath),
          diagnosis_path: path.relative(runDir, diagnosisPath),
          cadence_plan_path: path.relative(runDir, cadencePath),
          dispatch_plan_path: path.relative(runDir, dispatchPlanPath),
          cycle_state: cycleState,
          stage_recommendation: diagnosis.strategy_recommendation,
          summary: qualityReview
        }
      });
      writeJson(path.join(taskDir, 'team', 'team_state.json'), {
        task_id: path.basename(taskDir),
        current_iteration: iteration,
        strategy_cycle_id: cycleState.strategy_cycle_id,
        process_iteration_in_cycle: cycleState.process_iteration_in_cycle,
        current_stage: strategyState.stage,
        cadence_plan: cadencePlan,
        plan_source: cycleState.plan_source,
        replan_reason: cycleState.replan_reason,
        last_quality_state: diagnosis.quality_state,
        updated_at: new Date().toISOString()
      });
      appendJsonl(path.join(runDir, 'campaign_ledger.jsonl'), {
        type: 'quality_diagnosis',
        iteration,
        strategy_cycle_id: cycleState.strategy_cycle_id,
        process_iteration_in_cycle: cycleState.process_iteration_in_cycle,
        stage: strategyState.stage,
        cycle_state: cycleState,
        diagnosis
      });

      const passHoldCountBeforeExecution = history.length > 0
        ? countRecentPassWindows(history, continuousControl.passHoldWindow)
        : 0;
      if (diagnosis.quality_state === 'PASS' && passHoldCountBeforeExecution + 1 >= continuousControl.passHoldWindow) {
        stoppedReason = 'goal_pass_hold_confirmed';
        finalDiagnosis = diagnosis;
        finalQuality = quality;
        finalLoss = diagnosis.current_loss;
        break;
      }
      const passNeedsValidation = diagnosis.quality_state === 'PASS'
        && passHoldCountBeforeExecution + 1 < continuousControl.passHoldWindow;

      let planResult = null;
      let plan;
      let rdBrief;
      if (shouldRebuildStrategy) {
        try {
          planResult = await executeRDRole({
            mode: reasoningMode,
            config: claudeRoleConfig,
            projectRoot,
            trialEvidenceDir,
            input: {
              diagnosis,
              snapshot,
              quality,
              target,
              history,
              strategyState,
              cadencePlan
            }
          });
        } catch (error) {
          planResult = {
            result: rdEngineer({
              diagnosis,
              snapshot,
              quality,
              target,
              history,
              strategyState,
              cadencePlan
            }),
            baseline: null,
            reasoning: {
              mode: 'deterministic_fallback',
              role: 'rd',
              error: error.message
            }
          };
          writeJson(path.join(trialEvidenceDir, 'claude_rd_reasoning_error.json'), {
            error: error.message,
            fallback: planResult.result
          });
        }
        plan = planResult.result;
      } else {
        plan = JSON.parse(JSON.stringify(cachedStrategyBundle.plan));
      }
      if (passNeedsValidation && plan?.candidate_parameters?.[0]) {
        plan.objective = 'validate_best_recipe_stability';
        plan.hypothesis = 'Current recipe appears to satisfy the target and now needs repeated stable-window confirmation.';
        plan.control_mode = 'exploit';
        plan.candidate_parameters[0] = {
          ...plan.candidate_parameters[0],
          direction: 'hold',
          step: 0,
          signed_step: 0,
          expected_response: 'hold_quality_and_validate_repeatability',
          rationale: '目标已达到但尚未完成连续稳定窗口验证，本轮保持最佳 recipe 进行确认。'
        };
        plan.success_criteria = [...new Set([...(plan.success_criteria || []), 'stable_pass_window_confirmed'])];
        plan.plan_rationale = {
          ...(plan.plan_rationale || {}),
          validation_mode: true,
          validation_progress: `${passHoldCountBeforeExecution + 1}/${continuousControl.passHoldWindow}`,
          mode_reason: 'quality_pass_requires_multi_window_confirmation'
        };
        plan.review_focus = [...new Set([...(plan.review_focus || []), 'repeatability', 'stability_validation'])];
      }
      if (planResult) {
        reasoningUsage.push({
          iteration,
          role: 'rd',
          ...planResult.reasoning
        });
      }
      rdBrief = buildRDAgentBrief({
        target,
        diagnosis,
        history,
        iteration,
        strategyState,
        cadencePlan,
        cycleState
      });
      let proposalResult;
      try {
        proposalResult = await executeProcessRole({
          mode: reasoningMode,
          config: claudeRoleConfig,
          projectRoot,
          trialEvidenceDir,
        input: {
          campaignId,
          iteration,
          plan,
          snapshot,
          strategyState,
          rollbackRecipeId: readBestRecipeMemory(runDir).active_baseline_recipe_id,
          cadencePlan
        }
      });
      } catch (error) {
        proposalResult = {
          result: processEngineer({
            campaignId,
            iteration,
            plan,
            snapshot,
            strategyState,
            rollbackRecipeId: readBestRecipeMemory(runDir).active_baseline_recipe_id,
            cadencePlan
          }),
          baseline: null,
          reasoning: {
            mode: 'deterministic_fallback',
            role: 'process',
            error: error.message
          }
        };
        writeJson(path.join(trialEvidenceDir, 'claude_process_reasoning_error.json'), {
          error: error.message,
          fallback: proposalResult.result
        });
      }
      const proposal = proposalResult.result;
      reasoningUsage.push({
        iteration,
        role: 'process',
        ...proposalResult.reasoning
      });
      const processBrief = buildProcessAgentBrief({
        target,
        plan,
        diagnosis,
        iteration,
        strategyState,
        approvalRequired: true,
        cadencePlan,
        cycleState
      });
      cachedStrategyBundle = {
        diagnosis,
        plan,
        rdBrief
      };
      const gate = await adapter.checkSafetyGate(proposal);
      const approvalDecision = await adapter.requestApproval({ proposal, safetyGate: gate, strategyState });
      const approvalPacket = buildApprovalPacket({
        target,
        proposal,
        safetyGate: gate,
        strategyState,
        config,
        approvalDecision,
        iteration
      });

      const planPath = path.join(runDir, '03_rd_plan', `rd_optimization_plan_${iterId}.json`);
      const rdBriefPath = path.join(runDir, '07_coordination', `rd_brief_${iterId}.json`);
      const proposalPath = path.join(runDir, '04_execution', `parameter_delta_proposal_${iterId}.json`);
      const gatePath = path.join(runDir, '04_execution', `safety_gate_result_${iterId}.json`);
      const processBriefPath = path.join(runDir, '07_coordination', `process_brief_${iterId}.json`);
      const approvalPath = path.join(runDir, '07_coordination', `approval_packet_${iterId}.json`);
      const receiptPath = path.join(runDir, '04_execution', `execution_receipt_${iterId}.json`);
      const resultPath = path.join(runDir, '05_results', `experiment_result_${iterId}.json`);
      const executiveSummaryPath = path.join(runDir, '07_coordination', `executive_summary_${iterId}.md`);

      writeJson(planPath, plan);
      writeJson(rdBriefPath, rdBrief);
      writeJson(proposalPath, proposal);
      writeJson(gatePath, gate);
      writeJson(processBriefPath, processBrief);
      writeJson(approvalPath, approvalPacket);
      writeJson(path.join(trialEvidenceDir, '06_rd_plan.json'), plan);
      writeJson(path.join(trialEvidenceDir, '07_rd_brief.json'), rdBrief);
      writeJson(path.join(trialEvidenceDir, '08_proposal.json'), proposal);
      writeJson(path.join(trialEvidenceDir, '09_safety_gate.json'), gate);
      writeJson(path.join(trialEvidenceDir, '10_process_brief.json'), processBrief);
      writeJson(path.join(trialEvidenceDir, '11_approval_packet.json'), approvalPacket);
      postRoleMessage({
        taskWorkspace: {
          teamDir
        },
        role: 'rd-engineer',
        messageName: `rd_plan_${iterId}`,
        payload: {
          stage: strategyState.stage,
          purpose: 'rd-plan',
          summary: `selected_lever=${plan.candidate_parameters?.[0]?.name || 'none'}`,
          inputs: [path.relative(runDir, dispatchPlanPath), path.relative(runDir, diagnosisPath), path.relative(runDir, planPath), path.relative(runDir, rdBriefPath)],
          outputs: [path.relative(runDir, proposalPath), path.relative(runDir, gatePath)],
          risks: plan.stop_rules || [],
          next_action: 'hand off to process engineer for safety-gated proposal',
          artifact_refs: [path.relative(runDir, dispatchPlanPath), path.relative(runDir, diagnosisPath), path.relative(runDir, planPath), path.relative(runDir, rdBriefPath)],
          requestedActions: dispatchPlan.role_requests.find((item) => item.to === 'rd-engineer')?.requested_actions || [],
          diagnosis_path: path.relative(runDir, diagnosisPath),
          plan_path: path.relative(runDir, planPath),
          rd_brief_path: path.relative(runDir, rdBriefPath),
          cadence_plan_path: path.relative(runDir, cadencePath),
          dispatch_plan_path: path.relative(runDir, dispatchPlanPath),
          cycle_state: cycleState,
          next_stage: strategyState.stage,
          summary: rdBrief
        }
      });
      let effectiveApproval = approvalPacket;
      if (approvalPacket.approval_status === 'pending') {
        effectiveApproval = await waitForApprovalDecision({
          approvalFile: approvalPath,
          pollMs: config.orchestrator.approval_poll_ms,
          timeoutMs: config.orchestrator.max_approval_wait_ms,
          onTick: async () => {
            const latestControl = readControlState(runtimeDir, runId);
            if (latestControl.terminate_requested) throw new Error('termination_requested_during_approval');
          }
        });
        writeJson(approvalPath, effectiveApproval);
        writeJson(path.join(trialEvidenceDir, '12_approval_packet_effective.json'), effectiveApproval);
      }

      let receipt = { executed: false, write_confirmed: false, safety_gate_result: gate };
      if (gate.allowed && effectiveApproval.approval_status === 'approved') {
        receipt = await adapter.applyApprovedProposal(proposal);
      } else if (!gate.allowed) {
        receipt = {
          executed: false,
          write_confirmed: false,
          safety_gate_result: gate,
          message: 'safety gate rejected proposal'
        };
      } else {
        receipt = {
          executed: false,
          write_confirmed: false,
          safety_gate_result: gate,
          message: `approval_status:${effectiveApproval.approval_status}`
        };
      }

      writeJson(receiptPath, receipt);
      writeJson(path.join(trialEvidenceDir, '13_execution_receipt.json'), receipt);
      postRoleMessage({
        taskWorkspace: {
          teamDir
        },
        role: 'process-engineer',
        messageName: `process_brief_${iterId}`,
        payload: {
          stage: strategyState.stage,
          purpose: 'process-brief',
          summary: `approval_status=${approvalPacket.approval_status}`,
          inputs: [path.relative(runDir, dispatchPlanPath), path.relative(runDir, planPath), path.relative(runDir, proposalPath), path.relative(runDir, gatePath), path.relative(runDir, approvalPath)],
          outputs: [path.relative(runDir, receiptPath), path.relative(runDir, resultPath)],
          risks: approvalPacket.guardrails?.stop_rules || [],
          next_action: receipt.executed ? 'collect after-window quality' : 'await approval or revise proposal',
          artifact_refs: [path.relative(runDir, dispatchPlanPath), path.relative(runDir, planPath), path.relative(runDir, proposalPath), path.relative(runDir, gatePath), path.relative(runDir, approvalPath)],
          requestedActions: dispatchPlan.role_requests.find((item) => item.to === 'process-engineer')?.requested_actions || [],
          plan_path: path.relative(runDir, planPath),
          proposal_path: path.relative(runDir, proposalPath),
          safety_gate_path: path.relative(runDir, gatePath),
          approval_packet_path: path.relative(runDir, approvalPath),
          cadence_plan_path: path.relative(runDir, cadencePath),
          dispatch_plan_path: path.relative(runDir, dispatchPlanPath),
          cycle_state: cycleState,
          receipt_path: path.relative(runDir, receiptPath),
          summary: processBrief
        }
      });

      let experimentResult = {
        campaign_id: campaignId,
        experiment_id: proposal.experiment_id,
        executed: false,
        write_confirmed: false,
        decision: receipt.message?.startsWith('approval_status:') ? 'rejected' : 'rejected'
      };
      let postExecutionQualityState = diagnosis.quality_state;

      if (receipt.executed) {
        if (cadencePlan.process_settle_ticks > 0) {
          await adapter.runUntilStable({
            minStableTicks: cadencePlan.process_settle_ticks,
            maxTicks: Math.max(
              cadencePlan.process_settle_ticks + 6,
              cadencePlan.process_settle_ticks * 2
            )
          });
        }
        const afterWindow = await adapter.runUntilStable(config.orchestrator.stable_window[strategyState.stage].after);
        const afterQuality = afterWindow.online_quality;
        const compactState = await adapter.readCompactState();
        writeJson(path.join(trialEvidenceDir, '14_after_window.json'), afterWindow);
        writeJson(path.join(trialEvidenceDir, '15_after_quality.json'), afterQuality);
        writeJson(path.join(trialEvidenceDir, '16_compact_state.json'), compactState);
        experimentResult = summarizeExperiment({
          campaignId,
          experimentId: proposal.experiment_id,
          before: {
            windowId: beforeWindow.window_id,
            metrics: quality.metrics,
            loss: qualityLoss(quality.metrics, target)
          },
          after: {
            windowId: afterWindow.window_id,
            metrics: afterQuality.metrics,
            loss: qualityLoss(afterQuality.metrics, target),
            wasteMeter: compactState.waste_meter
          },
          receipt,
          strategyState
        });
        previousQuality = quality;
        finalQuality = afterQuality;
        finalLoss = qualityLoss(afterQuality.metrics, target);
        postExecutionQualityState = qualityEngineer({
          snapshot: afterWindow.snapshot,
          quality: afterQuality,
          target,
          previousQuality: quality,
          history,
          strategyState
        }).quality_state;

        if (!bestObserved || finalLoss < bestObserved.loss) {
          bestObserved = {
            loss: finalLoss,
            recipe_id: afterWindow.snapshot.recipe_id,
            setpoints: { ...afterWindow.snapshot.setpoints },
            metrics: { ...afterQuality.metrics },
            experiment_id: proposal.experiment_id
          };
          updateBestRecipeMemory(runDir, (current) => ({
            ...current,
            active_baseline_recipe_id: bestObserved.recipe_id,
            active_baseline_source: 'post_experiment_best_observed',
            best_observed_recipe: bestObserved,
            best_history: [...(current.best_history || []), bestObserved]
          }));
          await adapter.loadRecipeBaseline({
            recipeId: bestObserved.recipe_id,
            setpoints: bestObserved.setpoints,
            reason: 'sync best observed recipe as rollback baseline'
          });
        }
      }

      writeJson(resultPath, experimentResult);
      writeJson(path.join(trialEvidenceDir, '17_experiment_result.json'), experimentResult);
      postRoleMessage({
        taskWorkspace: {
          teamDir
        },
        role: 'quality-engineer',
        messageName: `experiment_result_${iterId}`,
        payload: {
          stage: strategyState.stage,
          purpose: 'quality-feedback',
          summary: `decision=${experimentResult.decision}`,
          inputs: [path.relative(runDir, receiptPath), path.relative(runDir, resultPath)],
          outputs: [path.relative(runDir, executiveSummaryPath)],
          risks: experimentResult.decision === 'worse' ? ['worsening_response'] : [],
          next_action: experimentResult.decision === 'effective' ? 'keep_learning_same_direction' : 're-evaluate lever',
          artifact_refs: [path.relative(runDir, receiptPath), path.relative(runDir, resultPath)],
          cycle_state: cycleState,
          result_path: path.relative(runDir, resultPath),
          experiment_result: experimentResult
        }
      });

      writeText(executiveSummaryPath, buildExecutiveSummary({
        target,
        strategyState,
        diagnosis,
        plan,
        approvalPacket: effectiveApproval,
        cycleState,
        experimentResult
      }));
      writeText(path.join(trialEvidenceDir, '18_executive_summary.md'), buildExecutiveSummary({
        target,
        strategyState,
        diagnosis,
        plan,
        approvalPacket: effectiveApproval,
        cycleState,
        experimentResult
      }));

      const coordinationIndex = buildCoordinationIndex({
        iteration,
        experimentId: proposal.experiment_id,
        artifactPaths: {
          snapshot: path.relative(runDir, snapshotPath),
          quality: path.relative(runDir, qualityPath),
          diagnosis: path.relative(runDir, diagnosisPath),
          quality_review: path.relative(runDir, qualityReviewPath),
          strategy_state: path.relative(runDir, strategyPath),
          cadence_plan: path.relative(runDir, cadencePath),
          team_dispatch_plan: path.relative(runDir, dispatchPlanPath),
          rd_plan: path.relative(runDir, planPath),
          rd_brief: path.relative(runDir, rdBriefPath),
          process_brief: path.relative(runDir, processBriefPath),
          proposal: path.relative(runDir, proposalPath),
          safety_gate: path.relative(runDir, gatePath),
          approval_packet: path.relative(runDir, approvalPath),
          execution_receipt: path.relative(runDir, receiptPath),
          experiment_result: path.relative(runDir, resultPath),
          executive_summary: path.relative(runDir, executiveSummaryPath)
        }
      });
      writeJson(path.join(runDir, '07_coordination', 'coordination_index.json'), coordinationIndex);
      writeJson(path.join(trialEvidenceDir, '19_coordination_index.json'), coordinationIndex);

      appendJsonl(path.join(runDir, 'campaign_ledger.jsonl'), {
        type: 'iteration_complete',
        iteration,
        strategy_cycle_id: cycleState.strategy_cycle_id,
        process_iteration_in_cycle: cycleState.process_iteration_in_cycle,
        stage: strategyState.stage,
        cadence_plan: cadencePlan,
        cycle_state: cycleState,
        quality_review: qualityReview,
        rd_brief: rdBrief,
        plan,
        process_brief: processBrief,
        proposal,
        gate,
        approval_packet: effectiveApproval,
        experiment_result: experimentResult
      });

      history.push({
        iteration,
        strategy_cycle_id: cycleState.strategy_cycle_id,
        process_iteration_in_cycle: cycleState.process_iteration_in_cycle,
        stage: strategyState.stage,
        plan,
        proposal,
        gate,
        approval_packet: effectiveApproval,
        experiment_result: experimentResult,
        cadence_plan: cadencePlan,
        cycle_state: cycleState,
        pre_quality_state: diagnosis.quality_state,
        post_quality_state: postExecutionQualityState,
        evidence_dir: path.relative(runDir, trialEvidenceDir)
      });
      processIterationInCycle = cycleState.process_iteration_in_cycle;

      const consecutiveWorse = currentConsecutiveDecisionCount(history, 'worse');
      const consecutiveRejected = currentConsecutiveDecisionCount(history, 'rejected');
      const passHoldCount = countRecentPassWindows(history, continuousControl.passHoldWindow);

      if (passHoldCount >= continuousControl.passHoldWindow) {
        stoppedReason = 'goal_pass_hold_confirmed';
        break;
      }

      const shouldRollback = readControlState(runtimeDir, runId).rollback_requested
        || strategyState.stage === 'recover'
        || consecutiveWorse >= continuousControl.maxConsecutiveWorse;
      if (shouldRollback) {
        const recoveryEvent = buildRecoveryEvent({
          iteration,
          reason: readControlState(runtimeDir, runId).rollback_requested
            ? 'manual_rollback_requested'
            : strategyState.stage === 'recover'
              ? 'strategy_requested_recover'
              : 'consecutive_worse_ceiling_reached',
          strategyState,
          bestObserved
        });
        appendJsonl(path.join(runDir, 'campaign_ledger.jsonl'), recoveryEvent);
        writeJson(path.join(trialEvidenceDir, '20_recovery_transition.json'), recoveryEvent);
        if (bestObserved) {
          await adapter.loadRecipeBaseline({
            recipeId: bestObserved.recipe_id,
            setpoints: bestObserved.setpoints,
            reason: strategyState.stage === 'recover'
              ? 'recover_pivot_back_to_best_observed'
              : 'rollback_to_best_observed'
          });
          if (strategyState.stage === 'recover') {
            await adapter.rollbackToRecipe('recover_to_best_observed_recipe');
          }
        }
        patchControlState(runtimeDir, runId, { rollback_requested: false });
        // 在持续优化模式下，recover 与 worsening ceiling 都优先回到 best recipe 后继续探索，
        // 只有显式终止、最大迭代上限、或持续审批/写入失败等硬条件才停止。
        if (strategyState.stage === 'recover' || consecutiveWorse >= continuousControl.maxConsecutiveWorse) {
          strategyState = buildStrategyState({
            iteration: iteration + 1, // bump so the next round starts fresh
            previousState: strategyState,
            diagnosis: { ...finalDiagnosis, quality_state: 'WARNING', strategy_recommendation: { next_stage: 'explore', reason: 'recover_complete_resume_exploration', trigger: 'default' } },
            history,
            config
          });
          continue; // don't stop — try a different lever
        }
      }

      if (consecutiveRejected >= continuousControl.maxConsecutiveRejected) {
        if (strategyCycleId >= continuousControl.maxStrategyCycles) {
          stoppedReason = 'execution_blocked_by_repeated_rejection';
          finalExecutionState = 'blocked';
          break;
        }
        cachedStrategyBundle = null;
        processIterationInCycle = 0;
        strategyCycleId += 1;
        continue;
      }
    }

    if (stoppedReason === 'completed' && history.length >= maxIters) {
      stoppedReason = 'max_iterations_reached';
    }

    finalSnapshot = await adapter.readSnapshot();
    finalQuality = await adapter.readOnlineQuality();
    finalDiagnosis = qualityEngineer({
      snapshot: finalSnapshot,
      quality: finalQuality,
      target,
      previousQuality,
      history,
      strategyState
    });
    finalLoss = finalDiagnosis.current_loss;

    let passHoldConfirmed = stoppedReason === 'goal_pass_hold_confirmed'
      || countRecentPassWindows(history, continuousControl.passHoldWindow) >= continuousControl.passHoldWindow;
    const bestObservedGoalReachedCandidate = Number.isFinite(bestObserved?.loss) && bestObserved.loss === 0;

    const recommendation = recipeRecommendation({
      simulator: {
        recipeId: finalSnapshot.recipe_id,
        saveCandidateRecipe: async ({ recipeId, metadata }) => adapter.saveCandidateRecipe({ recipeId, metadata })
      },
      target,
      finalQuality,
      finalLoss,
      bestObserved
    });
    if (recommendation.candidate_recipe_id) {
      await adapter.saveCandidateRecipe({
        recipeId: recommendation.candidate_recipe_id,
        metadata: {
          finalLoss,
          bestObservedLoss: bestObserved?.loss ?? null,
          release_status: recommendation.release_status
        }
      });
      if (bestObserved?.setpoints) {
        await adapter.loadRecipeBaseline({
          recipeId: recommendation.candidate_recipe_id,
          setpoints: bestObserved.setpoints,
          reason: 'final_recommendation_baseline_sync'
        });
        const holdValidation = await validateLoadedRecipeHold({
          adapter,
          target,
          previousQuality,
          history,
          strategyState,
          stableWindow: config.orchestrator.stable_window.exploit.after,
          requiredWindows: bestObservedGoalReachedCandidate ? continuousControl.passHoldWindow : 1
        });
        if (holdValidation.latest_snapshot) finalSnapshot = holdValidation.latest_snapshot;
        if (holdValidation.latest_quality) finalQuality = holdValidation.latest_quality;
        if (holdValidation.latest_diagnosis) finalDiagnosis = holdValidation.latest_diagnosis;
        if (holdValidation.latest_diagnosis) finalLoss = holdValidation.latest_diagnosis.current_loss;
        if (bestObservedGoalReachedCandidate) {
          passHoldConfirmed = holdValidation.stable_running_confirmed;
        }
        writeJson(path.join(runDir, '06_recipe', 'final_recipe_hold_validation.json'), holdValidation);
      }
    }
    writeJson(path.join(runDir, '06_recipe', 'recipe_release_recommendation.json'), recommendation);

    const stabilizedSnapshot = finalSnapshot || await adapter.readSnapshot();
    const compactState = await adapter.readCompactState();
    const bestObservedGoalReached = Number.isFinite(bestObserved?.loss) && bestObserved.loss === 0;
    const goalReached = finalDiagnosis.quality_state === 'PASS' || bestObservedGoalReached;
    const finalQualityState = finalDiagnosis.quality_state === 'PASS'
      ? 'PASS'
      : bestObservedGoalReached
        ? 'PASS_BEST_OBSERVED'
        : finalDiagnosis.quality_state;
    const stabilityCheck = {
      recipe_id: recommendation.candidate_recipe_id,
      product_grade: target.product_grade,
      material_family: target.product_context?.material_family || null,
      source_recipe_id: bestObserved?.recipe_id || stabilizedSnapshot.recipe_id,
      stable: stabilizedSnapshot.line_state === 'STABLE' && !stabilizedSnapshot.alarm_active,
      hold_window: config.orchestrator.stable_window.exploit.after,
      final_quality_state: finalQualityState,
      final_loss: finalLoss,
      goal_reached: goalReached,
      pass_hold_confirmed: passHoldConfirmed,
      setpoints: stabilizedSnapshot.setpoints,
      metrics: finalQuality.metrics,
      checked_at: new Date().toISOString(),
      production_use_policy: goalReached
        ? 'shadow_validation_required_before_full_release'
        : 'continue_optimization_before_release'
    };
    writeJson(path.join(runDir, '06_recipe', 'final_recipe_stability_check.json'), stabilityCheck);

    writeText(path.join(runDir, '07_coordination', 'executive_summary.md'), buildExecutiveSummary({
      target,
      strategyState,
      diagnosis: finalDiagnosis,
      plan: history.at(-1)?.plan || null,
      approvalPacket: history.at(-1)?.approval_packet || null,
      experimentResult: history.at(-1)?.experiment_result || null,
      final: true
    }));

      const summary = {
      campaign_id: campaignId,
      run_id: runId,
      run_dir: runDir,
      iterations: history.length,
      strategy_cycles_completed: strategyCycleId,
      goal_text: goalRequest.goal_text,
      product_grade: target.product_grade,
      product_context: target.product_context || null,
      goal_interpretation: goalRequest.goal_interpretation || [],
      goal_reached: goalReached,
      pass_hold_confirmed: passHoldConfirmed,
      final_quality_state: finalQualityState,
      final_loss: finalLoss,
      final_strategy_stage: strategyState?.stage || 'explore',
      final_execution_state: finalExecutionState,
      stopped_reason: stoppedReason,
      final_metrics: finalQuality.metrics,
      final_setpoints: stabilizedSnapshot.setpoints,
      best_observed: bestObserved,
      best_observed_goal_reached: bestObservedGoalReached,
      best_recipe_memory_file: '07_coordination/best_recipe_memory.json',
      final_recipe_stability_check: '06_recipe/final_recipe_stability_check.json',
      evidence_root: '08_trial_evidence',
      approval_mode: config.orchestrator.execution_mode,
      reasoning_mode: reasoningMode,
      reasoning_usage: reasoningUsage,
      recommendation
    };
    writeJson(path.join(runDir, 'run_summary.json'), summary);

    writeJson(path.join(runDir, 'simulator_state.json'), compactState);
    writeJson(path.join(runDir, 'final_snapshot.json'), stabilizedSnapshot);
    buildReport({ runDir, target, summary, recommendation });
    postRoleMessage({
      taskWorkspace: {
        teamDir
      },
      role: 'team-lead',
      messageName: 'campaign_complete',
      payload: {
        stage: strategyState?.stage || 'complete',
        purpose: 'campaign-complete',
        summary: `goal_reached=${summary.goal_reached}, final_state=${summary.final_quality_state}`,
        inputs: [path.join('campaigns', path.basename(runDir), 'run_summary.json')],
        outputs: ['task_summary.json', 'best_recipe.json', 'outputs/final_recipe.json'],
        risks: summary.goal_reached ? [] : ['goal_not_fully_reached'],
        next_action: summary.goal_reached ? 'freeze recipe and move to release validation' : 'continue simulation optimization',
        artifact_refs: ['run_summary.json', 'final_snapshot.json', 'report.md'],
        run_summary: summary,
        recommendation
      }
    });

    patchControlState(runtimeDir, runId, { completed: true, stopped_reason: stoppedReason });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await adapter.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
