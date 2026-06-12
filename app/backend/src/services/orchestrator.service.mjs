import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { normalizeGoalRequest } from '../../../../scripts/optimization/lib/goal-request.mjs';
import { controlFilePath, patchControlState, readControlState } from '../../../../scripts/optimization/lib/orchestrator-control.mjs';
import { loadPlatformConfig } from '../../../../scripts/optimization/lib/platform-config.mjs';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const CAMPAIGN_BASE_DIR = path.join(PROJECT_ROOT, 'workspace', 'optimization-campaigns');
const TASK_BASE_DIR = path.join(PROJECT_ROOT, 'workspace', 'optimization-tasks');
const TARGET_FILE = path.join(PROJECT_ROOT, 'examples', 'targets', 'bopet_new_grade_a.json');
const config = loadPlatformConfig({ projectRoot: PROJECT_ROOT });
const CONTROL_DIR = path.join(config.runtime_dir, 'orchestrator-controls');
const TASK_RUNTIME_FILE = 'orchestrator_runtime.json';

let activeRun = null;

function tailArray(items, count = 12) {
  return Array.isArray(items) ? items.slice(-count) : [];
}

function tailLines(text, count = 12) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count);
}

function mapAgentStatus(task, activeRunState) {
  const taskMessages = task?.teamMessagesTail || [];
  const runSummary = task?.latestCampaign?.runSummary || task?.taskSummary?.run_summary || {};
  const strategyState = task?.latestCampaign?.strategyState || {};
  const approvalPacket = task?.latestCampaign?.approvalPacket || {};
  const roleDefaults = [
    { role: 'team-lead', label: '总编排' },
    { role: 'quality-engineer', label: '质量 Agent' },
    { role: 'rd-engineer', label: '研发 Agent' },
    { role: 'process-engineer', label: '工艺 Agent' }
  ];

  return roleDefaults.map((item) => {
    const latestMessage = [...taskMessages].reverse().find((entry) => (
      entry.role === item.role || entry.actor === item.role
    )) || null;

    let state = 'idle';
    if (activeRunState?.status === 'running') state = 'working';
    if (runSummary.goal_reached) state = 'completed';
    if (activeRunState?.status === 'failed') state = 'error';
    if (item.role === 'process-engineer' && approvalPacket?.approval_required && approvalPacket?.approval_status !== 'approved') {
      state = 'awaiting_approval';
    }
    if (item.role === 'team-lead' && activeRunState?.status === 'running') {
      state = 'orchestrating';
    }

    return {
      role: item.role,
      label: item.label,
      state,
      stage: latestMessage?.stage || strategyState.stage || runSummary.final_strategy_stage || '-',
      summary: latestMessage?.summary || latestMessage?.purpose || (
        item.role === 'team-lead'
          ? (activeRunState?.status === 'running' ? '正在编排闭环执行' : '等待任务')
          : '等待上游输入'
      ),
      nextAction: latestMessage?.next_action || latestMessage?.payload?.next_action || '',
      updatedAt: latestMessage?.created_at || latestMessage?.timestamp || activeRunState?.startedAt || null
    };
  });
}

function buildEventFeed(task, activeRunState) {
  const teamMessages = tailArray(task?.teamMessagesTail, 10).map((entry) => ({
    type: 'agent_message',
    role: entry.role || entry.actor || 'team-lead',
    summary: entry.summary || entry.kind || '-',
    stage: entry.stage || entry.payload?.stage || '-',
    timestamp: entry.created_at || entry.timestamp || null
  }));

  const stdoutMessages = tailLines(activeRunState?.stdout, 8).map((line, index) => ({
    type: 'runtime_stdout',
    role: 'team-lead',
    summary: line,
    stage: activeRunState?.launchMode || '-',
    timestamp: `${activeRunState?.startedAt || new Date().toISOString()}#${index}`
  }));

  return [...teamMessages, ...stdoutMessages].slice(-16);
}

