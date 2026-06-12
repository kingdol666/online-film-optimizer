import { uniqueNowId } from './lib/ids.mjs';
import { getProductProfile, getProductSafetyLimits } from '../../simulator/industrial-film-line/product-catalog.mjs';

/**
 * Persistent optimization tunables.
 * Lower thresholds → more aggressive exploration, fewer recover triggers.
 * Increase consecutive-worse tolerance so we keep trying different levers
 * instead of giving up after a single regression.
 */
const TUNING = Object.freeze({
  /** Response is "improved" when loss drops > this fraction (default 3%). */
  improve_threshold: 0.03,
  /** Response is "worse" when loss rises > this fraction (default 5%). */
  worse_threshold: 0.05,
  /** Exploit-eligible when current loss < this threshold. */
  exploit_loss_threshold: 0.60,
  /** Exploit stage when at least N effective trials in recent history. */
  exploit_effective_count: 1,
  /** Switch to recover only when worse_count >= this (was 2). */
  recover_worse_count: 4,
  /** Maximum consecutive worse before forced break. */
  max_consecutive_worse: 4,
  /** Recent-history window size. */
  history_window: 6,
});

function buildProductionGovernanceContext(productionGovernance = null) {
  if (!productionGovernance) {
    return {
      mode: 'campaign_default',
      run_until_goal: true,
      industrial_boundary: 'bounded_continuous_optimization'
    };
  }
  return {
    mode: productionGovernance.enabled ? 'production_campaign' : 'demo_campaign',
    run_until_goal: Boolean(productionGovernance.run_until_goal),
    max_trial_count: productionGovernance.max_trial_count ?? null,
    max_strategy_cycles: productionGovernance.max_strategy_cycles ?? null,
    max_runtime_minutes: productionGovernance.max_runtime_minutes ?? null,
    pass_hold_iterations: productionGovernance.pass_hold_iterations ?? null,
    stable_recipe_hold_minutes: productionGovernance.stable_recipe_hold_minutes ?? null,
    shadow_validation_required: productionGovernance.shadow_validation_required ?? true,
    physics_constraints_enabled: productionGovernance.physics_constraints_enabled ?? true,
    spc_diagnosis_enabled: productionGovernance.spc_diagnosis_enabled ?? true,
    industrial_boundary: 'continue_until_goal_or_governance_limit'
  };
}

function buildBopetPhysicsContext({
  snapshot,
  quality,
  target,
  history = [],
  metricEvaluations = []
}) {
  const profile = getProductProfile(target.product_grade);
  const optimum = profile.model?.optimum || {};
  const setpoints = snapshot.setpoints || {};
  const metrics = quality.metrics || {};
  const family = String(target.product_context?.material_family || profile.material_family || 'PET').toUpperCase();
  const drawBalance = round((setpoints.td_draw_ratio || 0) - (setpoints.md_draw_ratio || 0), 5);
  const heatRelaxationIndex = round(
    ((setpoints.td_zone_1_temp || 0) + (setpoints.td_zone_2_temp || 0) + (setpoints.heatset_temp || 0)) / 3
      - (profile.model?.heat_balance_reference || setpoints.td_zone_2_temp || 0),
    5
  );
  const orientationGap = Number.isFinite(metrics.birefringence_mean)
    ? round(metrics.birefringence_mean - target.targets.birefringence_mean.target, 6)
    : null;
  const primaryOutOfSpec = metricEvaluations
    .filter((item) => !item.within_spec)
    .map((item) => item.metric);
  const leverCouplings = {
    td_zone_2_temp: ['TD thermal uniformity', 'orientation relaxation', 'birefringence_cv'],
    heatset_temp: ['residual stress relaxation', 'thermal shrinkage risk', 'birefringence_mean'],
    td_draw_ratio: ['TD orientation', 'edge-center profile', 'thickness_cv'],
    md_draw_ratio: ['MD orientation', 'draw balance', 'birefringence_mean'],
    winder_tension: ['winding stability', 'profile amplification', 'thickness_cv'],
    extruder_speed: ['throughput', 'thickness_mean', 'drawdown balance'],
    line_speed: ['residence time', 'drawdown', 'thickness_mean']
  };
  const riskFlags = [];
  if (Math.abs(orientationGap || 0) > target.targets.birefringence_mean.tolerance * 1.5) {
    riskFlags.push('orientation_mean_offset');
  }
  if (primaryOutOfSpec.includes('birefringence_cv')) riskFlags.push('orientation_uniformity_risk');
  if (primaryOutOfSpec.includes('thickness_cv')) riskFlags.push('profile_uniformity_risk');
  if (Math.abs(drawBalance - ((optimum.td_draw_ratio || 0) - (optimum.md_draw_ratio || 0))) > 0.18) {
    riskFlags.push('md_td_draw_balance_deviation');
  }
  if (family === 'PET' && Math.abs(heatRelaxationIndex) > 45) riskFlags.push('thermal_relaxation_window_deviation');
  if (family !== 'PET' && Math.abs(heatRelaxationIndex) > 25) riskFlags.push('narrow_thermal_window_material');

  return {
    model: 'bopet_physics_reduced_order_v1',
    material_family: family,
    product_grade: target.product_grade,
    primary_out_of_spec: primaryOutOfSpec,
    draw_balance: drawBalance,
    heat_relaxation_index: heatRelaxationIndex,
    orientation_gap: orientationGap,
    process_region_hypotheses: inferProcessRegionHypotheses(primaryOutOfSpec),
    lever_couplings: leverCouplings,
    best_history_count: history.length,
    risk_flags: riskFlags,
    overall_risk: snapshot.alarm_active
      ? 'alarm_blocked'
      : riskFlags.length >= 3
        ? 'high'
        : riskFlags.length >= 1
          ? 'medium'
          : 'low',
    physical_constraints: {
      do_not_change_all_coupled_draw_and_heat_levers_at_once: true,
      hold_after_write_before_quality_judgement: true,
      release_requires_shadow_validation: true
    }
  };
}

function inferProcessRegionHypotheses(metrics) {
  const hypotheses = new Set();
  if (metrics.includes('thickness_mean')) hypotheses.add('extrusion_drawdown_balance');
  if (metrics.includes('thickness_cv')) hypotheses.add('casting_td_profile_winding_chain');
  if (metrics.includes('birefringence_mean')) hypotheses.add('md_td_orientation_balance');
  if (metrics.includes('birefringence_cv')) hypotheses.add('td_thermal_uniformity_heatset_relaxation');
  if (hypotheses.size === 0) hypotheses.add('stable_recipe_hold_validation');
  return [...hypotheses];
}

