import fs from 'node:fs';
import path from 'node:path';
import { validateTeamMessage } from './lib/team-message-protocol.mjs';

function parseArgs(argv) {
  const args = { taskDir: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--task-dir') args.taskDir = argv[++i];
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readJsonl(filePath) {
  if (!exists(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.taskDir) fail('missing_task_dir');

  const taskDir = path.resolve(args.taskDir);
  const checks = {
    task_manifest: exists(path.join(taskDir, 'task_manifest.json')),
    goal_request: exists(path.join(taskDir, 'goal_request.json')),
    product_target: exists(path.join(taskDir, 'product_target.json')),
    department_briefs: exists(path.join(taskDir, 'team', 'department_briefs.json')),
    team_contract: exists(path.join(taskDir, 'team', 'team_contract.json')),
    team_state: exists(path.join(taskDir, 'team', 'team_state.json')),
    messages: exists(path.join(taskDir, 'team', 'team_messages.jsonl')),
    quality_inbox: exists(path.join(taskDir, 'team', 'inbox', 'quality-engineer')),
    rd_inbox: exists(path.join(taskDir, 'team', 'inbox', 'rd-engineer')),
    process_inbox: exists(path.join(taskDir, 'team', 'inbox', 'process-engineer')),
    outbox: exists(path.join(taskDir, 'team', 'outbox', 'team-lead')),
    campaign_root: exists(path.join(taskDir, 'campaigns')),
    outputs: exists(path.join(taskDir, 'outputs', 'final_recipe.json')),
    final_handoff: exists(path.join(taskDir, 'team', 'handoffs', 'final.md')),
    best_recipe: exists(path.join(taskDir, 'best_recipe.json')),
    task_summary: exists(path.join(taskDir, 'task_summary.json'))
  };

  const missing = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    fail('team_workspace_incomplete', { missing });
  }

  const teamState = readJson(path.join(taskDir, 'team', 'team_state.json'));
  const goalRequest = readJson(path.join(taskDir, 'goal_request.json'));
  const productTarget = readJson(path.join(taskDir, 'product_target.json'));
  const brief = readJson(path.join(taskDir, 'team', 'department_briefs.json'));
  const teamContract = readJson(path.join(taskDir, 'team', 'team_contract.json'));
  const messages = {
    quality: readJson(path.join(taskDir, 'team', 'inbox', 'quality-engineer', 'intake_brief.json')),
    rd: readJson(path.join(taskDir, 'team', 'inbox', 'rd-engineer', 'intake_brief.json')),
    process: readJson(path.join(taskDir, 'team', 'inbox', 'process-engineer', 'intake_brief.json'))
  };
  const ledgers = readJsonl(path.join(taskDir, 'team', 'team_messages.jsonl'));
  const qualityLeadInbox = readJson(path.join(taskDir, 'team', 'inbox', 'quality-engineer', 'quality_diagnosis_001.json'));
  const rdLeadInbox = readJson(path.join(taskDir, 'team', 'inbox', 'rd-engineer', 'rd_plan_001.json'));
  const processLeadInbox = readJson(path.join(taskDir, 'team', 'inbox', 'process-engineer', 'process_brief_001.json'));
  const finalRecipe = readJson(path.join(taskDir, 'outputs', 'final_recipe.json'));
  const allProtocolMessages = [
    messages.quality,
    messages.rd,
    messages.process,
    qualityLeadInbox,
    rdLeadInbox,
    processLeadInbox
  ];
  const invalidProtocolMessages = allProtocolMessages
    .map((message, index) => ({ index, errors: validateTeamMessage(message) }))
    .filter((entry) => entry.errors.length > 0);
  const campaignDirs = exists(path.join(taskDir, 'campaigns'))
    ? fs.readdirSync(path.join(taskDir, 'campaigns'))
      .map((name) => path.join(taskDir, 'campaigns', name))
      .filter((fullPath) => fs.statSync(fullPath).isDirectory())
    : [];
  const latestCampaign = campaignDirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  const campaignChecks = latestCampaign ? {
    run_summary: exists(path.join(latestCampaign, 'run_summary.json')),
    final_snapshot: exists(path.join(latestCampaign, 'final_snapshot.json')),
    recipe_recommendation: exists(path.join(latestCampaign, '06_recipe', 'recipe_release_recommendation.json')),
    final_recipe_stability_check: exists(path.join(latestCampaign, '06_recipe', 'final_recipe_stability_check.json')),
    best_recipe_memory: exists(path.join(latestCampaign, '07_coordination', 'best_recipe_memory.json')),
    evidence_root: exists(path.join(latestCampaign, '08_trial_evidence')),
    coordination_index: exists(path.join(latestCampaign, '07_coordination', 'coordination_index.json'))
  } : {};
  const protocolChecks = {
    quality_protocol: messages.quality.protocol_version === '1.0.0' && messages.quality.role === 'quality-engineer',
    rd_protocol: messages.rd.protocol_version === '1.0.0' && messages.rd.role === 'rd-engineer',
    process_protocol: messages.process.protocol_version === '1.0.0' && messages.process.role === 'process-engineer',
    messages_written: ledgers.length >= 2,
    brief_roles_match: brief.quality.role === 'quality-engineer' && brief.rd.role === 'rd-engineer' && brief.process.role === 'process-engineer',
    role_messages_parsed:
      qualityLeadInbox.protocol_version === '1.0.0' &&
      rdLeadInbox.protocol_version === '1.0.0' &&
      processLeadInbox.protocol_version === '1.0.0',
    required_fields_valid: invalidProtocolMessages.length === 0,
    recipient_graph_valid:
      messages.quality.to.includes('quality-engineer') &&
      qualityLeadInbox.to.includes('rd-engineer') &&
      rdLeadInbox.to.includes('process-engineer') &&
      processLeadInbox.to.includes('quality-engineer'),
    protocol_bus_contains_role_messages:
      ledgers.filter((entry) => entry.kind === 'protocol_message').length >= allProtocolMessages.length,
    team_contract_valid:
      teamContract.contract_version === '1.0.0' &&
      teamContract.roles?.length === 3 &&
      teamContract.sequence?.length >= 6 &&
      teamContract.hard_rules?.some((rule) => rule.includes('product_grade'))
  };
  const protocolMissing = Object.entries(protocolChecks).filter(([, value]) => !value).map(([key]) => key);
  if (protocolMissing.length > 0) {
    fail('team_message_protocol_invalid', { protocolMissing, invalidProtocolMessages });
  }
  const campaignMissing = Object.entries(campaignChecks).filter(([, value]) => !value).map(([key]) => key);
  if (!latestCampaign || campaignMissing.length > 0) {
    fail('team_campaign_artifacts_incomplete', { latestCampaign, campaignMissing });
  }
  if (
    !finalRecipe.candidate_recipe_id ||
    !finalRecipe.setpoints ||
    Object.keys(finalRecipe.setpoints).length === 0 ||
    !finalRecipe.metrics ||
    Object.keys(finalRecipe.metrics).length === 0
  ) {
    fail('final_recipe_not_operational', { finalRecipe });
  }
  if (
    finalRecipe.product_grade !== productTarget.product_grade ||
    brief.quality.product?.product_grade !== productTarget.product_grade ||
    brief.rd.product?.product_grade !== productTarget.product_grade ||
    brief.process.product?.product_grade !== productTarget.product_grade ||
    goalRequest.product_grade !== productTarget.product_grade
  ) {
    fail('product_grade_context_mismatch', {
      goal_request: goalRequest.product_grade,
      product_target: productTarget.product_grade,
      final_recipe: finalRecipe.product_grade,
      brief_quality: brief.quality.product?.product_grade,
      brief_rd: brief.rd.product?.product_grade,
      brief_process: brief.process.product?.product_grade
    });
  }
  const summary = {
    ok: true,
    task_dir: taskDir,
    latest_campaign: latestCampaign,
    current_stage: teamState.current_stage,
    current_iteration: teamState.current_iteration,
    product_grade: productTarget.product_grade,
    checks,
    protocol_checks: protocolChecks,
    campaign_checks: campaignChecks
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
