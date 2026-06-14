# DOE Campaign Framework — Biaxial Film Pilot-Line Recipe Development

> **Single source of truth for the whole optimization team.** Every role (PI, DOE Designer, Measurement & Stats Lead, Trial Execution Lead) reads this before any campaign action and follows it. This is the standard a real 双向拉伸薄膜 R&D team operates to.
>
> **Context:** the MCP-connected line is a **中试线 (pilot line)** — a reduced-scale, instrumented representation of the production biaxial-film process. Its purpose is R&D: we run **designed experiments (DOE)** on it to develop a **production-ready recipe** (a setpoint vector) that meets all performance targets, with confirmed robustness. DOE is the disciplined way to extract maximum process knowledge from the minimum number of (expensive) pilot runs.
>
> **Honesty note on the digital pilot:** the simulator currently *models* thickness, birefringence, and transmittance. Other real optical-film grade responses (haze, heat-shrinkage, tensile/modulus, crystallinity) are documented in the response taxonomy (§1) as **documented-not-yet-modeled** — the DOE optimizes the in-scope responses and the team records the out-of-scope ones so the recipe stays valid the day those sensors come online.

---

## 1. Response Variables (Y) — what we are optimizing

The performance of a biaxial film is captured by a fixed set of **responses**, locked at Phase 0 and never changed mid-campaign. The table below is the **full grade-level taxonomy**; the **scope** column tells the team which the current line can actually measure.

| Response | Direction | Typical target shape | Scope | Measurement |
|---|---|---|---|---|
| `thickness_mean` | on-target | target ± tolerance (e.g. 12.0 ± 0.22 μm) | **modeled** | online thickness gauge, TD-averaged |
| `thickness_cv` | minimize (≤ max) | ≤ max (e.g. ≤ 1.55 %) | **modeled** | CV across TD profile |
| `birefringence_mean` | on-target | target ± tolerance | **modeled** | online birefringence, TD-averaged |
| `birefringence_cv` | minimize (≤ max) | ≤ max | **modeled** | CV across profile |
| `transmittance` | on-target / ≥ min | ≥ min | **modeled** (product-dependent) | haze/transmittance meter |
| `haze` | minimize (≤ max) | ≤ max | documented-not-modeled | haze meter |
| `heat_shrinkage_md` | ≤ max | ≤ max (e.g. ≤ 1.5 % @150 °C) | documented-not-modeled | thermal shrinkage test |
| `heat_shrinkage_td` | ≤ max | ≤ max | documented-not-modeled | thermal shrinkage test |
| `tensile_strength_md` / `_td` | on-target / ≥ min | ≥ min | documented-not-modeled | tensile test |
| `youngs_modulus_md` / `_td` | on-target | target ± tolerance | documented-not-modeled | tensile test |
| `crystallinity` | on-target | target ± tolerance | documented-not-modeled | DSC / density |

\* Product-specific targets come from `product_target.json` (built from the product `target_template`). **Rule:** the team never conflates responses. A multi-response optimum must satisfy ALL in-scope responses simultaneously (see §6 desirability). Out-of-scope responses are recorded on each run so the recipe is defensible the day the sensor exists; they do **not** gate the current campaign.

## 2. Process Factors (X) — the experimental levers

The candidate factor set is the pilot line's **writable parameters** (from `film_line_list_writable_parameters`). Typical biaxial-film factors:

- `extruder_speed`, `melt_temp`, `casting_roll_temp` — extrusion / casting
- `md_draw_ratio`, `md_zone_temp` — machine-direction stretching
- `td_draw_ratio`, `td_zone_1_temp`, `td_zone_2_temp` — transverse-direction stretching
- `heatset_temp`, `relaxation_ratio` — heat-setting / stress relaxation
- `line_speed`, `winder_tension` — line transport / winding

Each factor has a **safety range [min, max]**, a **max delta per action**, and a **ramp limit** (from `product-catalog.mjs` `safety_limits`). These bound the experimentally explorable region; campaign ranges are chosen at Phase 0 **inside** the safety envelope.