function buildSpcQualityContext({
  quality,
  previousQuality = null,
  history = [],
  historianWindow = null
}) {
  const metrics = quality.metrics || {};
  const previousMetrics = previousQuality?.metrics || null;
  const metricTrend = {};
  for (const [metric, value] of Object.entries(metrics)) {
    const previous = previousMetrics?.[metric];
    metricTrend[metric] = {
      current: round(value, 6),
      previous: Number.isFinite(previous) ? round(previous, 6) : null,
      delta: Number.isFinite(previous) ? round(value - previous, 6) : null,
      delta_pct: Number.isFinite(previous) ? round(percentChange(value, previous), 4) : null
    };
  }
  const recent = history.slice(-TUNING.history_window);
  const lossSeries = recent
    .map((item) => item.experiment_result?.online_response?.quality_loss_change_pct)
    .filter((value) => Number.isFinite(value));
  const avgLossChange = lossSeries.length > 0
    ? round(lossSeries.reduce((sum, value) => sum + value, 0) / lossSeries.length, 4)
    : null;
  const positiveDrift = lossSeries.filter((value) => value > 3).length;
  const negativeDrift = lossSeries.filter((value) => value < -3).length;

  return {
    model: 'spc_lightweight_v1',
    historian_window_available: Boolean(historianWindow),
    recent_trials: recent.length,
    sensor_health: quality.sensor_health || 'UNKNOWN',
    metric_trend: metricTrend,
    quality_loss_change_avg_pct: avgLossChange,
    cusum_like_signal: {
      positive_worsening_count: positiveDrift,
      negative_improvement_count: negativeDrift
    },
    control_state: quality.sensor_health && quality.sensor_health !== 'OK'
      ? 'sensor_degraded'
      : positiveDrift >= 3
        ? 'drifting_worse'
        : negativeDrift >= 2
          ? 'improving'
          : recent.length >= 3
            ? 'stable_or_mixed'
            : 'insufficient_history',
    required_next_evidence: recent.length >= 3
      ? ['stable_window_after_write', 'profile_repeatability']
      : ['more_trials_for_spc_confidence']
  };
}

export function qualityEngineer({
  snapshot,
  quality,
  target,
  previousQuality = null,
  history = [],
  strategyState = null,
  cadencePlan = null,
  historianWindow = null,
  productionGovernance = null
}) {
  const metrics = quality.metrics;
  const targetSpec = target.targets;
  const metricEvaluations = buildMetricEvaluations(metrics, targetSpec);
  const outOfSpec = metricEvaluations.filter((item) => !item.within_spec);
  const primary = [...outOfSpec].sort((a, b) => b.normalized_gap - a.normalized_gap)[0] || null;
  const pass = outOfSpec.length === 0 && !snapshot.alarm_active;
  const cadenceMode = cadencePlan?.quality_review_mode || 'standard';

  const lossCurrent = qualityLoss(metrics, target);
  const lossPrevious = previousQuality ? qualityLoss(previousQuality.metrics, target) : null;
  const responseAssessment = classifyResponse(lossPrevious, lossCurrent);
  const recentDecisionTrail = summarizeRecentDecisionTrail(history);
  const physicsContext = buildBopetPhysicsContext({
    snapshot,
    quality,
    target,
    history,
    metricEvaluations
  });
  const spcContext = buildSpcQualityContext({
    quality,
    previousQuality,
    history,
    historianWindow
  });

  const processRegionMap = {
    thickness_mean: ['extrusion_casting_stretch_balance'],
    thickness_cv: ['TD_stretching_winding'],
    birefringence_mean: ['MD_TD_stretching_heat_setting'],
    birefringence_cv: ['TD_stretching_heat_setting']
  };

  const suspectedRegions = outOfSpec.flatMap((item) => processRegionMap[item.metric] || []);
  const historySignals = summarizeHistorySignals(history);
  const processRisk = summarizeProcessRisk(snapshot, quality, historySignals, recentDecisionTrail);
  const stageRecommendation = recommendStrategyStage({
    pass,
    snapshot,
    quality,
    responseAssessment,
    historySignals,
    strategyState,
    currentLoss: lossCurrent
  });
  const evidenceLevelBase = history.length > 1 ? 5 : previousQuality ? 4 : 3;
  const evidenceLevel = cadenceMode === 'deep_review'
    ? Math.min(7, evidenceLevelBase + 1)
    : evidenceLevelBase;
  const decisionContext = {
    quality_priority: primary?.metric || 'none',
    improvement_urgency: pass ? 'hold' : primary?.normalized_gap > 0.5 ? 'high' : 'medium',
    history_signal: historySignals.summary,
    response_assessment: responseAssessment,
    stage_recommendation: stageRecommendation.next_stage,
    cadence_mode: cadenceMode,
    physics_risk: physicsContext.overall_risk,
    spc_state: spcContext.control_state
  };

  return {
    quality_state: pass ? 'PASS' : snapshot.alarm_active ? 'FAIL' : 'WARNING',
    primary_quality_gap: primary?.metric || 'none',
    affected_metrics: outOfSpec.map((item) => item.metric),
    suspected_process_regions: [...new Set(suspectedRegions)],
    evidence_level: evidenceLevel,
    confidence: pass ? 0.9 : primary ? Math.min(0.9, 0.58 + primary.normalized_gap * 0.18) : 0.6,
    recommended_next_action: deriveNextAction({ pass, snapshot, responseAssessment, historySignals }),
    blocking_issues: buildBlockingIssues(snapshot, quality),
    response_assessment: responseAssessment,
    current_loss: round(lossCurrent, 5),
    metric_evaluations: metricEvaluations,
    process_risk_summary: processRisk,
    spc_quality_context: spcContext,
    physics_context: physicsContext,
    production_governance_context: buildProductionGovernanceContext(productionGovernance),
    history_signal_summary: historySignals,
    recent_decision_trail: recentDecisionTrail,
    decision_context: decisionContext,
    strategy_recommendation: {
      ...stageRecommendation,
      review_mode: cadenceMode
    },
    cadence_context: {
      quality_review_mode: cadenceMode,
      process_settle_minutes: cadencePlan?.process_settle_minutes ?? null,
      process_settle_ticks: cadencePlan?.process_settle_ticks ?? null,
      before_window_bias_ticks: cadencePlan?.before_window_bias_ticks ?? null
    }
  };
}

export function rdEngineer({
  diagnosis,
  snapshot,
  quality,
  target,
  history = [],
  strategyState = null,
  cadencePlan = null,
  productionGovernance = null
}) {
  const metrics = quality.metrics;
  const setpoints = snapshot.setpoints;
  const responseKnowledge = buildResponseKnowledge(history);
  const stage = strategyState?.stage || 'explore';
  const cadenceMode = cadencePlan?.rd_cycle_mode || 'standard';
  const candidateCatalog = buildCandidateCatalog({
    diagnosis,
    metrics,
    setpoints,
    target,
    responseKnowledge,
    strategyStage: stage,
    cadencePlan
  });

  const filtered = candidateCatalog.filter((candidate) => !responseKnowledge.recentRejects.has(candidate.name));
  const selectedCandidates = (filtered.length > 0 ? filtered : candidateCatalog)
    .map((candidate) => ({
      ...candidate,
      priority_score: round(candidate.priority_score + cadencePriorityAdjustment(candidate.name, cadenceMode, responseKnowledge), 4)
    }))
    .sort((a, b) => b.priority_score - a.priority_score);
  const selected = selectedCandidates[0] || candidateCatalog[0];

  return {
    objective: selected.objective,
    hypothesis: selected.hypothesis,
    control_mode: stage,
    cadence_mode: cadenceMode,
    fixed_parameters: ['line_speed'],
    candidate_parameters: selectedCandidates.slice(0, 3).map((candidate) => ({
      name: candidate.name,
      direction: candidate.direction,
      step: candidate.step,
      signed_step: candidate.signed_step,
      allowed_range: candidate.allowed_range,
      expected_response: candidate.expected_response,
      current: candidate.current,
      priority_score: candidate.priority_score,
      rationale: candidate.rationale,
      evidence: candidate.evidence
    })),
    hold_time_minutes: selected.hold_time_minutes,
    success_criteria: selected.success_criteria,
    stop_rules: selected.stop_rules,
    plan_rationale: {
      diagnosis_priority: diagnosis.primary_quality_gap,
      response_memory: responseKnowledge.summary,
      selected_primary_lever: selected.name,
      selected_reason: selected.rationale,
      control_mode: stage,
      mode_reason: strategyState?.transition_reason || 'default_stage_logic',
      physics_data_dual_drive: {
        physics_context: diagnosis.physics_context || null,
        spc_context: diagnosis.spc_quality_context || null,
        historian_window_used: Boolean(diagnosis.spc_quality_context?.historian_window_available),
        governance: buildProductionGovernanceContext(productionGovernance)
      }
    },
    review_focus: selected.review_focus,
    strategy_guidance: {
      stage,
      primary_lever_confidence: selected.lever_confidence,
      alternate_levers: selectedCandidates.slice(1, 3).map((item) => item.name),
      cadence_mode: cadenceMode
    }
  };
}

