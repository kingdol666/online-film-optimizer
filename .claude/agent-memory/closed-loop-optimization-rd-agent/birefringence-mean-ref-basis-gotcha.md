---
name: birefringence-mean-ref-basis-gotcha
description: blackbox-model.mjs response functions use baseline_setpoints as ref, NOT optimum — common source of arithmetic errors when computing lever authority
metadata:
  type: project
---

In `simulator/industrial-film-line/blackbox-model.mjs`, the response functions for thicknessMean, thicknessCv, birefringenceMean, birefringenceCv all compute deltas against `ref = profile.baseline_setpoints` (L46), NOT against `optimum`.

**Why:** The model has two distinct reference structures:
- `baseline_setpoints` (product-catalog.mjs, e.g. PET: md_draw_ratio=3.18, td_draw_ratio=3.62, td_zone_2_temp=112, relaxation_ratio=4.2) — used as the LINEAR-term reference for orientationDrive and several other terms.
- `optimum` (e.g. PET: md_draw_ratio=3.24, td_draw_ratio=3.69, td_zone_2_temp=114.2, heatset_temp=219.5, winder_tension=119) — used ONLY for the QUADRATIC penalty terms (heatset quad on mean, td_zone_2/heatset quad on cv).

Mixing these up produces phantom residuals. In TASK-20260613-003 a quality diagnosis used optimum as ref and concluded birefringence_mean was "structurally infeasible" with a +0.0174 unexplained offset; recomputing against the true baseline ref showed the prediction (0.0941) matched measurement (0.0935) within 0.0006 (1.8 noise-sigma) and the task was feasible.

**How to apply:** Before trusting any "setpoint-driven prediction" or "residual unexplained gap" claim, recompute the orientationDrive decomposition yourself using baseline_setpoints as ref. The two refs differ by enough (e.g. md_draw 3.18 vs 3.24, td_draw 3.62 vs 3.69) to flip lever-authority conclusions. Related: [[pet-film-grade-a-model-optima]] and [[pet-birefringence-optimization-recipe]].
