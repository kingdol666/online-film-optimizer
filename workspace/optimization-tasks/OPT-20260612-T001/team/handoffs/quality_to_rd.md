# Quality Diagnosis Handoff: Quality -> R&D

**Task:** OPT-20260612-T001 | **Product:** PET_FILM_GRADE_A | **Date:** 2026-06-12

## Current Quality — 3 of 4 Metrics Out of Spec

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| birefringence_cv | 3.6485 | <= 3.4851 | ABOVE (+4.69%) |
| birefringence_mean | 0.09186 | 0.078 +/- 0.003 | ABOVE (+17.8%) |
| thickness_cv | 2.5428 | <= 1.55 | ABOVE (+64%) |
| thickness_mean | 12.1281 | 12 +/- 0.22 | ON TARGET |

## Root Cause Summary

1. **TD thermal zone + heatset coupling (HIGH confidence):** birefringence profile is center-peaked, consistent with uneven TD orientation. td_zone_1 (108) is near the lower bound, while heatset_temp (218) is mid-low in range — together producing insufficient stress relaxation and a strong center-edge orientation gradient.

2. **Draw ratio / stress imbalance (MEDIUM confidence):** birefringence_mean at 0.092 vs target 0.078 indicates globally excessive orientation stress. Prior TD draw ratio reductions (3.62 -> 3.54) alone did not resolve this.

3. **TD stretch + winder tension mismatch causing thickness CV (HIGH confidence):** thickness profile is M-shaped (edges high, center low) — classic TD stretch insufficiency or uneven cooling. thickness_cv at 2.54 is the worst deviation across all metrics.

## Risk Level: HIGH

birefringence_cv is within 1.4% of the spec upper limit (3.7). thickness_cv is 64% over its max. Both dimensions are degraded. Single-parameter tuning is risky due to birefringence/thickness coupling.

## Stage Recommendation: EXPLORE

This is the initial state of recipe_011. No systematic DOE has been done for this product grade. The line is STABLE with no alarms — safe to explore. Do NOT jump to exploit without response surface data.

## Recommended R&D Focus

Three-factor DOE with controlled micro-steps:
- **Factor 1:** TD zone temperature gradient (td_zone_1, td_zone_2) — raise td_zone_1 toward td_zone_2 to flatten orientation profile
- **Factor 2:** heatset_temp — raise toward 222-224 to improve stress relaxation
- **Factor 3:** relaxation_ratio — raise toward 4.5-4.8 for additional stress relief

Hold extruder_speed and line_speed constant to preserve thickness_mean stability. Use preview_proposal before any apply to verify safety gate compliance.
