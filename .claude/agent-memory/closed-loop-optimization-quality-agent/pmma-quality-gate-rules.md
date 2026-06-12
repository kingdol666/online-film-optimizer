---
name: pmma-quality-gate-rules
description: PMMA_FILM_GRADE_A product quality targets, gate rules, historical baselines, and validated lever responses for quality engineer role
metadata:
  type: project
---

# PMMA_FILM_GRADE_A Quality Gate Rules

**Product:** PMMA 高透光硬质膜 A 级 (PMMA_FILM_GRADE_A)
**Material Family:** PMMA

## Quality Windows (from product_target.json -- ABSOLUTE GATES)

| Metric | Type | Target | Tolerance/Max | Acceptable Range |
|--------|------|--------|---------------|------------------|
| thickness_mean | target+tolerance | 25 | 0.35 | 24.65 - 25.35 |
| thickness_cv | max | - | 1.8 | <= 1.8 |
| birefringence_mean | target+tolerance | 0.032 | 0.002 | 0.030 - 0.034 |
| birefringence_cv | max | - | 3.05 | <= 3.05 |

**Why:** These are the absolute quality gates. The relative-percent goal (e.g., 4% decrease in birefringence_cv) derives an intermediate threshold, but PASS requires all metrics within these absolute windows. Use the tighter of absolute gate vs. goal-derived threshold.

## Goal-Derived Thresholds (campaign-specific)

For campaigns with relative-percent goals, the derived threshold is computed as:
- `derived_max = baseline_value * (1 - percent/100)` for "下降" directives
- `derived_min = baseline_value * (1 + percent/100)` for "上升" directives

The baseline for birefringence_cv is **3.409** (from simulator default for PMMA_FILM_GRADE_A).

Example: 4% decrease -> derived birefringence_cv max = 3.409 * 0.96 = 3.27264

## PASS/WARNING/FAIL Logic

- **PASS**: All 4 metrics within absolute gates. Use absolute gate birefringence_cv <= 3.05 (tighter than derived 3.27264).
- **WARNING**: Only birefringence_cv out of spec (others OK), gap is within reasonable range. Recommend `continue_optimization` with `exploit` stage.
- **FAIL**: Multiple metrics out of spec, alarm active, or sensor DEGRADED.
- **NEEDS_DATA**: Insufficient settle time or incomplete sensor data.

## Hold-Window Validation (for freeze_candidate_recipe)

1. quality_state = PASS
2. Line state = STABLE for full process_settle window (~11 min / 6 ticks)
3. Sensor health = OK
4. At least 1 hold iteration confirming metrics remain in spec
5. No alarm active
6. After hold confirmed: next_action = freeze_candidate_recipe, stop exploration

## Validated Lever Response (campaign evidence)

From CMP-SIM-PMMA_FILM_GRADE_A-20260612122729262-UERP:

| Change | Effect | Evidence |
|--------|--------|----------|
| td_zone_2_temp: 123 -> 123.576 | birefringence_cv: 3.4746 -> 3.1025 (PASS at abs gate 3.05) | iteration 1->2, hold confirmed |
| Small delta on td_zone_2 only | thickness_cv stayed stable (1.59->1.54), mean metrics barely moved | confirmed narrow-spectrum response |

**Confirmed PMMA process note**: 热松弛与收卷张力是关键质量杠杆; td_zone_2_temp adjustment alone can close birefringence_cv gaps.

## Historical Recipes

| Recipe | State | birefringence_cv | Key Setpoints |
|--------|-------|------------------|---------------|
| PMMA-HIST-001 | PASS | 2.94 | td_zone_2_temp=126, heatset_temp=128.5, winder_tension=88.5 |
| PMMA-HIST-002 | WARNING | 3.42 | td_draw_ratio=2.22, winder_tension=96 |
| RCP-BASELINE | baseline | 3.409 (mean) | td_zone_2_temp=123, heatset_temp=126, winder_tension=92 |

## How to apply

- Always read both task-level and campaign-level product_target.json; resolve PASS against the tighter gate
- PMMA process notes: PMMA 对残余应力和双折射均值更敏感，热松弛与收卷张力是关键质量杠杆; 过高 TD 拉伸会快速放大边中差
- When only birefringence_cv is out of spec, suspect TD_stretching_heat_setting process region
- td_zone_2_temp, heatset_temp, winder_tension are the top-3 lever candidates for PMMA birefringence