export function processEngineer({
  campaignId,
  iteration,
  plan,
  snapshot,
  strategyState = null,
  rollbackRecipeId = null,
  cadencePlan = null,
  productionGovernance = null
}) {
  const primary = plan.candidate_parameters[0];
  if (!primary) {
    throw new Error('missing_primary_candidate_parameter');
  }
  const targetValue = clamp(
    snapshot.setpoints[primary.name] + (primary.signed_step ?? signedDelta(primary.direction, primary.step)),
    primary.allowed_range[0],
    primary.allowed_range[1]
  );
  const deltaValue = round(targetValue - snapshot.setpoints[primary.name], 5);

  return {
    campaign_id: campaignId,
    experiment_id: `EXP-${String(iteration).padStart(3, '0')}`,
    source_plan: 'rd_optimization_plan.json',
    setpoint_changes: [
      {
        tag: primary.name,
        current: round(snapshot.setpoints[primary.name], 5),
        target: round(targetValue, 5),
        delta: deltaValue,
        ramp_limit_per_min: rampFor(primary.name, snapshot.product_grade || snapshot.productGrade || null),
        execution_role: 'primary_lever',
        expected_response: primary.expected_response
      }
    ],
    rollback_recipe: rollbackRecipeId || snapshot.recipe_id,
    expected_lag_minutes: plan.hold_time_minutes || cadencePlan?.process_settle_minutes || 8,
    production_execution_policy: {
      execution_mode: 'approval_gated',
      stable_wait_required: true,
      expected_stabilization_minutes: plan.hold_time_minutes || cadencePlan?.process_settle_minutes || 8,
      rollback_baseline_required: true,
      shadow_validation_required: productionGovernance?.shadow_validation_required ?? true,
      real_line_write_boundary: 'MCP/online bridge only after safety gate and approval'
    },
    execution_intent: {
      primary_objective: plan.objective,
      primary_hypothesis: plan.hypothesis,
      risk_guardrails: plan.stop_rules,
      control_mode: strategyState?.stage || plan.control_mode || 'explore',
      operator_message: `调整 ${primary.name} 以验证：${primary.expected_response}`,
      physics_risk_screen: plan.plan_rationale?.physics_data_dual_drive?.physics_context || null
    }
  };
}

export function qualityLoss(metrics, target) {
  const spec = target.targets;
  const thicknessMean = Math.max(0, Math.abs(metrics.thickness_mean - spec.thickness_mean.target) - spec.thickness_mean.tolerance) / spec.thickness_mean.tolerance;
  const thicknessCv = Math.max(0, metrics.thickness_cv - spec.thickness_cv.max) / spec.thickness_cv.max;
  const bireMean = Math.max(0, Math.abs(metrics.birefringence_mean - spec.birefringence_mean.target) - spec.birefringence_mean.tolerance) / spec.birefringence_mean.tolerance;
  const bireCv = Math.max(0, metrics.birefringence_cv - spec.birefringence_cv.max) / spec.birefringence_cv.max;
  return 0.24 * thicknessMean + 0.26 * thicknessCv + 0.24 * bireMean + 0.26 * bireCv;
}

export function buildStrategyState({
  iteration,
  previousState = null,
  diagnosis,
  history = [],
  config
}) {
  const currentStage = previousState?.stage || 'explore';
  const nextStage = diagnosis.strategy_recommendation?.next_stage || currentStage;
  const effectiveCount = history.filter((item) => item.experiment_result?.decision === 'effective').length;
  const worseCount = history.filter((item) => item.experiment_result?.decision === 'worse').length;
  const latestLever = history.at(-1)?.plan?.candidate_parameters?.[0]?.name || null;

  return {
    iteration,
    stage: nextStage,
    previous_stage: currentStage,
    transition_reason: diagnosis.strategy_recommendation?.reason || 'hold_stage',
    switch_trigger: diagnosis.strategy_recommendation?.trigger || 'quality_loop',
    dominant_lever_confidence: round(Math.min(0.95, 0.45 + effectiveCount * 0.12 - worseCount * 0.08), 4),
    dominant_lever: latestLever,
    escalation_conditions: {
      enter_recover_on_consecutive_worse: config.orchestrator.max_consecutive_worse,
      enter_recover_on_sensor_health: config.orchestrator.stage_switch.recover_sensor_health,
      enter_exploit_on_effective_count: config.orchestrator.stage_switch.exploit_effective_count
    },
    evidence_digest: {
      history_signal: diagnosis.history_signal_summary?.summary || 'no_history',
      quality_state: diagnosis.quality_state,
      current_loss: diagnosis.current_loss
    }
  };
}

export function buildApprovalPacket({
  target,
  proposal,
  safetyGate,
  strategyState,
  config,
  approvalDecision,
  iteration
}) {
  return {
    role: 'process-engineer',
    iteration,
    packet_type: 'setpoint_execution_approval',
    approval_status: approvalDecision.default_status,
    approval_required: true,
    approval_source: approvalDecision.auto_approved ? 'system_auto' : 'human_or_external',
    execution_mode: config.orchestrator.execution_mode,
    user_goal: target.user_objective?.performance_goal || '',
    control_mode: strategyState.stage,
    proposal,
    safety_gate_result: safetyGate,
    guardrails: {
      required_before_apply: ['safety_gate_allowed', 'approval_status=approved'],
      rollback_recipe: proposal.rollback_recipe,
      stop_rules: proposal.execution_intent?.risk_guardrails || []
    }
  };
}

