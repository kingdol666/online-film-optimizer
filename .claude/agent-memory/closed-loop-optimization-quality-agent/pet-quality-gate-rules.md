---
name: pet-quality-gate-rules
description: PET_FILM_GRADE_A product quality targets, gate rules, baseline metrics from simulator state file
metadata:
  type: project
---

# PET_FILM_GRADE_A Quality Gate Rules

**Product:** PET 双向拉伸光学膜 A 级 (PET_FILM_GRADE_A)
**Material Family:** PET

## Quality Windows (from product-catalog.mjs target_template — ABSOLUTE GATES)

| Metric | Type | Target | Tolerance/Max | Acceptable Range |
|--------|------|--------|---------------|------------------|
| thickness_mean | target+tolerance | 12.0 | 0.22 | 11.78 - 12.22 |
| thickness_cv | max | - | 1.55 | <= 1.55 |
| birefringence_mean | target+tolerance | 0.078 | 0.003 | 0.075 - 0.081 |
| birefringence_cv | max | - | 3.7 | <= 3.7 |

## PASS/WARNING/FAIL Logic

- **PASS**: All 4 metrics within absolute gates.
- **WARNING**: Only birefringence_cv out of spec (others OK), gap marginal.
- **FAIL**: Multiple metrics out of spec, alarm active, or sensor degraded.
- **NEEDS_DATA**: Insufficient settle time or incomplete sensor data.

## Baseline (RCP-BASELINE, Tick 0, Seed 20260610)

| Metric | Value | Status |
|--------|-------|--------|
| thickness_mean | 12.0842 | PASS (within 12.0 +/- 0.22) |
| thickness_cv | 1.5377 | PASS (<= 1.55) |
| birefringence_mean | 0.093905 | FAIL (> 0.081) |
| birefringence_cv | 3.7278 | FAIL (> 3.7) |

**Quality State: FAIL** — two metrics out of spec (birefringence_mean and birefringence_cv).

## Historical Recipes (PET_FILM_GRADE_A)

| Recipe | State | birefringence_cv | Key Setpoints |
|--------|-------|------------------|---------------|
| PET-HIST-001 | PASS | 3.61 | td_zone_2_temp=114.0, heatset_temp=219.2, td_draw_ratio=3.68 |
| PET-HIST-002 | WARNING | 3.96 | td_zone_2_temp=111.6, heatset_temp=217.8, td_draw_ratio=3.62 |

## Validated Lever Responses

From prior campaigns:
- td_zone_2_temp + heatset coupling is the primary control channel for PET birefringence
- Moving td_zone_2_temp from 112 -> 114 region yields significant birefringence_cv improvement
- RCP-BASELINE td_zone_2_temp=112 converges to local optimum around biref_cv=3.75

## Top-3 Lever Candidates for PET Birefringence
1. td_zone_2_temp (range 106-120, current 112)
2. heatset_temp (range 210-226, current 218)
3. td_draw_ratio (range 3.42-3.82, current 3.62)

**Why:** PET model optimum is at td_zone_2_temp=114.2, heatset_temp=219.5. The baseline (td_zone_2=112) sits in a local suboptimal region. td_zone_2 is the dominant univariate birefringence lever.
