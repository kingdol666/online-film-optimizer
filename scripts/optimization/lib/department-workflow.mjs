import fs from 'node:fs';
import path from 'node:path';
import { normalizeGoalRequest, goalRequestToProductTarget } from './goal-request.mjs';
import { parseGoalText } from './natural-language-goal-parser.mjs';
import { appendTeamMessage, createTaskWorkspace, readTeamMessageBox, writeTeamMessageBox } from './task-workspace.mjs';
import { createTeamMessage, readTeamProtocolMessage, summarizeProtocolMessage, writeTeamProtocolMessage } from './team-message-protocol.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function createTeamHandoff({
  taskDir,
  stage,
  nextStage,
  decided,
  rejected,
  risks,
  files,
  remaining
}) {
  const handoffPath = path.join(taskDir, 'team', 'handoffs', `${stage}.md`);
  const lines = [
    `## Handoff: ${stage} -> ${nextStage}`,
    '',
    `- **Decided**: ${decided.join('; ')}`,
    `- **Rejected**: ${rejected.join('; ')}`,
    `- **Risks**: ${risks.join('; ')}`,
    `- **Files**: ${files.join('; ')}`,
    `- **Remaining**: ${remaining.join('; ')}`,
    ''
  ];
  writeText(handoffPath, lines.join('\n'));
  return handoffPath;
}

function buildDepartmentBriefs(goalRequest, target, goalInterpretation) {
  const productContext = target.product_context || goalRequest.product_context || {};
  const productSummary = {
    product_grade: target.product_grade,
    display_name: productContext.display_name || target.product_grade,
    material_family: productContext.material_family || 'unknown',
    process_notes: productContext.process_notes || [],
    historical_recipes: productContext.historical_recipes || [],
    product_database_ref: target.product_database_ref || goalRequest.product_database_ref || null
  };
  return {
    quality: {
      role: 'quality-engineer',
      persona: 'calm fact-checker who protects signal quality and refuses to overreact to one noisy window',
      product: productSummary,
      user_goal: goalRequest.user_objective?.performance_goal || goalRequest.goal_text,
      target_priority_order: goalRequest.user_objective?.priority_order || [],
      interpreted_goal: goalInterpretation,
      responsibilities: [
        'collect stable snapshot and online quality',
        'judge dominant quality gap and risk',
        'recommend explore / exploit / recover stage'
      ]
    },
    rd: {
      role: 'rd-engineer',
      persona: 'curious hypothesis builder who alternates between broad search and focused refinement',
      product: productSummary,
      user_goal: goalRequest.user_objective?.performance_goal || goalRequest.goal_text,
      business_context: goalRequest.user_objective?.business_context || '',
      target_window: target.targets,
      responsibilities: [
        'turn quality diagnosis into ranked levers',
        'provide falsifiable hypothesis and stop rules',
        'produce one primary lever per iteration unless DOE is explicit'
      ]
    },
    process: {
      role: 'process-engineer',
      persona: 'disciplined execution operator who turns plans into safe, approval-aware actions and remembers rollback boundaries',
      product: productSummary,
      user_goal: goalRequest.user_objective?.performance_goal || goalRequest.goal_text,
      execution_mode: goalRequest.execution?.manual_approval_required ? 'semi_auto' : 'auto_gate',
      responsibilities: [
        'translate R&D plan into bounded setpoint proposal',
        'pass safety gate before execution',
        'preserve rollback recipe and execution intent'
      ]
    }
  };
}