export function summarizeExperiment({
  campaignId,
  experimentId,
  before,
  after,
  receipt,
  strategyState
}) {
  const lossBefore = before.loss;
  const lossAfter = after.loss;
  const qualityLossChangePct = round(percentChange(lossAfter, lossBefore), 4);
  const decision = !receipt.executed
    ? 'rejected'
    : lossAfter < lossBefore * 0.97
      ? 'effective'
      : lossAfter > lossBefore * 1.03
        ? 'worse'
        : 'ineffective';

  return {
    campaign_id: campaignId,
    experiment_id: experimentId,
    executed: Boolean(receipt.executed),
    write_confirmed: Boolean(receipt.write_confirmed),
    stable_window_before: before.windowId,
    stable_window_after: after.windowId,
    control_mode: strategyState?.stage || 'explore',
    online_response: {
      thickness_cv_change_pct: round(percentChange(after.metrics.thickness_cv, before.metrics.thickness_cv), 4),
      birefringence_cv_change_pct: round(percentChange(after.metrics.birefringence_cv, before.metrics.birefringence_cv), 4),
      quality_loss_change_pct: qualityLossChangePct
    },
    decision,
    waste_meter: after.wasteMeter,
    operator_note: `simulated ${decision} run`,
    data_mining_summary: {
      response_strength: Math.abs(qualityLossChangePct),
      dominant_metric_shift: dominantMetricShift(before.metrics, after.metrics),
      recommended_followup:
        decision === 'effective'
          ? 'keep_learning_same_direction'
          : decision === 'worse'
            ? 'change_primary_lever'
            : 'increase_information_gain'
    }
  };
}

export function recipeRecommendation({ simulator, target, finalQuality, finalLoss, bestObserved }) {
  const pass = qualityLoss(finalQuality.metrics, target) === 0;
  const bestPass = Number.isFinite(bestObserved?.loss) && bestObserved.loss === 0;
  const candidateId = pass
    ? `RCP-CANDIDATE-${uniqueNowId()}`
    : bestObserved
      ? `RCP-BEST-${bestObserved.experiment_id}`
      : simulator.recipeId;
  if (pass || bestObserved) {
    simulator.saveCandidateRecipe({
      recipeId: candidateId,
      metadata: {
        finalLoss,
        bestObservedLoss: bestObserved?.loss ?? null,
        status: pass || bestPass ? 'pass' : 'best_observed_needs_more_validation'
      }
    });
  }
  const releaseCandidate = pass || bestPass;
  return {
    candidate_recipe_id: candidateId,
    product_grade: target.product_grade,
    material_family: target.product_context?.material_family || null,
    release_status: releaseCandidate ? 'candidate' : 'needs_more_validation',
    quality_evidence: pass
      ? ['online_quality_pass', 'simulation_campaign_pass']
      : bestPass
        ? ['best_observed_recipe_pass', 'best_observed_recipe_restored']
        : bestObserved
        ? ['best_observed_recipe_restored', 'online_quality_not_fully_passed']
        : ['online_quality_not_fully_passed'],
    required_before_release: ['offline_tensile_test', 'thermal_shrinkage_test', 'real_line_shadow_mode_validation'],
    recommended_use: releaseCandidate ? 'simulation_candidate_ready_for_shadow_validation' : 'continue_simulation_optimization',
    collaboration_summary: {
      quality_role: 'diagnosed current dominant gap and stage recommendation',
      rd_role: 'ranked candidate levers using stage-aware response knowledge',
      process_role: 'translated selected lever into approval-gated executable action'
    }
  };
}

export function buildRDAgentBrief({
  target,
  diagnosis,
  history = [],
  iteration,
  strategyState = null,
  cadencePlan = null,
  cycleState = null
}) {
  return {
    role: 'rd-engineer',
    iteration,
    strategy_cycle_id: cycleState?.strategy_cycle_id || 1,
    process_iteration_in_cycle: cycleState?.process_iteration_in_cycle || 1,
    plan_source: cycleState?.plan_source || 'replanned',
    replan_reason: cycleState?.replan_reason || 'initial_cycle_plan',
    user_goal: target.user_objective?.performance_goal || 'optimize online quality toward target product window',
    business_context: target.user_objective?.business_context || '',
    target_priority_order: target.user_objective?.priority_order || [],
    diagnosis_priority: diagnosis.primary_quality_gap,
    recommendation_from_quality: diagnosis.recommended_next_action,
    strategy_stage: strategyState?.stage || diagnosis.strategy_recommendation?.next_stage || 'explore',
    cadence_plan: cadencePlan,
    physics_context: diagnosis.physics_context || null,
    spc_quality_context: diagnosis.spc_quality_context || null,
    history_signal: diagnosis.history_signal_summary?.summary || 'no_history',
    response_memory_window: history.slice(-3).map((item) => ({
      iteration: item.iteration,
      decision: item.experiment_result?.decision,
      lever: item.plan?.candidate_parameters?.[0]?.name || null
    }))
  };
}

export function buildProcessAgentBrief({
  target,
  plan,
  diagnosis,
  iteration,
  strategyState = null,
  approvalRequired = true,
  cadencePlan = null,
  cycleState = null
}) {
  return {
    role: 'process-engineer',
    iteration,
    strategy_cycle_id: cycleState?.strategy_cycle_id || 1,
    process_iteration_in_cycle: cycleState?.process_iteration_in_cycle || 1,
    plan_source: cycleState?.plan_source || 'replanned',
    user_goal: target.user_objective?.performance_goal || 'optimize online quality toward target product window',
    primary_objective: plan.objective,
    primary_hypothesis: plan.hypothesis,
    selected_lever: plan.candidate_parameters?.[0]?.name || null,
    strategy_stage: strategyState?.stage || plan.control_mode || 'explore',
    cadence_plan: cadencePlan,
    review_focus: plan.review_focus || [],
    diagnosis_priority: diagnosis.primary_quality_gap,
    physics_risk: diagnosis.physics_context?.overall_risk || 'unknown',
    spc_state: diagnosis.spc_quality_context?.control_state || 'unknown',
    stable_wait_minutes: plan.hold_time_minutes || cadencePlan?.process_settle_minutes || null,
    risk_posture: diagnosis.process_risk_summary?.execution_readiness || 'ready',
    approval_required: Boolean(approvalRequired)
  };
}

export function buildQualityReviewReport({
  target,
  snapshot,
  quality,
  diagnosis,
  history = [],
  iteration,
  strategyState = null,
  cadencePlan = null,
  cycleState = null
}) {
  return {
    role: 'quality-engineer',
    iteration,
    strategy_cycle_id: cycleState?.strategy_cycle_id || 1,
    process_iteration_in_cycle: cycleState?.process_iteration_in_cycle || 1,
    report_type: 'periodic_quality_review',
    user_goal: target.user_objective?.performance_goal || 'optimize online quality toward target product window',
    product_grade: target.product_grade,
    strategy_stage: strategyState?.stage || diagnosis.strategy_recommendation?.next_stage || 'explore',
    line_state: snapshot.line_state,
    sensor_health: quality.sensor_health,
    current_recipe: snapshot.recipe_id,
    current_setpoints: snapshot.setpoints,
    key_metrics: quality.metrics,
    diagnosis_summary: {
      quality_state: diagnosis.quality_state,
      primary_quality_gap: diagnosis.primary_quality_gap,
      recommended_next_action: diagnosis.recommended_next_action,
      current_loss: diagnosis.current_loss
    },
    metric_evaluations: diagnosis.metric_evaluations,
    process_risk_summary: diagnosis.process_risk_summary,
    spc_quality_context: diagnosis.spc_quality_context || null,
    physics_context: diagnosis.physics_context || null,
    production_governance_context: diagnosis.production_governance_context || null,
    history_signal_summary: diagnosis.history_signal_summary,
    stage_recommendation: diagnosis.strategy_recommendation,
    cadence_plan: cadencePlan,
    cross_role_guidance: {
      for_rd: diagnosis.decision_context,
      for_process: {
        execution_readiness: diagnosis.process_risk_summary.execution_readiness,
        blocking_issues: diagnosis.blocking_issues
      }
    },
    recent_response_digest: history.slice(-3).map((item) => ({
      iteration: item.iteration,
      lever: item.plan?.candidate_parameters?.[0]?.name || null,
      decision: item.experiment_result?.decision,
      quality_loss_change_pct: item.experiment_result?.online_response?.quality_loss_change_pct ?? null
    }))
  };
}