### 2.1 Factor changeability — Hard-to-Change (HTC) vs Easy-to-Change (ETC)

This is **the** signature consideration of a real pilot line, and it drives the design and the execution (§3.1, §4). A real line cannot fully randomize 12 factors: thermal parameters take minutes to re-equilibrate, so a completely-randomized design would spend the whole budget waiting for thermal stabilization. Instead every factor is classified by **changeability**:

| Class | Typical factors | Why | Settle time (from `inter_tick_control.json`) |
|---|---|---|---|
| **HTC** (hard-to-change) | `melt_temp`, `casting_roll_temp`, `md_zone_temp`, `td_zone_1_temp`, `td_zone_2_temp`, `heatset_temp` | thermal mass → long re-equilibration | **≥ 480 s** (8 min) per change |
| **ETC** (easy-to-change) | `md_draw_ratio`, `td_draw_ratio`, `relaxation_ratio` | servo/mechanical adjustment, fast but still needs film-local settle | **≥ 360 s** (6 min) |
| **ETC-fast** | `line_speed`, `winder_tension`, `extruder_speed` | direct drive / throughput | **≥ 300 s** (5 min, base) |

**Consequence:** when HTC factors are in a design (almost always), the design is a **split-plot design**, not a completely-randomized one. HTC factors define **whole-plots** (groups of runs held at the same HTC combination); ETC factors are randomized **within** each whole-plot (the sub-plots). This is not a compromise — it is the correct design for the physical reality, and it is how a real team conserves pilot time.

## 3. The 4-Phase Sequential DOE Campaign

Real process development is **sequential**: each phase's analysis decides the next phase's design. Do not skip phases. Do not run a phase without a written, reviewed design matrix.

```
 Phase 0            Phase 1             Phase 2              Phase 3            Phase 4
 FRAME      →     SCREEN       →    CHARACTERIZE     →     OPTIMIZE     →    CONFIRM
 ───────           ───────             ──────────            ─────────           ────────
 lock Y/X     Res-IV split-plot     split-plot CCD /     multi-response       replicates +
 budget       fractional OR DSD     Box-Behnken          desirability opt     Taguchi S/N
 Gage R&R     + center points       2nd-order model      predicted recipe     robustness
 power→n      vital few + curve?    ANOVA + LOF          (2-error-strata)     hold-window
                                  model adequate?        opt in window?      PASS+robust?
              ◄── rework            ◄── augment/rework    ◄── steepest ascent  ◄── iterate
                                                                                   │
                                                                              FREEZE recipe
```

### Phase 0 — Frame & Define (PI + team)

- Lock the response set Y and each target window (from user goal + `product_target.json`). Mark each response in-scope vs documented-not-modeled (§1).
- Lock the candidate factor set X, the experimental ranges (inside safety limits, guided by prior knowledge / historical recipes / §mechanism→factor mapping in `biaxial-film-physics.md`), and the **HTC/ETC classification** (§2.1).
- Define the **experimental budget**: max runs, max waste meter, material allowance, campaign wall-clock. **The budget must respect changeability** — fewer whole-plots ⇒ fewer expensive HTC re-equilibrations.
- **Measurement System Analysis (MSA) — formal Gage R&R.** For each in-scope response, quantify the measurement system: **%R&R** (% of study variation), **%tolerance**, and **ndc** (number of distinct categories, ndc = 1.41·(σ_part/σ_R&R)). Verdict: **<10 % acceptable**, **10–30 % marginal** (note it, accept with caution), **>30 % unacceptable** (fix the measurement before spending runs — a noisy gauge makes every effect non-significant). The Gage R&R also yields the **pure-error standard deviation `σ_pure_error`** that feeds power analysis.
- **Power analysis → run count.** Given `σ_pure_error` (from Gage R&R) and the **minimum effect of practical interest `Δ_min`** (a stated fraction of the target gap — e.g. "we only care about effects that move the response by ≥ ⅓ of the gap"), compute the **replicate count and factorial-run count needed to detect `Δ_min` at power ≥ 0.80, α = 0.05**. The design's run count is then sized by physics, not a rule of thumb. If power says the budget is too small, say so in Phase 0 — don't silently under-power.
- Define **success**: a recipe inside ALL in-scope Y windows, confirmed by replicate runs and a robustness (S/N) check.
- Artifact: `00_frame/campaign_charter.json` (Y targets + scope flags, X ranges + HTC/ETC classes, Gage R&R summary, power-based sizing, budget, success criteria, product grade).

