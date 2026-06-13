# DOE Campaign Framework — Biaxial Film Pilot-Line Recipe Development

> **Single source of truth for the whole optimization team.** Every role (PI, DOE Designer, Measurement & Stats Lead, Trial Execution Lead) follows this framework. Read it before any campaign action.
>
> **Context:** the MCP-connected line is a **中试线 (pilot line)** — a reduced-scale, instrumented representation of the production biaxial-film process. Its purpose is R&D: we run **designed experiments (DOE)** on it to develop a **production-ready recipe** (a setpoint vector) that meets all performance targets, with confirmed robustness. DOE is the disciplined way to extract maximum process knowledge from the minimum number of (expensive) pilot runs.

---

## 1. Response Variables (Y) — what we are optimizing

The performance of a biaxial film is captured by a fixed set of **responses**. Every campaign locks these at Phase 0 and never changes them mid-campaign.

| Response | Direction | Typical target shape | Measurement |
|---|---|---|---|
| `thickness_mean` | on-target | target ± tolerance (e.g. 12.0 ± 0.22 μm) | online thickness gauge, TD-averaged |
| `thickness_cv` | minimize (≤ max) | ≤ max (e.g. ≤ 1.55%) | CV across TD profile |
| `birefringence_mean` | on-target | target ± tolerance | online birefringence |
| `birefringence_cv` | minimize (≤ max) | ≤ max | CV across profile |
| `transmittance`* | on-target / ≥ min | product-specific | haze/transmittance (if applicable) |

\* product-dependent. Product-specific targets come from `product_target.json`.

**Rule:** the team never conflates responses. A multi-response optimum must satisfy ALL of them simultaneously (see §6 desirability).

## 2. Process Factors (X) — the experimental levers

The candidate factor set is the pilot line's **writable parameters** (from `film_line_list_writable_parameters`). Typical biaxial-film factors:

- `extruder_speed`, `melt_temp`, `casting_roll_temp` — extrusion / casting
- `md_draw_ratio`, `md_zone_temp` — machine-direction stretching
- `td_draw_ratio`, `td_zone_1_temp`, `td_zone_2_temp` — transverse-direction stretching
- `heatset_temp`, `relaxation_ratio` — heat-setting / stress relaxation
- `line_speed`, `winder_tension` — line transport / winding

Each factor has a **safety range [min, max]**, a **max delta per action**, and a **ramp limit** (from `product-catalog.mjs` / `safety_limits`). These bound the experimentally explorable region. The factor ranges for a campaign are chosen at Phase 0, INSIDE the safety envelope.

## 3. The 4-Phase Sequential DOE Campaign

Real process development is **sequential**: each phase's analysis decides the next phase's design. Do not skip phases. Do not run a phase without a written, reviewed design matrix.

```
 Phase 0            Phase 1             Phase 2              Phase 3            Phase 4
 FRAME      →     SCREEN       →    CHARACTERIZE     →     OPTIMIZE     →    CONFIRM
 ───────           ───────             ──────────            ─────────           ────────
 lock Y/X     fractional          response surface        multi-response       replicates at
 budget       factorial / PB      CCD or Box-Behnken      desirability opt     predicted opt
 MSA          2-level + center    2nd-order model         predicted recipe     robustness S/N
                                  ANOVA + LOF                                  hold-window
              vital few X?  ──►   model adequate?  ──►    opt in window? ──►   PASS+robust?
              ◄── rework          ◄── augment/rework      ◄── steepest ascent  ◄── iterate
                                                                                   │
                                                                              FREEZE recipe
```

### Phase 0 — Frame & Define (PI + team)

- Lock the response set Y and each target window (from user goal + `product_target.json`).
- Lock the candidate factor set X and the experimental ranges (inside safety limits, guided by prior knowledge / historical recipes).
- Define the **experimental budget**: max runs, max waste meter, material allowance, campaign wall-clock.
- **Measurement System Analysis (MSA) sanity**: confirm each Y is measured repeatably; note gauge resolution vs tolerance. If a response can't be measured reliably, fix that before spending runs.
- Define **success**: a recipe inside ALL Y windows, confirmed by replicate runs and a robustness check.
- Artifact: `00_frame/campaign_charter.json` (Y, X ranges, budget, success criteria, product grade).

### Phase 1 — Screening (DOE Designer leads)

**Objective:** reduce ~12 candidate factors to the **vital few** that actually move the responses, and detect whether curvature is present (justifying a response-surface phase).