export function buildCoordinationIndex({
  iteration,
  experimentId,
  artifactPaths
}) {
  return {
    iteration,
    experiment_id: experimentId,
    artifacts: artifactPaths,
    updated_at: new Date().toISOString()
  };
}

export function buildExecutiveSummary({
  target,
  strategyState,
  diagnosis,
  plan,
  approvalPacket,
  experimentResult,
  cycleState = null,
  final = false
}) {
  const lines = [
    '# Coordination Executive Summary',
    '',
    `- User goal: ${target.user_objective?.performance_goal || ''}`,
    `- Stage: ${strategyState?.stage || plan?.control_mode || 'explore'}`,
    `- Strategy cycle: ${cycleState?.strategy_cycle_id || 1}`,
    `- Process iteration in cycle: ${cycleState?.process_iteration_in_cycle || 1}`,
    `- Quality state: ${diagnosis?.quality_state || 'unknown'}`,
    `- Current loss: ${diagnosis?.current_loss ?? 'n/a'}`,
    `- Primary gap: ${diagnosis?.primary_quality_gap || 'none'}`,
    `- SPC state: ${diagnosis?.spc_quality_context?.control_state || 'n/a'}`,
    `- Physics risk: ${diagnosis?.physics_context?.overall_risk || 'n/a'}`,
    `- Selected lever: ${plan?.candidate_parameters?.[0]?.name || 'none'}`,
    `- Approval status: ${approvalPacket?.approval_status || 'n/a'}`,
    `- Experiment decision: ${experimentResult?.decision || 'pending'}`,
    ''
  ];
  if (final) {
    lines.push('## Final Note', '', 'This campaign summary is ready for R&D, process, and quality review.');
  } else {
    lines.push('## Operational Note', '', 'Use this summary as the shared human-readable handoff across all three roles.');
  }
  return lines.join('\n') + '\n';
}

function buildMetricEvaluations(metrics, targetSpec) {
  return [
    evaluateTargetMetric('thickness_mean', metrics.thickness_mean, targetSpec.thickness_mean.target, targetSpec.thickness_mean.tolerance),
    evaluateMaxMetric('thickness_cv', metrics.thickness_cv, targetSpec.thickness_cv.max),
    evaluateTargetMetric('birefringence_mean', metrics.birefringence_mean, targetSpec.birefringence_mean.target, targetSpec.birefringence_mean.tolerance),
    evaluateMaxMetric('birefringence_cv', metrics.birefringence_cv, targetSpec.birefringence_cv.max)
  ];
}

function evaluateTargetMetric(metric, actual, target, tolerance) {
  const rawGap = Math.max(0, Math.abs(actual - target) - tolerance);
  return {
    metric,
    actual: round(actual, 6),
    target: round(target, 6),
    tolerance: round(tolerance, 6),
    gap: round(rawGap, 6),
    normalized_gap: round(rawGap / Math.max(tolerance, 1e-9), 6),
    within_spec: rawGap === 0
  };
}

function evaluateMaxMetric(metric, actual, max) {
  const rawGap = Math.max(0, actual - max);
  return {
    metric,
    actual: round(actual, 6),
    max: round(max, 6),
    gap: round(rawGap, 6),
    normalized_gap: round(rawGap / Math.max(max, 1e-9), 6),
    within_spec: rawGap === 0
  };
}

function classifyResponse(lossPrevious, lossCurrent) {
  if (lossPrevious == null) return 'baseline';
  if (lossCurrent < lossPrevious * (1 - TUNING.improve_threshold)) return 'improved';
  if (lossCurrent > lossPrevious * (1 + TUNING.worse_threshold)) return 'worse';
  return 'flat';
}

function buildBlockingIssues(snapshot, quality) {
  const issues = [];
  if (snapshot.alarm_active) issues.push('alarm_active');
  if (quality.sensor_health && quality.sensor_health !== 'OK') issues.push(`sensor_${quality.sensor_health.toLowerCase()}`);
  return issues;
}

function summarizeHistorySignals(history) {
  const recent = history.slice(-TUNING.history_window);
  const effectiveCount = recent.filter((item) => item.experiment_result?.decision === 'effective').length;
  const worseCount = recent.filter((item) => item.experiment_result?.decision === 'worse').length;
  const ineffectiveCount = recent.filter((item) => item.experiment_result?.decision === 'ineffective').length;
  return {
    recent_iterations_considered: recent.length,
    effective_count: effectiveCount,
    worse_count: worseCount,
    ineffective_count: ineffectiveCount,
    summary:
      recent.length === 0
        ? 'no_history'
        : worseCount >= TUNING.recover_worse_count
          ? 'recent_strategy_unstable'
          : effectiveCount >= TUNING.exploit_effective_count
            ? 'recent_positive_signal_exists'
            : ineffectiveCount >= 4
              ? 'recent_information_gain_low'
              : 'history_mixed'
  };
}

function summarizeRecentDecisionTrail(history) {
  return history.slice(-3).map((item) => ({
    iteration: item.iteration,
    decision: item.experiment_result?.decision || 'pending',
    lever: item.plan?.candidate_parameters?.[0]?.name || null,
    quality_loss_change_pct: item.experiment_result?.online_response?.quality_loss_change_pct ?? null
  }));
}

function summarizeProcessRisk(snapshot, quality, historySignals, recentDecisionTrail = []) {
  const worseningTrail = recentDecisionTrail.filter((item) => item.decision === 'worse').length;
  const improvingTrail = recentDecisionTrail.filter((item) => item.decision === 'effective').length;
  return {
    alarm_active: snapshot.alarm_active,
    line_state: snapshot.line_state,
    sensor_health: quality.sensor_health,
    history_risk: historySignals.summary,
    recent_decision_trend:
      worseningTrail >= 2 ? 'unstable' : improvingTrail >= 1 ? 'positive' : 'mixed',
    execution_readiness: !snapshot.alarm_active && quality.sensor_health === 'OK' ? 'ready' : 'guarded'
  };
}

function deriveNextAction({ pass, snapshot, responseAssessment, historySignals }) {
  if (pass) return 'freeze_candidate_recipe';
  if (snapshot.alarm_active) return 'rollback_or_hold';
  if (responseAssessment === 'worse') return 'replan_or_change_lever';
  if (historySignals.summary === 'recent_information_gain_low') return 'expand_search_space';
  return 'continue_optimization';
}