export function createDepartmentTeamTask({
  goalText = null,
  goalRequest = null,
  targetFile,
  baseDir,
  teamName = 'closed-loop-optimization-team'
}) {
  const taskWorkspace = createTaskWorkspace({
    goalText: goalText || goalRequest?.goal_text || goalRequest?.user_objective?.performance_goal || 'optimization-task',
    workspaceRoot: path.resolve(baseDir || 'workspace/optimization-tasks'),
    targetFile,
    teamName
  });

  const normalizedGoalRequest = goalRequest
    ? normalizeGoalRequest({
        goalRequest,
        targetFile,
        projectRoot: process.cwd()
      })
    : normalizeGoalRequest({
        goalRequest: { goal_text: goalText },
        targetFile,
        projectRoot: process.cwd()
      });
  const effectiveGoalText = normalizedGoalRequest.goal_text || goalText || normalizedGoalRequest.user_objective?.performance_goal || '';
  const goalInterpretation = parseGoalText(effectiveGoalText);
  const target = goalRequestToProductTarget(normalizedGoalRequest);
  const departmentBriefs = buildDepartmentBriefs(normalizedGoalRequest, target, goalInterpretation);

  writeJson(path.join(taskWorkspace.taskDir, 'goal_request.json'), normalizedGoalRequest);
  writeJson(path.join(taskWorkspace.taskDir, 'orchestrator_goal_request.json'), normalizedGoalRequest);
  writeJson(path.join(taskWorkspace.taskDir, 'product_target.json'), target);
  writeJson(path.join(taskWorkspace.taskDir, 'team', 'department_briefs.json'), departmentBriefs);
  writeJson(path.join(taskWorkspace.teamDir, 'team_state.json'), {
    task_id: taskWorkspace.taskId,
    goal_text: effectiveGoalText,
    current_stage: 'team-intake',
    communication_mode: 'file-bus',
    team_persona_order: ['quality', 'rd', 'process'],
    created_at: new Date().toISOString()
  });

  const qualityMessage = createTeamMessage({
    role: 'quality-engineer',
    from: 'team-lead',
    to: ['quality-engineer', 'rd-engineer', 'process-engineer'],
    stage: 'team-intake',
    purpose: 'quality-intake',
    summary: 'quality role receives task brief and prepares diagnosis',
    inputs: ['goal_request.json', 'product_target.json', 'team/department_briefs.json'],
    outputs: ['quality_diagnosis_XXX.json', 'quality_review_XXX.json', 'strategy_state_XXX.json'],
    risks: ['quality role must not propose setpoints'],
    nextAction: 'read snapshot and quality window from latest campaign evidence',
    artifactRefs: ['goal_request.json', 'product_target.json', 'team/department_briefs.json'],
    payload: { brief: departmentBriefs.quality }
  });
  const rdMessage = createTeamMessage({
    role: 'rd-engineer',
    from: 'team-lead',
    to: ['rd-engineer'],
    stage: 'team-intake',
    purpose: 'rd-intake',
    summary: 'R&D role receives task brief and waits for quality diagnosis',
    inputs: ['goal_request.json', 'product_target.json', 'team/department_briefs.json'],
    outputs: ['rd_optimization_plan_XXX.json', 'rd_brief_XXX.json'],
    risks: ['R&D role must not write PLC or setpoints'],
    nextAction: 'wait for quality diagnosis, then rank levers and write rd brief',
    artifactRefs: ['goal_request.json', 'product_target.json', 'team/department_briefs.json'],
    payload: { brief: departmentBriefs.rd }
  });
  const processMessage = createTeamMessage({
    role: 'process-engineer',
    from: 'team-lead',
    to: ['process-engineer'],
    stage: 'team-intake',
    purpose: 'process-intake',
    summary: 'process role receives task brief and waits for R&D plan',
    inputs: ['goal_request.json', 'product_target.json', 'team/department_briefs.json'],
    outputs: ['parameter_delta_proposal_XXX.json', 'safety_gate_result_XXX.json', 'approval_packet_XXX.json'],
    risks: ['process role must preserve rollback recipe and safety gate'],
    nextAction: 'wait for rd plan, then draft proposal and safety gate',
    artifactRefs: ['goal_request.json', 'product_target.json', 'team/department_briefs.json'],
    payload: { brief: departmentBriefs.process }
  });
  writeTeamProtocolMessage(taskWorkspace.teamDir, 'quality-engineer', 'intake_brief', qualityMessage);
  writeTeamProtocolMessage(taskWorkspace.teamDir, 'rd-engineer', 'intake_brief', rdMessage);
  writeTeamProtocolMessage(taskWorkspace.teamDir, 'process-engineer', 'intake_brief', processMessage);

  appendTeamMessage(taskWorkspace.messagesPath, {
    kind: 'team_start',
    actor: 'team-lead',
    task_id: taskWorkspace.taskId,
    goal_text: effectiveGoalText,
    summary: 'department team initialized'
  });

  createTeamHandoff({
    taskDir: taskWorkspace.taskDir,
    stage: 'team-intake',
    nextStage: 'quality-review',
    decided: [
      'user goal normalized into orchestrator_goal_request.json',
      'team workspace created under task-specific directory',
      'three department briefs written for quality, R&D, and process'
    ],
    rejected: [
      'implicit prompt-only coordination',
      'shared mutable workspace without task isolation'
    ],
    risks: [
      'real-line adapter requires external bridge server for production writes',
      'native Claude Code team runtime still needs host-level team tooling'
    ],
    files: [
      'task_manifest.json',
      'team_roster.json',
      'goal_request.json',
      'orchestrator_goal_request.json',
      'product_target.json',
      'team/department_briefs.json'
    ],
    remaining: [
      'invoke campaign runner',
      'persist campaign summary and best recipe',
      'write final handoff and coordination index'
    ]
  });

  return {
    taskWorkspace,
    goalRequest: normalizedGoalRequest,
    target,
    departmentBriefs,
    messageBus: taskWorkspace.messagesPath
  };
}

