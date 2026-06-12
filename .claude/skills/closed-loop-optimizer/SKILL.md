---
name: closed-loop-optimizer
description: Use this skill as the single entrypoint for product-aware, team-based online closed-loop optimization of a biaxial film line. It selects the product/material grade, creates a task-specific workspace, routes the user goal into a three-agent team (quality / R&D / process), runs until the goal is reached or termination conditions fire, and persists the best recipe plus all evidence in the task folder. Triggers include 在线闭环优化, 自动调参平台, 黑盒产线优化, 最佳工艺参数, 多Agent协同优化, 团队协同优化, 产品recipe开发, PET/PPAT/PMMA/PVA recipe, closed-loop optimizer.
---

# Closed-Loop Optimizer

## Use This Skill When

Use this skill whenever the user provides a natural-language optimization goal and wants the system to keep working until the goal is met. The skill is the only entrypoint; it reads the goal and optional product/material grade, normalizes it into a unified goal request, creates a task folder, writes product-aware team briefs for quality / R&D / process, and then starts the team-based closed-loop campaign through shared artifacts and team messages.

Team roles:

- Quality Agent: diagnose quality state, stage recommendation, and risk.
- R&D Agent: produce stage-aware optimization strategy and ranked levers.
- Process Agent: turn the plan into approval-aware proposals and MCP execution artifacts.

## Team Entry

Recommended command:

```bash
npm run optimize:team -- --product-grade PMMA_FILM_GRADE_A --goal-text "请完成对 PMMA 产线的优化：使得双折射波动下降10%，并输出最终recipe"
```

Claude Agent SDK team command:

```bash
npm run optimize:claude-sdk -- --product-grade PMMA_FILM_GRADE_A --goal-text "请完成对 PMMA 产线的优化：使得双折射波动下降10%，并输出最终recipe" --max-iters 12
```

Or run the underlying team campaign directly:

```bash
node .claude/skills/closed-loop-optimizer/scripts/run-team-campaign.mjs \
  --goal-text "请完成对产线的优化：使得双折射波动下降10%，并输出最终recipe" \
  --product-grade PET_FILM_GRADE_A \
  --base-dir workspace/optimization-tasks \
  --max-iters 12 \
  --seed 20260610
```

The command is the deterministic AgentTeam runtime for this repository. It creates the team workspace, writes role inbox messages, runs the outer strategy cycle and inner process micro-tune cycle, applies approved MCP/adapter actions, records every trial, and writes final recipe outputs.

The SDK command is the preferred Claude-native entry when Claude Code is available. It registers the project agents from `.claude/agents/` as SDK `AgentDefinition`s, starts the main thread as `closed-loop-optimization-orchestrator`, enables the `closed-loop-optimizer` skill, and asks the orchestrator to invoke the three teammate subagents through the Agent tool before running the same auditable campaign command.

Runtime selection reference:

- Use `claude_sdk` when Claude Code / Claude Agent SDK is available and you want the most native AgentTeam entry.
- Use `team_claude_cli` when each quality / R&D / process role should use Claude structured reasoning during the campaign loop.
- Use `team_deterministic` for stable acceptance tests and reproducible CI-style verification.
- Use `single_campaign` only for low-level campaign debugging; it is not the full Teamwork mode.

The full runtime matrix and Teamwork contract are documented in `docs/closed-loop-optimizer-runtimes-and-teamwork.md`.

Supported simulated products are `PET_FILM_GRADE_A`, `PPAT_FILM_GRADE_A`, `PMMA_FILM_GRADE_A`, and `PVA_FILM_GRADE_A`. Legacy `BOPET_NEW_GRADE_A` maps to `PET_FILM_GRADE_A`. Product selection changes baseline recipe, writable parameter limits, target template, hidden simulation response, historical recipe memory, and AgentTeam brief context.

Every task gets its own workspace under `workspace/optimization-tasks/<task-id>/`.
The task workspace includes:

- `goal_request.json`
- `orchestrator_goal_request.json`
- `product_target.json`
- `product_context` and `product_database_ref` inside the goal/target artifacts
- `team/department_briefs.json`
- `team/handoffs/*.md`
- `campaigns/<campaign-id>/`
- `outputs/final_recipe.json`

After a team run, validate the workspace itself:

```bash
node scripts/optimization/validate-team-workspace.mjs --task-dir <task_dir>
```

Single-run command entry:

```bash
npm run optimize:line -- --product-grade PPAT_FILM_GRADE_A --goal-text "请完成对 PPAT 产线的优化：使得厚度波动下降8%，并输出最终recipe"
```

Equivalent project shortcut:

```bash
npm run opt:campaign:demo
```

## MCP Tool Mode

When the host exposes `.mcp.json`, use the `industrial-film-line-sim` MCP server for live simulated-line actions:

- `film_line_run_until_stable`
- `film_line_list_products`
- `film_line_get_snapshot`
- `film_line_get_online_quality`
- `film_line_preview_proposal`
- `film_line_apply_proposal`
- `film_line_rollback`
- `film_line_save_candidate_recipe`

For local smoke verification:

```bash
npm run sim:mcp:smoke
```

## Validate Campaign

```bash
node .claude/skills/closed-loop-optimizer/scripts/validate-campaign.mjs \
  --run-dir <campaign_run_dir>
```

## Orchestration

- The entry skill first normalizes the user goal, then creates a department-style team workspace, then launches the campaign runner.
- Product/material grade is first-class state. It must be present in `goal_request.json`, `product_target.json`, `team/department_briefs.json`, `run_summary.json`, and `outputs/final_recipe.json`.
- The team lead writes `team/inbox/<role>/intake_brief.json` for each role and appends lifecycle events to `team/team_messages.jsonl`.
- `quality-engineer` writes `02_quality/quality_diagnosis_XXX.json` with metric-level gap analysis, process risk, response/history context, and stage recommendation.
- `rd-engineer` writes `03_rd_plan/rd_optimization_plan_XXX.json` with stage-aware ranked levers, plan rationale, and review focus.
- `process-engineer` writes `04_execution/parameter_delta_proposal_XXX.json` and `safety_gate_result_XXX.json` while preserving execution intent, control mode, and guardrails.
- `07_coordination/` is the mandatory handoff protocol layer and includes quality review, R&D brief, process brief, strategy state, approval packet, coordination index, best recipe memory, and executive summary.
- `08_trial_evidence/trial_XXX/` stores the full evidence chain for each experiment.
- The simulator/equipment adapter writes `execution_receipt_XXX.json`, new snapshots, result summaries, and final recipe recommendation.
- Every iteration writes `07_coordination/team_dispatch_plan_XXX.json`; it explains which expert roles act in that iteration, whether R&D strategy is refreshed or carried forward, and what each role is being asked to do.

## Expert Team Mode

Use the project-level Claude Code agents in `.claude/agents/` when native subagent or AgentTeam execution is available:

- `closed-loop-optimization-orchestrator`: team lead and campaign controller.
- `closed-loop-optimization-quality-agent`: quality expert using the `quality-engineer` skill.
- `closed-loop-optimization-rd-agent`: R&D recipe strategist using the `rd-engineer` skill.
- `closed-loop-optimization-process-agent`: process execution expert using the `process-engineer` skill.

Standard trigger hierarchy:

1. Claude Code experimental Agent Teams, when the host exposes TeamCreate / TaskCreate / SendMessage style tools.
2. Claude Agent SDK subagents via `npm run optimize:claude-sdk`, using `agent='closed-loop-optimization-orchestrator'` and project `agents` definitions.
3. Deterministic file-bus AgentTeam via `npm run optimize:team`, preserving the same artifacts and validation contract.

The deterministic runtime implements the same contract through files when native AgentTeam is not available. The team behaves as:

- Outer strategy cycle: Quality publishes quality evidence, then R&D publishes the product-aware strategy.
- Inner process cycle: Process executes multiple bounded micro-tunes under the active R&D strategy.
- Replan trigger: no progress, repeated rejection, repeated worsening, safety gate block, or explicit quality/R&D/process request.
- Completion: freeze the best observed recipe only after target reach plus hold-window confirmation, otherwise preserve the best recipe and the evidence for the next cycle.

## Team Message Protocol

Every formal AgentTeam message must be a schema-like JSON object with:

- `protocol_version`, `message_id`, `role`, `from`, `to`, `stage`, `purpose`, `summary`
- `inputs`, `outputs`, `risks`, `next_action`, `artifact_refs`
- `payload` containing role-specific structured content

Message routing is fixed:

- Quality sends diagnosis and stage advice to R&D, Process, and Team Lead.
- R&D sends plan and lever strategy to Process, Quality, and Team Lead.
- Process sends proposal, safety/approval state, and execution receipt references back to Quality, R&D, and Team Lead.
- Any role may request work from another role through `requested_actions`, `requires_response`, and `reply_to_message_id`.
- Supported request purposes include `request_quality_review`, `request_rd_replan`, `request_process_revision`, `request_hold_validation`, and `role_response`.

Never rely on hidden chat context for role coordination. If another role needs to know it, write it into `team/inbox`, `team/team_messages.jsonl`, `07_coordination`, or `08_trial_evidence`.

## Completion Contract

A successful team optimization must leave:

- `task_summary.json`
- `best_recipe.json`
- `outputs/final_recipe.json`
- `team/handoffs/final.md`
- `campaigns/<campaign-id>/run_summary.json`
- `campaigns/<campaign-id>/07_coordination/best_recipe_memory.json`
- `campaigns/<campaign-id>/08_trial_evidence/trial_XXX/`

If the target is reached, stop and freeze the best observed recipe. If the target is not reached, still output the best observed recipe, stop reason, evidence, and recommended next action.

## Rules

- Do not let an LLM write PLC tags directly.
- Keep deterministic safety gates outside the LLM.
- Semi-auto mode requires approval gating before write execution.
- Keep best-observed recipe memory synchronized with rollback baseline so later proposals can safely inherit the current best-known recipe.
- Never mix product contexts. A PMMA/PVA/PPAT optimization must not reuse PET target windows, safety limits, or final recipe metadata.
- Prefer artifact-driven collaboration over implicit prompt memory: diagnosis context, strategy state, approval packet, ranked planning rationale, and execution intent must be written into artifacts.
- Treat the user request as the top-level product objective, not as an instruction to tune one metric in isolation.
- Continue across strategy cycles until the goal is reached or configured governance limits fire. Safety rejection, repeated worsening, or no progress should first trigger replanning/recover unless the hard stop limit is reached.
- For real-line migration and hook boundaries, read:
  - `references/orchestration-contract.md`
  - `references/real-line-adapter-contract.md`
  - `references/semi-auto-governance.md`
  - `references/coordination-protocol.md`
  - `references/goal-request-contract.md`
  - `references/team-orchestration.md`
  - `references/product-recipe-development.md`

## SubAgent Use

Use `.claude/agents/closed-loop-optimization-orchestrator.md` for the campaign controller. It may dispatch `closed-loop-optimization-quality-agent`, `closed-loop-optimization-rd-agent`, and `closed-loop-optimization-process-agent` as the team roles.

For Claude Agent SDK execution, use `scripts/optimization/run-claude-sdk-skill.mjs`. It loads `.claude/agents/*.md`, registers them as SDK subagents, sets `forwardSubagentText=true`, enables `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, and asks the orchestrator to trigger each teammate by `subagent_type`. If the host does not provide native AgentTeam execution, use the deterministic `npm run optimize:team` runtime; it implements the same team contract through files, role messages, and campaign artifacts.
