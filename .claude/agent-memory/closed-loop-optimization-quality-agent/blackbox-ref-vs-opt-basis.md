---
name: blackbox-ref-vs-opt-basis
description: Blackbox model reference basis — orientationDrive uses baseline (ref), quadratic penalties use optimum (opt); critical for birefringence_mean root-cause
metadata:
  type: project
---

# Blackbox Model: ref vs opt Reference Basis

In `simulator/industrial-film-line/blackbox-model.mjs` `evaluateBlackbox`:

- `ref = profile.baseline_setpoints` (L46) — the BASELINE recipe, NOT the optimum.
- `opt = hiddenOptimumForGrade` = `profile.model.optimum` (L49) — the HIDDEN optimum.

## Which basis each response term uses

**Linear / orientation terms use `ref` (baseline):**
- birefringenceMean `orientationDrive` (L82-89): md_draw_ratio, td_draw_ratio, heatBalance, td_zone_2_temp, relaxation_ratio are ALL delta-vs-baseline.
- thicknessMean (L64-71): throughputRatio-vs-ref, stretchProduct-vs-opt (mixed), casting_roll_temp-vs-ref.
- thicknessCv (L73-80): td_draw_ratio-vs-**opt** (quadratic), line_speed-vs-ref, winder_tension-vs-**opt** (quadratic), casting_roll_temp-vs-ref.
- thicknessEdgeCenterDelta (L108-112): td_draw_ratio-vs-ref, winder_tension-vs-ref.
- birefringenceEdgeCenterDelta (L114-118): td_zone_2_temp-vs-**opt**, heatset_temp-vs-**opt**.

**Quadratic penalty terms use `opt` (optimum):**
- birefringenceMean heatset quadratic (L94): `sq(heatset_temp - opt.heatset_temp)`.
- birefringenceCv (L101-104): td_zone_2_temp-vs-**opt** quadratic, heatset_temp-vs-**opt** quadratic, relaxation_ratio absolute-vs-ref.

## Critical for PET_FILM_GRADE_A birefringence_mean root cause

`heat_balance_reference = 188.0` (product-catalog.mjs L55). heatBalance = 0.55*heatset_temp + 0.25*td_zone_2_temp + 0.2*md_zone_temp (L56). The orientationDrive heatBalance term is `-0.00072*(heatBalance - 188.0)`.

**Why:** A prior diagnosis (quality_diagnosis_test.json for TASK-20260613-003) wrongly used `opt` as the reference for the linear orientationDrive terms. This manufactured a phantom +0.017 residual and a false "structural infeasibility" conclusion. Recomputing against the correct baseline `ref` shows the measured mean matches the deterministic prediction within 1 noise-sigma, and the heatBalance term (+0.0148 when heatBalance=167.4, i.e. 20.6 below 188) is the dominant +96% contributor — fully movable via heatset_temp/md_zone_temp.

**How to apply:** Before any birefringence_mean root-cause claim, recompute the orientationDrive decomposition against `baseline_setpoints`, not `optimum`. The "unexplained residual" must be <2-3 noise-sigma or the reference basis is wrong. heatset_temp (0.55 weight on heatBalance) is the strongest mean-lowering lever for PET, co-located with the biref_cv optimum (219.5), capped at ~223 by the biref_cv quadratic. Related: [[pet-quality-gate-rules]].
