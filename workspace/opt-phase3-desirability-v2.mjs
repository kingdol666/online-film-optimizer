#!/usr/bin/env node
/**
 * Phase 3 — Multi-Response Desirability Optimization (V2)
 *
 * Fix: birefringence_mean has structural floor ~0.091 due to the heatset quadratic penalty.
 * The original desirability target of 0.078 is unachievable in the current factor space.
 * We use a more gradual desirability function and search the full space properly.
 *
 * Also: since birefringence_cv has extreme curvature (A² dominates with coef 0.80,
 * creating a steep U-shaped response), we need fine-grained search.
 *
 * Strategy: brute force scan of (A,B,C) at high resolution, with (D,E) at moderate.
 * A=td_zone_2_temp (main bir_cv driver), B=heatset_temp (main bir_mean driver),
 * C=td_draw_ratio (affects both thickness + birefringence)
 */

const fs = await import('fs');

const MODELS = {
  thickness_mean: {
    coef: { intercept: 12.0556, A: -0.00159, B: -0.00378, C: -0.02988, D: -0.02526, E: -0.00390,
      A2: 0.00724, B2: -0.00491, C2: -0.01026, D2: 0.01789, E2: 0.00934,
      AB: 0.00106, AC: 0.00158, AD: -0.00857, AE: 0.00372,
      BC: -0.00233, BD: 0.00207, BE: -0.00107, CD: -0.00263, CE: 0.01163, DE: 0.00481 }
  },
  thickness_cv: {
    coef: { intercept: 1.26078, A: -0.01287, B: 0.02931, C: -0.00038, D: -0.11728, E: -0.00089,
      A2: -0.02288, B2: 0.05552, C2: 0.53142, D2: 0.10492, E2: -0.01473,
      AB: 0.00229, AC: -0.01572, AD: -0.00307, AE: 0.00049,
      BC: 0.01781, BD: 0.02328, BE: -0.03398, CD: 0.02207, CE: 0.03018, DE: 0.02561 }
  },
  birefringence_mean: {
    coef: { intercept: 0.09314, A: 0.000628, B: -0.001757, C: 0.001402, D: -0.000038, E: -0.000692,
      A2: -0.000248, B2: -0.000807, C2: -0.000099, D2: -0.000018, E2: 0.000124,
      AB: 0.000044, AC: -0.000002, AD: 0.000066, AE: 0.000001,
      BC: -0.000056, BD: 0.000085, BE: 0.000067, CD: 0.000056, CE: 0.000034, DE: -0.000078 }
  },
  birefringence_cv: {
    coef: { intercept: 3.37260, A: -0.26987, B: 0.00167, C: -0.09349, D: 0.00119, E: 0.00079,
      A2: 0.80005, B2: 0.29540, C2: -0.06648, D2: 0.01229, E2: -0.04987,
      AB: 0.02045, AC: -0.05992, AD: -0.04764, AE: 0.00854,
      BC: 0.02771, BD: -0.00966, BE: 0.01762, CD: 0.01181, CE: -0.01174, DE: -0.00365 }
  }
};

const RANGES = {
  A: { lo: -1, hi: 1, decode: v => 113.5 + v * 4.5 },
  B: { lo: -1, hi: 1, decode: v => 219.5 + v * 4.5 },
  C: { lo: -1, hi: 1, decode: v => 3.69 + v * 0.09 },
  D: { lo: -1, hi: 1, decode: v => 41 + v * 2 },
  E: { lo: -1, hi: 1, decode: v => 92 + v * 4 }
};

function predict(rid, x) {
  const {A,B,C,D,E} = x;
  const c = MODELS[rid].coef;
  return c.intercept +
    c.A*A + c.B*B + c.C*C + c.D*D + c.E*E +
    c.A2*A*A + c.B2*B*B + c.C2*C*C + c.D2*D*D + c.E2*E*E +
    c.AB*A*B + c.AC*A*C + c.AD*A*D + c.AE*A*E +
    c.BC*B*C + c.BD*B*D + c.BE*B*E +
    c.CD*C*D + c.CE*C*E + c.DE*D*E;
}

// Relaxed desirability: birefringence_mean target is realistic ~0.090 (structural floor)
// but we still penalize values above 0.091
function overall(x) {
  const y1 = predict('thickness_mean', x);
  const y2 = predict('thickness_cv', x);
  const y3 = predict('birefringence_mean', x);
  const y4 = predict('birefringence_cv', x);

  // thickness_mean: nominal 12.0 ± 0.22
  const d1 = y1 < 11.78 || y1 > 12.22 ? 0 :
    y1 === 12.0 ? 1 :
    y1 < 12.0 ? Math.pow((y1 - 11.78) / 0.22, 1.5) :
    Math.pow((12.22 - y1) / 0.22, 1.5);

  // thickness_cv: smaller, max=1.55, target=1.0
  const d2 = y2 <= 1.0 ? 1 : y2 >= 1.55 ? 0 : Math.pow(1 - (y2 - 1.0) / 0.55, 1.5);

  // birefringence_mean: nominal, but realistic target is 0.088-0.091 structural floor
  // Give partial credit even at 0.091 — it's the physical floor
  // lo=0.075, hi=0.081 (target window from charter)
  // But we extend: anything below 0.088 is great, above 0.093 is bad
  const d3 = y3 < 0.075 || y3 > 0.093 ? 0 :
    y3 <= 0.081 ? 1 : // inside spec window
    Math.pow(1 - (y3 - 0.081) / 0.012, 1.5); // decays from 0.081 to 0.093

  // birefringence_cv: smaller, max=3.7, target=3.0
  const d4 = y4 <= 3.0 ? 1 : y4 >= 3.7 ? 0 : Math.pow(1 - (y4 - 3.0) / 0.7, 1.5);

  const D = Math.pow(d1 * d2 * d3 * d4, 0.25);
  return { D, d1, d2, d3, d4, y1, y2, y3, y4 };
}

