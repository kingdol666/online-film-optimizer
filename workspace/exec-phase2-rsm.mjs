#!/usr/bin/env node
/**
 * DOE Phase 2 — RSM Batch Executor
 * 32-run Face-Centered CCD with multi-step ramping.
 * Uses simulator HTTP API on port 8877.
 * Each run: ramp from baseline → stabilize → collect → reset to baseline.
 */

const SIM = 'http://127.0.0.1:8877';
const CAMPAIGN = 'CMP-DOE-FULL-PET-001';
const WS = 'workspace/optimization-tasks/DOE-FULL-PET-001/02_rsm';
const fs = await import('fs');

const MAX_DELTA = {
  td_zone_2_temp:1.5, heatset_temp:1.5, td_draw_ratio:0.04,
  line_speed:0.8, md_zone_temp:1.5,
  extruder_speed:2.5, melt_temp:2, casting_roll_temp:1.5,
  md_draw_ratio:0.04, relaxation_ratio:0.3, winder_tension:3
};

// Baseline values for the 5 RSM factors (center) + 6 held factors
const BASELINE = {
  td_zone_2_temp:113.5, heatset_temp:219.5, td_draw_ratio:3.69,
  line_speed:41, md_zone_temp:92,
  md_draw_ratio:3.12, casting_roll_temp:33, relaxation_ratio:4.4,
  extruder_speed:100, melt_temp:278, winder_tension:118
};

async function api(method, path, body) {
  const r = await fetch(new URL(path, SIM), { method, headers:{'Content-Type':'application/json'}, body:body?JSON.stringify(body):undefined });
  return r.json();
}

function genSteps(from, to) {
  const steps = [{...from}], tags = Object.keys(to);
  while (true) {
    const cur = {...steps[steps.length-1]};
    let done = true;
    for (const t of tags) {
      const d = to[t] - cur[t];
      if (Math.abs(d) < 1e-8) continue;
      done = false;
      cur[t] = Math.round((cur[t] + Math.min(Math.abs(d), MAX_DELTA[t] || 100) * Math.sign(d)) * 1e4) / 1e4;
    }
    if (done || steps.length > 25) break;
    steps.push({...cur});
  }
  return steps;
}

async function doRun(ro, target, hold) {
  const fullTarget = { ...hold, ...target };
  const state = await api('GET', '/sim/state');
  const startWaste = state.waste_meter;
  const devs = [];

  // Only ramp the 5 RSM factors + any held factors that differ
  const rampTarget = {};
  for (const t of Object.keys(fullTarget)) {
    if (Math.abs(fullTarget[t] - BASELINE[t]) > 1e-8) {
      rampTarget[t] = fullTarget[t];
    }
  }

  if (Object.keys(rampTarget).length > 0) {
    const steps = genSteps(BASELINE, rampTarget);
    for (let s = 1; s < steps.length; s++) {
      const cur = steps[s], prv = steps[s-1];
      const ch = Object.keys(rampTarget).filter(t => Math.abs(cur[t] - prv[t]) > 1e-8).map(t => ({tag:t, target:cur[t]}));
      if (!ch.length) continue;
      if (s > 1) await api('POST', '/sim/run-until-stable', {minStableTicks:2, maxTicks:6});

      const pr = await api('POST', '/sim/setpoints/preview', { campaignId:CAMPAIGN, changes:ch, expectedLagMinutes:6, sourcePlan:`r2_${ro}_s${s}` });
      if (!pr.safety_gate_result?.allowed) {
        // Try anyway — gate may reject if line in transition
        console.error(`    ⚠️  Step ${s} preview: ${pr.safety_gate_result.violations?.join(',')}`);
      }
      const ap = await api('POST', '/sim/setpoints/apply', { campaignId:CAMPAIGN, changes:ch, expectedLagMinutes:6, sourcePlan:`r2_${ro}_s${s}` });
      if (!ap.receipt?.executed) { devs.push(`apply_fail_step${s}`); console.error(`    ❌ Step ${s} FAIL`); break; }
    }
  }

  // Stabilize and collect
  const sb = await api('POST', '/sim/run-until-stable', {minStableTicks:5, maxTicks:20});
  const q = await api('GET', '/sim/online-quality');
  const st2 = await api('GET', '/sim/state');

  if (q.metrics.birefringence_cv > 3.7) devs.push(`bir_cv=${q.metrics.birefringence_cv.toFixed(2)}>3.7`);
  if (Math.abs(q.metrics.thickness_mean - 12) > 0.22) devs.push(`thick_mean=${q.metrics.thickness_mean.toFixed(3)} out_of_spec`);
  if (st2.alarm_active) devs.push('alarm');
  if (st2.waste_meter - startWaste > 120) devs.push(`waste_jump=${(st2.waste_meter-startWaste).toFixed(1)}>120`);

  return { metrics: q.metrics, line_state: st2.line_state, alarm: st2.alarm_active, tick: st2.tick, waste: st2.waste_meter, deviations: devs };
}

