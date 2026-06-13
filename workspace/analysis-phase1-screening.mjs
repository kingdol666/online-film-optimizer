#!/usr/bin/env node
/**
 * Phase 1 Screening Analysis — DOE-FULL-PET-001
 *
 * 20-run Plackett-Burman + 4 center points.
 * Compute: effects per factor per response, Pareto chart, curvature test,
 * active factors identification, stage gate recommendation.
 *
 * Design: Plackett-Burman 16 factorial runs + 4 center points.
 * Factors: A=extruder_speed, B=melt_temp, C=casting_roll_temp, D=md_draw_ratio,
 *          E=md_zone_temp, F=td_draw_ratio, H=td_zone_1_temp, I=td_zone_2_temp,
 *          J=heatset_temp, L=relaxation_ratio, M=line_speed, O=winder_tension
 *          Dummies: G, K, N
 */

const fs = await import('fs');
const design = JSON.parse(fs.readFileSync(
  'workspace/optimization-tasks/DOE-FULL-PET-001/01_screening/doe_design_001.json', 'utf-8'));
const runs = JSON.parse(fs.readFileSync(
  'workspace/optimization-tasks/DOE-FULL-PET-001/01_screening/_execution_summary.json', 'utf-8')).runs;

// Build response matrix
// Map from run_log's run_order to design's coded levels
const runOrderToCoded = {};
for (const r of design.run_matrix.runs) {
  runOrderToCoded[r.run_order] = { ...r.coded, is_center: r.is_center, matrix_run: r.matrix_run };
}

const FACTOR_COLS = ['A','B','C','D','E','F','H','I','J','L','M','O'];
const DUMMY_COLS = ['G','K','N'];
const RESPONSES = ['thickness_mean','thickness_cv','birefringence_mean','birefringence_cv'];

// Separate factorial and center runs
const factorialRuns = [];
const centerRuns = [];

for (const run of runs) {
  const coded = runOrderToCoded[run.run_order];
  if (!coded) continue;
  if (run.is_center) {
    centerRuns.push(run);
  } else {
    factorialRuns.push({ ...run, coded });
  }
}

console.log(`Factorial runs: ${factorialRuns.length}, Center runs: ${centerRuns.length}`);
console.log(`Center point means:`);
for (const r of centerRuns) {
  console.log(`  C${r.matrix_run}: thick_cv=${r.responses.thickness_cv.toFixed(4)}, bir_mean=${r.responses.birefringence_mean.toFixed(5)}, bir_cv=${r.responses.birefringence_cv.toFixed(4)}`);
}

const analysis = {};