function listDirs(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir)
    .map((name) => path.join(rootDir, name))
    .filter((fullPath) => fs.statSync(fullPath).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function listRunDirs() {
  return listDirs(CAMPAIGN_BASE_DIR);
}

function listTaskDirs() {
  return listDirs(TASK_BASE_DIR);
}

function listTaskCampaignDirs() {
  return listTaskDirs()
    .flatMap((taskDir) => listDirs(path.join(taskDir, 'campaigns')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function readJsonlIfExists(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function latestTaskDir() {
  return listTaskDirs()[0] || null;
}

function latestCampaignDir(taskDir) {
  if (!taskDir) return null;
  const campaignRoot = path.join(taskDir, 'campaigns');
  return listDirs(campaignRoot)[0] || null;
}

function latestExistingArtifact(dir, prefix, fallback = null) {
  if (!fs.existsSync(dir)) return fallback;
  const files = fs.readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix))
    .sort();
  if (files.length === 0) return fallback;
  const filePath = path.join(dir, files[files.length - 1]);
  return readJsonIfExists(filePath);
}

function summarizeTask(taskDir) {
  if (!taskDir || !fs.existsSync(taskDir)) return null;
  const taskId = path.basename(taskDir);
  const campaignDir = latestCampaignDir(taskDir);
  const messageBus = readJsonlIfExists(path.join(taskDir, 'team', 'team_messages.jsonl'));
  const latestTaskSummary = readJsonIfExists(path.join(taskDir, 'task_summary.json'));
  const latestFinalRecipe = readJsonIfExists(path.join(taskDir, 'outputs', 'final_recipe.json'));
  const latestCampaignSummary = campaignDir ? readJsonIfExists(path.join(campaignDir, 'run_summary.json')) : null;
  return {
    taskId,
    taskDir,
    taskManifest: readJsonIfExists(path.join(taskDir, 'task_manifest.json')),
    runtime: readJsonIfExists(path.join(taskDir, TASK_RUNTIME_FILE)),
    taskSummary: latestTaskSummary,
    bestRecipe: readJsonIfExists(path.join(taskDir, 'best_recipe.json')),
    finalRecipe: latestFinalRecipe,
    teamState: readJsonIfExists(path.join(taskDir, 'team', 'team_state.json')),
    teamContract: readJsonIfExists(path.join(taskDir, 'team', 'team_contract.json')),
    teamMessagesTail: messageBus.slice(-12),
    handoffFinal: readTextIfExists(path.join(taskDir, 'team', 'handoffs', 'final.md')),
    latestCampaign: campaignDir ? {
      campaignDir,
      runSummary: latestCampaignSummary,
      latestCadencePlan: latestArtifactByPrefix(path.join(campaignDir, '07_coordination'), 'cadence_plan_'),
      latestQualityReview: latestArtifactByPrefix(path.join(campaignDir, '07_coordination'), 'quality_review_'),
      latestRDBrief: latestArtifactByPrefix(path.join(campaignDir, '07_coordination'), 'rd_brief_'),
      latestProcessBrief: latestArtifactByPrefix(path.join(campaignDir, '07_coordination'), 'process_brief_'),
      coordinationIndex: readJsonIfExists(path.join(campaignDir, '07_coordination', 'coordination_index.json')),
      strategyState: latestExistingArtifact(path.join(campaignDir, '07_coordination'), 'strategy_state_'),
      approvalPacket: latestExistingArtifact(path.join(campaignDir, '07_coordination'), 'approval_packet_'),
      executiveSummary: readTextIfExists(path.join(campaignDir, '07_coordination', 'executive_summary.md'))
    } : null
  };
}

function locateTaskById(taskId) {
  const taskDir = path.join(TASK_BASE_DIR, taskId);
  if (!fs.existsSync(taskDir)) throw new Error(`task_not_found:${taskId}`);
  return summarizeTask(taskDir);
}

function latestRunDir() {
  return [
    ...listRunDirs(),
    ...listTaskCampaignDirs()
  ].sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

function findRunDir(runId) {
  if (!runId) return null;
  const directCampaignDir = path.join(CAMPAIGN_BASE_DIR, runId);
  if (fs.existsSync(directCampaignDir)) return directCampaignDir;
  for (const taskDir of listTaskDirs()) {
    const candidate = path.join(taskDir, 'campaigns', runId);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function summarizeRun(runDir) {
  if (!runDir) return null;
  const runId = path.basename(runDir);
  return {
    runId,
    runDir,
    summary: readJsonIfExists(path.join(runDir, 'run_summary.json')),
    latestCadencePlan: latestArtifactByPrefix(path.join(runDir, '07_coordination'), 'cadence_plan_'),
    latestQualityReview: latestArtifactByPrefix(path.join(runDir, '07_coordination'), 'quality_review_'),
    latestCoordinationIndex: readJsonIfExists(path.join(runDir, '07_coordination', 'coordination_index.json')),
    latestExecutiveSummary: readTextIfExists(path.join(runDir, '07_coordination', 'executive_summary.md')),
    latestApprovalPacket: latestArtifactByPrefix(path.join(runDir, '07_coordination'), 'approval_packet_'),
    latestStrategyState: latestArtifactByPrefix(path.join(runDir, '07_coordination'), 'strategy_state_')
  };
}

function latestArtifactByPrefix(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix))
    .sort();
  if (files.length === 0) return null;
  const filePath = path.join(dir, files[files.length - 1]);
  return readJsonIfExists(filePath);
}

function writeTaskRuntime(taskDir, runtime) {
  if (!taskDir || !fs.existsSync(taskDir)) return;
  const filePath = path.join(taskDir, TASK_RUNTIME_FILE);
  const current = readJsonIfExists(filePath) || {};
  fs.writeFileSync(filePath, JSON.stringify({
    ...current,
    ...runtime
  }, null, 2) + '\n');
}

function updateActiveRunOnClose(code) {
  const task = latestTaskDir();
  const runDir = activeRun?.launchMode === 'single_campaign'
    ? latestRunDir()
    : latestCampaignDir(task);
  if (task && activeRun) {
    writeTaskRuntime(task, {
      request_id: activeRun.id,
      launch_mode: activeRun.launchMode,
      reasoning_mode: activeRun.reasoningMode,
      product_grade: activeRun.productGrade,
      goal_text: activeRun.goalText,
      request_path: activeRun.requestPath,
      completed_at: new Date().toISOString(),
      exit_code: code
    });
  }
  activeRun = {
    ...activeRun,
    status: code === 0 ? 'completed' : 'failed',
    exitedAt: new Date().toISOString(),
    exitCode: code,
    latestRun: summarizeRun(runDir),
    latestTask: summarizeTask(task)
  };
}

function resolveLaunchSpec({ normalizedGoalRequest, launchMode, maxIters, seed, stateFile }) {
  if (launchMode === 'claude_sdk') {
    return {
      script: path.join(PROJECT_ROOT, 'scripts', 'optimization', 'run-claude-sdk-skill.mjs'),
      args: [
        '--goal-text', normalizedGoalRequest.goal_text || normalizedGoalRequest.user_objective?.performance_goal || '',
        '--product-grade', normalizedGoalRequest.product_grade,
        '--max-iters', String(maxIters),
        '--seed', String(seed),
        '--reasoning-mode', normalizedGoalRequest.execution?.reasoning_mode || config.orchestrator.reasoning_mode || 'deterministic',
        '--max-turns', '20'
      ],
      baseDir: TASK_BASE_DIR
    };
  }
  if (launchMode === 'team_deterministic' || launchMode === 'team_claude_cli') {
    return {
      script: path.join(PROJECT_ROOT, 'scripts', 'optimization', 'run-team-campaign.mjs'),
      args: [
        '--target', TARGET_FILE,
        '--goal-request', path.join(config.runtime_dir, 'goal-requests', `${normalizedGoalRequest.request_id}.json`),
        '--base-dir', TASK_BASE_DIR,
        '--max-iters', String(maxIters),
        '--seed', String(seed),
        '--product-grade', normalizedGoalRequest.product_grade,
        '--reasoning-mode',
        launchMode === 'team_claude_cli'
          ? 'claude_cli'
          : (normalizedGoalRequest.execution?.reasoning_mode || 'deterministic')
      ],
      baseDir: TASK_BASE_DIR
    };
  }
  return {
    script: path.join(PROJECT_ROOT, 'scripts', 'optimization', 'run-sim-campaign.mjs'),
    args: [
      '--target', TARGET_FILE,
      '--goal-request', path.join(config.runtime_dir, 'goal-requests', `${normalizedGoalRequest.request_id}.json`),
      '--base-dir', CAMPAIGN_BASE_DIR,
      '--max-iters', String(maxIters),
      '--seed', String(seed),
      '--state-file', stateFile,
      '--product-grade', normalizedGoalRequest.product_grade,
      '--reasoning-mode', normalizedGoalRequest.execution?.reasoning_mode || config.orchestrator.reasoning_mode || 'deterministic'
    ],
    baseDir: CAMPAIGN_BASE_DIR
  };
}

export function getOrchestratorStatus() {
  const latestRun = summarizeRun(latestRunDir());
  const latestTask = summarizeTask(latestTaskDir());
  return {
    activeRun,
    latestRun,
    latestTask,
    runtimeConfig: {
      execution_mode: config.orchestrator.execution_mode,
      reasoning_mode: config.orchestrator.reasoning_mode,
      provider: config.orchestrator.provider,
      hooks: config.orchestrator.hooks
    }
  };
}

export function getOrchestratorRealtimeSnapshot({ overview = null } = {}) {
  const orchestrator = getOrchestratorStatus();
  const latestTask = orchestrator.latestTask;
  const runId = latestTask?.latestCampaign?.runSummary?.run_id
    || orchestrator.latestRun?.runId
    || null;
  const runDetail = runId ? getOrchestratorRun(runId) : null;

  return {
    timestamp: new Date().toISOString(),
    sequence: Date.now(),
    overview,
    orchestrator,
    latestTask,
    runDetail,
    agentStatuses: mapAgentStatus(latestTask, orchestrator.activeRun),
    stdoutTail: tailLines(orchestrator.activeRun?.stdout, 12),
    stderrTail: tailLines(orchestrator.activeRun?.stderr, 8),
    eventFeed: buildEventFeed(latestTask, orchestrator.activeRun)
  };
}

export function getOrchestratorRun(runId) {
  const runDir = findRunDir(runId);
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`run_not_found:${runId}`);
  }
  const controlPath = controlFilePath(config.runtime_dir, runId);
  return {
    ...summarizeRun(runDir),
    control: fs.existsSync(controlPath) ? readControlState(config.runtime_dir, runId) : null,
    goalRequest: readJsonIfExists(path.join(runDir, '00_objective', 'orchestrator_goal_request.json'))
  };
}

export function getOrchestratorTask(taskId) {
  return locateTaskById(taskId);
}

export function getLatestOrchestratorTask() {
  return summarizeTask(latestTaskDir());
}

export function runOrchestrator({
  goalText,
  goalRequest,
  productGrade,
  reasoningMode,
  launchMode = 'team_deterministic',
  maxIters = 12,
  seed = 20260610,
  stateFile = path.join(PROJECT_ROOT, 'workspace', 'runtime', 'simulator-state.json')
} = {}) {
  if (activeRun?.status === 'running') {
    throw new Error('campaign_already_running');
  }

  const normalizedGoalRequest = normalizeGoalRequest({
    goalRequest: {
      ...((goalRequest || readJsonIfExists(TARGET_FILE)) || {}),
      ...(goalText ? { goal_text: goalText } : {}),
      ...(productGrade ? { product_grade: productGrade } : {}),
      ...(reasoningMode ? { execution: { ...((goalRequest || {}).execution || {}), reasoning_mode: reasoningMode } } : {})
    },
    targetFile: TARGET_FILE,
    projectRoot: PROJECT_ROOT
  });

  const requestPath = path.join(config.runtime_dir, 'goal-requests', `${normalizedGoalRequest.request_id}.json`);
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, JSON.stringify(normalizedGoalRequest, null, 2) + '\n');

  const spec = resolveLaunchSpec({
    normalizedGoalRequest,
    launchMode,
    maxIters,
    seed,
    stateFile
  });
  const child = spawn(process.execPath, [
    spec.script,
    ...spec.args
  ], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  activeRun = {
    id: normalizedGoalRequest.request_id,
    goalText: normalizedGoalRequest.goal_text || normalizedGoalRequest.user_objective?.performance_goal || '',
    productGrade: normalizedGoalRequest.product_grade,
    reasoningMode: normalizedGoalRequest.execution?.reasoning_mode || config.orchestrator.reasoning_mode || 'deterministic',
    launchMode,
    status: 'running',
    startedAt: new Date().toISOString(),
    stdout: '',
    stderr: '',
    childPid: child.pid,
    requestPath,
    taskBaseDir: TASK_BASE_DIR
  };

  child.stdout.on('data', (chunk) => {
    activeRun.stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    activeRun.stderr += chunk.toString();
  });

  child.on('close', (code) => {
    updateActiveRunOnClose(code);
  });

  return activeRun;
}

export function approveRun(runId, {
  approvalStatus = 'approved',
  approver = 'api-user',
  note = ''
} = {}) {
  const runDir = findRunDir(runId);
  if (!runDir || !fs.existsSync(runDir)) throw new Error(`run_not_found:${runId}`);
  const coordDir = path.join(runDir, '07_coordination');
  const approvalFiles = fs.readdirSync(coordDir)
    .filter((entry) => entry.startsWith('approval_packet_'))
    .sort();
  if (approvalFiles.length === 0) throw new Error('approval_packet_not_found');
  const latestApprovalPath = path.join(coordDir, approvalFiles[approvalFiles.length - 1]);
  const approvalPacket = readJsonIfExists(latestApprovalPath);
  approvalPacket.approval_status = approvalStatus;
  approvalPacket.approval_source = approver;
  approvalPacket.approval_note = note;
  approvalPacket.approved_at = new Date().toISOString();
  fs.writeFileSync(latestApprovalPath, JSON.stringify(approvalPacket, null, 2) + '\n');
  return approvalPacket;
}

export function pauseRun(runId) {
  return patchControlState(config.runtime_dir, runId, { pause_requested: true });
}

export function resumeRun(runId) {
  return patchControlState(config.runtime_dir, runId, { pause_requested: false });
}

export function rollbackRun(runId) {
  return patchControlState(config.runtime_dir, runId, { rollback_requested: true });
}

export function terminateRun(runId) {
  return patchControlState(config.runtime_dir, runId, { terminate_requested: true });
}

export function listControlFiles() {
  if (!fs.existsSync(CONTROL_DIR)) return [];
  return fs.readdirSync(CONTROL_DIR);
}
