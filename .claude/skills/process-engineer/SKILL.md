---
name: process-engineer
description: Use this skill for online process engineering in biaxial-film closed-loop optimization, especially when the orchestrator needs approval-gated MCP execution packets, rollback boundaries, and standard 07_coordination handoff artifacts. It converts an R&D optimization plan into bounded setpoint proposals and execution-ready artifacts. Triggers include 工艺工程师, 在线调参, 参数下发, safety gate, setpoint proposal, process engineer.
---

# Process Engineer

## Use This Skill When

Translate a ranked R&D optimization plan into a safety-gated, approval-aware executable parameter delta proposal while preserving the intent, hypothesis, control mode, and guardrails needed by operations.

## Run

```bash
node .claude/skills/process-engineer/scripts/process-engineer.mjs \
  --plan <rd_optimization_plan_XXX.json> \
  --snapshot <process_snapshot_XXX.json> \
  --campaign-id <campaign_id> \
  --iteration <N> \
  --output <parameter_delta_proposal_XXX.json> \
  --safety-output <safety_gate_result_XXX.json>
```

## Validate

```bash
node .claude/skills/industrial-deep-diagnostic/scripts/validate.mjs \
  schemas/optimization/parameter_delta_proposal_schema.json \
  <parameter_delta_proposal_XXX.json>
node .claude/skills/industrial-deep-diagnostic/scripts/validate.mjs \
  schemas/optimization/safety_gate_result_schema.json \
  <safety_gate_result_XXX.json>
```

## Rules

- Never execute without safety gate approval.
- In semi-auto mode, execution also requires approval packet confirmation.
- Always include rollback recipe.
- Only propose known tags inside safety limits and ramp limits.
- Preserve the R&D handoff intent in `execution_intent`, `control_mode`, and per-change `expected_response`.
- If rejected, return violations to R&D; do not invent a hidden workaround.
- For detailed handoff fields, read `references/contract.md`.

## SubAgent Use

Use `.claude/agents/online-process-engineer.md` when SubAgents are available. Proposal drafting, safety-limit review, and rollback-readiness review may run in parallel; only the merged, safety-gated proposal can proceed.