### Phase 1 — Screening (DOE Designer leads)

**Objective:** reduce ~12 candidate factors to the **vital few** that actually move the responses, and detect curvature (justifying a response-surface phase).

- **Design type — choose by goal and budget:**
  - **Resolution-IV split-plot fractional factorial** `2^(k−p)` with HTC factors in whole-plots, ETC in sub-plots — the classic screen. Main effects are clear of 2-factor interactions.
  - **Plackett–Burman** — pure main-effect screen, fewest runs; use only when interaction/curvature is knowingly sacrificed.
  - **Definitive Screening Design (DSD, Jones & Nachtsheim)** — 3-level, ~`2k+1` runs; main effects clear, 2FI clear, **pure-quadratic terms estimable**. Use DSD when you want **curvature detection and second-order insight in a single screening pass** and `k` is moderate (4–8). DSDs are themselves run as split-plots when HTC factors are present.
- **Center points:** add **3–4 center points** (all factors at mid-level) — the only cheap way to (a) detect curvature and (b) get a first pure-error estimate. (With a DSD the center points are structural.)
- **Split-plot structure:** emit whole-plot groups with HTC held constant; randomize sub-plot (ETC) order within each whole-plot; randomize whole-plot order across the session. Record the whole-plot/sub-plot assignment explicitly.
- **Runs:** sized by Phase-0 power analysis (typically 12–20).
- **Analysis (Measurement & Stats):**
  - Effect estimation per factor per response.
  - **Lenth's method / half-normal plot / Pareto** (effect sparsity) to separate active from inactive effects.
  - **Curvature test** (factorial designs): center-point mean vs factorial-point mean — significant curvature ⇒ go to RSM. (A DSD estimates curvature directly per factor.)
  - **Two-error-strata awareness:** in a split-plot, HTC-factor effects are tested against **whole-plot error**; ETC-factor effects against **sub-plot error**. Never pool them into one error term — that is the classic amateur mistake.
- **Stage gate → Phase 2** when: a small set of active factors is identified AND curvature is present.
- **Abort/rework** when: no active factors (ranges wrong, or problem mis-framed), or overwhelming curvature everywhere (region mis-set).

### Phase 2 — Response Surface Characterization (DOE Designer + Stats)

**Objective:** for the vital few factors (typically 3–5), fit a **second-order model** capturing curvature and interactions, so the optimum can be found instead of guessed.

- **Design:**
  - **Split-plot Central Composite Design (CCD)** — factorial cube + axial (star) points + center replicates; HTC factors in whole-plots. Choose α for **rotatability** (`α = (2^k)^(1/4)`) or face-centered (α = 1) when star points would breach safety limits or HTC boundaries.
  - **Box-Behnken** — when corner combinations are unsafe/impractical; sits on a safer shell; also run split-plot when HTC present.
- **Center replicates:** ≥ 4–5 — give the **pure-error** DOF that make the **lack-of-fit (LOF)** test possible. Without them Quality cannot judge adequacy.
- **Runs:** sized by power analysis (~20–30).
- **Analysis (Measurement & Stats):**
  - Fit full quadratic per response: `Y = β0 + Σβi·xi + Σβii·xi² + Σβij·xi·xj + ε`.
  - **ANOVA** with the **correct error stratum per term** (whole-plot error for HTC terms, sub-plot error for ETC terms) — not one pooled error.
  - **Lack-of-Fit F-test vs pure error** — the single most important adequacy check.
  - **R² / adjusted R² / predicted R²**; watch the adj↔pred gap (overfitting / unstable prediction).
  - **Residual diagnostics:** normality, constant variance, independence vs run-order (unmodeled drift) — within and across whole-plots.
