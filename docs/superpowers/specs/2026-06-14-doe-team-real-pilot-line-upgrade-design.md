# DOE Team → Real Pilot-Line Expert Standard — Design Spec

**Date:** 2026-06-14
**Status:** Approved by user; implementing.
**Goal:** Elevate the biaxial-film pilot-line DOE team from "good textbook DOE" to the standard a real R&D team follows on a real 双向拉伸薄膜 line — through agent orchestration + MCP on the 中试线 interface — and run a real, directly-deployable optimization campaign that freezes a recipe.

## Scope of revision (targeted deepening; structure preserved)

Keep: 4-phase sequential DOE (screen → characterize → optimize → confirm), 3 roles + PI, five-gate safety protocol, artifact contract names, MCP-permission model, simulator + `inter_tick_control` config. Only deepen methodology, behavioral codes, and reference knowledge.

## Approved enhancements

- **A. HTC/ETC split-plot DOE.** Classify factors hard-to-change (thermal: melt/casting/zone/heatset temps, ≥8 min to settle) vs easy-to-change (draw ratios, speed, tension). Screening/RSM become split-plot designs; whole-plot (HTC fixed) holds while ETC sub-plots randomize inside. Reset+restabilize happens at whole-plot boundaries only. Quality analyzes with two error strata (whole-plot vs sub-plot) — never one pooled error term.
- **B. Formal MSA + power/sample-size.** Gage R&R (%R&R, %tolerance, ndc) per response; thresholds <10 / 10–30 / >30 %. Power analysis sets screening run count from `σ_pure_error` × `Δ_min` (power ≥0.8, α=0.05). Makes MSA→sizing explicit.
- **C. DSD + Taguchi S/N.** Definitive Screening Designs offered alongside Res-IV fractional (3-level, 2k+1 runs, curvature-in-one-pass). Phase-4 robustness formalized as Taguchi parameter design (inner control × outer noise, S/N η = 10·log₁₀(μ²/σ²)).
- **D. Response taxonomy + scope flag.** Expand framework Y-table to full optical-film grade set (adds haze, heat-shrinkage MD/TD, tensile MD/TD, modulus MD/TD, crystallinity), each flagged in-scope (simulator-modeled) vs documented-not-yet-modeled.
- **E. Biaxial-film physics reference (new file, concise).** 5 process zones → microstructure; birefringence as orientation probe (Δn=Δn_max·f, refractive-index ellipsoid, TD/MD balance); heatset crystallization → shrinkage; thickness formation; product-specific physics; mechanism→factor mapping table. R&D + Quality cross-validate "every active factor must have a physical story."

## User-added hard constraint — settling interval (anti-jitter)

**Every parameter change must wait for the type-specific cooldown AND a confirmed stable window before the next change.** Baked in as:
- A DOE-discipline item (framework §4) and a red-line (process-engineer).
- A mandatory step in the per-run pipeline: after `apply` → wait `min_wait` by parameter type → confirm `min_stable_ticks` of stable readings AND cv-deviation below oscillation threshold (`max_consecutive_cv_measurements_deviation`) → only then proceed.
- A governance cadence rule: the PI never shortens the cooldown; split-plot design reduces the *count* of expensive HTC changes rather than rushing them.
- Source of truth: `workspace/optimization-tasks/config/inter_tick_control.json` (temperature 480 s, draw_ratio 360 s, base 300 s; stabilization 3 ticks; cv-deviation 0.05).

## Files (10)

| # | File | Change |
|---|---|---|
| 1 | `closed-loop-optimizer/references/doe-campaign-framework.md` | SoT: 5 enhancements + settling discipline |
| 2 | `closed-loop-optimizer/references/biaxial-film-physics.md` | **NEW** concise mechanism ref |
| 3 | `rd-engineer/SKILL.md` | DSD, split-plot design, power-based sizing, multi-response, mechanism cross-check |
| 4 | `quality-engineer/SKILL.md` | Gage R&R, power analysis, split-plot 2-error-strata, Taguchi S/N |
| 5 | `process-engineer/SKILL.md` | whole/sub-plot execution + settling-interval enforcement |
| 6 | `closed-loop-optimizer/SKILL.md` | reflect framework upgrades + team interlock |
| 7 | `closed-loop-optimization-orchestrator.md` | PI behavioral code, HTC/MSA gates, settling cadence |
| 8 | `closed-loop-optimization-rd-agent.md` | DOE-designer code + mechanism cross-validation |
| 9 | `closed-loop-optimization-quality-agent.md` | stats-lead code + Gage R&R/SN gate duties |
| 10 | `closed-loop-optimization-process-agent.md` | trial-lead code + split-plot execution + settling |

New artifact fields (additive, backward-compatible): `factor_hardness`, `whole_plot_structure`, `restricted_randomization_order`, `msa_gage_rr`, `power_analysis`, `sn_ratio`, `settling_confirmation`.

## Execution plan

1. Implement the 10-file revision (framework → physics ref → skills → prompts), commit.
2. Verify MCP + backend gate.
3. Launch the team (`TeamCreate` + 3 standing role agents) and drive a real 4-phase campaign on PET_FILM_GRADE_A (multi-response: thickness + birefringence, with settling discipline), through freeze.
