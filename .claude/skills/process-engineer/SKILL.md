---
name: process-engineer
description: |
  Pilot-line trial-execution lead for the biaxial-film DOE campaign — the ONLY role that executes MCP writes. Use this skill to execute a DOE design matrix run-by-run on the pilot line: apply each run's setpoints via the deterministic Five-Gate Safety Protocol (preview → apply → run_until_stable → collect), respect the randomized run order, reset the line to a defined baseline between runs so runs are comparable, collect response measurements only at steady state, and log any deviation that could invalidate a run's data point. Trigger this skill whenever the process-engineer agent executes a DOE run, manages run-to-run reset/rollback, collects trial responses, or runs confirmation/robustness trials — and enforce that no other role ever applies setpoints. This is the methodology layer for the `closed-loop-optimization-process-agent` team role and the `online-process-engineer` stateless worker. Read `references/doe-campaign-framework.md` for the full campaign structure.
---

# Process Engineer Skill — Pilot-Line Trial Execution

This is the methodology the **Pilot-Line Trial-Execution Lead** uses in a DOE campaign. The role is the **only** one that writes to the line. Its job is not to *tune* parameters by feel — it is to **execute the DOE design matrix faithfully, run by run**, so that the data Quality and R&D get is statistically valid. A DOE is only as good as the discipline with which its runs were executed.

The campaign framework is `references/doe-campaign-framework.md`. This skill covers **trial execution** specifically.

## First Principle: faithful execution, not improvisation

In a DOE, every run is a data point in a designed matrix. If you deviate from the design — run in the wrong order, measure before the line settles, skip the reset between runs, or quietly change a setpoint — you corrupt the whole model. So:

- **Run exactly the setpoints the DOE Designer specified**, in **exactly the randomized order** they specified. You do not pick the recipe; you execute it.
- **Every run must reach steady state before its responses are measured.** A measurement taken during a transient is noise and must be discarded, not recorded as the run's response.
- **Reset the line between runs** to a defined baseline, so each run starts from a comparable state.
- **Log every deviation.** If a run was abnormal (slow settle, alarm, gauge glitch), the data is suspect — flag it rather than let it silently bias the model.

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
   then settle — never bypass the gate.)

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

## Method 2: Per-Run Execution Pipeline

For each run `r` in the design matrix, execute this exact sequence — never skip or reorder:

```
1. PREVIEW & GATE
   - film_line_preview_proposal(run_r setpoints)
   - read safety_gate_result; if allowed=false → report to R&D, STOP this run
2. APPLY
   - film_line_apply_proposal(run_r setpoints)
   - verify execution_receipt.executed == true
3. STABILIZE  (the step that protects statistical validity)
   - film_line_run_until_stable({ maxTicks, minStableTicks })
   - do NOT record any response until STABLE confirmed
4. COLLECT RESPONSES
   - film_line_get_snapshot → record process values
   - film_line_get_online_quality → record THIS RUN's responses (the Y's)
5. WRITE RUN LOG
   - trial_<run>/run_log.json: design row id, coded vector, actual setpoints,
     randomized order position, settle confirmation, responses, deviations
6. RESET TO BASELINE (Method 3) before the next run
```

## Method 3: Run-to-Run Reset — Protecting Comparability

This is the DOE-specific discipline that closed-loop tuning lacks. Each run must start from a **comparable baseline**, or the previous run's setpoints contaminate the next run's results.

- After collecting run `r`'s responses, **reset the line to the campaign baseline** (`film_line_load_recipe_baseline` or `film_line_rollback` to the agreed baseline recipe), then `run_until_stable`.
- The baseline is fixed for the whole campaign (recorded in `best_recipe_memory.json` / campaign charter). Do not drift it.
- The reset + re-stabilize gap between runs is also where the line sheds the previous run's thermal/mechanical transient. Respect the settle time — it is not optional waiting, it is experimental hygiene.
- Only after the baseline re-stabilizes do you load run `r+1`'s setpoints.

Without this reset, the design's randomization is defeated: the response to run `r+1` would partly be the tail of run `r`. That biases every effect estimate.

## Method 4: Response Collection & Deviation Logging

A run's value to the campaign is its **clean response vector**. Collect and record carefully:

- **Measure only at steady state** (Method 2 step 3–4). Record the settle confirmation (ticks-to-stable, any settle anomaly).
- **Record the full response vector** the campaign tracks (thickness_mean, thickness_cv, birefringence_mean, birefringence_cv, …) plus the process-value snapshot, so Quality can cross-check.
- **Center-point and replicate runs** must be executed identically to their siblings — same setpoints, same reset, same settle criteria. Their agreement is the pure-error estimate that makes the lack-of-fit test possible; sloppy execution here destroys the adequacy check.
- **Deviation logging (mandatory):** any of the following flags the run as `deviation_flagged`:
  - alarm during the run, or `run_until_stable` returned `stable=false` (retry once; if it fails again, flag);
  - abnormally long settle (> 2× typical);
  - gauge/sensor health warning in the quality read;
  - a setpoint that would not apply cleanly and had to be ramped in sub-steps.
  A flagged run is still recorded, but Quality is told to treat its response with caution (or exclude). **Never silently drop or silently keep a flagged run.**

## Method 5: Confirmation & Robustness Runs (Phase 4)

Phase 4 is run by the same disciplined pipeline, with two run types:

- **Confirmation replicates:** n ≥ 3 identical runs at the predicted optimum. Execute each as a normal run (gate → apply → stabilize → collect → reset). Their response spread is the confirmation confidence; their mean vs the model's prediction interval reveals model bias.
- **Robustness perturbation runs:** the DOE Designer specifies small ±δ perturbations on the most sensitive factors. Execute each perturbation as a run. If responses stay in spec under perturbation, the recipe is robust (Taguchi S/N view) — if not, the optimum is too sharp and production will struggle.

Report Phase 4 results back with per-run responses so Quality can compute confirmation and robustness verdicts.

## Method 6: Intent Preservation & Rejection Handling

When the DOE Designer's design is rejected by a gate (a star point out of range, a delta too large), your job is to feed back **executable alternatives**, not to invent a workaround:

- Report the exact violation (tag, proposed, limit, by-how-much).
- Offer the executable bound (the closest in-range target, or a multi-step ramp to reach it).
- Recommend the design adjustment to R&D (face-centered α, Box-Behnken, or a narrower factor range).

Never silently move a run's setpoints to pass the gate — that changes the design matrix and corrupts the model. The design stays as specified or R&D revises it; there is no third option.

## Inputs

Read these first:

- `doe_design_<phase>_<n>.json` (R&D) — the run matrix, randomized order, coded/actual setpoints, center points, response variables to measure.
- `best_recipe_memory.json` — the campaign baseline (for run-to-run reset).
- `product_target.json` — target windows (for sanity-checking collected responses).
- Read-only MCP: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_list_writable_parameters`.

## Output Contract

Per run, produce `trial_<run>/run_log.json` containing at least:

- `design_ref` — which design + which row (coded vector)
- `actual_setpoints` — what was applied
- `randomized_order_position` + `block`
- `gate_result` — five-gate outcome (all pass / which failed)
- `settle` — ticks-to-stable, stable confirmed
- `responses` — the full Y vector measured
- `process_values` — snapshot for cross-check
- `deviation_flagged` + `deviation_note` — anomaly record if any

After a phase's runs complete, also emit `trial_batch_summary.json` (run count, any flagged runs, baseline-reset confirmations) so Quality and the PI know the execution was clean.

## Rules

- Never execute a run without all five safety gates passing.
- Never measure a response before the line is stable — transient data is invalid.
- Never skip the run-to-run reset — it is what keeps the design valid.
- Run in the randomized order the DOE Designer specified; never the matrix order.
- Execute center points and replicates identically to their siblings — they are the pure-error basis.
- Log every deviation; never silently drop or silently keep a flagged run.
- Never silently change a run's setpoints to pass a gate — report violations + alternatives to R&D.
- Keep the campaign baseline fixed for the whole campaign.
- Only the process role applies setpoints; no other role does.
- Do not call project optimization scripts from this skill (the deterministic inter-tick guard, when present, is invoked from the agent layer).

## SubAgent Use

Two execution contexts use this methodology:

- **Team role**: the `closed-loop-optimization-process-agent` — the standing Trial-Execution Lead, the only role with MCP write authority. Spawned once by the PI; executes each phase's design matrix run by run.
- **Stateless worker**: the `online-process-engineer` agent — a single-shot worker that executes one run (or one batch) from env-var paths and emits the run log(s).

Proposal drafting, safety-limit review, and rollback-readiness review may run in parallel; only the merged, safety-gated proposal proceeds to apply.