- **Mechanism cross-check (mandatory):** every active term must have a physical story (`biaxial-film-physics.md`). A statistically active factor with no mechanism is flagged as a **suspected alias / spurious effect** and resolved before it drives the optimum.
- **DOE Designer:** build response-surface maps; locate the **stationary point**; classify its nature (max / min / saddle via second-order eigenanalysis).
- **Stage gate → Phase 3** when: model adequate (LOF not significant, adequate R²/pred-R², clean residuals, mechanism plausible).
- **Rework** when: LOF significant (augment design — add axial/extra points) or poor fit (add terms or reduce model).

### Phase 3 — Optimization (DOE Designer leads)

**Objective:** find the single setpoint vector that satisfies **all in-scope responses simultaneously**, within their target windows.

- **Method:** **desirability function** (Derringer–Suich, §6) — map each response to 0–1, combine geometrically into `D = (Π dᵢ)^(1/k)`; maximize `D` over the fitted surfaces subject to the safety ranges (and the HTC/ETC whole-plot feasibility).
- If the current region can't reach the targets, perform **steepest ascent** along the gradient of D (or of the binding response), shift the region, and **return to Phase 2**.
- Output: the **predicted optimum recipe** (setpoint vector) with **per-response prediction intervals** (computed on the correct error stratum).
- **Stage gate → Phase 4** when: predicted optimum falls inside ALL in-scope Y windows.
- Else: shift region and iterate.

### Phase 4 — Confirmation & Robustness (PI gates)

**Objective:** prove the predicted optimum actually delivers, repeatably, and tolerates small perturbations (the production reality: a good recipe is **insensitive** to disturbance, not just optimal at a point).

- **Confirmation runs:** ≥ 3 replicate runs at the predicted optimum. Each response mean must be (a) within its target window AND (b) within the model's prediction interval. A confirmation mean outside its PI reveals **model bias** — a serious finding that returns the campaign to Phase 2/3, not a "try again."
- **Robustness — Taguchi parameter design:** treat the predicted optimum as the **inner (control) array** center and apply an **outer (noise) array** of small ±δ perturbations on the most sensitive factors (largest |effect| or curvature) plus the line's `noise_scale`. Compute the **signal-to-noise ratio**:
  - nominal-the-best: `η = 10·log₁₀(μ² / σ²)`
  - smaller-the-better (CVs): `η = −10·log₁₀( mean(Σyᵢ²) )`
  A production-worthy recipe keeps responses in spec **and** maximizes η across the noise array — a sharp optimum with high sensitivity is a recipe production will struggle with.
- **Hold-window:** ≥ k consecutive confirmation runs all PASS, with no deterioration trend.
- **Stage gate → FREEZE** when: confirmation PASS + robustness (S/N) OK + hold confirmed.
- Else: diagnose — model error (Phase 2/3)? measurement drift? line drift? — and iterate.

**Frozen recipe** = the campaign deliverable: setpoint vector + predicted/confirmed responses + S/N robustness + the evidence chain, ready for production transfer.

---

## 4. DOE Discipline (non-negotiable)

These separate a real DOE from "trying parameters":

