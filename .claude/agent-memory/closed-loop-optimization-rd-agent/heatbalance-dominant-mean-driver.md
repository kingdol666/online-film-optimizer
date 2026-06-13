---
name: heatbalance-dominant-mean-driver
description: In PET birefringence_mean response, the heatBalance composite (0.55*heatset+0.25*td_zone_2+0.2*md_zone_temp) is the largest single contributor and the hidden mean lever via heatset_temp
metadata:
  type: project
---

In `simulator/industrial-film-line/blackbox-model.mjs`, the `heatBalance` composite term in orientationDrive is:
`heatBalance = 0.55*heatset_temp + 0.25*td_zone_2_temp + 0.2*md_zone_temp` (L56)
and enters birefringenceMean as `-0.00072 * (heatBalance - model.heat_balance_reference)`.

**Why this matters:** For PET_FILM_GRADE_A, `heat_balance_reference = 188.0`, but a typical running heatBalance (heatset 219, td_zone_2 114, md_zone 92) computes to ~167.4 — about 20 BELOW the reference. That gap makes the heatBalance term contribute roughly **+0.0148** to birefringence_mean, making it the single LARGEST contributor to an elevated mean — larger than all draw-ratio terms combined. This term is easy to miss because heatset_temp is usually thought of as "the cv-optimum knob" rather than "the strongest mean-lowering lever."

Per-unit mean authority via heatBalance:
- heatset_temp: -0.00072 * 0.55 = **-0.000396 / degC** (largest safe mean lever; sits at biref_cv optimum so low cross-talk up to ~222)
- md_zone_temp: -0.00072 * 0.2 = -0.000144 / degC
- td_zone_2_temp: -0.00072 * 0.25 = -0.00018 / degC BUT also carries the catastrophic biref_cv quadratic (+0.42*(delta/tdTempSpan)^2) — do NOT use td_zone_2_temp for mean, ever.

**How to apply:** When optimizing birefringence_mean on PET, reach for heatset_temp FIRST (via heatBalance) — it has the highest per-unit mean gain of any lever that does not damage thickness, and it is co-located with the biref_cv optimum so modest moves (up to ~222, cap 223) cost almost nothing in cv. md_draw_ratio is the clean second lever (gain -0.020/unit, zero cross-talk with cv/thickness). The diagnosis in TASK-20260613-003 missed this entirely due to [[birefringence-mean-ref-basis-gotcha]]. See [[pet-film-grade-a-model-optima]] for the full optimum map.
