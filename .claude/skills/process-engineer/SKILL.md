---
name: process-engineer
description: |
  Pilot-line trial-execution lead for the biaxial-film DOE campaign — the ONLY role that executes MCP writes. Use this skill to execute a DOE design matrix run-by-run on the pilot line as a split-plot: apply each run's setpoints via the deterministic Five-Gate Safety Protocol (preview → apply → run_until_stable → settle → collect), hold hard-to-change (HTC) factors constant within whole-plots while randomizing easy-to-change (ETC) sub-plot runs inside, enforce the mandatory settling interval (parameter-class cooldown + stable-window + anti-oscillation check) between every change so the line never jitters, reset to the campaign baseline only at whole-plot boundaries so runs are comparable, collect response measurements only at steady state, and log any deviation that could invalidate a run's data point. Trigger this skill whenever the process-engineer agent executes a DOE run, manages run-to-run reset/rollback, collects trial responses, or runs confirmation/robustness trials — and enforce that no other role ever applies setpoints. This is the methodology layer for the `closed-loop-optimization-process-agent` team role and the `online-process-engineer` stateless worker. Read `references/doe-campaign-framework.md` for the full campaign structure.
---

# Process Engineer Skill — Pilot-Line Trial Execution

This is the methodology the **Pilot-Line Trial-Execution Lead** uses in a DOE campaign. The role is the **only** one that writes to the line. Its job is not to *tune* parameters by feel — it is to **execute the DOE design matrix faithfully, run by run, as a split-plot that respects the line's thermal/mechanical lag**, so that the data Quality and R&D get is statistically valid. A DOE is only as good as the discipline with which its runs were executed — and on a real line that discipline is dominated by the **settling interval**: you cannot change a 220 °C heatset and measure 30 seconds later.

The campaign framework is `references/doe-campaign-framework.md` (esp. §2.1 changeability, §4.2 settling interval, §9 cadence). This skill covers **trial execution** specifically.

## First Principle: faithful execution, not improvisation

In a DOE, every run is a data point in a designed matrix. If you deviate from the design — run in the wrong order, measure before the line settles, skip the settling interval, skip the reset at whole-plot boundaries, or quietly change a setpoint — you corrupt the whole model. So:

- **Run exactly the setpoints the DOE Designer specified, in exactly the restricted-randomized order** (whole-plot order, then sub-plot order within each whole-plot) they specified. You do not pick the recipe; you execute it.
- **Every change must be followed by the settling interval.** No back-to-back changes. No measuring during a transient.
- **Every run must reach steady state AND clear the settling-interval check before its responses are measured.**
- **Reset to baseline at whole-plot boundaries** (HTC change), not before every run — within a whole-plot only the ETC settle is needed.
- **Log every deviation.** If a run was abnormal (slow settle, oscillation, alarm, gauge glitch), the data is suspect — flag it rather than let it silently bias the model.

## Method 1: The Five-Gate Safety Protocol (every run, no exceptions)

Before applying ANY run's setpoints, all five gates pass — deterministic, no LLM judgment:

```
GATE 1: Catalog Validation
  Is every tag in the writable parameter catalog?
  Source: film_line_list_writable_parameters
  Fail → REJECT: "Unknown parameter: <tag>"

GATE 2: Range Validation
  Is every target within [min, max]?
  Fail → REJECT: "Target <value> exceeds safety range [<min>, <max>]"

GATE 3: Delta Validation
  Is every |target - current| ≤ max_delta_per_action?
  Fail → REJECT: "Delta <value> exceeds max_delta_per_action <limit>"
  (Note: a DOE star/corner point may legitimately exceed a single-action delta.
   If so, ramp to the target across multiple gated steps within the same run,
   each step respecting the settling interval, then settle — never bypass the gate.)

GATE 4: Ramp Rate Validation
  Is every proposed ramp ≤ max_ramp_per_min?
  Fail → REJECT: "Ramp rate <value> exceeds max_ramp_per_min <limit>"

GATE 5: Rollback Readiness
  Is there a valid rollback recipe with matching product_grade?
  Source: best_recipe_memory.json
  Fail → REJECT: "Rollback baseline missing or product mismatch"

ALL 5 GATES PASS → PROCEED to preview/apply
```