export function finalizeDepartmentTeamTask({
  taskWorkspace,
  campaignDir,
  runSummary,
  bestRecipe,
  runtime = null
}) {
  const finalSummary = {
    task_id: taskWorkspace.taskId,
    task_dir: taskWorkspace.taskDir,
    campaign_dir: campaignDir,
    goal_text: taskWorkspace.manifest.goal_text,
    runtime,
    run_summary: runSummary,
    best_recipe: bestRecipe,
    completed_at: new Date().toISOString()
  };

  writeJson(path.join(taskWorkspace.taskDir, 'task_summary.json'), finalSummary);
  if (runtime) {
    writeJson(path.join(taskWorkspace.taskDir, 'orchestrator_runtime.json'), runtime);
  }
  writeJson(path.join(taskWorkspace.taskDir, 'best_recipe.json'), bestRecipe);
  writeJson(path.join(taskWorkspace.outputsDir, 'final_recipe.json'), {
    candidate_recipe_id: bestRecipe.candidate_recipe_id,
    product_grade: bestRecipe.product_grade || runSummary.product_grade || null,
    material_family: bestRecipe.material_family || runSummary.product_context?.material_family || null,
    release_status: bestRecipe.release_status,
    recommended_use: bestRecipe.recommended_use,
    goal_reached: Boolean(runSummary.goal_reached),
    final_quality_state: runSummary.final_quality_state,
    final_loss: runSummary.final_loss,
    setpoints: runSummary.best_observed?.setpoints || runSummary.final_setpoints || {},
    metrics: runSummary.best_observed?.metrics || runSummary.final_metrics || {},
    source_experiment_id: runSummary.best_observed?.experiment_id || null,
    source_recipe_id: runSummary.best_observed?.recipe_id || runSummary.final_snapshot?.recipe_id || null,
    validation_required_before_release: bestRecipe.required_before_release || [],
    production_use_policy: bestRecipe.release_status === 'candidate'
      ? 'shadow_validation_required_before_full_release'
      : 'continue_optimization_before_release'
  });

  appendTeamMessage(taskWorkspace.messagesPath, {
    kind: 'team_complete',
    actor: 'team-lead',
    task_id: taskWorkspace.taskId,
    summary: `goal_reached=${runSummary.goal_reached}, recipe=${bestRecipe.candidate_recipe_id}`
  });
  writeTeamMessageBox(taskWorkspace.teamDir, 'quality-engineer', 'final_summary', {
    run_summary: runSummary,
    best_recipe: bestRecipe
  });
  writeTeamMessageBox(taskWorkspace.teamDir, 'rd-engineer', 'final_summary', {
    run_summary: runSummary,
    best_recipe: bestRecipe
  });
  writeTeamMessageBox(taskWorkspace.teamDir, 'process-engineer', 'final_summary', {
    run_summary: runSummary,
    best_recipe: bestRecipe
  });

  writeText(
    path.join(taskWorkspace.taskDir, 'team', 'handoffs', 'final.md'),
    [
      '## Handoff: team-exec -> complete',
      '',
      `- **Decided**: campaign finished with ${runSummary.final_quality_state}; best recipe captured as ${bestRecipe.candidate_recipe_id}`,
      `- **Rejected**: continuing beyond stop condition`,
      `- **Risks**: real-line migration still needs external bridge server integration and plant safety validation`,
      `- **Files**: task_summary.json; best_recipe.json; outputs/final_recipe.json`,
      `- **Remaining**: production bridge hookup, shadow validation, offline product validation`,
      ''
    ].join('\n')
  );

  return finalSummary;
}

export function postRoleMessage({ taskWorkspace, role, messageName, payload }) {
  const summary = typeof payload.summary === 'string'
    ? payload.summary
    : payload.summary_text || messageName;
  const nextAction = typeof payload.next_action === 'string'
    ? payload.next_action
    : '';
  const message = createTeamMessage({
    role,
    from: role,
    to: role === 'quality-engineer'
      ? ['rd-engineer', 'process-engineer', 'team-lead']
      : role === 'rd-engineer'
        ? ['process-engineer', 'quality-engineer', 'team-lead']
        : role === 'process-engineer'
          ? ['quality-engineer', 'rd-engineer', 'team-lead']
          : ['quality-engineer', 'rd-engineer', 'process-engineer'],
    stage: payload.stage || 'campaign-execution',
    purpose: payload.purpose || messageName,
    summary,
    inputs: payload.inputs || [],
    outputs: payload.outputs || [],
    risks: payload.risks || [],
    nextAction,
    artifactRefs: payload.artifact_refs || [],
    requestedActions: payload.requested_actions || payload.requestedActions || [],
    requiresResponse: Boolean(payload.requires_response || payload.requiresResponse),
    replyToMessageId: payload.reply_to_message_id || payload.replyToMessageId || null,
    personaSignal: payload.persona_signal || payload.personaSignal || '',
    payload
  });
  return writeTeamProtocolMessage(taskWorkspace.teamDir, role, messageName, message);
}

export function readRoleMessage({ taskWorkspace, role, messageName }) {
  return readTeamProtocolMessage(taskWorkspace.teamDir, role, messageName);
}

export function decodeRoleMessage(message) {
  return summarizeProtocolMessage(message);
}
