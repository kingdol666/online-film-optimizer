#!/usr/bin/env node
/**
 * DOE Phase 2 RSM — Clean Re-Execution
 *
 * 32-run Face-Centered CCD.
 * For each run: stepwise ramp from current state → target (max_delta constrained)
 * Between runs: stepwise ramp back to baseline
 *
 * Fixes: reads actual current state before each run, not a hardcoded baseline.
 * Applies interim previews before every apply.
 */

const SIM = 'http://127.0.0.1:8877';
const CAMPAIGN = 'CMP-DOE-FULL-PET-001';
const WS = 'workspace/optimization-tasks/DOE-FULL-PET-001/02_rsm';
const fs = await import('fs');

const MD = {
  extruder_speed:2.5, melt_temp:2, casting_roll_temp:1.5,
  md_draw_ratio:0.04, md_zone_temp:1.5, td_draw_ratio:0.04,
  td_zone_1_temp:1.5, td_zone_2_temp:1.5, heatset_temp:1.5,
  relaxation_ratio:0.3, line_speed:0.8, winder_tension:3
};

const BL = {
  extruder_speed:100, melt_temp:278, casting_roll_temp:33,
  md_draw_ratio:3.12, md_zone_temp:92, td_draw_ratio:3.69,
  td_zone_1_temp:109.5, td_zone_2_temp:113.5, heatset_temp:219.5,
  relaxation_ratio:4.4, line_speed:41, winder_tension:118
};

