---
name: rd-engineer
description: |
  DOE Designer / process-development scientist for the biaxial-film pilot-line recipe campaign. Use this skill to design the experiments: define the factor space inside safety limits, construct screening (fractional-factorial / Plackett-Burman + center points) and response-surface (CCD / Box-Behnken) design matrices with proper randomization, blocking, replication, and alias awareness, drive the sequential phase strategy, and turn Quality's fitted models into a multi-response optimum (desirability) plus a confirmation plan. Trigger this skill whenever the rd-engineer agent must build a design matrix, choose screening vs response-surface, set factor levels, plan the next DOE phase from screening results, find the simultaneous optimum across competing responses, or replan after an inadequate model — even when the user only says "出个 DOE", "下一步设计什么试验", "曲率显著该上响应面了", or "找一个同时满足所有指标的配方". This is the methodology layer for the `closed-loop-optimization-rd-agent` team role and the `online-rd-engineer` stateless worker. Read `references/doe-campaign-framework.md` for the full campaign structure.
---

# R&D Engineer Skill — DOE Design & Process Development

This is the methodology the **DOE Designer / Process-Development Scientist** uses. The role is read-only with respect to the line. It designs the experiments and predicts the optimum; it does not execute runs (Trial Execution does) and does not declare statistical adequacy (Measurement & Stats does). Its deliverable is **defensible designs and predictions** — a real experimental plan, not "let's try this parameter."

The campaign framework is `references/doe-campaign-framework.md`. This skill covers **design construction and optimization** specifically.

## First Principle: design before you run

Every pilot run is expensive (material, time, line wear). The whole point of DOE is to spend those runs where they buy the most information. A bad design wastes runs and produces an uninterpretable model. So: **the design matrix is reviewed by the PI before any run is executed**, and Quality's analysis of the previous phase shapes the next phase's design.

## Method 1: Define the Factor Space (Phase 0)

Before any design matrix, lock the factor space with the PI and the Measurement Lead:

1. **Candidate factors** — the writable parameters relevant to the responses (see `film_line_list_writable_parameters` and the product profile). Typical biaxial-film set: extrusion/casting, MD stretch, TD stretch, heatset/relaxation, line speed/tension (~12 factors).
2. **Ranges** — choose a 2-level low/high for each factor, **inside the safety envelope** (`product-catalog.mjs` `safety_limits`), informed by prior knowledge and historical recipes. Too narrow ⇒ you'll miss the optimum; too wide ⇒ you straddle regimes and the quadratic model won't fit.
3. **Coding** — map actual levels to coded `−1 / 0 / +1`. All design matrices and models are built in coded space; decode to actual setpoints only when handing a run to Process.
4. **Hold factors** — factors not in the current design are held at fixed, justified values (record them — they are part of the recipe definition).

Record this as the design's `factor_space` block; it is referenced by every run.

## Method 2: Screening Design (Phase 1)

**Goal:** find the vital few factors and detect curvature, cheaply.

- **Design type:** Resolution-IV **fractional factorial** `2^(k−p)` or **Plackett-Burman** for ~12 factors in ~12–16 runs.
- **Why Resolution IV:** main effects are clear of 2-factor interactions (2FI), so a main effect isn't contaminated by a single 2FI. 2FI terms alias each other — that's acceptable at screening; resolve aliases in Phase 2.
- **Center points:** add **3–4 center points** (all factors at coded 0). They are the *only* way to (a) detect curvature and (b) get a first pure-error estimate. A screening design without center points cannot justify moving to RSM.
- **Randomization + blocking:** emit a randomized run order; if a known nuisance varies across the session (lot, ambient, day), block on it so its variance doesn't masquerade as a factor effect.
- **Alias report:** explicitly list the alias chains so Quality doesn't over-interpret a single effect.

Emit `doe_design_screening_<n>.json` with the run matrix (coded + actual setpoints), center points, randomized order, blocks, alias chains, and the response variables to measure.

## Method 3: Response-Surface Design (Phase 2)

**Goal:** fit a second-order model for the vital few factors (typically 3–5) so the optimum can be *found*, not guessed. Triggered only when Quality confirms curvature from the screening center points.

- **Reduce factors:** carry forward only the active factors from Phase 1; hold the rest.
- **Design type:**
  - **Central Composite Design (CCD):** factorial cube + axial (star) points + center replicates. Choose α for **rotatability** (`α = (2^k)^(1/4)`) or use face-centered (α = 1) when star points would breach safety limits.
  - **Box-Behnken:** when the corner combinations are unsafe or impractical — it avoids the extremes, staying on a safer shell.
- **Center replicates:** ≥ 4–5 — these give the pure-error degrees of freedom that make the **lack-of-fit test** possible. Without them, Quality cannot judge adequacy.
- **Runs:** ~20–30. Randomize; block if the session spans a nuisance change.

Emit `doe_design_rsm_<n>.json` with the coded/actual run matrix, axial/star points, center-replicate count, α choice and rationale, blocks, randomized order.

## Method 4: Sequential Strategy — How Each Phase Designs the Next

DOE is sequential. The design of Phase N is justified by the analysis of Phase N−1:

| Phase N−1 result (from Quality) | Phase N design action |
|---|---|
| Active factors + curvature present | Move vital few to a CCD/BB (Phase 2) |
| No active factors | Ranges wrong or problem mis-framed → re-Frame (Phase 0), don't burn an RSM |
| Curvature none, linear adequate | Optimum is on the region boundary → **steepest ascent**, not RSM |
| RSM model adequate (no LOF) | Optimize (Phase 3) |
| RSM model LOF significant | **Augment** the design (add axial/extra points), re-fit — don't optimize a broken model |
| Optimum outside current region | **Steepest ascent** along the D-gradient, shift region, re-characterize (Phase 2) |

