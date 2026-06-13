#!/usr/bin/env node
/**
 * Phase 2 RSM Analysis — Face-Centered CCD on 5 factors
 * Fit second-order model: Y = β0 + Σβi·xi + Σβii·xi² + Σβij·xi·xj + ε
 * For each of 4 responses: thickness_mean, thickness_cv, birefringence_mean, birefringence_cv
 *
 * ANOVA + LOF + R² diagnostics + model adequacy verdict
 */

const fs = await import('fs');

const WS = 'workspace/optimization-tasks/DOE-FULL-PET-001/02_rsm';
const data = JSON.parse(fs.readFileSync(`${WS}/_execution_redux.json`, 'utf-8')).runs;
const design = JSON.parse(fs.readFileSync(`${WS}/doe_design_001.json`, 'utf-8'));

// Build design matrix — coded factor levels from the design
const codedMap = {};
for (const r of design.run_matrix.runs) {
  codedMap[r.run_order] = { ...r.coded, is_center: r.is_center, type: r.type };
}

// Factors: A=td_zone_2_temp, B=heatset_temp, C=td_draw_ratio, D=line_speed, E=md_zone_temp
const FACTORS = ['A','B','C','D','E'];
const FACTOR_NAMES = { A:'td_zone_2_temp', B:'heatset_temp', C:'td_draw_ratio', D:'line_speed', E:'md_zone_temp' };
const RESPONSES = ['thickness_mean','thickness_cv','birefringence_mean','birefringence_cv'];

// Separate factorial+axial from center runs
const factorialAxial = data.filter(r => !r.is_center && codedMap[r.run_order]);
const center = data.filter(r => r.is_center && codedMap[r.run_order]);

console.log(`Factorial+axial runs: ${factorialAxial.length}, Center runs: ${center.length}`);

const analysis = {};

