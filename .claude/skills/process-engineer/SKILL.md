---
name: process-engineer
description: Use this skill for online process engineering in biaxial-film closed-loop optimization, especially when the orchestrator needs approval-gated MCP execution packets, rollback boundaries, and standard 07_coordination handoff artifacts. It converts an R&D optimization plan into bounded setpoint proposals and execution-ready artifacts. Triggers include 工艺工程师, 在线调参, 参数下发, safety gate, setpoint proposal, process engineer.
---

# Process Engineer

## Use This Skill When

Translate a ranked R&D optimization plan into a safety-gated, approval-aware executable parameter delta proposal while preserving the intent, hypothesis, control mode, and guardrails needed by operations.

## Inputs

Read these artifacts first:

- `rd_optimization_plan_XXX.json`
- `process_snapshot_XXX.json`
- `quality_review_XXX.json`
- `strategy_state_XXX.json`
- `best_recipe_memory.json`

If the host exposes MCP tools, the process role may additionally use:

- `film_line_preview_proposal`
- `film_line_apply_proposal`
- `film_line_run_until_stable`
- `film_line_rollback`
- `film_line_save_candidate_recipe`
- `film_line_load_recipe_baseline`

## Output Contract

Produce the process execution handoff as structured artifacts, including at least:

- `parameter_delta_proposal_XXX.json`
- `safety_gate_result_XXX.json`
- `process_brief_XXX.json`
- `approval_packet_XXX.json`
- `execution_receipt_XXX.json` after execution

Optional maintenance helper:

- `scripts/validate-output.mjs <parameter_delta_proposal_XXX.json> <safety_gate_result_XXX.json>`

## Rules

- Never execute without safety gate approval.
- In semi-auto mode, execution also requires approval packet confirmation.
- Always include rollback recipe.
- Only propose known tags inside safety limits and ramp limits.
- Preserve the R&D handoff intent in `execution_intent`, `control_mode`, and per-change `expected_response`.
- If rejected, return violations to R&D; do not invent a hidden workaround.
- Do not call shell commands or project optimization scripts from this skill.
- For detailed handoff fields, read `references/contract.md`.

## SubAgent Use

Use `.claude/agents/online-process-engineer.md` when SubAgents are available. Proposal drafting, safety-limit review, and rollback-readiness review may run in parallel; only the merged, safety-gated proposal can proceed.