for (const RESP of RESPONSES) {
  console.log(`\n========== ${RESP} ==========`);

  // Mean of all factorial runs
  const yFactorial = factorialRuns.map(r => r.responses[RESP]);
  const yCenter = centerRuns.map(r => r.responses[RESP]);

  const nFact = yFactorial.length;
  const nCen = yCenter.length;
  const meanFact = yFactorial.reduce((a,b) => a+b, 0) / nFact;
  const meanCen = yCenter.reduce((a,b) => a+b, 0) / nCen;

  // Compute effects for each factor in the PB design
  // For PB designs: effect = (mean of runs with factor at +1) - (mean of runs with factor at -1)
  // Note: the actual effect coefficient = effect / 2 in regression terms
  const effects = {};

  for (const col of [...FACTOR_COLS, ...DUMMY_COLS]) {
    const plusRuns = factorialRuns.filter(r => r.coded[col] === 1 || r.coded[col] === '+1' || r.coded[col] === 1);
    const minusRuns = factorialRuns.filter(r => r.coded[col] === -1 || r.coded[col] === '-1' || r.coded[col] === -1);

    if (plusRuns.length === 0 || minusRuns.length === 0) {
      // Handle center point coded = 0 — skip for now
      effects[col] = { effect: null, mean_plus: null, mean_minus: null, n_plus: 0, n_minus: 0 };
      continue;
    }

    const meanPlus = plusRuns.reduce((a,r) => a + r.responses[RESP], 0) / plusRuns.length;
    const meanMinus = minusRuns.reduce((a,r) => a + r.responses[RESP], 0) / minusRuns.length;
    effects[col] = {
      effect: meanPlus - meanMinus,
      mean_plus: meanPlus,
      mean_minus: meanMinus,
      n_plus: plusRuns.length,
      n_minus: minusRuns.length
    };
  }

  // Sort by absolute effect
  const sortedEffects = Object.entries(effects)
    .filter(([k, v]) => v.effect !== null)
    .sort((a, b) => Math.abs(b[1].effect) - Math.abs(a[1].effect));

  // Estimate PSE (Pseudo Standard Error) from Lenth's method
  // Based on the median of |effects| of the factors (NOT the active ones)
  const absEffects = sortedEffects.map(([k, v]) => Math.abs(v.effect));
  const s0 = 1.5 * median(absEffects);
  const trimmedEffects = absEffects.filter(e => e < 2.5 * s0);
  const PSE = 1.5 * median(trimmedEffects);

  // ME (Margin of Error) and SME (Simultaneous Margin of Error) at α=0.10
  // m = number of effects estimated
  const m = sortedEffects.length;
  const t_ME = 2.152; // approximate for PB with 15 columns at α=0.10
  const t_SME = 3.037; // approximate for m=15
  const ME = t_ME * PSE;
  const SME = t_SME * PSE;

  // Dummy effects
  const dummyEffects = [];
  for (const col of DUMMY_COLS) {
    if (effects[col]?.effect !== null) {
      dummyEffects.push({ col, effect: effects[col].effect });
    }
  }

  // Curvature test: compare factorial mean vs center mean
  // t = (mean_cen - mean_fact) / sqrt( s_pool^2 * (1/n_cen + 1/n_fact) )
  // Pooled variance from factorial runs (center points give pure error)
  const varCen = yCenter.reduce((s, v) => s + (v - meanCen)**2, 0) / (nCen - 1);
  const varFact = yFactorial.reduce((s, v) => s + (v - meanFact)**2, 0) / (nFact - 1);
  // Use center-point variance as pure error estimate
  const sp2 = varCen;
  const seCurve = Math.sqrt(sp2 * (1/nCen + 1/nFact));
  const tCurve = (meanCen - meanFact) / (seCurve || 1e-10);
  const dfCurve = nCen - 1;
  // Two-tailed p-value from t-distribution (approximate)
  const pCurve = 2 * (1 - tCDF(Math.abs(tCurve), dfCurve));

  console.log(`\nFactor effects (sorted):`);
  console.log(`  PSE=${PSE.toFixed(5)}, ME=${ME.toFixed(5)}, SME=${SME.toFixed(5)}`);
  console.log(`  Curvature: mean_cen=${meanCen.toFixed(5)} mean_fact=${meanFact.toFixed(5)} t=${tCurve.toFixed(3)} p=${pCurve.toFixed(5)}`);
  console.log(`  Dummy effects: ${dummyEffects.map(d => `${d.col}=${d.effect.toFixed(5)}`).join(', ') || 'none'}`);
  console.log(`  Active (|effect| > ME=${ME.toFixed(5)}):`);

  for (const [col, v] of sortedEffects) {
    const active = Math.abs(v.effect) > ME ? '***' : Math.abs(v.effect) > PSE * 1.5 ? '**' : '';
    const meFlag = Math.abs(v.effect) > ME ? ' >ME' : '';
    const smeFlag = Math.abs(v.effect) > SME ? ' >SME' : '';
    console.log(`  ${col}: ${v.effect.toFixed(5)} (${v.mean_plus.toFixed(4)} vs ${v.mean_minus.toFixed(4)})${meFlag}${smeFlag}`);
  }

  // Identify active factors (|effect| > ME)
  const activeFactors = sortedEffects
    .filter(([k, v]) => Math.abs(v.effect) > ME && !DUMMY_COLS.includes(k))
    .map(([k, v]) => ({
      factor: design.factor_space.factors[k]?.name || k,
      effect: v.effect,
      absolute_effect: Math.abs(v.effect),
      mean_plus: v.mean_plus,
      mean_minus: v.mean_minus
    }));

  // Identify dummy significance
  const significantDummy = dummyEffects.filter(d => Math.abs(d.effect) > ME);

  analysis[RESP] = {
    mean_factorial: meanFact,
    mean_center: meanCen,
    curvature_test: {
      t_statistic: tCurve,
      p_value: pCurve,
      significant: pCurve < 0.1,
      degrees_of_freedom: dfCurve,
      interpretation: pCurve < 0.1
        ? `Curvature is statistically significant (p=${pCurve.toFixed(4)}). Response surface phase recommended.`
        : `No significant curvature detected (p=${pCurve.toFixed(4)}). Linear model may suffice.`
    },
    lenth_estimates: {
      PSE,
      ME,
      SME,
      m_effects: m
    },
    effects: Object.fromEntries(
      sortedEffects.map(([k, v]) => [k, v.effect])
    ),
    active_factors: activeFactors,
    all_active_factor_names: activeFactors.map(f => f.factor),
    significant_dummy_columns: significantDummy,
    stage_recommendation: activeFactors.length > 0
      ? `ADVANCE to Phase 2 with vital factors: ${activeFactors.map(f => f.factor).join(', ')}`
      : 'REWORK — no active factors detected. Re-examine factor ranges or problem framing.'
  };
}

// ────────────────────
// Stage gate synthesis
// ────────────────────