The safety gate is the line's guardian. Even the PI cannot override a gate failure — if a gate blocks, the run is reported back to the DOE Designer to revise the design (e.g. a star point outside range ⇒ switch to face-centered α or Box-Behnken).

## Method 2: The Settling Interval — anti-jitter red line (every change, no exceptions)

**This is the user's hard constraint and the line's heartbeat.** Every parameter change must wait for the line to re-equilibrate before the next action or measurement. Source of truth: `workspace/optimization-tasks/config/inter_tick_control.json`. Enforce, in order, after every `apply`:

```
SETTLE 1: Parameter-class cooldown
  Wait the min_wait for the SLOWEST class changed in this action:
    temperature (melt/casting/zone/heatset) → ≥ 480 s (8 min)
    draw_ratio  (md/td_draw_ratio)           → ≥ 360 s (6 min)
    speed_tension (line_speed/winder_tension/extruder_speed) → ≥ 300 s (5 min, base)
  If a change touches multiple classes, use the longest class cooldown.

SETTLE 2: run_until_stable
  film_line_run_until_stable({ maxTicks, minStableTicks })
  → stable must come back true. stable=false → do NOT measure; retry once;
    if it fails again, flag the run deviation_flagged and consider rollback.

SETTLE 3: Stable-window confirmation
  ≥ min_stable_ticks_before_next_action ticks of consecutive stable readings
  (config: 3 ticks) BEFORE the next change is allowed.

SETTLE 4: Anti-oscillation check
  consecutive cv-measurement deviation < max_consecutive_cv_measurements_deviation
  (config: 0.05). If the response is still swinging (cv deviation > threshold),
  the line has NOT settled — WAIT, do not push the next change.
```

**The settling interval is non-negotiable.** The PI cannot shorten it; budget pressure cannot shorten it. If budget is the binding constraint, R&D reduces the *count* of HTC changes via the split-plot whole-plot structure — the cooldown per change is never cut. This is exactly why split-plot designs exist: holding HTC factors constant within a whole-plot means the 8-minute thermal re-equilibration is paid once per whole-plot, not once per run.

Record the settling outcome on every run log as `settling_confirmation` {cooldown_class, wait_seconds, stable_ticks, cv_deviation_max, oscillation_clear}.

**Deterministic enforcement (not just prose).** This discipline is codified in `workspace/optimization-tasks/lib/doe-cadence.mjs`, which is the single sanctioned path for any setpoint change. `applyWithCadence(target, {campaignId, sourcePlan, cfg})` enforces the full chain: cooldown gate (`time_since_last_change_sec >= required`) → re-anchoring safety-gated ramp → `run_until_stable` (stable must be true) → oscillation detector (3 reads) → gross-defect assessment. **Two-tier rollback (matches the production reality):**

- **Rollback IMMEDIATELY** when: `run_until_stable` returns `stable=false`, an alarm is active, a **gross** oscillation (cv-swing > ~0.4 or mean-swing > ~0.003 — a genuine "很大波动") is detected, or a **serious defect** (e.g. thickness_cv > 2.0) appears. After rollback, wait the cooldown before continuing.
- **Do NOT rollback** for normal post-change settling transients (a mild cv-swing that exceeds the soft real-line threshold but stays well under gross). Instead: the change holds, the response is collected, and the **next** action simply waits its cooldown. This is "调整一定时间再做下一次优化" — the cadence absorbs the settle, it does not panic on routine re-equilibration.

The soft real-line thresholds (`max_cv_swing`/`max_mean_swing` in `inter_tick_control.json`) are logged as warnings; only the gross thresholds (or unstable/alarm/defect) trigger rollback. Tune the gross thresholds only with PI approval.

## Method 3: Split-Plot Per-Run Execution Pipeline

The design is a split-plot (framework §2.1, §3.1). Execute it as such. For each **whole-plot** `W` (an HTC combination), then each **sub-plot run** `r` inside `W`:

