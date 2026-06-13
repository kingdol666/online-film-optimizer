---
name: birefringence-cv-model-decomposition-learnings
description: Key model decomposition learnings: heatset_temp quadratic penalty is primary cv driver, td_zone_2_temp=p114.2 is at optimum, td_zone_1 not in cv equation
metadata:
  type: reference
---

# Birefringence CV Model Decomposition Learnings

From QDIAG-CV-001 correction (rd-engineer feedback, 2026-06-13):

## Critical Model Facts for PET_FILM_GRADE_A birefringence_cv

1. **Heatset_temp quadratic penalty**: `0.28 * sq(heatset_temp - 219.5) / sq(3.2)` is the largest controllable term. Current heatset=222 gives +0.171. Reducing to 221.25 gives ~+0.145 (delta -0.026).

2. **Relaxation_ratio absolute term**: `0.22 * abs(relaxation_ratio - 4.2) / 0.56`. Current 4.42 gives +0.086. Not recommended to adjust (previous experiments showed increasing worsened cv).

3. **TD_draw_ratio relief term**: `-0.24 * max(0, td_draw_ratio - 3.62) / 0.08`, capped at 0.24 when td_draw >= 3.70. Current 3.65 gives -0.090, optimum 3.69 gives -0.21. Zero tradeoff lever.

4. **td_zone_2_temp**: `0.42 * sq(114.2 - 114.2) / 7.84 = 0`. At optimum, zero penalty. **Do not adjust for cv**.

5. **td_zone_1_temp**: Not in the birefringence_cv equation at all (blackbox-model.mjs L99-106).

6. **base_birefringence_cv = 3.55** (product-catalog.mjs L52).

7. **noise(0.055)**, so 1-sigma = 0.055. Residuals within 0.055 are noise.

## Diagnosis Correction Required

Initial diagnosis incorrectly attributed 65% of cv to 6.2C TD zone delta (td_zone_1=108 vs td_zone_2=114.2). This was physically plausible (spatial profile asymmetry) but wrong at the model level. The profile asymmetry is a modeling artifact of the birefringenceEdgeCenterDelta function (L114-118), where the heatset deviation from opt creates +0.000781 of the observed -0.003895 edge_center_delta.

## Strategy Alignment

- Phase 1: heatset_temp 222 -> 221.25 (test direction)
- Phase 2: td_draw_ratio 3.65 -> 3.69 (zero tradeoff)
- Do NOT adjust td_zone_2_temp or td_zone_1_temp for cv

Related: [[pet-quality-gate-rules]], [[blackbox-ref-vs-opt-basis]]