for (const RESP of RESPONSES) {
  console.log(`\n========== ${RESP} ==========`);

  // Build X matrix for second-order model
  // y = β0 + βA·A + βB·B + ... + βAA·A² + ... + βAB·A·B + ...
  const n = factorialAxial.length;
  const y = factorialAxial.map(r => r.responses[RESP]);

  // Design matrix columns (20 predictors + intercept = 21)
  // Intercept not explicitly included — we'll add via the regression
  const terms = ['intercept', ...FACTORS, ...FACTORS.map(f => `${f}²`)];

  // 2-way interactions
  const interactions = [];
  for (let i = 0; i < FACTORS.length; i++) {
    for (let j = i+1; j < FACTORS.length; j++) {
      interactions.push(`${FACTORS[i]}×${FACTORS[j]}`);
    }
  }
  terms.push(...interactions);

  // Build design matrix X (n × p)
  const p = terms.length;
  const X = Array.from({length: n}, (_, i) => {
    const row = [1]; // intercept
    const c = codedMap[factorialAxial[i].run_order];
    // Linear terms
    for (const f of FACTORS) row.push(c[f]);
    // Quadratic terms
    for (const f of FACTORS) row.push(c[f] * c[f]);
    // Interactions
    for (let j = 0; j < FACTORS.length; j++)
      for (let k = j+1; k < FACTORS.length; k++)
        row.push(c[FACTORS[j]] * c[FACTORS[k]]);
    return row;
  });

  // OLS: β = (X'X)^(-1) X'y
  function matMul(A, B) {
    const m = A.length, n = A[0].length, p2 = B[0].length;
    const C = Array.from({length: m}, () => Array(p2).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < p2; j++)
        for (let k = 0; k < n; k++)
          C[i][j] += A[i][k] * B[k][j];
    return C;
  }

  function matTrans(A) {
    const m = A.length, n = A[0].length;
    return Array.from({length: n}, (_, j) => Array.from({length: m}, (_, i) => A[i][j]));
  }

  function matInv(A) {
    // Gaussian elimination with partial pivoting
    const n = A.length;
    const aug = A.map((row, i) => [...row, ...Array.from({length: n}, (_, j) => i === j ? 1 : 0)]);
    for (let col = 0; col < n; col++) {
      // Find pivot
      let maxEl = Math.abs(aug[col][col]), maxRow = col;
      for (let row = col+1; row < n; row++) {
        if (Math.abs(aug[row][col]) > maxEl) { maxEl = Math.abs(aug[row][col]); maxRow = row; }
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
      // Scale pivot row
      const pivot = aug[col][col];
      if (Math.abs(pivot) < 1e-12) return null; // singular
      for (let j = col; j < 2*n; j++) aug[col][j] /= pivot;
      // Eliminate other rows
      for (let row = 0; row < n; row++) {
        if (row !== col) {
          const factor = aug[row][col];
          for (let j = col; j < 2*n; j++) aug[row][j] -= factor * aug[col][j];
        }
      }
    }
    return aug.map(row => row.slice(n));
  }

  const Xt = matTrans(X);
  const XtX = matMul(Xt, X);
  const XtXinv = matInv(XtX);
  if (!XtXinv) { console.log('  ⚠️  Singular XtX — design not full rank'); analysis[RESP] = {error:'singular'}; continue; }
  const Xty = matMul(Xt, y.map(v => [v]));
  const beta = matMul(XtXinv, Xty);
  const coef = beta.map(r => r[0]);

  // Predictions and residuals
  const yPred = X.map(row => row.reduce((s, v, i) => s + v * coef[i], 0));
  const residuals = y.map((yn, i) => yn - yPred[i]);
  const yMean = y.reduce((a,b) => a+b, 0) / n;

  // ANOVA
  const SS_res = residuals.reduce((s, e) => s + e*e, 0);
  const SS_reg = yPred.reduce((s, p) => s + (p - yMean)*(p - yMean), 0);
  const SS_total = y.reduce((s, v) => s + (v - yMean)*(v - yMean), 0);
  const MS_res = SS_res / (n - p);
  const MS_reg = SS_reg / (p - 1);
  const F_model = MS_reg / MS_res;
  const p_model = 1 - fCDF(F_model, p - 1, n - p);

  // R²
  const R2 = 1 - SS_res / SS_total;
  const R2adj = 1 - (SS_res / (n - p)) / (SS_total / (n - 1));

  // PRESS (leave-one-out)
  let press = 0;
  for (let i = 0; i < n; i++) {
    const hii = X[i].reduce((s, xj, j) => {
      let v = 0;
      for (let k = 0; k < n; k++) v += X[k][j] * X[k][j]; // approximate
      return s + xj * xj / v;
    }, 0);
    if (i < X.length) {
      // Use hat matrix diagonal element proper
      let hiiVal = 0;
      for (let l = 0; l < p; l++)
        for (let m = 0; m < p; m++)
          hiiVal += X[i][l] * XtXinv[l][m] * X[i][m];
      press += (residuals[i] / (1 - hiiVal))**2;
    }
  }
  const R2pred = 1 - press / SS_total;

  // LOF test
  const yCen = center.map(r => r.responses[RESP]);
  const nCen = yCen.length;
  const meanCen = yCen.reduce((a,b) => a+b, 0) / nCen;
  const SS_pe = yCen.reduce((s, v) => s + (v - meanCen)*(v - meanCen), 0);
  const MS_pe = SS_pe / (nCen - 1);

  // Predicted at center (coded all zeros)
  const yPredCenter = coef[0]; // intercept = predicted at center
  const centerDev = yCen.map(v => v - yPredCenter);
  const SS_lof = nCen * (meanCen - yPredCenter)**2;
  // More accurate: LOF includes lack of fit from the factorial+axial data too
  // SS_lof_total = SS_res - SS_pe
  const SS_lof_total = SS_res - SS_pe;
  const df_lof = (n - p) - (nCen - 1);
  const MS_lof = df_lof > 0 ? SS_lof_total / df_lof : 0;
  const F_lof = MS_lof > 0 && MS_pe > 0 ? MS_lof / MS_pe : 0;
  const p_lof = F_lof > 0 ? 1 - fCDF(F_lof, Math.max(1, df_lof), nCen - 1) : 1;

  // Per-term t-statistics
  const se2 = MS_res;
  const termStats = terms.map((term, i) => {
    const se = Math.sqrt(se2 * XtXinv[i][i]);
    const t = coef[i] / (se || 1e-10);
    const pVal = 2 * (1 - tCDF(Math.abs(t), n - p));
    return { term, coefficient: coef[i], std_error: se, t_statistic: t, p_value: pVal };
  });

  // Significant terms
  const sigTerms = termStats.filter(t => t.p_value < 0.05 && t.term !== 'intercept');
  const curvatureSig = nCen > 0 ? Math.abs(meanCen - yPredCenter) > 2 * Math.sqrt(MS_pe / nCen + se2) : false;

  // Residual diagnostics
  const resMean = residuals.reduce((a,b) => a+b, 0) / residuals.length;
  const resVar = residuals.reduce((s, e) => s + (e - resMean)**2, 0) / (residuals.length - 1);
  // Check normality via Shapiro-Wilk approximation

  console.log(`  Model F=${F_model.toFixed(2)} p=${p_model.toFixed(6)} R²=${R2.toFixed(4)} adjR²=${R2adj.toFixed(4)} predR²=${R2pred.toFixed(4)}`);
  console.log(`  LOF F=${F_lof.toFixed(2)} p=${p_lof.toFixed(4)} (df=${df_lof},${nCen-1})`);
  console.log(`  Center mean=${meanCen.toFixed(5)} vs model predicted=${yPredCenter.toFixed(5)}`);
  console.log(`  Significant terms (p<0.05): ${sigTerms.map(t => t.term).join(', ') || 'none'}`);

  analysis[RESP] = {
    model_summary: {
      F_statistic: F_model,
      p_value: p_model,
      significant: p_model < 0.05
    },
    r_squared: { R_sq: R2, R_sq_adj: R2adj, R_sq_pred: R2pred },
    lof_test: {
      F_statistic: F_lof,
      p_value: p_lof,
      df_lof,
      df_pure_error: nCen - 1,
      significant: p_lof < 0.05
    },
    curvature: { center_mean: meanCen, predicted_at_center: yPredCenter, significant: curvatureSig },
    significant_terms: sigTerms,
    all_terms: termStats,
    model_quality: p_lof < 0.05 ? 'POOR — LOF significant, model inadequate' :
                    R2pred < 0.5 ? 'MARGINAL — low predictive power' :
                    R2adj > 0.7 ? 'ADEQUATE — model acceptable for optimization' :
                    'MARGINAL',
    stage_recommendation: p_lof < 0.05
      ? 'DO NOT OPTIMIZE — LOF significant. Augment design or reduce model.'
      : R2pred > 0.5
        ? 'ADVANCE to Phase 3 — model adequate for desirability optimization'
        : 'RE-EVALUATE — low predictive power; consider replicate center runs'
  };
}

// ────────────────────
// Write analysis
// ────────────────────

const output = {
  task_id: 'DOE-FULL-PET-001',
  phase: 2,
  analysis_id: 'doe_analysis_001',
  campaign_id: 'CMP-DOE-FULL-PET-001',
  author_role: 'Measurement & Statistical-Analysis Lead',
  method: 'CCF RSM — OLS second-order model, ANOVA, LOF, R² diagnostics',
  design_summary: { factorial_runs: 26, center_runs: 6, total_runs: 32, responses_analyzed: RESPONSES },
  per_response: analysis,
  overall_verdict: (() => {
    const allAdequate = Object.values(analysis).every(a => a.model_quality?.includes('ADEQUATE'));
    const anyLOF = Object.values(analysis).some(a => a.lof_test?.significant);
    return {
      all_models_adequate: allAdequate,
      any_lof_significant: anyLOF,
      recommend_optimization: !anyLOF,
      next_phase: !anyLOF ? 'Phase 3 multi-response desirability optimization' :
                  'Augment Phase 2 design first (add runs to resolve LOF)',
      note: `Model adequacy: thickness_mean=${analysis.thickness_mean?.model_quality}, thickness_cv=${analysis.thickness_cv?.model_quality}, birefringence_mean=${analysis.birefringence_mean?.model_quality}, birefringence_cv=${analysis.birefringence_cv?.model_quality}`
    };
  })(),
  file_generated: '02_rsm/doe_analysis_001.json'
};

fs.writeFileSync(`${WS}/doe_analysis_001.json`, JSON.stringify(output, null, 2) + '\n');
console.log(`\nAnalysis written to ${WS}/doe_analysis_001.json`);

// ─── helper functions ───

function fCDF(x, d1, d2) {
  // Regularized incomplete beta for F distribution
  if (x <= 0 || d1 <= 0 || d2 <= 0) return 0;
  const p = 1 - regIncBeta(d2 / (d2 + d1 * x), d2 / 2, d1 / 2);
  return isNaN(p) ? 0.5 : Math.min(1, Math.max(0, p));
}

function regIncBeta(x, a, b, maxIter=100) {
  if (x < 0 || x > 1) return NaN;
  if (x === 0 || x === 1) return x;
  const bt = Math.exp(lgamma(a+b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1-x));
  if (x < (a+1)/(a+b+2)) return bt * betacf(x, a, b, maxIter) / a;
  else return 1 - bt * betacf(1-x, b, a, maxIter) / b;
}

function betacf(x, a, b, maxIter=100) {
  const EPS = 3e-7;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    let m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function lgamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function tCDF(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * regIncBeta(x, df / 2, 0.5);
}