1. **Restricted randomization / split-plot.** A real line cannot fully randomize. HTC factors are held constant within whole-plots; ETC factors are randomized within sub-plots; whole-plot order is randomized across the session. The design's whole-plot/sub-plot structure is explicit and the analysis uses the matching error strata (§3.1). *Never* pretend a split-plot is a CRD.
2. **Settling interval — anti-jitter (the line's heartbeat).** **Every parameter change must wait for the type-specific cooldown AND a confirmed stable window before the next change.** Concretely, after any `apply`: (a) wait the parameter-class min-wait (HTC ≥ 480 s, draw-ratio ≥ 360 s, base ≥ 300 s, per `inter_tick_control.json`); (b) confirm ≥ `min_stable_ticks_before_next_action` ticks of stable readings; (c) verify the consecutive-cv-measurement deviation is below the oscillation threshold (`max_consecutive_cv_measurements_deviation = 0.05`). If the line is still oscillating, **wait — do not push the next change.** The split-plot structure reduces the *count* of expensive HTC changes; it never shortens a cooldown.
3. **Replication.** Center-point replicates give pure error; confirmation replicates give confidence. A single run is an anecdote, not a data point.
4. **Blocking.** When a known nuisance varies (raw-material lot, session/day, ambient), block on it so its variance is separated from factor effects.
5. **Center points.** Always include them — they detect curvature cheaply and estimate pure error; without them the LOF test is impossible.
6. **Confounding / alias awareness.** In screening, know the alias structure of the fractional design. A Resolution-IV design keeps main effects clear of 2FI, but 2FI alias each other — don't over-interpret a single alias chain; resolve it in Phase 2.
7. **Steady-state measurement.** A run is measured only after the pilot line has settled (`film_line_run_until_stable` **plus** the §4.2 settling interval). Transient data is noise and invalidates the response.
8. **Run-to-run reset at the right granularity.** Within a whole-plot (HTC fixed), sub-plot runs need only the ETC settling interval — no full thermal reset. **Across** a whole-plot boundary, reset to the campaign baseline and re-stabilize, so the new whole-plot starts from a comparable state.
9. **Deviation logging.** Any anomaly during a run (alarm, slow settle, oscillation, gauge glitch) is recorded. A run with an unexplained deviation is **flagged**, not silently kept — it can bias the whole model.

## 5. Role Responsibilities (DOE mapping)

| Role | DOE hat | Owns | Never does |
|---|---|---|---|
| **Orchestrator** | Principal Investigator (PI) / Campaign Director | campaign roadmap, stage-gate decisions, budget, settling cadence, final accountability | design matrices, statistical analysis, setpoint writes |
| **R&D** | DOE Designer / Process-Development Scientist | design matrices (incl. split-plot), factor space + HTC/ETC, model building, optimum prediction, sequential strategy, mechanism cross-check | writes setpoints, declares PASS without stats |
| **Quality** | Measurement & Statistical-Analysis Lead | Gage R&R, power analysis, response measurement, ANOVA (two-error-strata), effect/curvature/LOF tests, S/N robustness, significance vs practicality | writes setpoints, picks the design |
| **Process** | Pilot-Line Trial-Execution Lead | run-by-run MCP execution in (restricted) randomized order, **settling-interval enforcement**, whole-plot/sub-plot execution, run-to-run reset at whole-plot boundaries, response collection, deviation logging | picks the design, declares model adequacy |

The three expert roles **cross-validate** each other: Quality's analysis must match R&D's model prediction; Process's observed run responses must match Quality's measurements; R&D's active factors must have a mechanism (`biaxial-film-physics.md`). Any disagreement is investigated before the campaign advances.

### 5.1 Permission & Write-Control Matrix (the hard "卡控")

MCP is the hand; the team is the brain. **Only the Process role operates the line.** Quality and R&D are analysis/design experts — they are structurally and procedurally blocked from any setpoint write.

| Capability | Orchestrator (PI) | R&D (DOE Designer) | Quality (Stats Lead) | Process (Trial Exec) |
|---|---|---|---|---|
| Load own / global Skills, reason, produce artifacts | ✅ | ✅ | ✅ | ✅ |
| Read line (state / snapshot / online-quality / ledger / lists) | via main session | via main session | via main session | ✅ via main session |
| Author a setpoint change proposal | ❌ | ❌ (authors **design** artifacts, not setpoint writes) | ❌ (authors **analysis** artifacts) | ✅ **sole author** |
| **Execute a setpoint write (apply/preview-apply/rollback/save/load)** | ❌ never | ❌ **never** | ❌ **never** | ✅ **sole executor** |
| Stage-gate decisions / budget / cadence authority | ✅ | ❌ | ❌ | ❌ |

**Enforcement (defense in depth — the server is the final authority):**
1. **SERVER-SIDE CREDENTIAL-BOUND ROLE GATE (primary, anti-impersonation)**: `simulator/industrial-film-line/server.mjs` authenticates every caller at the HTTP chokepoint. A role claim is valid **only** with its matching secret token (`(x-agent-role, x-role-token)` pair; tokens in `workspace/optimization-tasks/config/role-tokens.json`). An agent **cannot impersonate** another role — claiming `process` while presenting `rd`'s token returns `token_mismatch` 403 and is audit-logged. Writes are allowed **only** for `agent_role='process'` (+ its token), then still pass the five-gate threshold check. Any other authenticated role, no token, or a mismatched token → 403. Reads (`get_*`/`list_*`/`preview_*`) are open to all roles. Every decision is audit-logged (`/sim/access-log`).
2. **EMERGENCY CARVE-OUT**: the `emergency` role (+ its token) is the *only* cross-role write exception, and it is restricted to `/sim/rollback` (a safety stop) — never setpoint writes. Any role may invoke it when the line is deteriorating/alarmed and Process is unavailable.
3. **MCP-layer credential forwarding**: `mcp-server.mjs` adds `agentRole` + `roleToken` params to every tool and forwards them as the `x-agent-role` / `x-role-token` headers.
4. **Cadence enforcer (run-level)**: `workspace/optimization-tasks/lib/doe-cadence.mjs` `applyWithCadence(target, {role})` authenticates as `process` (role + token) and adds the settling cadence (cooldown + stable-window + oscillation + defect) at the orchestration layer.
5. **Procedural red-line**: each role prompt requires passing its OWN role + token and forbids impersonation.

**Each agent's credential**: PI=`'pi'`, R&D=`'rd'`, Quality=`'quality'`, Process=`'process'`, Emergency=`'emergency'`. Each binds to its own token; tokens are NOT shared. Process is the only writer; the others are read-only eyes/brain; emergency is rollback-only. **No role can destroy the line or impersonate another — the server binds identity to a credential and refuses mismatches.** That is the baseline.

## 6. Desirability, Multi-Response Optimization & Robustness (Phase 3/4 reference)

**Desirability (Phase 3).** Map each response to an individual desirability `dᵢ ∈ [0,1]`:
- **Nominal-the-best** (`thickness_mean`, `birefringence_mean`): `d = 1` at target, falls to 0 at the tolerance limits.
- **Smaller-the-better** (`thickness_cv`, `birefringence_cv`, `haze`, `heat_shrinkage_*`): `d = 1` at/below max, 0 above.
- **Larger-the-better** (`transmittance`, tensile): `d = 1` at/above min.

Overall: `D = (d₁ · d₂ · … · dₖ)^(1/k)` (geometric mean — **one failing response sinks the whole recipe**). Maximize D over the fitted response surfaces, subject to the safety ranges and the HTC/ETC whole-plot feasibility. This is how a real team reconciles competing responses instead of tuning one at a time.

**Robustness (Phase 4).** The predicted optimum is the center of a Taguchi **inner array**; an **outer array** of noise (±δ on the sensitive factors + the line `noise_scale`) probes sensitivity. Maximize the **S/N ratio** (§3 Phase 4 formulas). A recipe with high D but low η is a cliff edge — production will struggle; the team prefers the slightly-lower-D, higher-η neighbor if one exists.

## 7. Artifact Contract per Phase

| Phase | By | Artifact | Minimum content |
|---|---|---|---|
| 0 | PI | `00_frame/campaign_charter.json` | Y set + targets + **scope flags**, X ranges + **HTC/ETC classes**, **Gage R&R summary**, **power-based sizing**, budget, success criteria, product grade |
| 1 | R&D | `01_screening/doe_design_<n>.json` | design type (Res-IV/DSD/PB), factor coding, run matrix (coded + actual), center points, **`factor_hardness` + `whole_plot_structure` + `restricted_randomization_order`**, blocks, alias chains |
| 1 | Process | `01_screening/trial_<run>/run_log.json` | setpoints applied, whole/sub-plot position, randomized order, gate result, **`settling_confirmation`**, responses, deviations |
| 1 | Quality | `01_screening/doe_analysis_<n>.json` | **`msa_gage_rr`**, effects, active factors (Lenth/Pareto), curvature test, **two-error-strata note**, stage recommendation |
| 2 | R&D | `02_rsm/doe_design_<n>.json` | split-plot CCD/BB, axial/star points, center replicates, pure-error DOF, α choice |
| 2 | Quality | `02_rsm/doe_analysis_<n>.json` | full ANOVA (per-stratum F-tests), LOF F-test, R² family, residual diagnostics, **mechanism cross-check**, model-adequacy verdict |
| 3 | R&D | `03_optimize/optimum_<n>.json` | predicted optimum setpoints, per-response prediction + PI, desirability D, stationary-point nature, shift recommendation if out-of-window |
| 4 | Process + Quality | `04_confirm/confirmation_<n>.json` | replicate responses vs targets vs prediction CI, **`sn_ratio` + outer-array robustness results**, hold-window count |
| gate | PI | `stage_gate_<phase>.json` | decision (advance/iterate/abort), statistical justification, next phase |

(New fields are additive and backward-compatible.)

## 8. Stage-Gate Criteria (PI enforces)

The PI advances the campaign ONLY when the gate is met with documented statistical evidence from Quality + a reviewed design/plan from R&D:

| Gate | Pass criterion | Fail action |
|---|---|---|
| 0 → 1 | Y/X locked + scoped, **Gage R&R acceptable**, **power-based n within budget**, MSA sane | fix MSA or re-scope / re-budget |
| 1 → 2 | active factors identified + curvature present | rework ranges / re-frame |
| 2 → 3 | no LOF, adequate R²/pred-R², clean residuals, mechanism plausible | augment design or reduce model |
| 3 → 4 | predicted optimum inside all in-scope Y windows | steepest-ascent region shift → Phase 2 |
| 4 → FREEZE | confirmation PASS + robustness (S/N) OK + hold confirmed | diagnose model/measurement/drift → iterate |

No phase advances on a single run, a hunch, or "looks better." Every gate is evidence-based.

## 9. Settling-Interval & Execution Cadence (PI enforces)

The line obeys real thermal/mechanical lag. The PI's cadence rules:

- **No two changes closer than the parameter-class cooldown.** The PI never authorizes a back-to-back change that violates `inter_tick_control.json`.
- **Settle before measure; settle before next change.** A response is read only after `run_until_stable` **and** the settling-interval check (§4.2) both pass. The next change waits on the same check.
- **Split-plot is the cadence's ally.** Holding HTC factors constant within a whole-plot means the 8-minute thermal re-equilibration is paid once per whole-plot, not once per run. The PI credits R&D designs that minimize whole-plot count when budget is tight.
- **Oscillation stops the line.** If `run_until_stable` returns `stable=false` or the cv-deviation threshold trips, the next change does not proceed — Process reports and waits (or rolls back if a response deteriorates).

**Deterministic enforcement.** The entire settling discipline is codified in `workspace/optimization-tasks/lib/doe-cadence.mjs` — the single sanctioned path for any setpoint change (`applyWithCadence`). It enforces the cooldown gate, the re-anchoring ramp, `run_until_stable`, the 3-read oscillation detector, and a gross-defect check, using `inter_tick_control.json` as the single source of truth. **Two-tier rollback**: a gross swing / serious defect / unstable / alarm rolls back *immediately* and waits the cooldown before continuing ("很大波动或严重缺陷 → 立刻回滚, 等待后继续"); a normal post-change settle transient does *not* roll back — the change holds and the next action simply waits its cooldown ("调整一定时间再做下一次优化"). This is the user's hard constraint, made executable and tested.

## 10. Pilot-Line → Production Transfer Note

A pilot-line recipe is not automatically a production recipe. Before declaring the campaign deliverable, the PI confirms: (a) the recipe is inside all safety limits, (b) it survived the robustness (S/N) check, (c) the hold-window held, (d) documented-not-modeled responses are noted as transfer risks. **Scale-up validation on the real production line (thermal mass, web width, line speed, residence time, tenter-clip dynamics) is out of scope for this digital pilot campaign** — the deliverable is a pilot-confirmed candidate recipe + full evidence chain, flagged for production transfer.