function recommendStrategyStage({
  pass,
  snapshot,
  quality,
  responseAssessment,
  historySignals,
  strategyState,
  currentLoss
}) {
  const currentStage = strategyState?.stage || 'explore';
  if (pass) {
    return { next_stage: 'exploit', reason: 'quality_pass_hold_and_refine', trigger: 'quality_pass' };
  }
  if (snapshot.alarm_active || quality.sensor_health !== 'OK') {
    return { next_stage: 'recover', reason: 'alarm_or_sensor_degraded', trigger: 'safety' };
  }
  // Require a clear accumulation of worsening before triggering recover.
  // A single worse trial is part of healthy exploration — try a different lever.
  if (historySignals.worse_count >= TUNING.recover_worse_count && responseAssessment === 'worse') {
    return { next_stage: 'recover', reason: 'consecutive_worsening_threshold_exceeded', trigger: 'response_regression' };
  }
  // Promote to exploit when we have any effective signal OR loss is already low.
  if (historySignals.effective_count >= TUNING.exploit_effective_count || currentLoss < TUNING.exploit_loss_threshold) {
    return { next_stage: 'exploit', reason: 'sufficient_positive_signal', trigger: 'convergence' };
  }
  // In recover, only persist if genuinely unstable; otherwise return to explore.
  if (currentStage === 'recover') {
    return historySignals.worse_count >= TUNING.recover_worse_count
      ? { next_stage: 'recover', reason: 'persist_recover', trigger: 'safety' }
      : { next_stage: 'explore', reason: 'recover_complete_resume_exploration', trigger: 'default' };
  }
  // Default: keep exploring with different levers.
  return { next_stage: 'explore', reason: 'keep_collecting_information', trigger: 'default' };
}

function buildResponseKnowledge(history) {
  const recentRejects = new Set();
  const cooldownLevers = new Set();
  const byLever = new Map();
  const latestIteration = history.at(-1)?.iteration || 0;
  const latestLever = history.at(-1)?.plan?.candidate_parameters?.[0]?.name || null;

  for (const item of history) {
    const lever = item.plan?.candidate_parameters?.[0]?.name;
    if (!lever) continue;
    if (!byLever.has(lever)) {
      byLever.set(lever, {
        effective: 0,
        worse: 0,
        ineffective: 0,
        rejected: 0,
        last_direction: null,
        last_iteration: 0,
        last_decision: null
      });
    }
    const stats = byLever.get(lever);
    const decision = item.experiment_result?.decision;
    if (decision === 'effective') stats.effective += 1;
    if (decision === 'worse') stats.worse += 1;
    if (decision === 'ineffective') stats.ineffective += 1;
    if (decision === 'rejected') stats.rejected += 1;
    stats.last_direction = item.plan?.candidate_parameters?.[0]?.direction || stats.last_direction;
    stats.last_iteration = item.iteration || stats.last_iteration;
    stats.last_decision = decision || stats.last_decision;
    if ((decision === 'worse' && stats.worse >= 2) || (decision === 'rejected' && stats.rejected >= 1)) recentRejects.add(lever);
  }

  for (const [lever, stats] of byLever.entries()) {
    const recentlyTried = latestIteration - stats.last_iteration <= 1;
    const latestBad = ['worse', 'ineffective', 'rejected'].includes(stats.last_decision);
    if (recentlyTried && latestBad) {
      cooldownLevers.add(lever);
    }
  }

  const summary = [...byLever.entries()]
    .map(([lever, stats]) => `${lever}:E${stats.effective}/W${stats.worse}/I${stats.ineffective}/R${stats.rejected}`)
    .join(', ') || 'no_prior_response_memory';
  return { byLever, recentRejects, cooldownLevers, summary, latestLever };
}

