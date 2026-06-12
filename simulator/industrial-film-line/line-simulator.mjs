import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETPOINTS,
  evaluateBlackbox,
  round
} from './blackbox-model.mjs';
import {
  getProductProfile,
  getProductSafetyLimits,
  getProductSetpoints,
  normalizeProductGrade
} from './product-catalog.mjs';

const DEFAULT_CAMPAIGN = 'CMP-SIM-BOPET-NEW-GRADE-A';
const DEFAULT_STATE_FILE = path.resolve('workspace/runtime/simulator-state.json');

export class IndustrialFilmLineSimulator {
  constructor({
    seed = 20260610,
    productGrade = 'BOPET_NEW_GRADE_A',
    campaignId = DEFAULT_CAMPAIGN,
    stateFile = process.env.SIM_STATE_FILE || DEFAULT_STATE_FILE
  } = {}) {
    this.seed = seed;
    this.productGrade = productGrade;
    this.campaignId = campaignId;
    this.stateFile = path.resolve(stateFile);
    this.lastLoadedMtimeMs = 0;
    if (fs.existsSync(this.stateFile)) {
      this.#loadStateFromDisk({ force: true });
    } else {
      this.reset({ campaignId, productGrade });
    }
  }

  reset({ campaignId = this.campaignId, productGrade = this.productGrade } = {}) {
    this.#syncFromDisk();
    this.campaignId = campaignId;
    this.productGrade = normalizeProductGrade(productGrade);
    this.productProfile = getProductProfile(this.productGrade);
    this.tick = 0;
    this.clock = new Date('2026-06-10T00:00:00.000Z');
    this.lineState = 'STABLE';
    this.experimentId = 'EXP-000';
    this.recipeId = 'RCP-BASELINE';
    this.setpoints = getProductSetpoints(this.productGrade);
    this.lastKnownGoodRecipe = { id: this.recipeId, setpoints: { ...this.setpoints } };
    this.pendingTransitionTicks = 0;
    this.timeSinceLastChangeSec = 900;
    this.alarmActive = false;
    this.wasteMeter = 0;
    this.drift = 0;
    this.ledger = [];
    this.rngState = this.seed >>> 0;
    this.lastQuality = this.#evaluate();
    this.#saveState();
    return this.getState();
  }

  getState() {
    this.#syncFromDisk();
    return {
      campaign_id: this.campaignId,
      product_grade: this.productGrade,
      material_family: this.productProfile?.material_family || getProductProfile(this.productGrade).material_family,
      experiment_id: this.experimentId,
      recipe_id: this.recipeId,
      line_state: this.lineState,
      alarm_active: this.alarmActive,
      tick: this.tick,
      time_since_last_change_sec: this.timeSinceLastChangeSec,
      waste_meter: round(this.wasteMeter, 2),
      setpoints: { ...this.setpoints }
    };
  }

  getSnapshot() {
    this.#syncFromDisk();
    return {
      timestamp: this.clock.toISOString(),
      campaign_id: this.campaignId,
      product_grade: this.productGrade,
      material_family: this.productProfile?.material_family || getProductProfile(this.productGrade).material_family,
      experiment_id: this.experimentId,
      recipe_id: this.recipeId,
      line_state: this.lineState,
      setpoints: { ...this.setpoints },
      process_values: this.#processValues(),
      alarm_active: this.alarmActive,
      time_since_last_change_sec: this.timeSinceLastChangeSec
    };
  }

  getOnlineQuality() {
    this.#syncFromDisk();
    const quality = this.#evaluate();
    return {
      timestamp: this.clock.toISOString(),
      campaign_id: this.campaignId,
      product_grade: this.productGrade,
      material_family: this.productProfile?.material_family || getProductProfile(this.productGrade).material_family,
      experiment_id: this.experimentId,
      metrics: quality.metrics,
      profiles: quality.profiles,
      sensor_health: this.alarmActive ? 'DEGRADED' : 'OK'
    };
  }

  getWritableParameters() {
    this.#syncFromDisk();
    return Object.entries(getProductSafetyLimits(this.productGrade)).map(([tag, limit]) => ({
      tag,
      current: round(this.setpoints[tag], 5),
      min: limit.min,
      max: limit.max,
      max_delta_per_action: limit.maxDelta,
      max_ramp_per_min: limit.ramp,
      writable: true
    }));
  }

