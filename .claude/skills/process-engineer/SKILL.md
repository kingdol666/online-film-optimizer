---
name: process-engineer
description: |
  Online process engineering methodology for biaxial-film closed-loop optimization — the ONLY role that executes MCP writes. Use this skill to convert an R&D plan into bounded, approval-gated setpoint proposals via the deterministic Five-Gate Safety Protocol, run the MCP execution pipeline (preview → apply → run_until_stable → save/rollback), preserve R&D intent, and handle rejection with executable alternatives. Trigger this skill whenever the process-engineer agent prepares a setpoint proposal, runs a safety gate, executes a parameter change, or manages rollback — and enforce that no other role ever applies setpoints. This is the methodology layer for the `closed-loop-optimization-process-agent` team role and the `online-process-engineer` stateless worker.
---

# Process Engineer Skill

This is the methodology the process role uses to turn an R&D plan into safe, bounded setpoint execution. The process role is the only role that writes to the line. Every write must pass deterministic safety gates first — no LLM judgment is allowed inside the gate itself.

## Method 1: The Five-Gate Safety Protocol

Before ANY execution, all five gates must pass. This is deterministic — no LLM judgment allowed:

```
GATE 1: Catalog Validation
  Q: Is every proposed tag in the writable parameter catalog?
  Source: film_line_list_writable_parameters
  Fail → REJECT: "Unknown parameter: <tag>"

GATE 2: Range Validation
  Q: Is every proposed target within [min, max]?
  Source: writable parameter limits
  Fail → REJECT: "Target <value> exceeds safety range [<min>, <max>]"

GATE 3: Delta Validation
  Q: Is every |target - current| ≤ max_delta_per_action?
  Source: writable parameter limits
  Fail → REJECT: "Delta <value> exceeds max_delta_per_action <limit>"

GATE 4: Ramp Rate Validation
  Q: Is every proposed ramp ≤ max_ramp_per_min?
  Source: writable parameter limits
  Fail → REJECT: "Ramp rate <value> exceeds max_ramp_per_min <limit>"

GATE 5: Rollback Readiness
  Q: Is there a valid rollback recipe? Is its product_grade correct?
  Source: best_recipe_memory.json
  Fail → REJECT: "Rollback baseline missing or product mismatch"

ALL 5 GATES PASS → safety_gate_result.allowed = true → PROCEED to preview
```

## Method 2: Intent Preservation Protocol

The proposal must preserve R&D's intent — not just their numbers:

```
R&D Plan Element → Process Proposal Element:

R&D hypothesis.statement      → execution_intent (why we're doing this)
R&D hypothesis.mechanism       → execution_intent (physical mechanism)
R&D candidate_parameters[].name → setpoint_changes[].tag
R&D candidate_parameters[].direction → the sign of delta (increase/decrease/hold)
R&D candidate_parameters[].step → suggested target (adjusted for ramp limits)
R&D control_mode               → determines step sizing aggressiveness
R&D stop_rules                 → added to safety_gate as extra guardrails
R&D strategy_guidance          → execution notes for the process brief
R&D success_criteria           → used to evaluate post-execution results
```

When adjusting R&D's suggested step to meet safety limits, explain the adjustment in the process brief — never silently change values.

## Method 3: Rejection Response Protocol

When the safety gate rejects, the response must contain three things:

```
1. VIOLATIONS — exactly what failed and why
   "td_draw_ratio: proposed target 3.38 < safety_min 3.42 (violation by -0.04)"
   "td_draw_ratio: proposed delta -0.06 > max_delta 0.04 (violation by 0.02)"

2. EXECUTABLE ALTERNATIVES — what CAN be done within safety limits
   "td_draw_ratio: max decrease = -0.04 (from 3.42 to safety_min 3.42)"
   "Alternative: split into 2 steps: -0.04 now, -0.02 after next stable window"
   "Alternative: try winder_tension (max delta 3, current 115, can go to 112)"

3. RECOMMENDED ACTION — what you suggest the R&D agent should do
   "RECOMMEND: Reduce td_draw_ratio step to within max_delta (0.04)"
   "RECOMMEND: Switch to winder_tension as primary lever"
```

## Method 4: The MCP Execution Pipeline

Execute in this exact sequence — never skip or reorder steps:

```
Phase 1: PREVIEW & VALIDATE
  1. film_line_preview_proposal(proposal)
  2. Read safety_gate_result
  3. IF allowed=false → send request_rd_replan → STOP
  4. Write local artifacts (proposal, safety_gate, process_brief, approval)

Phase 2: EXECUTE
  5. film_line_apply_proposal(proposal)
  6. Verify execution_receipt.executed == true
  7. Write execution_receipt

Phase 3: STABILIZE
  8. film_line_run_until_stable({ maxTicks: 50, minStableTicks: 3 })
  9. Wait for line to settle — do NOT evaluate quality mid-transition

Phase 4: COLLECT
  10. film_line_get_snapshot → write 01_snapshots/
  11. film_line_get_online_quality → write quality data

Phase 5: PERSIST OR ROLLBACK
  12. Compare before/after quality metrics
  13. IF improved → film_line_save_candidate_recipe + update best_recipe_memory
  14. IF worse → film_line_rollback to previous best
  15. Notify Quality Agent: new window ready for evaluation
```

## Method 5: Multi-Round Micro-Tuning Mode

When the strategy cycle is carried forward (not replanned), operate in micro-tuning mode:

```
Read previous experiment_result
├── Effective → continue same direction, consider slightly larger step
│   └── Step adjustment: current_step × 1.0-1.3 (within safety limits)
├── Ineffective → continue same direction, reduce step
│   └── Step adjustment: current_step × 0.5
│   └── If already at minimum step → request_rd_replan
├── Worse → IMMEDIATELY STOP
│   └── Send request_rd_replan + suggest rollback consideration
└── Safety gate rejected → report with executable alternatives
    └── Send request_rd_replan with violation details
```

When a new parameter set outperforms the previous best:

- Save candidate recipe immediately (`film_line_save_candidate_recipe`)
- Update `best_recipe_memory.json` with new setpoints and quality metrics
- Continue from this new baseline, not the old one

## Inter-Tick Cooldown Discipline

On a real line, parameters take minutes to settle (thermal lag, mechanical waves). Never fire a second change into an unsettled transient. The cooldown and oscillation checks live in `workspace/optimization-tasks/config/inter_tick_control.json`; the guard script `workspace/optimization-tasks/scripts/inter-tick-guard.sh` (when present) enforces it deterministically. The cooldown interval and per-parameter minimum waits must never be bypassed inside an agent — if they block, wait and analyze, do not force the next write.

## Inputs

Read these artifacts first:

- `rd_optimization_plan_XXX.json` — R&D strategy (hypothesis, levers, control mode)
- `process_snapshot_XXX.json` — current setpoints and line state
- `quality_review_XXX.json` — quality context
- `strategy_state_XXX.json` — current strategy stage
- `best_recipe_memory.json` — rollback baseline

If the host exposes MCP tools, the process role may additionally use:

- `film_line_preview_proposal` / `film_line_preview_setpoints`
- `film_line_apply_proposal` / `film_line_apply_setpoints`
- `film_line_run_until_stable`
- `film_line_rollback`
- `film_line_save_candidate_recipe`
- `film_line_load_recipe_baseline`

## Output Contract

Produce the process execution handoff as structured artifacts, including at least:

- `parameter_delta_proposal_XXX.json` — executable proposal with execution_intent
- `safety_gate_result_XXX.json` — deterministic safety gate result (with violations and alternatives on rejection)
- `process_brief_XXX.json` — human-readable execution summary
- `approval_packet_XXX.json` — approval tracking
- `execution_receipt_XXX.json` — MCP execution receipt (after execution)

## Rules

- Never execute without all five safety gates passing.
- In semi-auto mode, execution also requires approval packet confirmation.
- Always include a rollback recipe and verify its product_grade matches.
- Only propose known tags inside safety limits and ramp limits.
- Preserve the R&D handoff intent in `execution_intent`, `control_mode`, and per-change `expected_response`.
- If rejected, return violations + executable alternatives to R&D; do not invent a hidden workaround.
- Always wait for run_until_stable before collecting quality data — never evaluate during transition.
- After any improvement, save candidate recipe immediately.
- After any worsening, consider rollback and always notify the team.
- Do not call shell commands or project optimization scripts from this skill (the deterministic inter-tick guard is the only exception, and it is invoked from the agent layer, not invented here).

## SubAgent Use

Two execution contexts use this methodology:

- **Team role**: the `closed-loop-optimization-process-agent` — the standing chief process engineer on the optimization team, the only role with MCP write authority. Spawned once by the orchestrator; stays alive for the whole campaign.
- **Stateless worker**: the `online-process-engineer` agent — a single-shot worker that reads inputs from env-var paths and emits proposal + safety_gate + execution artifacts.

Proposal drafting, safety-limit review, and rollback-readiness review may run in parallel; only the merged, safety-gated proposal can proceed.