function buildCandidateCatalog({ diagnosis, metrics, setpoints, target, responseKnowledge, strategyStage, cadencePlan }) {
  const catalog = [];
  const qualityGap = diagnosis.primary_quality_gap;
  const stepScale = stageStepScale(strategyStage, cadencePlan);
  const holdMinutes = resolveHoldMinutes(strategyStage, cadencePlan);
  const safetyLimits = getProductSafetyLimits(target.product_grade);
  const productOptimum = getProductProfile(target.product_grade).model.optimum;
  const allowedRange = (tag, fallback) => {
    const limit = safetyLimits[tag];
    return limit ? [limit.min, limit.max] : fallback;
  };

  if (qualityGap === 'birefringence_cv') {
    catalog.push(candidateSpec({
      name: 'td_zone_2_temp',
      current: setpoints.td_zone_2_temp,
      direction: setpoints.td_zone_2_temp < productOptimum.td_zone_2_temp ? 'increase' : 'decrease',
      step: 0.8 * stepScale.temp,
      allowed_range: allowedRange('td_zone_2_temp', [106, 120]),
      expected_response: 'birefringence_cv_decrease',
      objective: 'reduce_birefringence_cv_without_worsening_thickness_cv',
      hypothesis: 'TD zone temperature directly affects transverse orientation uniformity',
      rationale: `${strategyStage} 模式下优先围绕双折射波动最直接热区杠杆行动`,
      evidence: ['primary_gap=birefringence_cv', `current_metric=${metrics.birefringence_cv}`, `stage=${strategyStage}`],
      priority_score: leverPriority('td_zone_2_temp', responseKnowledge, baseStagePriority(strategyStage, 0.92)),
      review_focus: ['response_memory', 'thermal_uniformity'],
      lever_confidence: stageLeverConfidence(strategyStage, 'primary'),
      hold_time_minutes: holdMinutes
    }));
    catalog.push(candidateSpec({
      name: 'td_draw_ratio',
      current: setpoints.td_draw_ratio,
      direction: strategyStage === 'recover' ? 'decrease' : 'increase',
      step: 0.025 * stepScale.draw,
      allowed_range: allowedRange('td_draw_ratio', [3.42, 3.82]),
      expected_response: 'birefringence_cv_decrease_via_orientation_balance',
      objective: 'reduce_birefringence_cv_without_worsening_thickness_cv',
      hypothesis: 'TD draw ratio can rebalance transverse orientation when thermal lever saturates',
      rationale: '作为 TD 热区参数的替代或恢复杠杆',
      evidence: ['secondary_lever=td_draw_ratio', `stage=${strategyStage}`],
      priority_score: leverPriority('td_draw_ratio', responseKnowledge, baseStagePriority(strategyStage, 0.74)),
      review_focus: ['orientation_balance', 'constraint_screen'],
      lever_confidence: stageLeverConfidence(strategyStage, 'secondary'),
      hold_time_minutes: holdMinutes
    }));
    catalog.push(candidateSpec({
      name: 'heatset_temp',
      current: setpoints.heatset_temp,
      direction: setpoints.heatset_temp < productOptimum.heatset_temp ? 'increase' : 'decrease',
      step: 0.7 * stepScale.temp,
      allowed_range: allowedRange('heatset_temp', [116, 138]),
      expected_response: 'birefringence_cv_decrease_via_relaxation_uniformity',
      objective: 'reduce_birefringence_cv_without_worsening_mean_orientation',
      hypothesis: 'Heatset profile can smooth residual stress variation after TD orientation',
      rationale: '当 TD 热区信息增益下降时，切换热定型温度继续探索',
      evidence: ['alternate_lever=heatset_temp', `stage=${strategyStage}`],
      priority_score: leverPriority('heatset_temp', responseKnowledge, baseStagePriority(strategyStage, 0.7)),
      review_focus: ['residual_stress_balance', 'repeatability'],
      lever_confidence: stageLeverConfidence(strategyStage, 'secondary'),
      hold_time_minutes: holdMinutes
    }));
  }

  if (qualityGap === 'birefringence_mean') {
    catalog.push(candidateSpec({
      name: 'td_draw_ratio',
      current: setpoints.td_draw_ratio,
      direction: metrics.birefringence_mean < target.targets.birefringence_mean.target ? 'increase' : 'decrease',
      step: 0.025 * stepScale.draw,
      allowed_range: allowedRange('td_draw_ratio', [3.42, 3.82]),
      expected_response: 'birefringence_mean_moves_to_target',
      objective: 'move_birefringence_mean_to_target_window',
      hypothesis: 'Draw ratio balance controls orientation magnitude',
      rationale: '双折射均值偏差优先看拉伸倍率平衡',
      evidence: ['primary_gap=birefringence_mean', `stage=${strategyStage}`],
      priority_score: leverPriority('td_draw_ratio', responseKnowledge, baseStagePriority(strategyStage, 0.88)),
      review_focus: ['orientation_magnitude'],
      lever_confidence: stageLeverConfidence(strategyStage, 'primary'),
      hold_time_minutes: holdMinutes
    }));
    catalog.push(candidateSpec({
      name: 'heatset_temp',
      current: setpoints.heatset_temp,
      direction: metrics.birefringence_mean < target.targets.birefringence_mean.target ? 'decrease' : 'increase',
      step: 0.6 * stepScale.temp,
      allowed_range: allowedRange('heatset_temp', [116, 138]),
      expected_response: 'birefringence_mean_moves_to_target_via_relaxation',
      objective: 'move_birefringence_mean_to_target_window',
      hypothesis: 'Heatset relaxation can trim residual orientation magnitude after draw-ratio adjustment',
      rationale: '在拉伸倍率之外增加热定型协同杠杆，避免单一变量来回试探',
      evidence: ['secondary_lever=heatset_temp', `stage=${strategyStage}`],
      priority_score: leverPriority('heatset_temp', responseKnowledge, baseStagePriority(strategyStage, 0.71)),
      review_focus: ['residual_orientation'],
      lever_confidence: stageLeverConfidence(strategyStage, 'secondary'),
      hold_time_minutes: holdMinutes
    }));
  }

  if (qualityGap === 'thickness_cv') {
    catalog.push(candidateSpec({
      name: 'winder_tension',
      current: setpoints.winder_tension,
      direction: setpoints.winder_tension > productOptimum.winder_tension ? 'decrease' : 'increase',
      step: 1.2 * stepScale.tension,
      allowed_range: allowedRange('winder_tension', [105, 132]),
      expected_response: 'thickness_cv_decrease',
      objective: 'reduce_thickness_cv_while_holding_orientation',
      hypothesis: 'Winding tension is amplifying gauge nonuniformity',
      rationale: '厚度波动优先从末端张力平稳性找控制杠杆',
      evidence: ['primary_gap=thickness_cv', `stage=${strategyStage}`],
      priority_score: leverPriority('winder_tension', responseKnowledge, baseStagePriority(strategyStage, 0.84)),
      review_focus: ['profile_uniformity', 'winding_stability'],
      lever_confidence: stageLeverConfidence(strategyStage, 'primary'),
      hold_time_minutes: holdMinutes
    }));
    catalog.push(candidateSpec({
      name: 'td_draw_ratio',
      current: setpoints.td_draw_ratio,
      direction: strategyStage === 'recover' ? 'increase' : 'decrease',
      step: 0.025 * stepScale.draw,
      allowed_range: allowedRange('td_draw_ratio', [3.42, 3.82]),
      expected_response: 'thickness_cv_decrease_via_td_profile_relief',
      objective: 'reduce_thickness_cv_while_holding_orientation',
      hypothesis: 'Slight relief on TD stretch can reduce profile amplification',
      rationale: '作为张力之外的轮廓二级杠杆',
      evidence: ['secondary_lever=td_draw_ratio', `stage=${strategyStage}`],
      priority_score: leverPriority('td_draw_ratio', responseKnowledge, baseStagePriority(strategyStage, 0.68)),
      review_focus: ['profile_shape'],
      lever_confidence: stageLeverConfidence(strategyStage, 'secondary'),
      hold_time_minutes: holdMinutes
    }));
    catalog.push(candidateSpec({
      name: 'td_zone_1_temp',
      current: setpoints.td_zone_1_temp,
      direction: setpoints.td_zone_1_temp < (productOptimum.td_zone_1_temp ?? setpoints.td_zone_1_temp) ? 'increase' : 'decrease',
      step: 0.6 * stepScale.temp,
      allowed_range: allowedRange('td_zone_1_temp', [110, 128]),
      expected_response: 'thickness_cv_decrease_via_profile_uniformity',
      objective: 'reduce_thickness_cv_while_holding_orientation',
      hypothesis: 'Upstream TD heating uniformity can reduce profile amplification before winding',
      rationale: '给研发增加一个比张力更靠前的轮廓均匀性探索杠杆',
      evidence: ['alternate_lever=td_zone_1_temp', `stage=${strategyStage}`],
      priority_score: leverPriority('td_zone_1_temp', responseKnowledge, baseStagePriority(strategyStage, 0.63)),
      review_focus: ['td_profile_uniformity'],
      lever_confidence: stageLeverConfidence(strategyStage, 'secondary')
    }));
  }

  if (qualityGap === 'thickness_mean') {
    catalog.push(candidateSpec({
      name: 'extruder_speed',
      current: setpoints.extruder_speed,
      direction: metrics.thickness_mean < target.targets.thickness_mean.target ? 'increase' : 'decrease',
      step: 1.2 * stepScale.speed,
      allowed_range: allowedRange('extruder_speed', [88, 112]),
      expected_response: 'thickness_mean_moves_to_target',
      objective: 'move_thickness_mean_to_target_window',
      hypothesis: 'Extrusion throughput dominates current thickness mean offset',
      rationale: '厚度均值偏差优先用吞吐杠杆修正',
      evidence: ['primary_gap=thickness_mean', `stage=${strategyStage}`],
      priority_score: leverPriority('extruder_speed', responseKnowledge, baseStagePriority(strategyStage, 0.85)),
      review_focus: ['throughput_balance'],
      lever_confidence: stageLeverConfidence(strategyStage, 'primary'),
      hold_time_minutes: holdMinutes
    }));
    catalog.push(candidateSpec({
      name: 'line_speed',
      current: setpoints.line_speed,
      direction: metrics.thickness_mean < target.targets.thickness_mean.target ? 'decrease' : 'increase',
      step: 0.45 * stepScale.speed,
      allowed_range: allowedRange('line_speed', [16, 46]),
      expected_response: 'thickness_mean_moves_to_target_via_drawdown_balance',
      objective: 'move_thickness_mean_to_target_window',
      hypothesis: 'Line speed offers a drawdown-side correction when throughput-only control is insufficient',
      rationale: '增加产线速度这一对偶杠杆，避免仅靠挤出量单边修正',
      evidence: ['secondary_lever=line_speed', `stage=${strategyStage}`],
      priority_score: leverPriority('line_speed', responseKnowledge, baseStagePriority(strategyStage, 0.69)),
      review_focus: ['drawdown_balance'],
      lever_confidence: stageLeverConfidence(strategyStage, 'secondary'),
      hold_time_minutes: holdMinutes
    }));
  }

  if (catalog.length === 0) {
    catalog.push(candidateSpec({
      name: 'td_zone_2_temp',
      current: setpoints.td_zone_2_temp,
      direction: 'hold',
      step: 0,
      allowed_range: allowedRange('td_zone_2_temp', [106, 120]),
      expected_response: 'hold_quality_and_validate_repeatability',
      objective: 'local_refine_current_recipe',
      hypothesis: 'All metrics are close enough that repeatability matters more than exploration',
      rationale: '无显著质量缺口时，优先保持并验证',
      evidence: ['primary_gap=none', `stage=${strategyStage}`],
      priority_score: 0.4,
      review_focus: ['repeatability'],
      lever_confidence: 0.5,
      hold_time_minutes: holdMinutes
    }));
  }

  return applyCadenceRanking(catalog, cadencePlan, responseKnowledge);
}