```
WHOLE-PLOT BOUNDARY (entering a new HTC combination, or the first whole-plot):
  W0. Reset to campaign baseline (Method 5) + full settling interval.
      Only here — across an HTC boundary — is the full thermal reset paid.
  W1. PREVIEW & GATE the HTC setpoints → apply → settling interval (HTC: ≥480 s).
      The HTC factors are now held for all sub-plot runs in W.

FOR EACH SUB-PLOT RUN r inside W (ETC factors vary, HTC fixed):
  r1. PREVIEW & GATE the ETC setpoints for run r.
      - read safety_gate_result; allowed=false → report to R&D, STOP this run.
  r2. APPLY: film_line_apply_proposal → verify execution_receipt.executed == true.
  r3. SETTLE: settling interval for the ETC classes changed (typically ≥360 s for
      draw ratios, ≥300 s for speed/tension) + run_until_stable + stable-window
      + anti-oscillation check (Method 2). No full thermal reset — HTC is fixed.
  r4. COLLECT RESPONSES:
      - film_line_get_snapshot → record process values.
      - film_line_get_online_quality → record THIS RUN's responses (the Y's).
  r5. WRITE RUN LOG: trial_<run>/run_log.json — design row id, coded vector,
      whole_plot_id, sub-plot position, actual setpoints, restricted-randomized
      order position, gate_result, settling_confirmation, responses, deviations.
  r6. Proceed to next sub-plot run r+1 inside the same whole-plot (no reset).

NEXT WHOLE-PLAN: go to WHOLE-PLOT BOUNDARY (full reset + HTC change).
```

The whole-plot loop is where pilot time is saved and the design's validity is protected: sub-plot runs inside a whole-plot share the same thermal state, so their contrast isolates the ETC effects cleanly against the sub-plot error stratum.

## Method 4: Response Collection & Deviation Logging

A run's value to the campaign is its **clean response vector**. Collect and record carefully:

- **Measure only after the settling interval** (Method 2 steps r3–r4). Record `settling_confirmation` (cooldown class, wait, stable ticks, cv deviation, oscillation clear).
- **Record the full response vector** the campaign tracks (thickness_mean, thickness_cv, birefringence_mean, birefringence_cv, …) plus the process-value snapshot, so Quality can cross-check.
- **Center-point and replicate runs** must be executed identically to their siblings — same setpoints, same whole-plot, same settling, same settle criteria. Their agreement is the pure-error estimate that makes the lack-of-fit test possible; sloppy execution here destroys the adequacy check.
- **Deviation logging (mandatory):** any of the following flags the run as `deviation_flagged`:
  - alarm during the run, or `run_until_stable` returned `stable=false` (retry once; if it fails again, flag);
  - **oscillation not clearing** (cv deviation > threshold persisting) — the settling interval was extended; record how long;
  - abnormally long settle (> 2× the class cooldown);
  - gauge/sensor health warning in the quality read;
  - a setpoint that would not apply cleanly and had to be ramped in sub-steps.
  A flagged run is still recorded, but Quality is told to treat its response with caution (or exclude). **Never silently drop or silently keep a flagged run.**

## Method 5: Run-to-Run Reset — at the Right Granularity

This is the DOE-specific discipline. Reset granularity follows the split-plot:

- **Within a whole-plot (HTC fixed):** sub-plot runs do NOT reset to baseline. They share the held HTC state; only the ETC factors change, and only the ETC settling interval applies. Resetting here would waste thermal-equilibrium time and add noise.
- **Across a whole-plot boundary (HTC change):** reset the line to the campaign baseline (`film_line_load_recipe_baseline` or `film_line_rollback` to the agreed baseline recipe), then `run_until_stable` + settling interval, THEN apply the new HTC combination + HTC settling interval. The new whole-plot must start from a comparable state so the HTC contrast is clean against the whole-plot error stratum.
- The baseline is fixed for the whole campaign (recorded in `best_recipe_memory.json` / campaign charter). Do not drift it.
- The reset + re-stabilize gap across a whole-plot boundary is where the line sheds the previous whole-plot's thermal transient. Respect it — it is not optional waiting, it is experimental hygiene.

Without the boundary reset, the design's whole-plot structure is defeated: the HTC contrast would partly be the tail of the previous whole-plot. That biases every HTC effect estimate (and the whole-plot error stratum).

## Method 6: Confirmation & Robustness Runs (Phase 4)

Phase 4 is run by the same disciplined pipeline, with two run types:

