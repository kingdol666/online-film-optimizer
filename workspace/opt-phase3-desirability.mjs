#!/usr/bin/env node
/**
 * Phase 3 — Multi-Response Desirability Optimization
 *
 * Find the setpoint vector maximizing D = (d1·d2·...·dk)^(1/k)
 * where each d_i ∈ [0,1] is the desirability of response i.
 *
 * Responses:
 *   thickness_mean: nominal-is-best (target=12.0, tol=0.22)
 *   thickness_cv:   smaller-is-better (max=1.55, target=1.0)
 *   birefringence_mean: nominal-is-best (target=0.078, tol=0.003)
 *   birefringence_cv:   smaller-is-better (max=3.7, target=3.0)
 */

const fs = await import('fs');

// Model coefficients per response from Phase 2 analysis
// Y = intercept + βA·A + βB·B + βC·C + βD·D + βE·E + βAA·A² + ... + βAB·A·B + ...
const MODELS = {
  // thickness_mean: only linear terms C and D significant
  thickness_mean: {
    coef: {
      intercept: 12.0556,
      A: -0.00159, B: -0.00378, C: -0.02988, D: -0.02526, E: -0.00390,
      A2: 0.00724, B2: -0.00491, C2: -0.01026, D2: 0.01789, E2: 0.00934,
      AB: 0.00106, AC: 0.00158, AD: -0.00857, AE: 0.00372,
      BC: -0.00233, BD: 0.00207, BE: -0.00107,
      CD: -0.00263, CE: 0.01163, DE: 0.00481
    }
  },
  // thickness_cv: D linear + C² dominant
  thickness_cv: {
    coef: {
      intercept: 1.26078,
      A: -0.01287, B: 0.02931, C: -0.00038, D: -0.11728, E: -0.00089,
      A2: -0.02288, B2: 0.05552, C2: 0.53142, D2: 0.10492, E2: -0.01473,
      AB: 0.00229, AC: -0.01572, AD: -0.00307, AE: 0.00049,
      BC: 0.01781, BD: 0.02328, BE: -0.03398,
      CD: 0.02207, CE: 0.03018, DE: 0.02561
    }
  },
  // birefringence_mean: A, B, C, E linear dominant. B is heatset (negative = lower bir = good!)
  birefringence_mean: {
    coef: {
      intercept: 0.09314,
      A: 0.000628, B: -0.001757, C: 0.001402, D: -0.000038, E: -0.000692,
      A2: -0.000248, B2: -0.000807, C2: -0.000099, D2: -0.000018, E2: 0.000124,
      AB: 0.000044, AC: -0.000002, AD: 0.000066, AE: 0.000001,
      BC: -0.000056, BD: 0.000085, BE: 0.000067,
      CD: 0.000056, CE: 0.000034, DE: -0.000078
    }
  },
  // birefringence_cv: A linear + A², B², C linear dominant
  birefringence_cv: {
    coef: {
      intercept: 3.37260,
      A: -0.26987, B: 0.00167, C: -0.09349, D: 0.00119, E: 0.00079,
      A2: 0.80005, B2: 0.29540, C2: -0.06648, D2: 0.01229, E2: -0.04987,
      AB: 0.02045, AC: -0.05992, AD: -0.04764, AE: 0.00854,
      BC: 0.02771, BD: -0.00966, BE: 0.01762,
      CD: 0.01181, CE: -0.01174, DE: -0.00365
    }
  }
};

// Factor ranges (coded -1 to +1)
const RANGES = {
  A: { lo: -1, hi: 1, name: 'td_zone_2_temp', decode: v => 113.5 + v * 4.5 },
  B: { lo: -1, hi: 1, name: 'heatset_temp', decode: v => 219.5 + v * 4.5 },
  C: { lo: -1, hi: 1, name: 'td_draw_ratio', decode: v => 3.69 + v * 0.09 },
  D: { lo: -1, hi: 1, name: 'line_speed', decode: v => 41 + v * 2 },
  E: { lo: -1, hi: 1, name: 'md_zone_temp', decode: v => 92 + v * 4 }
};