function candidateSpec({
  name,
  current,
  direction,
  step,
  allowed_range,
  expected_response,
  objective,
  hypothesis,
  rationale,
  evidence,
  priority_score,
  review_focus,
  lever_confidence,
  hold_time_minutes
}) {
  const signed_step = signedDelta(direction, step);
  return {
    name,
    current: round(current, 5),
    direction,
    step: round(Math.abs(step), 5),
    signed_step: round(signed_step, 5),
    allowed_range,
    expected_response,
    objective,
    hypothesis,
    rationale,
    evidence,
    priority_score: round(priority_score, 4),
    success_criteria: ['target_loss_decreases_gt_3_percent', 'no_alarm', 'no_major_secondary_metric_worsening'],
    stop_rules: ['alarm_active', 'quality_loss_worse_gt_5_percent', 'mcp_safety_reject', 'max_iterations_reached'],
    hold_time_minutes: Math.max(1, Number(hold_time_minutes || 10)),
    review_focus,
    lever_confidence: round(lever_confidence, 4)
  };
}

function applyCadenceRanking(catalog, cadencePlan, responseKnowledge) {
  if (!cadencePlan) return catalog;
  return catalog
    .map((candidate) => ({
      ...candidate,
      priority_score: round(
        candidate.priority_score + cadencePriorityAdjustment(candidate.name, cadencePlan.rd_cycle_mode, responseKnowledge),
        4
      )
    }))
    .sort((a, b) => b.priority_score - a.priority_score);
}

function cadencePriorityAdjustment(candidateName, cadenceMode, responseKnowledge) {
  if (!cadenceMode || cadenceMode === 'standard') return 0;
  const latestLever = responseKnowledge?.latestLever || null;
  const isLatestLever = candidateName && candidateName === latestLever;
  if (cadenceMode === 'micro_tune') {
    return isLatestLever ? 0.06 : -0.01;
  }
  if (cadenceMode === 'full_replan') {
    return isLatestLever ? -0.01 : 0.04;
  }
  return 0;
}

function resolveHoldMinutes(stage, cadencePlan) {
  if (cadencePlan?.process_settle_minutes) {
    return Math.max(8, Number(cadencePlan.process_settle_minutes));
  }
  if (stage === 'recover') return 12;
  if (stage === 'exploit') return 9;
  return 10;
}

function stageStepScale(stage, cadencePlan = null) {
  const cadenceMode = cadencePlan?.rd_cycle_mode || 'standard';
  if (stage === 'exploit') {
    if (cadenceMode === 'micro_tune') {
      return { temp: 0.52, draw: 0.56, tension: 0.6, speed: 0.6 };
    }
    if (cadenceMode === 'full_replan') {
      return { temp: 0.72, draw: 0.76, tension: 0.8, speed: 0.8 };
    }
    return { temp: 0.65, draw: 0.7, tension: 0.75, speed: 0.75 };
  }
  if (stage === 'recover') {
    if (cadenceMode === 'full_replan') {
      return { temp: 0.56, draw: 0.56, tension: 0.65, speed: 0.65 };
    }
    return { temp: 0.5, draw: 0.5, tension: 0.6, speed: 0.6 };
  }
  if (cadenceMode === 'micro_tune') {
    return { temp: 0.82, draw: 0.82, tension: 0.88, speed: 0.88 };
  }
  if (cadenceMode === 'full_replan') {
    return { temp: 1.08, draw: 1.08, tension: 1.05, speed: 1.05 };
  }
  return { temp: 1, draw: 1, tension: 1, speed: 1 };
}

function baseStagePriority(stage, baseScore) {
  if (stage === 'exploit') return baseScore + 0.05;
  if (stage === 'recover') return baseScore - 0.03;
  return baseScore;
}

function stageLeverConfidence(stage, kind) {
  if (stage === 'exploit') return kind === 'primary' ? 0.82 : 0.6;
  if (stage === 'recover') return kind === 'primary' ? 0.64 : 0.52;
  return kind === 'primary' ? 0.7 : 0.56;
}

function leverPriority(name, responseKnowledge, baseScore) {
  const stats = responseKnowledge.byLever.get(name);
  const cooldownPenalty = responseKnowledge.cooldownLevers.has(name) ? 0.12 : 0;
  if (!stats) return baseScore - cooldownPenalty;
  return baseScore + stats.effective * 0.08 - stats.worse * 0.1 - stats.ineffective * 0.04 - stats.rejected * 0.06 - cooldownPenalty;
}

function signedDelta(direction, step) {
  if (direction === 'decrease') return -Math.abs(step);
  if (direction === 'increase') return Math.abs(step);
  return 0;
}

function dominantMetricShift(beforeMetrics, afterMetrics) {
  const shifts = [
    ['thickness_cv', Math.abs(percentChange(afterMetrics.thickness_cv, beforeMetrics.thickness_cv))],
    ['birefringence_cv', Math.abs(percentChange(afterMetrics.birefringence_cv, beforeMetrics.birefringence_cv))],
    ['thickness_mean', Math.abs(percentChange(afterMetrics.thickness_mean, beforeMetrics.thickness_mean))],
    ['birefringence_mean', Math.abs(percentChange(afterMetrics.birefringence_mean, beforeMetrics.birefringence_mean))]
  ].sort((a, b) => b[1] - a[1]);
  return shifts[0][0];
}

function rampFor(tag, productGrade = null) {
  if (productGrade) {
    const limit = getProductSafetyLimits(productGrade)[tag];
    if (limit?.ramp) return limit.ramp;
  }
  if (tag.includes('draw_ratio')) return 0.02;
  if (tag.includes('temp')) return 0.5;
  if (tag.includes('tension')) return 1.0;
  return 0.8;
}

function percentChange(after, before) {
  return ((after - before) / Math.max(Math.abs(before), 1e-9)) * 100;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