console.log('\n=== Phase 3: Multi-Response Desirability (v2 — relaxed bir_mean target) ===\n');

// Strategy 1: Heuristic at higher resolution on the 3 key factors (A, B, C)
let best = { D: -1 };
const n = 21;
for (let ai = 0; ai < n; ai++) {
  const A = -1 + 2 * ai / (n-1);
  for (let bi = 0; bi < n; bi++) {
    const B = -1 + 2 * bi / (n-1);
    for (let ci = 0; ci < n; ci++) {
      const C = -1 + 2 * ci / (n-1);
      // Scan D and E at lower resolution
      for (let di = 0; di < 7; di++) {
        const D = -1 + 2 * di / 6;
        for (let ei = 0; ei < 7; ei++) {
          const E = -1 + 2 * ei / 6;
          const r = overall({ A, B, C, D, E });
          if (r.D > best.D) best = { ...r, x: { A, B, C, D, E } };
        }
      }
    }
  }
}
console.log(`Grid 21×21×21×7×7: best D=${best.D.toFixed(4)}`);

// Strategy 2: Local refinement
for (let iter = 0; iter < 5; iter++) {
  const span = 0.8 / (iter + 1);
  const n2 = 9;
  for (let ai = 0; ai < n2; ai++) {
    const A = Math.max(-1, Math.min(1, best.x.A - span + 2*span*ai/(n2-1)));
    for (let bi = 0; bi < n2; bi++) {
      const B = Math.max(-1, Math.min(1, best.x.B - span + 2*span*bi/(n2-1)));
      for (let ci = 0; ci < n2; ci++) {
        const C = Math.max(-1, Math.min(1, best.x.C - span + 2*span*ci/(n2-1)));
        for (let di = 0; di < n2; di++) {
          const D = Math.max(-1, Math.min(1, best.x.D - span + 2*span*di/(n2-1)));
          for (let ei = 0; ei < n2; ei++) {
            const E = Math.max(-1, Math.min(1, best.x.E - span + 2*span*ei/(n2-1)));
            const r = overall({ A, B, C, D, E });
            if (r.D > best.D) best = { ...r, x: { A, B, C, D, E } };
          }
        }
      }
    }
  }
}
console.log(`Local refinement: D=${best.D.toFixed(4)}`);

// Strategy 3: Physics-guided candidates
const candidates = [
  // High heatset + high td_zone_2 + moderate td_draw + fast line + low md_zone
  { A:0.5, B:1.0, C:-0.2, D:0.8, E:-0.5 },
  { A:0.8, B:1.0, C:0, D:1.0, E:-1.0 },
  { A:0.3, B:1.0, C:-0.3, D:0.5, E:0 },
  { A:0.6, B:1.0, C:-0.1, D:1.0, E:-0.5 },
  { A:1.0, B:1.0, C:-0.2, D:0.8, E:0 },
  // Lower td_zone_2 for bir_cv (minimizing bir_cv requires A near optimum ~0.17 from A² coeff)
  { A:0.17, B:1.0, C:-0.2, D:1.0, E:-0.5 },
  { A:0.17, B:0.8, C:0, D:1.0, E:-0.3 },
  { A:0.2, B:1.0, C:-0.15, D:0.8, E:-0.5 },
  // Mid td_zone_2 + high heatset
  { A:-0.2, B:1.0, C:-0.1, D:0.5, E:0 },
  { A:0, B:1.0, C:0, D:0, E:0 },
  // Conservative
  { A:0, B:0.5, C:0, D:0.5, E:0 },
  { A:0.3, B:0.5, C:-0.2, D:1.0, E:-0.3 },
  // Extreme
  { A:0.8, B:0.8, C:0.2, D:0.5, E:0.5 },
  { A:-0.5, B:1.0, C:-0.3, D:0.8, E:-0.8 },
];

for (const c of candidates) {
  const r = overall(c);
  if (r.D > best.D + 0.001) {
    best = { ...r, x: { ...c } };
    console.log(`  Physics candidate: D=${r.D.toFixed(4)} ${JSON.stringify(c)}`);
  }
}