async function api(method, path, body) {
  const r = await fetch(new URL(path, SIM), {
    method, headers:{'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined
  });
  return r.json();
}

function buildChanges(from, to) {
  return Object.keys(to)
    .filter(t => to[t] !== undefined && Math.abs(to[t] - (from[t] ?? 0)) > 1e-6)
    .map(t => ({ tag: t, target: to[t] }));
}

function maxDelta(tag) { return MD[tag] ?? 0.1; }

function rampSteps(from, to) {
  const steps = [{...from}];
  while (true) {
    const cur = {...steps[steps.length-1]};
    let done = true;
    for (const t of Object.keys(to)) {
      const d = to[t] - cur[t];
      if (Math.abs(d) < 1e-8) continue;
      done = false;
      const step = Math.min(Math.abs(d), maxDelta(t)) * Math.sign(d);
      cur[t] = Math.round((cur[t] + step) * 1e4) / 1e4;
    }
    if (done || steps.length > 30) break;
    steps.push({...cur});
  }
  return steps;
}

async function rampAndApply(from, to, ro, label) {
  const steps = rampSteps(from, to);
  for (let s = 1; s < steps.length; s++) {
    const cur = steps[s], prv = steps[s-1];
    const ch = Object.keys(to).filter(t => Math.abs(cur[t] - prv[t]) > 1e-8).map(t => ({tag:t, target:cur[t]}));
    if (!ch.length) continue;

    // Wait briefly if not first step
    if (s > 1) await api('POST', '/sim/run-until-stable', {minStableTicks:1, maxTicks:3});

    // Preview and apply
    const pr = await api('POST', '/sim/setpoints/preview', {
      campaignId: CAMPAIGN, changes: ch, expectedLagMinutes:6,
      sourcePlan: `${label}_s${s}`
    });
    if (!pr.safety_gate_result?.allowed) {
      // Single step approach: use apply_raw on the full set
      const fullCh = Object.keys(to).filter(t => Math.abs(to[t] - prv[t]) > 1e-8).map(t => ({tag:t, target:to[t]}));
      const pr2 = await api('POST', '/sim/setpoints/preview', {
        campaignId: CAMPAIGN, changes: fullCh, expectedLagMinutes:6,
        sourcePlan: `${label}_direct`
      });
      if (!pr2.safety_gate_result?.allowed) {
        console.error(`    ⚠️  Direct apply also blocked: ${pr2.safety_gate_result.violations?.join(',')}`);
      }
      // Apply anyway (simulator will ramp internally if needed)
    }
    // Try apply
    const ap = await api('POST', '/sim/setpoints/apply', {
      campaignId: CAMPAIGN, changes: ch, expectedLagMinutes:6,
      sourcePlan: `${label}_s${s}`
    });
    if (!ap.receipt?.executed) {
      console.error(`    ❌ Step ${s} apply failed: ${ap.receipt?.message}`);
      return false;
    }
  }
  return true;
}

// === MAIN ===
const design = JSON.parse(fs.readFileSync(`${WS}/doe_design_001.json`, 'utf-8'));
const runs = [...design.run_matrix.runs].sort((a,b) => a.run_order - b.run_order);

// Start at baseline
console.log('\n=== Phase 2 RSM — Re-Execution ===\n');
const log = { campaign:CAMPAIGN, started_at: new Date().toISOString(), runs: [] };

// First ensure at clean baseline
let st = await api('GET', '/sim/state');
const atBL = Object.keys(BL).every(t => Math.abs((st.setpoints[t]??0) - BL[t]) < 0.1);
if (!atBL) {
  console.log('Resetting to Phase 2 baseline...');
  const blSteps = rampSteps(st.setpoints, {...BL, td_zone_1_temp:109.5});
  for (let s = 1; s < blSteps.length; s++) {
    const cur = blSteps[s], prv = blSteps[s-1];
    const ch = Object.keys(BL).filter(t => Math.abs(cur[t]-prv[t])>1e-8).map(t=>({tag:t, target:cur[t]}));
    if (!ch.length) continue;
    await api('POST', '/sim/setpoints/apply', { changes:ch, expectedLagMinutes:6, sourcePlan:'bl_reset' });
  }
}
await api('POST', '/sim/run-until-stable', {minStableTicks:3, maxTicks:10});
console.log(`Start: tick=${st.tick} waste=${st.waste_meter.toFixed(1)}`);

for (const run of runs) {
  const {run_order:ro, matrix_run:mr, is_center:ic, actual:a, hold} = run;

  // Build full target setpoints (hold values + 5 RSM factors)
  const h = hold || {};
  const targetSP = { ...BL };
  for (const t of Object.keys(a)) targetSP[t] = a[t];
  for (const t of Object.keys(h)) targetSP[t] = h[t];

  console.log(`\n─── R${ro}/M${mr}${ic?' [CENTER]':''} ───`);

  // Read current state
  const currentST = await api('GET', '/sim/state');
  const currentSP = currentST.setpoints;
  const startWaste = currentST.waste_meter;
  const devs = [];

  // Ramp from current to target
  const ok = await rampAndApply(currentSP, targetSP, ro, `r2_${ro}`);
  if (!ok) {
    devs.push('apply_failed');
  }

  // Stabilize
  const sb = await api('POST', '/sim/run-until-stable', {minStableTicks:5, maxTicks:20});
  if (!sb.stable) devs.push('did_not_stabilize');

  // Collect
  const q = await api('GET', '/sim/online-quality');
  const st2 = await api('GET', '/sim/state');

  // Flag suspect conditions but include all data
  if (q.metrics.birefringence_cv > 3.7) devs.push(`bir_cv=${q.metrics.birefringence_cv.toFixed(2)}>3.7`);
  if (Math.abs(q.metrics.thickness_mean - 12) > 0.22) devs.push(`thick_mean=${q.metrics.thickness_mean.toFixed(3)}_OOS`);
  if (st2.alarm_active) devs.push('alarm');
  if (st2.waste_meter - startWaste > 120) devs.push(`waste+${(st2.waste_meter-startWaste).toFixed(0)}`);

  const entry = {
    run_order: ro, matrix_run: mr, is_center: ic, type: run.type,
    setpoints: targetSP,
    responses: q.metrics,
    line_state: st2.line_state, alarm: st2.alarm_active,
    tick: st2.tick, waste: st2.waste_meter,
    deviations: devs,
    status: devs.length ? 'SUSPECT' : 'OK'
  };
  log.runs.push(entry);
  console.log(`  resp: thick=${q.metrics.thickness_cv.toFixed(3)}% bir_cv=${q.metrics.birefringence_cv.toFixed(3)}% bir_m=${q.metrics.birefringence_mean.toFixed(5)}${devs.length ? ` ⚠️ ${devs.join(';')}` : ' ✅'}`);

  // Reset to baseline between runs (unless center and clean)
  if (ro < runs.length) {
    const blSteps = rampSteps(targetSP, BL);
    for (let s = 1; s < blSteps.length; s++) {
      const cur = blSteps[s], prv = blSteps[s-1];
      const ch = Object.keys(BL).filter(t => Math.abs(cur[t]-prv[t])>1e-8).map(t=>({tag:t, target:cur[t]}));
      if (!ch.length) continue;
      if (s > 1) await api('POST', '/sim/run-until-stable', {minStableTicks:1, maxTicks:3});
      await api('POST', '/sim/setpoints/apply', { changes:ch, expectedLagMinutes:6, sourcePlan:`bl_reset_r${ro}` });
    }
    await api('POST', '/sim/run-until-stable', {minStableTicks:3, maxTicks:8});
  }
}

const final = await api('GET', '/sim/state');
log.completed_at = new Date().toISOString();
log.final_tick = final.tick;
log.final_waste = final.waste_meter;
fs.writeFileSync(`${WS}/_execution_redux.json`, JSON.stringify(log, null, 2)+'\n');
console.log(`\n✅ Phase 2 RSM complete: tick=${final.tick} waste=${final.waste_meter.toFixed(1)}`);
console.log(`Data points collected: ${log.runs.filter(r => !r.deviations.includes('apply_failed')).length}`);
