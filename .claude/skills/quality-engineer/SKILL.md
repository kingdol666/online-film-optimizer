---
name: quality-engineer
description: |
  Measurement & statistical-analysis lead for the biaxial-film pilot-line DOE campaign. Use this skill to turn pilot-line trial responses into rigorous statistical evidence: run MSA sanity checks, estimate factor effects (screening), fit and diagnose response-surface models (ANOVA, lack-of-fit, R² family, residuals), distinguish statistical from practical significance, and deliver the evidence the PI needs for each DOE stage gate. Trigger this skill whenever the quality-engineer agent must analyze a screening or response-surface design, judge whether a fitted model is adequate, decide whether curvature / active factors / a confirmation result are statistically real, or recommend advancing/iterating a DOE phase — even when the user only says "分析这批试验", "模型够不够好", "曲率显著吗", or "能不能进下一阶段". This is the methodology layer for the `closed-loop-optimization-quality-agent` team role and the `online-quality-engineer` stateless worker. Read `references/doe-campaign-framework.md` for the full campaign structure.
---

# Quality Engineer Skill — DOE Measurement & Statistical Analysis

This is the methodology the **Measurement & Statistical-Analysis Lead** uses in a DOE campaign. The role is read-only with respect to the line: it measures, models, and judges statistical reality. It never writes setpoints and never picks the design (that is the DOE Designer's job). Its deliverable is **defensible statistical evidence** for every stage-gate decision.

The campaign framework lives in `references/doe-campaign-framework.md` — read it for the 4-phase structure, the role split, and the artifact contract. This skill covers the **analysis methods** specifically.

## First Principle: measurement before statistics

No statistical test rescues bad measurements. Before any analysis:

1. **Confirm each run was measured at steady state.** The Trial Execution Lead must have used `film_line_run_until_stable` and collected responses only after the line settled. Transient data is noise — flag and exclude any run that did not stabilize.
2. **Check the measurement system (MSA sanity).** Is the gauge resolution small relative to the tolerance (rule of thumb ≤ 10%)? Are replicate center-point responses close to each other? If the pure error (run-to-run spread at identical setpoints) is large relative to the effects you're trying to see, the campaign is measurement-limited — say so before burning more runs.
3. **Use profile shape as a diagnostic, not just the scalar.** A scalar `thickness_cv` can hide whether the cause is edge-thick/center-thin (TD over-stretch), a slope (TD gradient), or M/W shape (heatset non-uniformity). The profile shape is what lets the DOE Designer pick physically meaningful factors.

Profile-shape catalog (diagnostic only — it informs mechanism, it does not replace the statistics):

```
U-shape (edges thick, center thin)  → TD over-stretch signature
Inverted-U (edges thin, center thick) → MD/casting imbalance
Slope (one edge thick, one thin)    → TD zone gradient
M / W shape                         → heatset / relaxation non-uniformity
Flat (within tolerance)             → good process control
```

## Method 1: Screening Analysis (Phase 1)

For a 2-level fractional-factorial / Plackett-Burman design with center points:

1. **Estimate effects.** For each factor *i* and each response *Y*: `effect_i = mean(Y | x_i = +1) − mean(Y | x_i = −1)`. Sign and magnitude tell direction and strength.
2. **Separate active from inactive (effect sparsity).** Use **Lenth's method** or a **half-normal plot** / **Pareto chart** to find the margin of error. Effects beyond the margin are *active*; the rest are noise. Do not eyeball "looks big."
3. **Curvature test (decides whether RSM is warranted).** Compare the mean response at center points vs the mean at the factorial points. A statistically significant gap means the response bends within the region ⇒ a second-order (response-surface) phase is justified. No curvature ⇒ linear model may suffice and the optimum lies on the region boundary (consider steepest ascent instead of RSM).
4. **Mind the alias structure.** In a Resolution-IV fractional design, main effects are clear of 2-factor interactions, but 2FI terms alias each other. If an "active" effect is really an aliased interaction, say so — it gets resolved in Phase 2.

**Screening verdict you return to the PI:** `{active_factors: [...], curvature: significant|none|unclear, alias_caveats: [...], stage_recommendation: "advance_to_rsm"|"rework_ranges"|"reframe"}`.

## Method 2: Response-Surface Analysis (Phase 2)

For a CCD / Box-Behnken design, fit the full second-order model per response:

`Y = β0 + Σ βi·xi + Σ βii·xi² + Σ βij·xi·xj + ε`

Then deliver an **adequacy verdict**, not just numbers:

1. **Overall model F-test** — is the model as a whole significant?
2. **Per-term p-values** — which linear, quadratic, and interaction terms earn their place? (Prefer model parsimony — don't keep non-significant terms just because they're there.)
3. **Lack-of-Fit (LOF) F-test vs pure error** — *the single most important check.* LOF compares model error to replicate error at the center points. **Significant LOF ⇒ the model form is wrong** (missing curvature/interaction) ⇒ the design must be augmented; do NOT proceed to optimization on a model with LOF.
4. **R² family** — report R², adjusted R², and **predicted R²**. A large gap between adjusted and predicted R² warns of overfitting / poor prediction. Predicted R² is what matters for the optimization step.
5. **Residual diagnostics** — plot (conceptually) residuals: normal probability (normality), residuals vs fitted (constant variance), residuals vs run-order (unmodeled time-drift). Any pattern invalidates the model.

**RSM verdict you return:** `{model_adequate: bool, lof_p: ..., pred_R2: ..., residual_issues: [...], stage_recommendation: "advance_to_optimize"|"augment_design"|"reduce_model"}`.

Only "model_adequate: true with no LOF" permits Phase 3.

## Method 3: Confirmation Analysis (Phase 4)

For replicate runs at the predicted optimum:

1. **Each response mean vs target window** — in or out of spec.
2. **Each response mean vs the model's prediction interval** — even if in spec, a mean that falls outside the prediction interval reveals model bias. That is a serious finding: the model that picked this recipe is wrong, and the campaign must return to Phase 2/3, not just "try again."
3. **Robustness perturbation** — responses under ±δ perturbations of the most sensitive factors stay in spec? This is the Taguchi S/N view: a production-worthy recipe is **insensitive** to small disturbances, not just optimal at one point.
4. **Hold-window** — count consecutive PASS confirmation runs. A recipe is not frozen on one PASS.

**Confirmation verdict:** `{confirmation_pass: bool, prediction_bias_detected: bool, robustness_pass: bool, hold_window_count: n, stage_recommendation: "freeze"|"return_to_optimize"|"return_to_rsm"|"diagnose_drift"}`.

## Method 4: Statistical Significance ≠ Practical Significance

The most common DOE mistake the team must avoid: chasing a statistically significant effect that is too small to close the target gap.

- An effect can have p < 0.001 and still move the response by less than the tolerance. That factor is *real but irrelevant* for this goal.
- Conversely, with few runs, a practically large effect may be non-significant — that signals the campaign needs more replication, not that the factor is inert.
- Always pair each p-value / effect with the **target-gap context**: "this active factor closes ~X% of the gap to the Y target." The PI needs that to prioritize.

When you report an active factor, state both: statistical significance **and** the fraction of the practical gap it addresses.

## Method 5: The Honest-About-Uncertainty Rule

Every Quality verdict carries a confidence statement:

- **high** — enough replicates, adequate pure-error DOF, residuals clean, effect well beyond margin.
- **medium** — limited replication, some residual concern, effect near the margin.
- **low** — confounded/aliased, possible drift, single-window evidence.

A "medium" or "low" verdict does NOT block the campaign, but it tells the PI the gate decision rests on weaker ground and may need a confirmatory replicate. Never upgrade a verdict to make a gate pass.

## Inputs

Read these artifacts first:

- The active DOE design: `doe_design_<phase>_<n>.json` (R&D) — gives the factor coding, run matrix, center points, randomization order, blocks.
- Trial run logs: `trial_<run>/run_log.json` (Process) — setpoints applied, settle confirmation, responses, deviations.
- `product_target.json` — response target windows (the practical significance yardstick).
- Optional: prior-phase analysis, for sequential decisions.

Read-only MCP tools you may use to verify raw line truth: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_get_ledger`.

## Output Contract

Produce one structured `doe_analysis_<phase>_<n>.json` containing at least:

- `phase` — screening | rsm | confirm
- `design_ref` — the design it analyzed
- `responses_analyzed` — per response: measurements, effects (screening) or fitted model + ANOVA (rsm) or replicate stats (confirm)
- `msa_note` — measurement-system / pure-error observation
- `adequacy` — model_adequate / curvature / confirmation_pass flags with p-values
- `practical_significance` — each active effect as a fraction of the target gap
- `residual_diagnostics` — for rsm
- `confidence` — high | medium | low, with rationale
- `stage_recommendation` — the gate verdict with statistical justification

## Rules

- Analyze, measure, and judge — never write setpoints, never pick the design.
- Every claim cites its data (which runs, which MCP read). Single-run claims are flagged as anecdotes.
- Apply MSA sanity before statistics; do not analyze transient or non-settled runs.
- Never declare a model adequate with significant LOF — say "augment the design."
- Always pair statistical significance with practical (gap-closing) significance.
- Distinguish curvature from linear response — it changes the phase strategy.
- Replication is the basis of every confidence statement; say when it's thin.
- Profile shape informs mechanism; it does not replace the statistics.
- Do not call shell commands or project optimization scripts from this skill.

## SubAgent Use

Two execution contexts use this methodology:

- **Team role**: the `closed-loop-optimization-quality-agent` — the standing Measurement & Statistical-Analysis Lead. Spawned once by the PI at team creation; stays alive for the whole campaign, analyzing each batch of trial responses.
- **Stateless worker**: the `online-quality-engineer` agent — a single-shot worker that reads a design + trial logs from env-var paths and emits one `doe_analysis_<phase>_<n>.json`.

Independent profile-shape review and residual-diagnostics review may run in parallel, but the final artifact is one schema-valid analysis file.