- **Design:** 2-level **Resolution-IV fractional factorial** `2^(k-p)` or **Plackett-Burman**, on all candidate factors.
- Add **3–4 center points** (all factors at mid-level) — these are the only way to detect curvature and to get a first pure-error estimate.
- **Runs:** ~12–20.
- **Analysis (Measurement & Stats):**
  - Effect estimation per factor per response.
  - **Half-normal plot / Pareto / Lenth's method** (effect sparsity) to separate active from inactive effects.
  - **Curvature test**: compare center-point mean vs factorial-point mean — significant curvature ⇒ the response bends ⇒ go to RSM.
- **Stage gate → Phase 2** when: a small set of active factors is identified AND center points indicate curvature.
- **Abort/rework** when: no active factors (ranges wrong, or problem mis-framed), or overwhelming curvature everywhere (region mis-set).

### Phase 2 — Response Surface Characterization (DOE Designer + Stats)

**Objective:** for the vital few factors (typically 3–5), fit a **second-order model** that captures curvature and interactions, so the optimum can be found instead of guessed.

- **Design:** **Central Composite Design (CCD)** (face-centered or rotatable) or **Box-Behnken**, on the vital few factors only. Move the other factors to fixed hold values.
- Include **replicate center points** (≥ 4–5) for a real **pure-error** estimate.
- **Runs:** ~20–30.
- **Analysis (Measurement & Stats):**
  - Fit full quadratic: `Y = β0 + Σβi·xi + Σβii·xi² + Σβij·xi·xj + ε`.
  - **ANOVA**: overall model F-test, per-term p-values.
  - **Lack-of-Fit (LOF) test** vs pure error — the single most important adequacy check.
  - **R² / adjusted R² / predicted R²**; watch gap between adj and pred R² (signals overfitting / unstable model).
  - **Residual diagnostics**: normality, constant variance, independence vs run-order (unmodeled drift).
- **DOE Designer:** build response-surface maps; locate the **stationary point**; check its nature (max / min / saddle via second-order eigenanalysis).
- **Stage gate → Phase 3** when: model is adequate (LOF not significant, adequate R², clean residuals).
- **Rework** when: LOF significant (augment design — e.g. add axial points / star points) or poor fit (add terms or reduce model).

### Phase 3 — Optimization (DOE Designer leads)

**Objective:** find the single setpoint vector that satisfies **all responses simultaneously**, within their target windows.

- **Method:** **desirability function** (Derringer–Suich) — map each response to a 0–1 desirability `d`, combine geometrically into `D = (Π dᵢ)^(1/k)`; maximize `D` over the fitted surfaces, subject to the safety ranges.
- If the current factor region can't reach the targets, perform **steepest ascent** along the gradient of D (or of the binding response), shift the region, and **return to Phase 2** to re-characterize the new region.
- Output: the **predicted optimum recipe** (setpoint vector) with **prediction intervals** on each response.
- **Stage gate → Phase 4** when: predicted optimum falls inside ALL Y windows.
- Else: shift region and iterate.

### Phase 4 — Confirmation & Robustness (PI gates)

**Objective:** prove the predicted optimum actually delivers, repeatably, and tolerates small perturbations.

- **Confirmation runs:** ≥ 3 replicate runs at the predicted optimum. Each response mean must be (a) within its target window AND (b) within the model's prediction interval. This catches model bias.
- **Robustness check:** small ±δ perturbations around the optimum on the most sensitive factors; responses must stay in spec. This is the Taguchi-style signal-to-noise view — a good recipe is one that is **insensitive** to small disturbances, not just optimal at a point.
- **Hold-window:** ≥ k consecutive confirmation runs all PASS, with no deterioration trend.
- **Stage gate → FREEZE** when: confirmation PASS + robustness OK + hold confirmed.
- Else: diagnose — is it model error (return to Phase 2/3)? measurement drift? line drift? — and iterate.

**Frozen recipe** = the campaign deliverable: a setpoint vector + its predicted/confirmed responses + the evidence chain, ready for production transfer.

---

## 4. DOE Discipline (non-negotiable)

These are what separate a real DOE from "trying parameters":

1. **Randomization.** Run order is randomized. Time-drift, warm-up, and ambient changes must not masquerade as factor effects. The Trial Execution Lead runs in the randomized order; never the matrix order.
2. **Replication.** Center-point replicates give pure error; confirmation replicates give confidence. A single run is an anecdote, not a data point.
3. **Blocking.** When a known nuisance varies (raw-material lot, session/day, ambient), block on it so its variance is separated from factor effects.
4. **Center points.** Always include them. They detect curvature (cheaply) and estimate pure error — without them the LOF test is impossible.
5. **Confounding / alias awareness.** In screening, know the alias structure of the fractional design. A resolution-IV design keeps main effects clear of 2-factor interactions, but 2FI's alias each other — don't over-interpret a single alias chain; resolve it in Phase 2.
6. **Steady-state measurement.** A run is measured only after the pilot line has settled (`film_line_run_until_stable`). Transient data is noise and invalidates the response.
7. **Run-to-run reset.** Between runs, the line returns to a defined baseline (rollback) so each run starts from a comparable state — otherwise the previous run's setpoint contaminates the next.
8. **Deviation logging.** Any anomaly during a run (alarm, slow settle, gauge glitch) is recorded. A run with an unexplained deviation is **flagged**, not silently kept — it can bias the whole model.