- **Confirmation replicates:** n ≥ 3 identical runs at the predicted optimum. Execute each as a normal run (gate → apply → settling interval → stabilize → collect). Their response spread is the confirmation confidence; their mean vs the model's prediction interval reveals model bias.
- **Robustness / Taguchi outer-array perturbation runs:** the DOE Designer specifies small ±δ perturbations on the most sensitive factors plus the line `noise_scale`. Execute each perturbation as a run (respecting settling intervals — these are real changes). If responses stay in spec and S/N is high under perturbation, the recipe is robust — if not, the optimum is too sharp and production will struggle. Quality computes the S/N.

Report Phase 4 results back with per-run responses so Quality can compute confirmation and S/N robustness verdicts.

## Method 7: Intent Preservation & Rejection Handling

When the DOE Designer's design is rejected by a gate (a star point out of range, a delta too large, a ramp too steep), your job is to feed back **executable alternatives**, not to invent a workaround:

- Report the exact violation (tag, proposed, limit, by-how-much).
- Offer the executable bound (the closest in-range target, or a multi-step ramp to reach it, each step respecting the settling interval).
- Recommend the design adjustment to R&D (face-centered α, Box-Behnken, or a narrower factor range).

Never silently move a run's setpoints to pass the gate — that changes the design matrix and corrupts the model. The design stays as specified or R&D revises it; there is no third option.

## Inputs

Read these first:

- `doe_design_<phase>_<n>.json` (R&D) — the run matrix, `whole_plot_structure`, `restricted_randomization_order`, coded/actual setpoints, center points, `factor_hardness`, response variables to measure.
- `best_recipe_memory.json` — the campaign baseline (for whole-plot-boundary reset).
- `product_target.json` — target windows (for sanity-checking collected responses).
- `workspace/optimization-tasks/config/inter_tick_control.json` — the settling-interval source of truth.
- Read-only MCP: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_list_writable_parameters`.

## Output Contract

Per run, produce `trial_<run>/run_log.json` containing at least:

- `design_ref` — which design + which row (coded vector)
- `whole_plot_id` + `sub_plot_position`
- `actual_setpoints` — what was applied (incl. which were HTC-held vs ETC-varied)
- `randomized_order_position` + `block`
- `gate_result` — five-gate outcome (all pass / which failed)
- `settling_confirmation` — {cooldown_class, wait_seconds, stable_ticks, cv_deviation_max, oscillation_clear}
- `settle` — run_until_stable outcome, stable confirmed
- `responses` — the full Y vector measured
- `process_values` — snapshot for cross-check
- `deviation_flagged` + `deviation_note` — anomaly record if any

After a phase's runs complete, also emit `trial_batch_summary.json` (run count, whole-plot count, settling-interval confirmations, any flagged runs, baseline-reset confirmations at whole-plot boundaries) so Quality and the PI know the execution was clean.

## Rules

- Never execute a run without all five safety gates passing.
- **Never measure a response before the settling interval + stable-window + anti-oscillation check all pass.** The settling interval is the user's hard constraint — no shortcut, not even under PI pressure.
- Run in the **restricted-randomized order** the DOE Designer specified (whole-plot order, sub-plot order within); never the matrix order, never a "fully randomized" order that ignores changeability.
- Reset to baseline **only at whole-plot boundaries**; within a whole-plot, only the ETC settling interval applies.
- Execute center points and replicates identically to their siblings — they are the pure-error basis.
- Log every deviation; never silently drop or silently keep a flagged run.
- Never silently change a run's setpoints to pass a gate — report violations + alternatives to R&D.
- Keep the campaign baseline fixed for the whole campaign.
- Only the process role applies setpoints; no other role does.
- Do not call project optimization scripts from this skill (the deterministic inter-tick guard, when present, is invoked from the agent layer).

## SubAgent Use

Two execution contexts use this methodology:

- **Team role**: the `closed-loop-optimization-process-agent` — the standing Trial-Execution Lead, the only role with MCP write authority. Spawned once by the PI; executes each phase's split-plot design matrix whole-plot by whole-plot.
- **Stateless worker**: the `online-process-engineer` agent — a single-shot worker that executes one run (or one batch) from env-var paths and emits the run log(s).

Proposal drafting, safety-limit review, and rollback-readiness review may run in parallel; only the merged, safety-gated proposal proceeds to apply.
