---
name: biref-cv-is-binding-for-mean-gap
description: When closing a large birefringence_mean gap on PET, the binding constraint is biref_cv (shared heatset lever), not mean feasibility — heatset pushed to 223 costs +0.21 on cv
metadata:
  type: project
---

When optimizing birefringence_mean DOWN on PET_FILM_GRADE_A, a naive reading of the lever authority suggests the gap is closable (heatset → 223 cap + md_draw → 3.0 + md_zone → 96). But independent quantification in TASK-20260613-003 showed this is misleading: the binding constraint is **birefringence_cv**, not mean feasibility, because heatset_temp is the ONE lever shared between mean (via [[heatbalance-dominant-mean-driver]]) and cv (via the 0.28×(Δfrom opt 219.5)²/16 quadratic in blackbox-model.mjs L102).

**Key numbers (PET, from source-verified blackbox-model.mjs):**
- heatset 219 → 221: cv cost +0.035 (cv ≈ 3.47, safe)
- heatset 219 → 222: cv cost +0.105 (cv ≈ 3.54, still safe)
- heatset 219 → 223: cv cost **+0.210** (cv ≈ 3.65, only 0.05 margin to 3.70 FAIL — leaves NO room for noise sigma 0.055)
- heatset 219 → 224: cv cost +0.354 (cv ≈ 3.79, FAIL)

So heatset's SAFE working ceiling is ~222, and 223 should be treated as an absolute red line, NOT a working target. Quality's "cap at 223" is correct as a hard limit but optimistic as a goal.

**Why this matters:** With heatset effectively capped at 222 for safe operation, the clean levers' total travel is insufficient to push a mean of 0.0935 into the [0.075, 0.081] target window:
- heatset 219→222: mean -0.00119
- md_draw_ratio 3.18→3.0 (floor): mean -0.0036 (zero cross-talk, the strongest clean lever)
- md_zone_temp 92→96.5: mean -0.00065
- Total ≈ -0.00544 → mean floor ≈ 0.088, still ~0.007 above the 0.081 gate.

**How to apply:** Before promising a mean-target PASS, project the cv cost of the heatset travel needed. If the projected mean floor (with heatset ≤ 222 and md_draw at its 3.0 floor) is still above the target window, surface a feasibility/binding-constraint decision to team-lead EARLY — do not run a long exploit path that cannot end in PASS under the stated hard constraints. The realistic outcomes are: (a) accept mean ~0.088 as the constraint-bound optimum, (b) relax the biref_cv guard, or (c) relax the mean target window. Related: [[birefringence-mean-ref-basis-gotcha]].