## 5. Role Responsibilities (DOE mapping)

| Role | DOE hat | Owns | Never does |
|---|---|---|---|
| **Orchestrator** | Principal Investigator (PI) / Campaign Director | campaign roadmap, stage-gate decisions, budget, final accountability | design matrices, statistical analysis, setpoint writes |
| **R&D** | DOE Designer / Process-Development Scientist | design matrices, factor space, model building, optimum prediction, sequential strategy | writes setpoints, declares PASS without stats |
| **Quality** | Measurement & Statistical-Analysis Lead | MSA, response measurement, ANOVA, effect/curvature/LOF tests, significance vs practicality, evidence for gates | writes setpoints, picks the design |
| **Process** | Pilot-Line Trial-Execution Lead | run-by-run MCP setpoint execution in randomized order, stabilization, run-to-run reset, response collection, deviation logging | picks the design, declares model adequacy |

The three expert roles **cross-validate** each other: Quality's analysis must match what R&D's model predicts; Process's observed run responses must match Quality's measurements; any disagreement is investigated before the campaign advances.

## 6. Desirability & Multi-Response Optimization (Phase 3 reference)

Map each response to an individual desirability `dᵢ ∈ [0,1]`:

- **Nominal-the-best** (e.g. `thickness_mean`): `d = 1` at target, falls to 0 at the tolerance limits.
- **Smaller-the-better** (e.g. `thickness_cv`): `d = 1` at/below max, 0 above.
- **Larger-the-better** (e.g. transmittance): `d = 1` at/above min.

Overall: `D = (d₁ · d₂ · … · dₖ)^(1/k)` (geometric mean — one failing response sinks the whole recipe). Maximize D over the fitted response surfaces. This is how a real team reconciles competing responses instead of tuning one at a time.

## 7. Artifact Contract per Phase

| Phase | By | Artifact | Minimum content |
|---|---|---|---|
| 0 | PI | `00_frame/campaign_charter.json` | Y set + targets, X ranges, budget, success criteria, product grade |
| 1 | R&D | `01_screening/doe_design_001.json` | design type, factor coding, run matrix (coded + actual), center points, randomization order, blocks |
| 1 | Process | `01_screening/trial_<run>/run_log.json` | setpoints applied, run order, settle confirmation, responses, deviations |
| 1 | Quality | `01_screening/doe_analysis_001.json` | effects, active factors (Lenth/Pareto), curvature test, stage recommendation |
| 2 | R&D | `02_rsm/doe_design_001.json` | CCD/BB, axial/star points, center replicates, pure-error DOF |
| 2 | Quality | `02_rsm/doe_analysis_001.json` | full ANOVA, LOF F-test, R² family, residual diagnostics, model-adequacy verdict |
| 3 | R&D | `03_optimize/optimum_001.json` | predicted optimum setpoints, per-response prediction, desirability D, shift recommendation if out-of-window |
| 4 | Process + Quality | `04_confirm/confirmation_001.json` | replicate responses vs targets vs prediction CI, robustness perturbation results, hold-window count |
| gate | PI | `stage_gate_<phase>.json` | decision (advance/iterate/abort), statistical justification, next phase |

## 8. Stage-Gate Criteria (PI enforces)

The PI advances the campaign ONLY when the gate is met with documented statistical evidence from Quality + a reviewed design/plan from R&D:

| Gate | Pass criterion | Fail action |
|---|---|---|
| 0 → 1 | Y/X locked, MSA sane, budget set | re-frame |
| 1 → 2 | active factors identified + curvature present | rework ranges / re-frame |
| 2 → 3 | no LOF, adequate R²/pred-R², clean residuals | augment design or reduce model |
| 3 → 4 | predicted optimum inside all Y windows | steepest-ascent region shift → Phase 2 |
| 4 → FREEZE | confirmation PASS + robustness OK + hold confirmed | diagnose model/measurement/drift → iterate |

No phase advances on a single run, a hunch, or "looks better." Every gate is evidence-based.

## 9. Pilot-Line → Production Transfer Note

A pilot-line recipe is not automatically a production recipe. Before declaring the campaign deliverable, the PI confirms: (a) the recipe is inside all safety limits, (b) it survived the robustness check, (c) the hold-window held. **Scale-up validation on the real production line is out of scope for this digital pilot campaign** — the deliverable is a pilot-confirmed candidate recipe + full evidence chain, flagged for production transfer.
