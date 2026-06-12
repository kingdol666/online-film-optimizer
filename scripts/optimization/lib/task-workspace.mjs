import fs from 'node:fs';
import path from 'node:path';
import { uniqueNowId } from './ids.mjs';

function slugify(text) {
  return String(text || 'optimization-task')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'optimization-task';
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function createTaskWorkspace({
  goalText,
  workspaceRoot = path.resolve(process.cwd(), 'workspace', 'optimization-tasks'),
  targetFile = 'examples/targets/bopet_new_grade_a.json',
  teamName = 'closed-loop-optimization-team'
}) {
  const taskId = `${slugify(goalText)}-${uniqueNowId()}`;
  const taskDir = path.join(workspaceRoot, taskId);
  const campaignRoot = path.join(taskDir, 'campaigns');
  const teamDir = path.join(taskDir, 'team');
  const outputsDir = path.join(taskDir, 'outputs');
  const messagesPath = path.join(teamDir, 'team_messages.jsonl');
  const inboxDir = path.join(teamDir, 'inbox');
  const outboxDir = path.join(teamDir, 'outbox');

  for (const dir of [taskDir, campaignRoot, teamDir, outputsDir, inboxDir, outboxDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const manifest = {
    task_id: taskId,
    task_dir: taskDir,
    task_name: slugify(goalText),
    goal_text: goalText,
    target_file: targetFile,
    team_name: teamName,
    workspace_layout: {
      campaign_root: 'campaigns/',
      team_dir: 'team/',
      outputs_dir: 'outputs/',
      inbox_dir: 'team/inbox/',
      outbox_dir: 'team/outbox/'
    },
    communication: {
      message_bus: path.relative(taskDir, messagesPath),
      inbox_dir: 'team/inbox/',
      outbox_dir: 'team/outbox/',
      handoff_dir: 'team/handoffs/'
    },
    created_at: new Date().toISOString()
  };

  fs.mkdirSync(path.join(teamDir, 'handoffs'), { recursive: true });
  writeJson(path.join(taskDir, 'task_manifest.json'), manifest);
  writeJson(path.join(taskDir, 'team_roster.json'), {
    team_name: teamName,
    leader: 'closed-loop-optimization-team-lead',
    members: [
      'closed-loop-optimization-quality-agent',
      'closed-loop-optimization-rd-agent',
      'closed-loop-optimization-process-agent'
    ]
  });
  writeJson(path.join(teamDir, 'team_contract.json'), {
    contract_version: '1.0.0',
    team_name: teamName,
    execution_model: 'deterministic-file-bus-agentteam',
    entrypoint: 'npm run optimize:team -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>"',
    team_personas: {
      quality: {
        persona: 'calm fact-checker who guards evidence quality and stability',
        behavior: 'lead with measurements, avoid overreaction, insist on hold-window proof, and request replanning when evidence stalls',
        asks_for_help_when: ['sensor_health_degraded', 'process_cycle_no_progress', 'target_reached_needs_hold_validation']
      },
      rd: {
        persona: 'curious hypothesis builder who balances exploration and exploitation',
        behavior: 'rank levers, change one main control at a time unless DOE is explicit, and stop repeating failed hypotheses',
        asks_for_help_when: ['quality_signal_ambiguous', 'safety_gate_blocks_primary_lever', 'process_response_conflicts_with_hypothesis']
      },
      process: {
        persona: 'disciplined execution operator who respects approval and rollback boundaries',
        behavior: 'convert plans into bounded proposals, never skip safety gate, preserve baseline, and request replan when execution evidence is exhausted',
        asks_for_help_when: ['proposal_rejected', 'no_safe_setpoint_path', 'multi_round_micro_tune_no_progress']
      }
    },
    communication_protocol: {
      mailbox_model: 'team/inbox/<role>/*.json plus team/team_messages.jsonl',
      shared_context_layers: [
        'team/department_briefs.json',
        'team/team_contract.json',
        '07_coordination/team_dispatch_plan_XXX.json',
        '07_coordination/quality_review_XXX.json',
        '07_coordination/rd_brief_XXX.json',
        '07_coordination/process_brief_XXX.json',
        '07_coordination/approval_packet_XXX.json',
        '08_trial_evidence/trial_XXX/'
      ],
      request_purposes: [
        'request_quality_review',
        'request_rd_replan',
        'request_process_revision',
        'request_hold_validation',
        'role_response'
      ],
      required_request_fields: ['requested_actions', 'requires_response', 'artifact_refs', 'payload.reason']
    },
    team_cadence: {
      quality_first: true,
      rd_after_quality: true,
      process_after_rd: true,
      team_lead_decides_next_actor_based_on_evidence: true,
      outer_strategy_cycle: 'quality + rd create or refresh strategy',
      inner_process_cycle: 'process may execute multiple bounded trials under the active rd strategy',
      replan_trigger: 'no progress, repeated rejection, repeated worsening, safety block, or quality request'
    },
    roles: [
      {
        agent: 'closed-loop-optimization-quality-agent',
        skill: 'quality-engineer',
        role: 'quality-engineer',
        responsibility: 'evaluate stable quality windows, identify dominant gaps, recommend explore/exploit/recover stage',
        must_read: ['goal_request.json', 'product_target.json', 'team/department_briefs.json', 'team/team_contract.json', 'latest process_snapshot_XXX.json', 'latest online_quality_XXX.json', 'latest rd_brief_XXX.json', 'latest process_brief_XXX.json', 'latest experiment_result_XXX.json'],
        must_write: ['02_quality/quality_diagnosis_XXX.json', '07_coordination/quality_review_XXX.json', '07_coordination/strategy_state_XXX.json', 'team/inbox/quality-engineer/*.json'],
        can_request: ['rd-engineer:request_rd_replan', 'process-engineer:request_process_revision'],
        forbidden: ['setpoint proposal', 'equipment write', 'approval bypass']
      },
      {
        agent: 'closed-loop-optimization-rd-agent',
        skill: 'rd-engineer',
        role: 'rd-engineer',
        responsibility: 'turn quality evidence and response history into a product-aware optimization plan and ranked levers',
        must_read: ['quality_diagnosis_XXX.json', 'quality_review_XXX.json', 'process_snapshot_XXX.json', 'online_quality_XXX.json', 'process_brief_XXX.json', 'safety_gate_result_XXX.json', 'experiment_result_XXX.json', 'product_target.json', 'campaign_ledger.jsonl', 'strategy_state_XXX.json'],
        must_write: ['03_rd_plan/rd_optimization_plan_XXX.json', '07_coordination/rd_brief_XXX.json', 'team/inbox/rd-engineer/*.json'],
        can_request: ['quality-engineer:request_quality_review', 'process-engineer:request_process_revision'],
        forbidden: ['equipment write', 'safety gate override', 'release approval']
      },
      {
        agent: 'closed-loop-optimization-process-agent',
        skill: 'process-engineer',
        role: 'process-engineer',
        responsibility: 'convert the R&D plan into a bounded MCP proposal, safety gate, approval packet, and rollback-safe execution handoff',
        must_read: ['rd_optimization_plan_XXX.json', 'rd_brief_XXX.json', 'quality_review_XXX.json', 'process_snapshot_XXX.json', 'online_quality_XXX.json', 'strategy_state_XXX.json', 'best_recipe_memory.json', 'experiment_result_XXX.json'],
        must_write: ['04_execution/parameter_delta_proposal_XXX.json', '04_execution/safety_gate_result_XXX.json', '07_coordination/process_brief_XXX.json', '07_coordination/approval_packet_XXX.json', 'team/inbox/process-engineer/*.json'],
        can_request: ['rd-engineer:request_rd_replan', 'quality-engineer:request_quality_review'],
        forbidden: ['unsafe write', 'missing rollback recipe', 'cross-product recipe reuse']
      }
    ],
    sequence: [
      'team-lead normalizes goal and creates product-aware workspace',
      'team-lead writes dispatch plan for the current strategy cycle',
      'quality-engineer publishes diagnosis and stage recommendation when a strategy refresh is needed',
      'rd-engineer publishes optimization plan and ranked levers when a strategy refresh is needed',
      'process-engineer may run multiple bounded trials under the active R&D strategy',
      'adapter/MCP executes only approved safe proposals',
      'quality-engineer evaluates after-window response and may request R&D replan',
      'if response worsens or risk increases, recover by restoring best observed recipe and resume exploration with alternate levers',
      'team-lead freezes best recipe only after goal reach plus hold-window confirmation, or records hard stop reason'
    ],
    hard_rules: [
      'product_grade must remain identical across goal_request, product_target, department_briefs, run_summary, and final_recipe',
      'all role handoffs must use team-message-protocol.mjs',
      'LLM roles must never write PLC/MCP setpoints directly',
      'best observed recipe must stay synchronized with rollback baseline',
      'each trial must leave complete evidence under 08_trial_evidence/trial_XXX'
    ],
    team_dynamics: [
      'quality speaks first when evidence is noisy or the line is unstable',
      'rd speaks first when quality is stable enough to choose between explore and exploit',
      'process speaks first when safety, approval, or rollback selection is the primary concern',
      'team-lead may request a quality re-check before process if the decision evidence is thin'
    ],
    stop_conditions: [
      'goal_reached_and_hold_confirmed',
      'execution_blocked_by_repeated_rejection',
      'max_iterations',
      'manual_terminate',
      'sensor_or_alarm_hard_failure'
    ]
  });
  fs.writeFileSync(messagesPath, '');

  return {
    taskId,
    taskDir,
    campaignRoot,
    teamDir,
    outputsDir,
    inboxDir,
    outboxDir,
    messagesPath,
    manifest
  };
}

export function appendTeamMessage(messagesPath, message) {
  fs.mkdirSync(path.dirname(messagesPath), { recursive: true });
  fs.appendFileSync(messagesPath, JSON.stringify({
    ...message,
    timestamp: new Date().toISOString()
  }) + '\n');
}

export function writeTeamMessageBox(teamDir, role, messageName, payload) {
  const boxDir = path.join(teamDir, role === 'team-lead' ? 'outbox' : 'inbox', role);
  fs.mkdirSync(boxDir, { recursive: true });
  const filePath = path.join(boxDir, `${messageName}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    role,
    message_name: messageName,
    payload,
    created_at: new Date().toISOString()
  }, null, 2) + '\n');
  return filePath;
}

export function readTeamMessageBox(teamDir, role, messageName) {
  const filePath = path.join(teamDir, role === 'team-lead' ? 'outbox' : 'inbox', role, `${messageName}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