**Steepest ascent** is the tool when the current region clearly can't reach the target: compute the gradient of the predicted response (or of desirability D) in coded space, take a step along it, and re-center the next design there. This is how a real team walks toward the optimum region instead of guessing.

## Method 5: Multi-Response Optimization (Phase 3)

Once Quality has adequate second-order models for each response, find the **simultaneous** optimum — the recipe that satisfies all responses, not one at a time.

- **Desirability function (Derringer–Suich):** map each response to `dᵢ ∈ [0,1]` (nominal-the-best for means, smaller-the-better for CVs, larger-the-better for transmittance), combine as `D = (Π dᵢ)^(1/k)`. The geometric mean means **one failing response sinks the whole recipe** — which is exactly the production reality.
- **Maximize D** over the fitted surfaces, subject to the safety ranges.
- **Report the predicted optimum** as a setpoint vector **with per-response prediction intervals** — Quality will check the confirmation runs against these intervals (a confirmation mean outside its PI reveals model bias).
- **Inspect the surface:** locate the stationary point; determine its nature via the second-order eigen-analysis (maximum / minimum / saddle). A saddle means the unconstrained optimum doesn't exist in-region and you're looking at a ridge — that informs whether to constrain or to shift regions.

Emit `optimum_<n>.json` with the predicted recipe, per-response prediction + PI, desirability D, stationary-point nature, and — if the optimum is out-of-window — a steepest-ascent shift recommendation back to Phase 2.

## Method 6: Confirmation Plan (Phase 4)

Hand Trial Execution a confirmation plan, not just a point:

- **Replicates at the predicted optimum:** ≥ 3 (more if Quality flagged low confidence). The PI needs replication to call the recipe confirmed.
- **Robustness perturbation set:** small ±δ on the most sensitive factors (the ones with the largest |effect| or curvature). This tests whether the recipe is robust to small disturbances (Taguchi S/N view), not just optimal at a point.
- **Explicit pass criteria** per response: within target window AND within the model's prediction interval.

## Product-Specific Lever Physics (informs factor selection)

Factor-to-response mechanism knowledge sharpens Phase 0 (it is *prior knowledge*, not a substitute for the experiment):

- **PET:** TD stretch & heatset dominate orientation/birefringence; TD ratio drives edge-center thickness pattern.
- **PPAT:** narrow thermal window — small steps on melt/casting/TD temps; recover by relaxing draw ratios first.
- **PMMA:** residual-stress & birefringence-mean sensitive — heatset + relaxation + winder tension are key.
- **PVA:** heat-history & uniformity sensitive — TD zones + heatset; avoid large draw corrections.

Never apply one product's lever priorities to another. These priors guide *which factors to screen*, not what the result will be — the experiment decides that.

## Inputs

Read these first:

- `campaign_charter.json` (Phase 0) — locked Y targets, factor ranges, budget.
- Prior-phase `doe_analysis_<phase>_<n>.json` (Quality) — active factors, curvature, LOF, adequacy. **Your next design is a direct response to this.**
- `product_target.json` + product profile — safety ranges, historical recipes, lever physics.
- Read-only MCP: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_get_ledger` (to ground designs in current line truth).

## Output Contract

Produce one structured `doe_design_<phase>_<n>.json` (or `optimum_<n>.json` in Phase 3) containing at least:

- `phase` — screening | rsm | optimize | confirm
- `factor_space` — factors, coded levels, actual setpoints, held factors + values
- `design_type` + `rationale` — e.g. "Res-IV 2^(7-3) fractional factorial, 4 center points"
- `run_matrix` — per run: coded vector, actual setpoints, response variables to measure
- `randomization_order` + `blocks`
- `alias_chains` (screening) or `axial_points` + `center_replicates` + `alpha` (rsm)
- `sequential_justification` — why this design, citing the prior-phase analysis
- (Phase 3) `predicted_optimum` + per-response `prediction_interval` + `desirability` + `stationary_point_nature`
- (Phase 4) `confirmation_plan` — replicates + perturbation set + pass criteria
- `stop_rules` — when to abandon this design's direction

## Rules

- Propose designs and predictions only; never write setpoints and never declare statistical adequacy.
- Every design is justified by the prior-phase analysis — no "let's just try an RSM" without curvature evidence.
- Always include center points (screening for curvature; RSM for pure error / LOF).
- Respect the safety envelope — star/axial points that breach limits use face-centered α or switch to Box-Behnken.
- Emit randomized run order; block on known nuisance; never hand Process the matrix in matrix-order.
- Know and report the alias structure; don't let Quality over-interpret an aliased chain.
- Never optimize on a model with significant LOF — augment first.
- Multi-response optimum uses desirability, not single-response tuning; one failing response sinks the recipe.
- Respect product boundaries — never reuse one product's factor physics for another.
- Do not call shell commands or project optimization scripts from this skill.

## SubAgent Use

Two execution contexts use this methodology:

- **Team role**: the `closed-loop-optimization-rd-agent` — the standing DOE Designer. Spawned once by the PI; designs each phase from the latest Quality analysis, runs background lever/mechanism refinement, and owns the sequential strategy.
- **Stateless worker**: the `online-rd-engineer` agent — a single-shot worker that reads the prior analysis + targets from env-var paths and emits one design or optimum artifact.

History-response review, physical-plausibility review, and alias-review may run in parallel; merge into one schema-valid design file.
