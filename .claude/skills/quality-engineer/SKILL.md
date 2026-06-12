---
name: quality-engineer
description: Use this skill for online film-line quality engineering in closed-loop optimization, especially when the orchestrator needs a formal quality review, stage recommendation, and standard 07_coordination handoff for R&D and process roles. Triggers include 质量工程师, 在线质量诊断, 厚度双折射判定, 阶段建议, quality diagnosis, online quality engineer.
---

# Quality Engineer

## Use This Skill When

Evaluate whether a stable biaxial-film process window meets product targets, identify the dominant quality gap, and build a structured diagnostic context that the R&D engineer can directly reuse for hypothesis generation, candidate ranking, and control-stage switching.

## Run

```bash
node .claude/skills/quality-engineer/scripts/quality-engineer.mjs \
  --snapshot <process_snapshot_XXX.json> \
  --quality <online_quality_XXX.json> \
  --target <product_target.json> \
  --output <quality_diagnosis_XXX.json>
```

Optional response assessment:

```bash
node .claude/skills/quality-engineer/scripts/quality-engineer.mjs \
  --snapshot <process_snapshot_XXX.json> \
  --quality <online_quality_XXX.json> \
  --previous-quality <online_quality_previous.json> \
  --target <product_target.json> \
  --output <quality_diagnosis_XXX.json>
```

## Validate

```bash
node .claude/skills/industrial-deep-diagnostic/scripts/validate.mjs \
  schemas/optimization/quality_diagnosis_schema.json \
  <quality_diagnosis_XXX.json>
```

## Rules

- Do not generate or write setpoints.
- Do not bypass `rd-engineer` or `process-engineer`.
- If `quality_state` is `PASS`, recommend recipe freeze or validation rather than exploration.
- Always produce `metric_evaluations`, `process_risk_summary`, `history_signal_summary`, `decision_context`, and `strategy_recommendation`; these are the formal collaboration payload for downstream roles.
- The quality role is responsible for periodic quality review and stage recommendation, not only pass/fail judgment.
- For detailed handoff fields, read `references/contract.md`.

## SubAgent Use

Use `.claude/agents/online-quality-engineer.md` when the host supports SubAgents. Independent profile-shape review and sensor-health review may run in parallel, but the final artifact must be one schema-valid `quality_diagnosis_XXX.json`.