// Report final
console.log(`\n==========================================================`);
console.log(`=== FINAL OPTIMUM RECIPE ===`);

const sp = {
  td_zone_2_temp: Math.round(RANGES.A.decode(best.x.A) * 10) / 10,
  heatset_temp: Math.round(RANGES.B.decode(best.x.B) * 10) / 10,
  td_draw_ratio: Math.round(RANGES.C.decode(best.x.C) * 100) / 100,
  line_speed: Math.round(RANGES.D.decode(best.x.D)),
  md_zone_temp: Math.round(RANGES.E.decode(best.x.E)),
  md_draw_ratio: 3.12,
  casting_roll_temp: 33,
  relaxation_ratio: 4.4,
  extruder_speed: 100,
  melt_temp: 278,
  winder_tension: 118
};

const y1 = best.y1; const y2 = best.y2; const y3 = best.y3; const y4 = best.y4;
const allSpec = Math.abs(y1-12) <= 0.22 && y2 <= 1.55 && y3 >= 0.075 && y3 <= 0.081 && y4 <= 3.7;

console.log(JSON.stringify(sp, null, 2));
console.log(`\nCoded:`, JSON.stringify(best.x));
console.log(`\nPredicted responses:`);
console.log(`  thickness_mean:       ${y1.toFixed(4)} μm (d=${best.d1.toFixed(4)}) [12.0±0.22] ${Math.abs(y1-12)<=0.22 ? '✅' : '❌'}`);
console.log(`  thickness_cv:         ${y2.toFixed(4)}% (d=${best.d2.toFixed(4)}) [≤1.55] ${y2 <= 1.55 ? '✅' : '❌'}`);
console.log(`  birefringence_mean:   ${y3.toFixed(5)} (d=${best.d3.toFixed(4)}) [0.078±0.003] ${y3 >= 0.075 && y3 <= 0.081 ? '✅' : y3 <= 0.091 ? '🟡 near floor' : '❌'}`);
console.log(`  birefringence_cv:     ${y4.toFixed(4)}% (d=${best.d4.toFixed(4)}) [≤3.7] ${y4 <= 3.7 ? '✅' : '❌'}`);
console.log(`  Overall D:            ${best.D.toFixed(4)}`);

const verdict = allSpec
  ? 'ADVANCE to Phase 4 — all responses predicted in-spec'
  : y3 > 0.081
    ? 'PARTIAL — birefringence_mean above 0.081 (structural floor ~0.091 confirmed). Proceed to Phase 4 with relaxed birefringence_mean target, or consider steepest-ascent beyond current experimental region.'
    : 'PARTIAL — not all in spec. Consider steepest ascent or re-examination.';

console.log(`\nStage gate: ${verdict}`);

const optimum = {
  task_id: 'DOE-FULL-PET-001',
  phase: 3,
  optimum_id: 'optimum_001',
  campaign_id: 'CMP-DOE-FULL-PET-001',
  method: 'Grid search 21³×7×2 + local refinement + physics candidates',
  coded_factors: best.x,
  predicted_recipe_setpoints: sp,
  hold_factors: { md_draw_ratio: 3.12, casting_roll_temp: 33, relaxation_ratio: 4.4, extruder_speed: 100, melt_temp: 278, winder_tension: 118 },
  predicted_responses: {
    thickness_mean: { value: y1, target: 12.0, tol: 0.22, lo: 11.78, hi: 12.22, in_spec: Math.abs(y1-12) <= 0.22 },
    thickness_cv: { value: y2, target: 1.0, max: 1.55, in_spec: y2 <= 1.55 },
    birefringence_mean: { value: y3, target: 0.078, tol: 0.003, lo: 0.075, hi: 0.081, in_spec: y3 >= 0.075 && y3 <= 0.081 },
    birefringence_cv: { value: y4, target: 3.0, max: 3.7, in_spec: y4 <= 3.7 }
  },
  overall_desirability: best.D,
  all_individual_desirabilities: { d_thickness_mean: best.d1, d_thickness_cv: best.d2, d_birefringence_mean: best.d3, d_birefringence_cv: best.d4 },
  all_in_spec: allSpec,
  structural_floor_note: y3 > 0.081 ? 'birefringence_mean structural floor ~0.089-0.091 confirmed. The 0.081 target is unachievable within this experimental region. See pet-birefringence-mean-structural-floor.md memory.' : null,
  stage_gate_recommendation: verdict,
  recommended_confirmation_plan: allSpec ? 'Proceed to Phase 4: ≥3 replicate runs at predicted optimum, robustness perturbations on heatset_temp (±1°C) and td_zone_2_temp (±1°C).' : 'Phase 4 confirmation still recommended: validate model predictions at the best-found recipe, even if not all targets are met. This provides the confirmed baseline for a steepest-ascent iteration.'
};

fs.writeFileSync('workspace/optimization-tasks/DOE-FULL-PET-001/03_optimize/optimum_001.json', JSON.stringify(optimum, null, 2) + '\n');
console.log(`\nSaved to 03_optimize/optimum_001.json`);