function predict(respondId, x) {
  const { A, B, C, D, E } = x;
  const cf = MODELS[respondId].coef;
  // Combine all terms
  const f = cf.intercept +
    cf.A * A + cf.B * B + cf.C * C + cf.D * D + cf.E * E +
    cf.A2 * A * A + cf.B2 * B * B + cf.C2 * C * C + cf.D2 * D * D + cf.E2 * E * E +
    cf.AB * A * B + cf.AC * A * C + cf.AD * A * D + cf.AE * A * E +
    cf.BC * B * C + cf.BD * B * D + cf.BE * B * E +
    cf.CD * C * D + cf.CE * C * E + cf.DE * D * E;
  return f;
}

// Desirability functions
function desirabilityNominal(y, target, lo, hi) {
  if (y < lo || y > hi) return 0;
  if (y === target) return 1;
  if (y < target) return ((y - lo) / (target - lo));
  return ((hi - y) / (hi - target));
}

function desirabilitySmaller(y, target, max) {
  if (y <= target) return 1;
  if (y >= max) return 0;
  return 1 - (y - target) / (max - target);
}

function overallDesirability(x) {
  const y1 = predict('thickness_mean', x);
  const y2 = predict('thickness_cv', x);
  const y3 = predict('birefringence_mean', x);
  const y4 = predict('birefringence_cv', x);

  const d1 = desirabilityNominal(y1, 12.0, 11.78, 12.22);
  const d2 = desirabilitySmaller(y2, 1.0, 1.55);
  const d3 = desirabilityNominal(y3, 0.078, 0.075, 0.081);
  const d4 = desirabilitySmaller(y4, 3.0, 3.7);

  const D = Math.pow(d1 * d2 * d3 * d4, 0.25);
  return { D, d1, d2, d3, d4, y1, y2, y3, y4 };
}

// Grid search over coded factor space (5D grid, coarse first)
console.log('\n=== Phase 3: Multi-Response Desirability Optimization ===\n');

// Multi-resolution grid search
let best = { D: -1 };
const levels = [9, 13, 21]; // resolutions to scan

for (const n of levels) {
  const step = 2 / (n - 1);
  let count = 0;
  for (let ai = 0; ai < n; ai++) {
    const A = -1 + ai * step;
    for (let bi = 0; bi < n; bi++) {
      const B = -1 + bi * step;
      for (let ci = 0; ci < n; ci++) {
        const C = -1 + ci * step;
        for (let di = 0; di < n; di++) {
          const D = -1 + di * step;
          for (let ei = 0; ei < n; ei++) {
            const E = -1 + ei * step;
            const x = { A, B, C, D, E };
            const result = overallDesirability(x);
            count++;
            if (result.D > best.D) {
              best = { ...result, x: { ...x }, grid: n, index: count };
            }
          }
        }
      }
    }
  }
  console.log(`  Grid ${n}³ (${count} points): best D=${best.D.toFixed(4)} at (${Object.values(best.x).map(v => v.toFixed(3)).join(', ')})`);
}

// Report best result
console.log(`\n=== Best Recipe (D=${best.D.toFixed(4)}) ===`);
for (const f of ['A','B','C','D','E']) {
  const r = RANGES[f];
  const coded = best.x[f];
  const actual = r.decode(coded);
  console.log(`  ${r.name}: coded=${coded.toFixed(3)}, actual=${actual.toFixed(3)}${actual < 0 ? ' ⚠️' : ''}`);
}
console.log(`\nPredicted responses:`);
console.log(`  thickness_mean:       ${best.y1.toFixed(4)} μm (d=${best.d1.toFixed(4)}) [target: 12.0±0.22]`);
console.log(`  thickness_cv:         ${best.y2.toFixed(4)}% (d=${best.d2.toFixed(4)}) [target: ≤1.0, max: 1.55]`);
console.log(`  birefringence_mean:   ${best.y3.toFixed(5)} (d=${best.d3.toFixed(4)}) [target: 0.078±0.003]`);
console.log(`  birefringence_cv:     ${best.y4.toFixed(4)}% (d=${best.d4.toFixed(4)}) [target: ≤3.0, max: 3.7]`);
console.log(`  Overall D:            ${best.D.toFixed(4)}`);

