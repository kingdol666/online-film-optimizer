#!/usr/bin/env node
/**
 * DOE Phase 1 Screening — Batch Executor
 * Runs all 20 screening runs in randomized order from doe_design_001.json.
 * Each run: multi-step ramp from baseline → stabilize → collect → reset to baseline.
 * Uses simulator HTTP API on port 8877.
 */

const SIM = 'http://127.0.0.1:8877';
const CAMPAIGN = 'CMP-DOE-FULL-PET-001';
const WS = 'workspace/optimization-tasks/DOE-FULL-PET-001/01_screening';
const fs = await import('fs');

const MAX_DELTA = {
  extruder_speed:2.5, melt_temp:2, casting_roll_temp:1.5,
  md_draw_ratio:0.04, md_zone_temp:1.5, td_draw_ratio:0.04,
  td_zone_1_temp:1.5, td_zone_2_temp:1.5, heatset_temp:1.5,
  relaxation_ratio:0.3, line_speed:0.8, winder_tension:3
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
      cur[t] = Math.round((cur[t] + Math.min(Math.abs(d), MAX_DELTA[t]) * Math.sign(d)) * 1e4) / 1e4;
    }
    if (done || steps.length > 25) break;
    steps.push({...cur});
  }
  return steps;
}

async function doRun(ro, target) {
  const state = await api('GET', '/sim/state');
  const startWaste = state.waste_meter;
  const devs = [];
  console.log(`  Ramp: ${ro} start waste=${startWaste.toFixed(1)}`);

  const steps = genSteps(state.setpoints, target);
  for (let s = 1; s < steps.length; s++) {
    const cur = steps[s], prv = steps[s-1];
    const ch = Object.keys(target).filter(t => Math.abs(cur[t] - prv[t]) > 1e-8).map(t => ({tag:t, target:cur[t]}));
    if (!ch.length) continue;
    if (s > 1) await api('POST', '/sim/run-until-stable', {minStableTicks:2, maxTicks:6});

    const pr = await api('POST', '/sim/setpoints/preview', { campaignId:CAMPAIGN, changes:ch, expectedLagMinutes:6, sourcePlan:`r${ro}_s${s}` });
    if (!pr.safety_gate_result?.allowed) {
      devs.push(`preview_fail_step${s}:${pr.safety_gate_result.violations?.join(',')}`);
      console.error(`    ❌ Step ${s} PREVIEW FAIL: ${pr.safety_gate_result.violations?.join(';')}`);
      continue;
    }
    const ap = await api('POST', '/sim/setpoints/apply', { campaignId:CAMPAIGN, changes:ch, expectedLagMinutes:6, sourcePlan:`r${ro}_s${s}` });
    if (!ap.receipt?.executed) { devs.push(`apply_fail_step${s}`); console.error(`    ❌ Step ${s} APPLY FAIL`); break; }
    console.log(`    Step ${s} OK: ${ch.length} params`);
  }

  // Stabilize and collect
  console.log('  Stabilizing...');
  const sb = await api('POST', '/sim/run-until-stable', {minStableTicks:5, maxTicks:20});
  const q = await api('GET', '/sim/online-quality');
  const st2 = await api('GET', '/sim/state');

  console.log(`  Responses: thick_mean=${q.metrics.thickness_mean.toFixed(3)} thick_cv=${q.metrics.thickness_cv.toFixed(3)} bir_mean=${q.metrics.birefringence_mean.toFixed(5)} bir_cv=${q.metrics.birefringence_cv.toFixed(3)}`);

  if (q.metrics.birefringence_cv > 3.7) devs.push(`bir_cv=${q.metrics.birefringence_cv.toFixed(2)}>3.7`);
  if (Math.abs(q.metrics.thickness_mean - 12) > 0.22) devs.push(`thick_mean=${q.metrics.thickness_mean.toFixed(3)} out_of_spec`);
  if (st2.alarm_active) devs.push('alarm');
  if (st2.waste_meter - startWaste > 80) devs.push(`waste_jump=${(st2.waste_meter-startWaste).toFixed(1)}>80`);

  return { metrics: q.metrics, line_state: st2.line_state, alarm: st2.alarm_active, tick: st2.tick, waste: st2.waste_meter, deviations: devs };
}

async function resetToBaseline(targetTo) {
  const bv = { extruder_speed:100, melt_temp:278, casting_roll_temp:33, md_draw_ratio:3.1, md_zone_temp:92, td_draw_ratio:3.69, td_zone_1_temp:108, td_zone_2_temp:114.2, heatset_temp:220.5, relaxation_ratio:4.42, line_speed:41, winder_tension:118 };
  const steps = genSteps(targetTo, bv);
  for (let s = 1; s < steps.length; s++) {
    const cur = steps[s], prv = steps[s-1];
    const ch = Object.keys(bv).filter(t => Math.abs(cur[t] - prv[t]) > 1e-8).map(t => ({tag:t, target:cur[t]}));
    if (!ch.length) continue;
    if (s > 1) await api('POST', '/sim/run-until-stable', {minStableTicks:2, maxTicks:6});
    await api('POST', '/sim/setpoints/apply', { campaignId:CAMPAIGN, changes:ch, expectedLagMinutes:6, sourcePlan:'reset_baseline' });
  }
  await api('POST', '/sim/run-until-stable', {minStableTicks:3, maxTicks:10});
}

// === MAIN ===
const design = JSON.parse(fs.readFileSync(`${WS}/doe_design_001.json`, 'utf-8'));
const runs = [...design.run_matrix.runs].sort((a,b) => a.run_order - b.run_order);

console.log(`\n=== DOE Phase 1 Screening — ${runs.length} runs ===`);
const log = { campaign:CAMPAIGN, started_at: new Date().toISOString(), runs: [] };

for (const run of runs) {
  const {run_order:ro, matrix_run:mr, is_center:ic, actual:target} = run;
  const tag = `R${ro}/M${mr}${ic?' [CENTER]':''}`;
  console.log(`\n─── ${tag} ───`);

  const result = await doRun(ro, target);
  // Save run log
  const logEntry = {
    run_order: ro, matrix_run: mr, is_center: ic,
    setpoints: target,
    responses: result.metrics,
    line_state: result.line_state,
    alarm: result.alarm,
    tick: result.tick,
    waste: result.waste,
    deviations: result.deviations,
    status: result.deviations.length ? 'SUSPECT' : 'OK'
  };
  log.runs.push(logEntry);

  const dir = `${WS}/trial_R${ro}`;
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(`${dir}/run_log.json`, JSON.stringify(logEntry, null, 2)+'\n');

  if (result.deviations.length) console.log(`  ⚠️  ${result.deviations.join('; ')}`);
  else console.log('  ✅');

  // Reset to baseline
  if (ro < runs.length) {
    console.log('  Resetting to baseline...');
    await resetToBaseline(target);
    const s = await api('GET', '/sim/state');
    console.log(`  Baseline: tick=${s.tick} waste=${s.waste_meter.toFixed(1)}`);
  }
}

const final = await api('GET', '/sim/state');
log.completed_at = new Date().toISOString();
log.final_tick = final.tick;
log.final_waste = final.waste_meter;
log.final_line_state = final.line_state;
fs.writeFileSync(`${WS}/_execution_summary.json`, JSON.stringify(log, null, 2)+'\n');
console.log(`\n✅ All ${runs.length} runs complete! tick=${final.tick} waste=${final.waste_meter.toFixed(1)}`);
