---
name: rd-engineer
description: Use this skill for R&D process-development planning in online biaxial-film optimization, especially when the orchestrator needs stage-aware parameter strategy in explore, exploit, or recover mode. It reads quality diagnosis, process snapshots, online metrics, targets, and campaign history to produce a schema-valid optimization plan and ranked lever set. Triggers include 研发工程师, 工艺研发方案, DOE策略, 参数优化方案, R&D optimization plan.
---

# R&D Engineer

## Use This Skill When

Convert quality evidence, response history, process physics, and current control stage into the next optimization hypothesis and a ranked candidate-parameter plan that the process engineer can execute safely.

## Run

```bash
node .claude/skills/rd-engineer/scripts/rd-engineer.mjs \
  --diagnosis <quality_diagnosis_XXX.json> \
  --snapshot <process_snapshot_XXX.json> \
  --quality <online_quality_XXX.json> \
  --target <product_target.json> \
  --history <campaign_ledger.jsonl> \
  --output <rd_optimization_plan_XXX.json>
```

`--history` is optional, but use it whenever available to avoid repeating ineffective or worsening moves.

## Validate

```bash
node .claude/skills/industrial-deep-diagnostic/scripts/validate.mjs \
  schemas/optimization/rd_optimization_plan_schema.json \
  <rd_optimization_plan_XXX.json>
```

## Rules

- Propose optimization intent only; never write equipment setpoints.
- Prefer one primary lever per iteration unless explicitly running a multi-factor DOE.
- Include a falsifiable `hypothesis`, `success_criteria`, and `stop_rules`.
- Rank candidate levers using current diagnosis plus `campaign_ledger.jsonl` response memory when available.
- Always emit `control_mode`, `plan_rationale`, `review_focus`, `strategy_guidance`, and per-candidate `priority_score` / `rationale` / `evidence`.
- Do not mark a production recipe releasable from online proxies alone.
- For detailed handoff fields, read `references/contract.md`.

## SubAgent Use

Use `.claude/agents/online-rd-engineer.md` when SubAgents are available. History-response review, physical-plausibility review, and candidate screening may run in parallel; merge them into one schema-valid `rd_optimization_plan_XXX.json`.