// Local refinement around best point
console.log(`\n--- Local refinement around best ---`);
let localBest = { ...best };
for (let iter = 0; iter < 3; iter++) {
  const range = 0.5 / (iter + 1);
  const n2 = 7;
  const step2 = 2 * range / (n2 - 1);
  for (let ai = 0; ai < n2; ai++) {
    const A = Math.max(-1, Math.min(1, localBest.x.A - range + ai * step2));
    for (let bi = 0; bi < n2; bi++) {
      const B = Math.max(-1, Math.min(1, localBest.x.B - range + bi * step2));
      for (let ci = 0; ci < n2; ci++) {
        const C = Math.max(-1, Math.min(1, localBest.x.C - range + ci * step2));
        for (let di = 0; di < n2; di++) {
          const D = Math.max(-1, Math.min(1, localBest.x.D - range + di * step2));
          for (let ei = 0; ei < n2; ei++) {
            const E = Math.max(-1, Math.min(1, localBest.x.E - range + ei * step2));
            const result = overallDesirability({ A, B, C, D, E });
            if (result.D > localBest.D + 0.001) {
              localBest = { ...result, x: { A, B, C, D, E } };
            }
          }
        }
      }
    }
  }
  console.log(`  Refinement ${iter + 1}: D=${localBest.D.toFixed(4)} at ${Object.values(localBest.x).map(v => v.toFixed(3)).join(', ')}`);
}

// Also try specific promising regions based on physics
console.log(`\n--- Physics-guided search ---`);

// Strategy: higher heatset (B) to reduce birefringence_mean,
// higher td_zone_2_temp (A) for birefringence_cv,
// moderate td_draw_ratio (C) for thickness_cv U-curve optimum,
// higher line_speed (D) for thickness_cv

const targetedAttempts = [
  // Low heatset zone
  { A: 0.5, B: 1.0, C: -0.3, D: 1.0, E: 0, label: 'B=+1 (high heatset), D=+1 (fast line), moderate C' },
  { A: 1.0, B: 1.0, C: 0, D: 1.0, E: 0, label: 'A=+1 B=+1 C=0 D=+1 E=0' },
  { A: 0.5, B: 1.0, C: -0.2, D: 1.0, E: -0.5, label: 'B=+1, C=-0.2 (low td_draw), D=+1, E=-0.5' },
  { A: 0.8, B: 1.0, C: -0.1, D: 1.0, E: -1.0, label: 'A=0.8 B=1.0 C=-0.1 D=1.0 E=-1' },
  { A: 0.3, B: 1.0, C: -0.2, D: 0.8, E: -0.5, label: 'A=0.3 B=+1 C=-0.2 D=0.8 E=-0.5' },
  // Perturbations around best
  { ...localBest.x, A: Math.min(1, localBest.x.A + 0.2), label: 'best +A' },
  { ...localBest.x, A: Math.max(-1, localBest.x.A - 0.2), label: 'best -A' },
  { ...localBest.x, C: Math.min(1, localBest.x.C + 0.2), label: 'best +C' },
  { ...localBest.x, C: Math.max(-1, localBest.x.C - 0.2), label: 'best -C' },
  { ...localBest.x, B: Math.min(1, localBest.x.B + 0.1), label: 'best +B' },
  { ...localBest.x, B: Math.max(-1, localBest.x.B - 0.1), label: 'best -B' },
];

for (const t of targetedAttempts) {
  const result = overallDesirability({ A: t.A, B: t.B, C: t.C, D: t.D, E: t.E });
  if (result.D > localBest.D) {
    console.log(`  🎯 ${t.label}: D=${result.D.toFixed(4)} (IMPROVEMENT!)`);
    localBest = { ...result, x: { A: t.A, B: t.B, C: t.C, D: t.D, E: t.E } };
  }
}

// Report final
console.log(`\n==========================================================`);
console.log(`=== FINAL OPTIMUM RECIPE ===`);