  buildProposalFromSetpoints({
    changes,
    campaignId = this.campaignId,
    experimentId = `EXP-MCP-${String(this.tick + 1).padStart(4, '0')}`,
    sourcePlan = 'mcp_setpoint_request',
    expectedLagMinutes = 8
  } = {}) {
    this.#syncFromDisk();
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new Error('changes must be a non-empty array');
    }
    return {
      campaign_id: campaignId,
      experiment_id: experimentId,
      source_plan: sourcePlan,
      setpoint_changes: changes.map((change) => {
        const current = this.setpoints[change.tag];
        if (current === undefined) throw new Error(`unknown_writable_tag:${change.tag}`);
        const target = Number(change.target);
        const delta = target - current;
        const limit = getProductSafetyLimits(this.productGrade)[change.tag];
        return {
          tag: change.tag,
          current: round(current, 5),
          target: round(target, 5),
          delta: round(delta, 5),
          ramp_limit_per_min: round(change.ramp_limit_per_min ?? limit.ramp, 5)
        };
      }),
      rollback_recipe: this.lastKnownGoodRecipe.id,
      expected_lag_minutes: expectedLagMinutes
    };
  }

  preview(proposal) {
    this.#syncFromDisk();
    return deterministicSafetyGate({
      proposal,
      snapshot: this.getSnapshot(),
      rollbackRecipe: this.lastKnownGoodRecipe.id,
      safetyLimits: getProductSafetyLimits(this.productGrade)
    });
  }

  previewSetpoints(request) {
    this.#syncFromDisk();
    const proposal = this.buildProposalFromSetpoints(request);
    return {
      proposal,
      safety_gate_result: this.preview(proposal)
    };
  }

  apply(proposal) {
    this.#syncFromDisk();
    const gate = this.preview(proposal);
    if (!gate.allowed) {
      return {
        executed: false,
        write_confirmed: false,
        safety_gate_result: gate,
        message: 'safety gate rejected proposal'
      };
    }

    const before = { ...this.setpoints };
    for (const change of proposal.setpoint_changes) {
      this.setpoints[change.tag] = round(change.target, 5);
    }

    this.experimentId = proposal.experiment_id;
    this.recipeId = `RCP-${proposal.experiment_id}`;
    this.lineState = 'TRANSITION';
    this.pendingTransitionTicks = Math.max(3, Math.ceil((proposal.expected_lag_minutes || 8) / 2));
    this.timeSinceLastChangeSec = 0;
    this.wasteMeter += 8;
    this.tickForward(1);

    const receipt = {
      executed: true,
      write_confirmed: true,
      safety_gate_result: gate,
      before_setpoints: before,
      after_setpoints: { ...this.setpoints },
      timestamp: this.clock.toISOString()
    };
    this.ledger.push({ type: 'apply', proposal, receipt });
    this.#saveState();
    return receipt;
  }

  applySetpoints(request) {
    this.#syncFromDisk();
    const proposal = this.buildProposalFromSetpoints(request);
    return {
      proposal,
      receipt: this.apply(proposal)
    };
  }

  tickForward(count = 1) {
    this.#syncFromDisk();
    for (let i = 0; i < count; i += 1) {
      this.tick += 1;
      this.clock = new Date(this.clock.getTime() + 60_000);
      this.timeSinceLastChangeSec += 60;
      this.drift += (this.#nextRandom() - 0.48) * 0.002;
      if (this.pendingTransitionTicks > 0) {
        this.pendingTransitionTicks -= 1;
        this.wasteMeter += this.setpoints.line_speed / 6;
        if (this.pendingTransitionTicks === 0) this.lineState = 'STABLE';
      }
      const quality = this.#evaluate();
      this.alarmActive = quality.alarmRisk;
      if (this.alarmActive) this.lineState = 'ALARM';
      this.lastQuality = quality;
    }
    this.#saveState();
    return this.getState();
  }

  runUntilStable({ minStableTicks = 6, maxTicks = 40 } = {}) {
    this.#syncFromDisk();
    let stableTicks = 0;
    const start = this.clock.toISOString();
    for (let i = 0; i < maxTicks; i += 1) {
      this.tickForward(1);
      if (this.lineState === 'STABLE' && !this.alarmActive) stableTicks += 1;
      else stableTicks = 0;
      if (stableTicks >= minStableTicks) break;
    }
    return {
      stable: this.lineState === 'STABLE' && !this.alarmActive,
      window_id: `win_${this.experimentId}_${this.tick}`,
      start,
      end: this.clock.toISOString(),
      snapshot: this.getSnapshot(),
      online_quality: this.getOnlineQuality()
    };
  }

  rollback(reason = 'manual rollback') {
    this.#syncFromDisk();
    const before = { ...this.setpoints };
    this.setpoints = { ...this.lastKnownGoodRecipe.setpoints };
    this.recipeId = `${this.lastKnownGoodRecipe.id}-ROLLBACK`;
    this.lineState = 'TRANSITION';
    this.pendingTransitionTicks = 4;
    this.timeSinceLastChangeSec = 0;
    this.wasteMeter += 20;
    const receipt = {
      rolled_back: true,
      reason,
      before_setpoints: before,
      after_setpoints: { ...this.setpoints },
      timestamp: this.clock.toISOString()
    };
    this.ledger.push({ type: 'rollback', receipt });
    this.#saveState();
    return receipt;
  }

  loadRecipe({ recipeId, setpoints, reason = 'load recipe' }) {
    this.#syncFromDisk();
    const before = { ...this.setpoints };
    this.setpoints = { ...this.setpoints, ...setpoints };
    this.recipeId = recipeId;
    this.lineState = 'TRANSITION';
    this.pendingTransitionTicks = 4;
    this.timeSinceLastChangeSec = 0;
    this.wasteMeter += 12;
    const receipt = {
      loaded: true,
      reason,
      before_setpoints: before,
      after_setpoints: { ...this.setpoints },
      timestamp: this.clock.toISOString()
    };
    this.ledger.push({ type: 'load_recipe', receipt });
    this.#saveState();
    return receipt;
  }

  loadRecipeBaseline({ recipeId, setpoints, reason = 'load recipe baseline' }) {
    this.#syncFromDisk();
    const before = { ...this.setpoints };
    this.setpoints = { ...this.setpoints, ...setpoints };
    this.recipeId = recipeId;
    this.lastKnownGoodRecipe = { id: recipeId, setpoints: { ...this.setpoints } };
    this.lineState = 'TRANSITION';
    this.pendingTransitionTicks = 4;
    this.timeSinceLastChangeSec = 0;
    this.wasteMeter += 10;
    const receipt = {
      loaded: true,
      baseline_synced: true,
      reason,
      before_setpoints: before,
      after_setpoints: { ...this.setpoints },
      rollback_recipe: this.lastKnownGoodRecipe.id,
      timestamp: this.clock.toISOString()
    };
    this.ledger.push({ type: 'load_recipe_baseline', receipt });
    this.#saveState();
    return receipt;
  }

  saveCandidateRecipe({ recipeId, metadata = {} }) {
    this.#syncFromDisk();
    const record = {
      recipe_id: recipeId,
      setpoints: { ...this.setpoints },
      metadata,
      saved_at: this.clock.toISOString()
    };
    this.lastKnownGoodRecipe = { id: recipeId, setpoints: { ...this.setpoints } };
    this.ledger.push({ type: 'candidate_recipe', record });
    this.#saveState();
    return record;
  }

  exportLedger(filePath) {
    this.#syncFromDisk();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, this.ledger.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  }

  getLedger() {
    this.#syncFromDisk();
    return [...this.ledger];
  }

  #syncFromDisk() {
    this.#loadStateFromDisk({ force: false });
  }

  #loadStateFromDisk({ force }) {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) return;
    const stats = fs.statSync(this.stateFile);
    if (!force && stats.mtimeMs <= this.lastLoadedMtimeMs) return;
    const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    this.#hydrate(raw);
    this.lastLoadedMtimeMs = stats.mtimeMs;
  }

  #hydrate(raw) {
    this.seed = raw.seed ?? this.seed ?? 20260610;
    this.rngState = raw.rngState ?? (this.seed >>> 0);
    this.productGrade = normalizeProductGrade(raw.productGrade ?? this.productGrade ?? 'PET_FILM_GRADE_A');
    this.productProfile = getProductProfile(this.productGrade);
    this.campaignId = raw.campaignId ?? this.campaignId ?? DEFAULT_CAMPAIGN;
    this.tick = raw.tick ?? 0;
    this.clock = new Date(raw.clock ?? '2026-06-10T00:00:00.000Z');
    this.lineState = raw.lineState ?? 'STABLE';
    this.experimentId = raw.experimentId ?? 'EXP-000';
    this.recipeId = raw.recipeId ?? 'RCP-BASELINE';
    this.setpoints = { ...DEFAULT_SETPOINTS, ...getProductSetpoints(this.productGrade), ...(raw.setpoints || {}) };
    this.lastKnownGoodRecipe = raw.lastKnownGoodRecipe || { id: this.recipeId, setpoints: { ...this.setpoints } };
    this.pendingTransitionTicks = raw.pendingTransitionTicks ?? 0;
    this.timeSinceLastChangeSec = raw.timeSinceLastChangeSec ?? 900;
    this.alarmActive = Boolean(raw.alarmActive);
    this.wasteMeter = raw.wasteMeter ?? 0;
    this.drift = raw.drift ?? 0;
    this.ledger = Array.isArray(raw.ledger) ? raw.ledger : [];
    this.lastQuality = raw.lastQuality || this.#evaluate();
  }

  #saveState() {
    if (!this.stateFile) return;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.#serialize(), null, 2) + '\n');
    const stats = fs.statSync(this.stateFile);
    this.lastLoadedMtimeMs = stats.mtimeMs;
  }

  #serialize() {
    return {
      seed: this.seed,
      rngState: this.rngState,
      productGrade: this.productGrade,
      campaignId: this.campaignId,
      tick: this.tick,
      clock: this.clock.toISOString(),
      lineState: this.lineState,
      experimentId: this.experimentId,
      recipeId: this.recipeId,
      setpoints: this.setpoints,
      lastKnownGoodRecipe: this.lastKnownGoodRecipe,
      pendingTransitionTicks: this.pendingTransitionTicks,
      timeSinceLastChangeSec: this.timeSinceLastChangeSec,
      alarmActive: this.alarmActive,
      wasteMeter: this.wasteMeter,
      drift: this.drift,
      ledger: this.ledger,
      lastQuality: this.lastQuality
    };
  }

  #processValues() {
    const jitter = (scale) => (this.#nextRandom() - 0.5) * scale;
    return {
      melt_temp: round(this.setpoints.melt_temp + jitter(0.18), 3),
      line_speed: round(this.setpoints.line_speed + jitter(0.08), 3),
      winder_tension: round(this.setpoints.winder_tension + jitter(0.5), 3),
      extruder_pressure: round(18.2 + 0.08 * (this.setpoints.extruder_speed - 100) + jitter(0.08), 3),
      casting_roll_actual_temp: round(this.setpoints.casting_roll_temp + jitter(0.12), 3)
    };
  }

  #evaluate() {
    return evaluateBlackbox({
      setpoints: this.setpoints,
      tick: this.tick,
      rng: () => this.#nextRandom(),
      productGrade: this.productGrade,
      drift: this.drift
    });
  }

  #nextRandom() {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }
}

