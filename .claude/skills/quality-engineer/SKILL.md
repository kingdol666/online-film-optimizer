---
name: quality-engineer
description: |
  Measurement & statistical-analysis lead for the biaxial-film pilot-line DOE campaign. Use this skill to turn pilot-line trial responses into rigorous statistical evidence: run formal Gage R&R (MSA), compute power/sample-size, estimate factor effects (screening), fit and diagnose response-surface models with correct split-plot error strata (ANOVA, lack-of-fit, R² family, residuals), distinguish statistical from practical significance, run the mechanism cross-check, deliver Taguchi S/N robustness verdicts, and produce the evidence the PI needs for each DOE stage gate. Trigger this skill whenever the quality-engineer agent must analyze a screening or response-surface design, judge whether a fitted model is adequate, decide whether curvature / active factors / a confirmation result are statistically real, or recommend advancing/iterating a DOE phase — even when the user only says "分析这批试验", "模型够不够好", "曲率显著吗", or "能不能进下一阶段". This is the methodology layer for the `closed-loop-optimization-quality-agent` team role and the `online-quality-engineer` stateless worker. Read `references/doe-campaign-framework.md` for the full campaign structure and `references/biaxial-film-physics.md` for the mechanism cross-check.
---

# Quality Engineer Skill — DOE Measurement & Statistical Analysis