const sp = {
  td_zone_2_temp: Math.round(RANGES.A.decode(localBest.x.A) * 10) / 10,
  heatset_temp: Math.round(RANGES.B.decode(localBest.x.B) * 10) / 10,
  td_draw_ratio: Math.round(RANGES.C.decode(localBest.x.C) * 100) / 100,
  line_speed: Math.round(RANGES.D.decode(localBest.x.D)),
  md_zone_temp: Math.round(RANGES.E.decode(localBest.x.E)),
  // Hold factors at baseline
  md_draw_ratio: 3.12,
  casting_roll_temp: 33,
  relaxation_ratio: 4.4,
  extruder_speed: 100,
  melt_temp: 278,
  winder_tension: 118
};

console.log(JSON.stringify(sp, null, 2));
console.log(`\nPredicted responses:`);
console.log(`  thickness_mean:       ${localBest.y1.toFixed(4)} (target 12.0±0.22) ${Math.abs(localBest.y1-12)<=0.22 ? '✅' : '❌'}`);
console.log(`  thickness_cv:         ${localBest.y2.toFixed(4)}% (max 1.55) ${localBest.y2 <= 1.55 ? '✅' : '❌'}`);
console.log(`  birefringence_mean:   ${localBest.y3.toFixed(4)} (target 0.078±0.003) ${localBest.y3 >= 0.075 && localBest.y3 <= 0.081 ? '✅' : '❌'}`);
console.log(`  birefringence_cv:     ${localBest.y4.toFixed(4)}% (max 3.7) ${localBest.y4 <= 3.7 ? '✅' : '❌'}`);
console.log(`  Overall D:            ${localBest.D.toFixed(4)}`);

// Save optimum
const optimum = {
  task_id: 'DOE-FULL-PET-001',
  phase: 3,
  optimum_id: 'optimum_001',
  campaign_id: 'CMP-DOE-FULL-PET-001',
  method: 'Multi-resolution grid search + local refinement + physics-guided search',
  coded_factors: localBest.x,
  predicted_recipe_setpoints: sp,
  hold_factors: { md_draw_ratio: 3.12, casting_roll_temp: 33, relaxation_ratio: 4.4, extruder_speed: 100, melt_temp: 278, winder_tension: 118 },
  predicted_responses: {
    thickness_mean: { value: localBest.y1, target: 12.0, tolerance: 0.22, in_spec: Math.abs(localBest.y1 - 12) <= 0.22 },
    thickness_cv: { value: localBest.y2, target: 1.0, max: 1.55, in_spec: localBest.y2 <= 1.55 },
    birefringence_mean: { value: localBest.y3, target: 0.078, tolerance: 0.003, in_spec: localBest.y3 >= 0.075 && localBest.y3 <= 0.081 },
    birefringence_cv: { value: localBest.y4, target: 3.0, max: 3.7, in_spec: localBest.y4 <= 3.7 }
  },
  overall_desirability: localBest.D,
  all_individual_desirabilities: {
    d_thickness_mean: localBest.d1,
    d_thickness_cv: localBest.d2,
    d_birefringence_mean: localBest.d3,
    d_birefringence_cv: localBest.d4
  },
  all_in_spec: Math.abs(localBest.y1 - 12) <= 0.22 && localBest.y2 <= 1.55 && localBest.y3 >= 0.075 && localBest.y3 <= 0.081 && localBest.y4 <= 3.7,
  stage_recommendation: localBest.y3 > 0.081
    ? 'PREDICTED OUT OF WINDOW — birefringence_mean still above 0.081. The structural floor ~0.091 is confirmed. Recommend steepest-ascent towards lower birefringence_mean via further heatset_temp increase + td_zone_2_temp + td_draw_ratio joint optimization.'
    : 'All responses predicted in-spec. Proceed to Phase 4 confirmation.',
  file_generated: '03_optimize/optimum_001.json'
};

fs.mkdirSync('workspace/optimization-tasks/DOE-FULL-PET-001/03_optimize', { recursive: true });
fs.writeFileSync(
  'workspace/optimization-tasks/DOE-FULL-PET-001/03_optimize/optimum_001.json',
  JSON.stringify(optimum, null, 2) + '\n'
);
console.log(`\nOptimum saved: 03_optimize/optimum_001.json`);
