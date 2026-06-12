import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildApprovalPacket,
  buildProcessAgentBrief,
  buildQualityReviewReport,
  buildRDAgentBrief,
  buildStrategyState,
  processEngineer,
  qualityEngineer,
  rdEngineer
} from '../role-engines.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function parseClaudeResult(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('claude_empty_output');
  const parsed = JSON.parse(text);
  if (parsed?.structured_output && typeof parsed.structured_output === 'object') {
    return {
      structured: parsed.structured_output,
      raw: parsed
    };
  }
  throw new Error('claude_missing_structured_output');
}

function runClaudeStructured({
  prompt,
  schema,
  config,
  cwd
}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--bare',
      '-p',
      prompt,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      '--model',
      config.model || 'sonnet',
      '--effort',
      config.effort || 'medium',
      '--max-budget-usd',
      String(config.max_budget_usd ?? 2),
      '--tools',
      ''
    ];

    const child = spawn(config.command || 'claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude_cli_failed:${code}:${stderr.trim()}`));
        return;
      }
      try {
        resolve({
          ...parseClaudeResult(stdout),
          stdout,
          stderr
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function qualitySchema() {
  return {
    type: 'object',
    required: [
      'quality_state',
      'primary_quality_gap',
      'affected_metrics',
      'suspected_process_regions',
      'evidence_level',
      'confidence',
      'recommended_next_action',
      'blocking_issues',
      'response_assessment',
      'current_loss',
      'metric_evaluations',
      'process_risk_summary',
      'history_signal_summary',
      'decision_context',
      'strategy_recommendation'
    ],
    properties: {
      quality_state: { type: 'string', enum: ['PASS', 'WARNING', 'FAIL', 'NEEDS_DATA'] },
      primary_quality_gap: { type: 'string' },
      affected_metrics: { type: 'array', items: { type: 'string' } },
      suspected_process_regions: { type: 'array', items: { type: 'string' } },
      evidence_level: { type: 'integer', minimum: 1, maximum: 7 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      recommended_next_action: { type: 'string' },
      blocking_issues: { type: 'array', items: { type: 'string' } },
      response_assessment: { type: 'string' },
      current_loss: { type: 'number' },
      metric_evaluations: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
      process_risk_summary: { type: 'object', additionalProperties: true },
      history_signal_summary: { type: 'object', additionalProperties: true },
      decision_context: { type: 'object', additionalProperties: true },
      strategy_recommendation: {
        type: 'object',
        required: ['next_stage', 'reason', 'trigger'],
        properties: {
          next_stage: { type: 'string', enum: ['explore', 'exploit', 'recover'] },
          reason: { type: 'string' },
          trigger: { type: 'string' }
        },
        additionalProperties: true
      }
    },
    additionalProperties: true
  };
}

function rdSchema() {
  return {
    type: 'object',
    required: [
      'objective',
      'hypothesis',
      'control_mode',
      'fixed_parameters',
      'candidate_parameters',
      'hold_time_minutes',
      'success_criteria',
      'stop_rules',
      'plan_rationale',
      'review_focus',
      'strategy_guidance'
    ],
    properties: {
      objective: { type: 'string' },
      hypothesis: { type: 'string' },
      control_mode: { type: 'string', enum: ['explore', 'exploit', 'recover'] },
      fixed_parameters: { type: 'array', items: { type: 'string' } },
      candidate_parameters: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
      hold_time_minutes: { type: 'number', minimum: 0 },
      success_criteria: { type: 'array', items: { type: 'string' } },
      stop_rules: { type: 'array', items: { type: 'string' } },
      plan_rationale: { type: 'object', additionalProperties: true },
      review_focus: { type: 'array', items: { type: 'string' } },
      strategy_guidance: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  };
}

function processSchema() {
  return {
    type: 'object',
    required: [
      'campaign_id',
      'experiment_id',
      'source_plan',
      'setpoint_changes',
      'rollback_recipe',
      'expected_lag_minutes',
      'execution_intent'
    ],
    properties: {
      campaign_id: { type: 'string' },
      experiment_id: { type: 'string' },
      source_plan: { type: 'string' },
      setpoint_changes: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
      rollback_recipe: { type: 'string' },
      expected_lag_minutes: { type: 'number', minimum: 0 },
      execution_intent: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  };
}

function compactContext(value) {
  return JSON.stringify(value, null, 2);
}

function summarizeSnapshot(snapshot = {}) {
  return {
    campaign_id: snapshot.campaign_id,
    product_grade: snapshot.product_grade,
    experiment_id: snapshot.experiment_id,
    recipe_id: snapshot.recipe_id,
    line_state: snapshot.line_state,
    alarm_active: snapshot.alarm_active,
    time_since_last_change_sec: snapshot.time_since_last_change_sec,
    setpoints: snapshot.setpoints,
    process_values: snapshot.process_values
  };
}

function summarizeQuality(quality = {}) {
  return {
    campaign_id: quality.campaign_id,
    product_grade: quality.product_grade,
    experiment_id: quality.experiment_id,
    metrics: quality.metrics,
    sensor_health: quality.sensor_health
  };
}

function summarizeTarget(target = {}) {
  return {
    campaign_id: target.campaign_id,
    product_grade: target.product_grade,
    user_goal: target.user_objective?.performance_goal || '',
    priority_order: target.user_objective?.priority_order || [],
    targets: target.targets,
    safety_limits: target.constraints?.safety_limits || null,
    product_context: {
      display_name: target.product_context?.display_name || null,
      material_family: target.product_context?.material_family || null,
      process_notes: target.product_context?.process_notes || [],
      historical_recipes: (target.product_context?.historical_recipes || []).slice(0, 2)
    }
  };
}

function summarizeHistory(history = []) {
  return history.slice(-2).map((item) => ({
    iteration: item.iteration,
    stage: item.stage,
    lever: item.plan?.candidate_parameters?.[0]?.name || null,
    direction: item.plan?.candidate_parameters?.[0]?.direction || null,
    experiment_decision: item.experiment_result?.decision || null,
    quality_loss_change_pct: item.experiment_result?.online_response?.quality_loss_change_pct ?? null,
    birefringence_cv_change_pct: item.experiment_result?.online_response?.birefringence_cv_change_pct ?? null,
    thickness_cv_change_pct: item.experiment_result?.online_response?.thickness_cv_change_pct ?? null
  }));
}

function summarizeQualityInput(input) {
  return {
    snapshot: summarizeSnapshot(input.snapshot),
    quality: summarizeQuality(input.quality),
    target: summarizeTarget(input.target),
    previous_quality_metrics: input.previousQuality?.metrics || null,
    history_digest: summarizeHistory(input.history),
    strategy_state: input.strategyState || null
  };
}

function summarizeRDInput(input) {
  return {
    diagnosis: input.diagnosis,
    snapshot: summarizeSnapshot(input.snapshot),
    quality: summarizeQuality(input.quality),
    target: summarizeTarget(input.target),
    history_digest: summarizeHistory(input.history),
    strategy_state: input.strategyState || null
  };
}

function summarizeProcessInput(input) {
  return {
    campaign_id: input.campaignId,
    iteration: input.iteration,
    snapshot: summarizeSnapshot(input.snapshot),
    plan: input.plan,
    strategy_state: input.strategyState || null,
    rollback_recipe_id: input.rollbackRecipeId || null
  };
}

function buildQualityPrompt({ baseline, input }) {
  return [
    '你是闭环优化团队中的质量工程师。',
    '你的职责是基于当前快照、在线质量、目标窗口和历史响应，给出结构化质量诊断。',
    '必须保持输出为 JSON，并满足给定 schema。',
    '不能提出直接写设备的动作，不能越过 safety gate。',
    '如果基线方案已经合理，可以保持它；如果你认为需要修正，请只做小幅、可解释的修正。',
    '',
    '请参考以下上下文：',
    compactContext({
      input: summarizeQualityInput(input),
      deterministic_baseline: baseline
    }),
    '',
    '输出要求：',
    '- 保持 `metric_evaluations` 与输入目标一致。',
    '- `strategy_recommendation.next_stage` 只能是 explore/exploit/recover。',
    '- 如果报警或传感器退化，优先建议 recover。',
    '- `current_loss` 应与当前质量状态一致，保持数值型。',
    '- 所有结论必须围绕当前产品型号和当前目标，不允许跨产品混用经验。'
  ].join('\n');
}

function buildRDPrompt({ baseline, input }) {
  return [
    '你是闭环优化团队中的研发工程师。',
    '你的职责是基于质量诊断、产品上下文、历史响应和当前工艺状态，给出一个阶段感知的研发优化计划。',
    '必须保持输出为 JSON，并满足给定 schema。',
    '不能直接写 PLC 或设备，只能提出参数策略。',
    '优先在基线方案上做审慎增强，而不是完全推翻。',
    '',
    '请参考以下上下文：',
    compactContext({
      input: summarizeRDInput(input),
      deterministic_baseline: baseline
    }),
    '',
    '输出要求：',
    '- `candidate_parameters[0]` 必须是本轮主杠杆。',
    '- `control_mode` 必须与当前阶段一致。',
    '- 参数范围必须留在输入基线允许范围内。',
    '- `plan_rationale.selected_primary_lever` 必须与主杠杆一致。',
    '- 目标是帮助工艺工程师生成可安全执行的 proposal。'
  ].join('\n');
}

function buildProcessPrompt({ baseline, input }) {
  return [
    '你是闭环优化团队中的工艺工程师。',
    '你的职责是把研发方案转成受控、可回滚、可审批的执行 proposal。',
    '必须保持输出为 JSON，并满足给定 schema。',
    '不能绕过 rollback recipe、不能绕过安全边界、不能提出超出 allowed_range 的值。',
    '优先在基线 proposal 上做小幅修正，而不是激进重写。',
    '',
    '请参考以下上下文：',
    compactContext({
      input: summarizeProcessInput(input),
      deterministic_baseline: baseline
    }),
    '',
    '输出要求：',
    '- `setpoint_changes` 只允许改动已选主杠杆，除非有非常明确的必要。',
    '- `target` 必须位于 `allowed_range` 内。',
    '- `rollback_recipe` 必须保留当前最佳基线 recipe。',
    '- `execution_intent.control_mode` 必须与当前阶段一致。'
  ].join('\n');
}

function normalizeProcessProposal(proposal, baseline) {
  const change = proposal?.setpoint_changes?.[0];
  const baseChange = baseline.setpoint_changes[0];
  if (!change) return baseline;
  const normalized = {
    ...baseline,
    ...proposal,
    setpoint_changes: [
      {
        ...baseChange,
        ...change
      }
    ],
    execution_intent: {
      ...baseline.execution_intent,
      ...(proposal.execution_intent || {})
    }
  };
  return normalized;
}

export async function executeQualityRole({
  mode,
  config,
  projectRoot,
  trialEvidenceDir,
  input
}) {
  const baseline = qualityEngineer(input);
  if (mode !== 'claude_cli') {
    return { result: baseline, baseline, reasoning: { mode: 'deterministic' } };
  }

  const prompt = buildQualityPrompt({ baseline, input });
  const response = await runClaudeStructured({
    prompt,
    schema: qualitySchema(),
    config,
    cwd: projectRoot
  });
  const reasoning = {
    mode: 'claude_cli',
    role: 'quality',
    model: response.raw.modelUsage ? Object.keys(response.raw.modelUsage)[0] : (config.model || 'sonnet'),
    session_id: response.raw.session_id || null,
    total_cost_usd: response.raw.total_cost_usd ?? null
  };
  writeJson(path.join(trialEvidenceDir, 'claude_quality_reasoning.json'), {
    prompt,
    baseline,
    structured_output: response.structured,
    raw: response.raw
  });
  return {
    result: response.structured,
    baseline,
    reasoning
  };
}

export async function executeRDRole({
  mode,
  config,
  projectRoot,
  trialEvidenceDir,
  input
}) {
  const baseline = rdEngineer(input);
  if (mode !== 'claude_cli') {
    return { result: baseline, baseline, reasoning: { mode: 'deterministic' } };
  }

  const prompt = buildRDPrompt({ baseline, input });
  const response = await runClaudeStructured({
    prompt,
    schema: rdSchema(),
    config,
    cwd: projectRoot
  });
  const reasoning = {
    mode: 'claude_cli',
    role: 'rd',
    model: response.raw.modelUsage ? Object.keys(response.raw.modelUsage)[0] : (config.model || 'sonnet'),
    session_id: response.raw.session_id || null,
    total_cost_usd: response.raw.total_cost_usd ?? null
  };
  writeJson(path.join(trialEvidenceDir, 'claude_rd_reasoning.json'), {
    prompt,
    baseline,
    structured_output: response.structured,
    raw: response.raw
  });
  return {
    result: response.structured,
    baseline,
    reasoning
  };
}

export async function executeProcessRole({
  mode,
  config,
  projectRoot,
  trialEvidenceDir,
  input
}) {
  const baseline = processEngineer(input);
  if (mode !== 'claude_cli') {
    return { result: baseline, baseline, reasoning: { mode: 'deterministic' } };
  }

  const prompt = buildProcessPrompt({ baseline, input });
  const response = await runClaudeStructured({
    prompt,
    schema: processSchema(),
    config,
    cwd: projectRoot
  });
  const normalized = normalizeProcessProposal(response.structured, baseline);
  const reasoning = {
    mode: 'claude_cli',
    role: 'process',
    model: response.raw.modelUsage ? Object.keys(response.raw.modelUsage)[0] : (config.model || 'sonnet'),
    session_id: response.raw.session_id || null,
    total_cost_usd: response.raw.total_cost_usd ?? null
  };
  writeJson(path.join(trialEvidenceDir, 'claude_process_reasoning.json'), {
    prompt,
    baseline,
    structured_output: response.structured,
    normalized_output: normalized,
    raw: response.raw
  });
  return {
    result: normalized,
    baseline,
    reasoning
  };
}

export function buildDerivedArtifacts({
  target,
  snapshot,
  quality,
  diagnosis,
  history,
  iteration,
  strategyState,
  plan,
  approvalRequired,
  config,
  campaignId,
  rollbackRecipeId
}) {
  const qualityReview = buildQualityReviewReport({
    target,
    snapshot,
    quality,
    diagnosis,
    history,
    iteration,
    strategyState
  });
  const rdBrief = buildRDAgentBrief({
    target,
    diagnosis,
    history,
    iteration,
    strategyState
  });
  const processBrief = buildProcessAgentBrief({
    target,
    plan,
    diagnosis,
    iteration,
    strategyState,
    approvalRequired
  });
  const proposal = processEngineer({
    campaignId,
    iteration,
    plan,
    snapshot,
    strategyState,
    rollbackRecipeId
  });
  const fallbackApprovalPacket = buildApprovalPacket({
    target,
    proposal,
    safetyGate: { allowed: true, violations: [], approval_required: approvalRequired, limit_applied: false, rollback_recipe: rollbackRecipeId || snapshot.recipe_id },
    strategyState,
    config,
    approvalDecision: { default_status: approvalRequired ? 'pending' : 'approved', auto_approved: !approvalRequired },
    iteration
  });

  return {
    qualityReview,
    rdBrief,
    processBrief,
    proposal,
    fallbackApprovalPacket
  };
}

export function buildStrategyStateFromDiagnosis({
  iteration,
  previousState,
  diagnosis,
  history,
  config
}) {
  return buildStrategyState({
    iteration,
    previousState,
    diagnosis,
    history,
    config
  });
}