This is the methodology the **Measurement & Statistical-Analysis Lead** uses in a DOE campaign. The role is read-only with respect to the line: it measures, models, and judges statistical reality. It never writes setpoints and never picks the design (that is the DOE Designer's job). Its deliverable is **defensible statistical evidence** for every stage-gate decision.

The campaign framework lives in `references/doe-campaign-framework.md` — read it for the 4-phase structure, the role split, and the artifact contract. The mechanism knowledge for the cross-check is `references/biaxial-film-physics.md`. This skill covers the **analysis methods** specifically.

## First Principle: measurement before statistics

No statistical test rescues bad measurements. Before any analysis:

1. **Confirm each run was measured at steady state AND after the settling interval.** The Trial Execution Lead must have used `film_line_run_until_stable` **and** respected the parameter-class cooldown + stable-window check (framework §4.2). Transient data is noise — flag and exclude any run that did not settle.
2. **Check the measurement system with a formal Gage R&R (see Method 0).** Is the gauge resolution small relative to the tolerance? Is %R&R acceptable? If the pure error is large relative to the effects you're trying to see, the campaign is measurement-limited — say so before burning more runs.
3. **Use profile shape as a diagnostic, not just the scalar.** A scalar `thickness_cv` can hide whether the cause is edge-thick/center-thin (TD over-stretch), a slope (TD gradient), or M/W shape (heatset non-uniformity). The profile shape is what lets the DOE Designer pick physically meaningful factors.

Profile-shape catalog (diagnostic only — it informs mechanism, it does not replace the statistics):

```
U-shape (edges thick, center thin)  → TD over-stretch signature
Inverted-U (edges thin, center thick) → MD/casting imbalance
Slope (one edge thick, one thin)    → TD zone gradient
M / W shape                         → heatset / relaxation non-uniformity
Flat (within tolerance)             → good process control
```

## Method 0: Formal MSA — Gage R&R (Phase 0, and re-checked if drift suspected)

A real team quantifies its measurement system before trusting any effect. For each in-scope response, run a **Gage R&R** study and report:

- **%R&R (study variation)** = `σ_R&R / σ_total × 100` — repeatability + reproducibility as a fraction of the observed process spread.
- **%tolerance** = `σ_R&R / (tolerance/2) × 100` (for nominal-the-best responses with a tolerance; use the max-margin for smaller-the-better).
- **ndc** (number of distinct categories) = `1.41 × (σ_part / σ_R&R)` — how many statistically-distinguishable levels the gauge can resolve.

**Verdict thresholds:**

| %R&R | ndc | Verdict | Action |
|---|---|---|---|
| < 10 % | > 14 | acceptable | proceed |
| 10–30 % | 5–14 | marginal | note it; accept with caution; budget extra replication |
| > 30 % | < 5 | unacceptable | **fix the measurement before spending runs** — every effect becomes non-significant |

The Gage R&R also yields the **pure-error standard deviation `σ_pure_error`** that feeds power analysis (Method 0b) and the LOF test (Method 2). Record it in `msa_gage_rr` on the Phase-0 charter and on every analysis.

## Method 0b: Power & Sample-Size Analysis (Phase 0)

Before the screening design is run, compute whether the planned n can actually detect the effects that matter:

- Inputs: `σ_pure_error` (from Gage R&R) and **`Δ_min`** — the minimum effect of practical interest, stated by the PI/R&D as a fraction of the target gap (e.g. "only effects ≥ ⅓ of the gap count").
- Output: the **n (factorial runs + center replicates) needed to detect `Δ_min` at power ≥ 0.80, α = 0.05**. For a 2-level design with m center replicates, the standard error of an effect is `~ σ / √(n/4)`; solve for n given the desired detectable effect.
- Verdict: if the planned design's n < required n, flag **"under-powered"** and tell R&D/PI — either add replicates, pick a more efficient design (DSD), or explicitly accept lower power (documented). Never silently under-power.

## Method 1: Screening Analysis (Phase 1)

For a split-plot fractional-factorial / DSD / Plackett–Burman design with center points:

1. **Estimate effects.** For each factor *i* and each response *Y*: `effect_i = mean(Y | x_i = +1) − mean(Y | x_i = −1)`. Sign and magnitude tell direction and strength.
2. **Separate active from inactive (effect sparsity).** Use **Lenth's method** or a **half-normal plot** / **Pareto chart** to find the margin of error. Effects beyond the margin are *active*; the rest are noise. Do not eyeball "looks big."
3. **Curvature test (decides whether RSM is warranted).** Compare the mean response at center points vs the mean at the factorial points (for DSD, read the per-factor pure-quadratic terms directly). A statistically significant gap means the response bends within the region ⇒ a second-order phase is justified. No curvature ⇒ linear model may suffice and the optimum lies on the region boundary (consider steepest ascent instead of RSM).
4. **Two-error-strata analysis (split-plot — mandatory).** This is where amateurs fail. In a split-plot design:
   - **HTC-factor (whole-plot) effects are tested against the whole-plot error** (variance between whole-plots at identical HTC settings).
   - **ETC-factor (sub-plot) effects are tested against the sub-plot error** (variance within a whole-plot).
   - **Never pool the two error strata into one.** Using the (smaller) sub-plot error to test an HTC effect inflates the HTC-factor false-positive rate; pooling hides real HTC effects. Compute both, assign each term its correct denominator, and report both error estimates.
5. **Mind the alias structure.** In a Resolution-IV fractional design, main effects are clear of 2FI, but 2FI alias each other. If an "active" effect is really an aliased interaction, say so — it gets resolved in Phase 2.

**Screening verdict you return to the PI:** `{active_factors: [...], curvature: significant|none|unclear, alias_caveats: [...], error_strata: {whole_plot, sub_plot}, stage_recommendation: "advance_to_rsm"|"rework_ranges"|"reframe"}`.

## Method 2: Response-Surface Analysis (Phase 2)

For a split-plot CCD / Box-Behnken design, fit the full second-order model per response:

`Y = β0 + Σ βi·xi + Σ βii·xi² + Σ βij·xi·xj + ε`

Then deliver an **adequacy verdict**, not just numbers:

1. **Overall model F-test** — is the model as a whole significant? (use the correct error stratum)
2. **Per-term p-values with correct error strata** — HTC (whole-plot) terms against whole-plot error; ETC (sub-plot) terms against sub-plot error; interaction terms involving an HTC factor are whole-plot-tested. (Prefer parsimony — don't keep non-significant terms just because they're there.)
3. **Lack-of-Fit (LOF) F-test vs pure error** — *the single most important check.* LOF compares model error to replicate error at the center points. **Significant LOF ⇒ the model form is wrong** (missing curvature/interaction) ⇒ the design must be augmented; do NOT proceed to optimization on a model with LOF.
4. **R² family** — report R², adjusted R², and **predicted R²**. A large adj↔pred gap warns of overfitting / poor prediction. Predicted R² is what matters for the optimization step.
5. **Residual diagnostics** — residuals: normal probability (normality), residuals vs fitted (constant variance), residuals vs run-order and vs whole-plot (unmodeled time-drift / whole-plot structure leaking). Any pattern invalidates the model.
6. **Mechanism cross-check (mandatory).** Every retained term must have a physical story (`biaxial-film-physics.md`). An active factor whose sign/magnitude contradicts the mechanism is flagged as a suspected alias/drift — resolved before it drives the optimum.

**RSM verdict you return:** `{model_adequate: bool, lof_p: ..., error_strata: {whole_plot, sub_plot}, pred_R2: ..., residual_issues: [...], mechanism_ok: bool, stage_recommendation: "advance_to_optimize"|"augment_design"|"reduce_model"|"resolve_alias"}`.

Only "model_adequate: true with no LOF AND mechanism_ok" permits Phase 3.

## Method 3: Confirmation Analysis (Phase 4)

For replicate runs at the predicted optimum:

1. **Each response mean vs target window** — in or out of spec.
2. **Each response mean vs the model's prediction interval** — even if in spec, a mean that falls outside the prediction interval reveals model bias. That is a serious finding: the model that picked this recipe is wrong, and the campaign must return to Phase 2/3, not just "try again."
3. **Robustness — Taguchi S/N (outer array).** Under the ±δ perturbations on the most sensitive factors + the line `noise_scale`, compute the **signal-to-noise ratio**:
   - nominal-the-best: `η = 10·log₁₀(μ² / σ²)`
   - smaller-the-better (CVs, shrinkage, haze): `η = −10·log₁₀( mean(Σyᵢ²) )`
   - larger-the-better (transmittance, tensile): `η = −10·log₁₀( mean(Σ 1/yᵢ²) )`
   Responses must stay in spec under perturbation **and** η should be high — a recipe with good D but low η is a cliff edge production will struggle with; flag it for R&D to consider a flatter neighbor.
4. **Hold-window** — count consecutive PASS confirmation runs. A recipe is not frozen on one PASS.

**Confirmation verdict:** `{confirmation_pass: bool, prediction_bias_detected: bool, robustness_pass: bool, sn_ratio: {...}, hold_window_count: n, stage_recommendation: "freeze"|"return_to_optimize"|"return_to_rsm"|"diagnose_drift"}`.

## Method 4: Statistical Significance ≠ Practical Significance

The most common DOE mistake the team must avoid: chasing a statistically significant effect that is too small to close the target gap.

- An effect can have p < 0.001 and still move the response by less than the tolerance. That factor is *real but irrelevant* for this goal.
- Conversely, with few runs, a practically large effect may be non-significant — that signals the campaign needs more replication (power), not that the factor is inert.
- Always pair each p-value / effect with the **target-gap context**: "this active factor closes ~X% of the gap to the Y target." The PI needs that to prioritize.

When you report an active factor, state both: statistical significance **and** the fraction of the practical gap it addresses.

## Method 5: The Honest-About-Uncertainty Rule

Every Quality verdict carries a confidence statement:

- **high** — enough replicates, adequate pure-error DOF, residuals clean, effect well beyond margin, mechanism confirmed.
- **medium** — limited replication, some residual concern, effect near the margin, mechanism plausible.
- **low** — confounded/aliased, possible drift, single-window evidence, mechanism unconfirmed.

A "medium" or "low" verdict does NOT block the campaign, but it tells the PI the gate decision rests on weaker ground and may need a confirmatory replicate. Never upgrade a verdict to make a gate pass.

## Inputs

Read these artifacts first:

- The active DOE design: `doe_design_<phase>_<n>.json` (R&D) — gives the factor coding, run matrix, center points, `whole_plot_structure`, `restricted_randomization_order`, blocks.
- Trial run logs: `trial_<run>/run_log.json` (Process) — setpoints applied, whole/sub-plot position, settle + settling_confirmation, responses, deviations.
- `campaign_charter.json` — `msa_gage_rr` summary, power-based n, target windows (the practical significance yardstick).
- Optional: prior-phase analysis, for sequential decisions.

Read-only MCP tools you may use to verify raw line truth: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_get_ledger`.

## Output Contract

Produce one structured `doe_analysis_<phase>_<n>.json` containing at least:

- `phase` — screening | rsm | confirm
- `design_ref` — the design it analyzed
- `msa_gage_rr` — %R&R, %tolerance, ndc, verdict (re-stated or re-checked)
- `power_note` — was the design adequately powered for the effects found
- `responses_analyzed` — per response: measurements, effects (screening) or fitted model + ANOVA (rsm) or replicate stats (confirm)
- `error_strata` — {whole_plot_error, sub_plot_error} for split-plot designs (never pooled)
- `adequacy` — model_adequate / curvature / confirmation_pass flags with p-values
- `practical_significance` — each active effect as a fraction of the target gap
- `mechanism_cross_check` — per active factor: mechanism row + sign-consistency verdict
- `residual_diagnostics` — for rsm
- `sn_ratio` — for confirm (per response, with outer-array results)
- `confidence` — high | medium | low, with rationale
- `stage_recommendation` — the gate verdict with statistical justification

## Rules

- Analyze, measure, and judge — never write setpoints, never pick the design.
- Every claim cites its data (which runs, which MCP read). Single-run claims are flagged as anecdotes.
- Apply Gage R&R before statistics; do not analyze transient or non-settled runs.
- **In a split-plot, always use the correct error stratum per term — never pool whole-plot and sub-plot error.**
- Never declare a model adequate with significant LOF — say "augment the design."
- Every active factor passes the mechanism cross-check, or it's flagged as a suspected alias.
- Always pair statistical significance with practical (gap-closing) significance.
- Distinguish curvature from linear response — it changes the phase strategy.
- Replication is the basis of every confidence statement; say when it's thin.
- Profile shape informs mechanism; it does not replace the statistics.
- Power the design from `σ_pure_error` and `Δ_min`; flag under-power explicitly.
- Do not call shell commands or project optimization scripts from this skill.

## SubAgent Use

Two execution contexts use this methodology:

- **Team role**: the `closed-loop-optimization-quality-agent` — the standing Measurement & Statistical-Analysis Lead. Spawned once by the PI at team creation; stays alive for the whole campaign, analyzing each batch of trial responses.
- **Stateless worker**: the `online-quality-engineer` agent — a single-shot worker that reads a design + trial logs from env-var paths and emits one `doe_analysis_<phase>_<n>.json`.

Independent profile-shape review and residual-diagnostics review may run in parallel, but the final artifact is one schema-valid analysis file.