export function deterministicSafetyGate({ proposal, snapshot, rollbackRecipe, safetyLimits = null }) {
  const activeSafetyLimits = safetyLimits || getProductSafetyLimits(snapshot?.product_grade || 'PET_FILM_GRADE_A');
  const violations = [];
  if (snapshot.alarm_active) violations.push('alarm_active');
  if (!rollbackRecipe) violations.push('missing_rollback_recipe');
  if (snapshot.line_state !== 'STABLE') violations.push(`line_not_stable:${snapshot.line_state}`);
  if (!proposal || typeof proposal !== 'object') violations.push('invalid_proposal');
  if (!Array.isArray(proposal?.setpoint_changes) || proposal.setpoint_changes.length === 0) {
    violations.push('missing_setpoint_changes');
  }
  if (proposal?.rollback_recipe && rollbackRecipe && proposal.rollback_recipe !== rollbackRecipe) {
    violations.push(`rollback_recipe_mismatch:${proposal.rollback_recipe}:expected:${rollbackRecipe}`);
  }
  if (proposal?.expected_lag_minutes !== undefined && (proposal.expected_lag_minutes < 0 || proposal.expected_lag_minutes > 60)) {
    violations.push(`expected_lag_minutes_out_of_range:${proposal.expected_lag_minutes}`);
  }

  const seen = new Set();
  for (const change of proposal?.setpoint_changes || []) {
    const limit = activeSafetyLimits[change.tag];
    if (!limit) {
      violations.push(`unknown_writable_tag:${change.tag}`);
      continue;
    }
    if (seen.has(change.tag)) violations.push(`duplicate_tag:${change.tag}`);
    seen.add(change.tag);
    for (const field of ['current', 'target', 'delta', 'ramp_limit_per_min']) {
      if (!Number.isFinite(change[field])) violations.push(`invalid_number:${change.tag}:${field}`);
    }
    const actualCurrent = snapshot.setpoints[change.tag];
    if (Number.isFinite(change.current) && Math.abs(change.current - actualCurrent) > 1e-6) {
      violations.push(`current_mismatch:${change.tag}:proposal:${change.current}:actual:${actualCurrent}`);
    }
    if (Number.isFinite(change.target) && Number.isFinite(change.delta)) {
      const expectedDelta = change.target - actualCurrent;
      if (Math.abs(change.delta - expectedDelta) > 1e-6) {
        violations.push(`delta_mismatch:${change.tag}:proposal:${change.delta}:expected:${round(expectedDelta, 5)}`);
      }
    }
    if (change.target < limit.min || change.target > limit.max) {
      violations.push(`target_out_of_bounds:${change.tag}:${change.target}`);
    }
    if (Math.abs(change.delta) > limit.maxDelta) {
      violations.push(`delta_too_large:${change.tag}:${change.delta}`);
    }
    if (change.ramp_limit_per_min > limit.ramp) {
      violations.push(`ramp_too_fast:${change.tag}:${change.ramp_limit_per_min}`);
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    approval_required: true,
    limit_applied: false,
    rollback_recipe: rollbackRecipe || ''
  };
}