const allActive = {};
for (const RESP of RESPONSES) {
  const factors = analysis[RESP].active_factors;
  for (const f of factors) {
    allActive[f.factor] = (allActive[f.factor] || 0) + 1;
  }
}

const activeFactorList = Object.entries(allActive)
  .sort((a, b) => b[1] - a[1])
  .map(([f, count]) => ({ factor: f, responses_affected: count }));

const anyCurvatureSignificant = Object.values(analysis).some(a => a.curvature_test.significant);
const totalActiveFactors = new Set(Object.keys(allActive)).size;

const gateVerdict = totalActiveFactors > 0
  ? {
      decision: 'ADVANCE',
      condition: 'Active factors identified',
      active_factors_found: totalActiveFactors,
      vital_factors: activeFactorList,
      curvature_detected: anyCurvatureSignificant,
      next_phase: anyCurvatureSignificant ? 'Phase 2 RSM' : 'Consider steepest ascent (linear)',
      note: anyCurvatureSignificant
        ? 'Curvature is significant for key responses, supporting Phase 2 response surface methodology.'
        : 'No significant curvature detected. A linear steepest-ascent path may be more efficient than RSM.'
    }
  : {
      decision: 'REWORK',
      condition: 'No active factors identified across any response',
      note: 'Re-examine factor ranges (may be too narrow) or check for measurement resolution issues.'
    };

// ────────────────────
// Write analysis
// ────────────────────

const output = {
  task_id: 'DOE-FULL-PET-001',
  phase: 1,
  analysis_id: 'doe_analysis_001',
  campaign_id: 'CMP-DOE-FULL-PET-001',
  author_role: 'Measurement & Statistical-Analysis Lead (Quality)',
  method: 'Plackett-Burman screening — Lenth PSE + ME + SME, curvature t-test',
  design_summary: {
    factorial_runs: factorialRuns.length,
    center_runs: centerRuns.length,
    total_runs: factorialRuns.length + centerRuns.length,
    responses_analyzed: RESPONSES
  },
  per_response: analysis,
  cross_response_synthesis: {
    total_unique_active_factors: totalActiveFactors,
    active_factors_by_impact: activeFactorList,
    curvature_significant_any_response: anyCurvatureSignificant,
    dummy_column_structural_check: (() => {
      const sigDummies = {};
      for (const RESP of RESPONSES) {
        const sigs = analysis[RESP].significant_dummy_columns;
        sigs.forEach(d => { sigDummies[d.col] = (sigDummies[d.col] || 0) + 1; });
      };
      const totalSigDummy = Object.keys(sigDummies).length;
      return {
        dummy_columns_significant: sigDummies,
        concern_level: totalSigDummy >= 2 ? 'HIGH — multiple dummy columns significant suggests structural confounding' : 'LOW — dummies not significant, design adequate'
      };
    })()
  },
  stage_gate_recommendation: gateVerdict,
  file_generated: '01_screening/doe_analysis_001.json'
};

// Write
fs.writeFileSync(
  'workspace/optimization-tasks/DOE-FULL-PET-001/01_screening/doe_analysis_001.json',
  JSON.stringify(output, null, 2) + '\n',
  'utf-8'
);
console.log(`\nAnalysis written: ${output.file_generated}`);
console.log(`\n=== GATE VERDICT: ${gateVerdict.decision} ===`);
console.log(`Active factors found: ${totalActiveFactors}`);
console.log(`Curvature significant: ${anyCurvatureSignificant}`);
console.log(`Recommended next phase: ${gateVerdict.next_phase}`);

// ─── helper functions ───

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function tCDF(t, df) {
  // Approximation using regularized incomplete beta function
  const x = df / (df + t * t);
  if (df <= 0) return NaN;
  const a = df / 2;
  const b = 0.5;
  const ib = regIncBeta(x, a, b);
  return 1 - 0.5 * ib;
}

function regIncBeta(x, a, b) {
  // Lent's method for regularized incomplete beta function (approximate)
  // Use continued fraction representation
  if (x < 0 || x > 1) return NaN;
  if (x === 0 || x === 1) return x;
  const bt = Math.exp(lgamma(a+b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1-x));
  if (x < (a+1)/(a+b+2)) {
    return bt * betacf(x, a, b) / a;
  } else {
    return 1 - bt * betacf(1-x, b, a) / b;
  }
}

function betacf(x, a, b) {
  const MAX_ITER = 100;
  const EPS = 3e-7;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1.0;
  let d = 1.0 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1.0 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    let m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1.0 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1.0 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1.0 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1.0 / d;
    let del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < EPS) break;
  }
  return h;
}

function lgamma(z) {
  // Stirling's approximation for log gamma
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
            771.32342877765313, -176.61502916214059, 12.507343278686905,
            -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