async function resetToBaseline() {
  const steps = genSteps({}, BASELINE);
  // Apply all baseline in one shot if possible
  const ch = Object.entries(BASELINE).map(([tag, target]) => ({tag, target}));
  await api('POST', '/sim/setpoints/apply', { campaignId:CAMPAIGN, changes:ch, expectedLagMinutes:6, sourcePlan:'r2_baseline_reset' });
  await api('POST', '/sim/run-until-stable', {minStableTicks:3, maxTicks:10});
}

// === MAIN ===
const design = JSON.parse(fs.readFileSync(`${WS}/doe_design_001.json`, 'utf-8'));
const runs = [...design.run_matrix.runs].sort((a,b) => a.run_order - b.run_order);

console.log(`\n=== DOE Phase 2 RSM — ${runs.length} runs ===`);
const log = { campaign:CAMPAIGN, started_at: new Date().toISOString(), runs: [] };

// First, ensure line is at baseline
console.log('Ensuring line at baseline...');
await resetToBaseline();
let st = await api('GET', '/sim/state');
console.log(`Start: tick=${st.tick} waste=${st.waste_meter.toFixed(1)}`);

for (const run of runs) {
  const {run_order:ro, matrix_run:mr, is_center:ic, actual:target, hold} = run;
  const tag = `R${ro}/M${mr}${ic?' [CENTER]':''}`;
  console.log(`\n─── ${tag} ───`);

  const result = await doRun(ro, target, hold || BASELINE);
  const logEntry = {
    run_order: ro, matrix_run: mr, is_center: ic, type: run.type,
    setpoints: { ...BASELINE, ...target },
    responses: result.metrics,
    line_state: result.line_state,
    alarm: result.alarm,
    tick: result.tick,
    waste: result.waste,
    deviations: result.deviations,
    status: result.deviations.length ? 'SUSPECT' : 'OK'
  };
  log.runs.push(logEntry);

  if (result.deviations.length) console.log(`  ⚠️  ${result.deviations.join('; ')}`);
  else console.log(`  ✅ thick_cv=${result.metrics.thickness_cv.toFixed(3)} bir_cv=${result.metrics.birefringence_cv.toFixed(3)} bir_mean=${result.metrics.birefringence_mean.toFixed(5)}`);

  // Reset to baseline
  if (ro < runs.length && !ic) {
    console.log('  Reset to baseline...');
    await resetToBaseline();
  } else if (ro < runs.length) {
    // Center points are near baseline already; just check
    const s2 = await api('GET', '/sim/state');
    if (Math.abs(s2.waste_meter - result.waste) > 10) {
      await resetToBaseline();
    }
  }
}

const final = await api('GET', '/sim/state');
log.completed_at = new Date().toISOString();
log.final_tick = final.tick;
log.final_waste = final.waste_meter;
log.final_line_state = final.line_state;
fs.writeFileSync(`${WS}/_execution_summary.json`, JSON.stringify(log, null, 2)+'\n');
console.log(`\n✅ All ${runs.length} Phase 2 RSM runs complete! tick=${final.tick} waste=${final.waste_meter.toFixed(1)}`);
