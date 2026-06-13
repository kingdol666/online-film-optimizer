---
name: closed-loop-optimizer
description: Use this skill as the single Claude Code entrypoint for product-aware, team-based online closed-loop optimization of a biaxial film line. Trigger it whenever the user says things like “请完成对产线的优化”, “使得某性能提升/下降 xx%”, “给我开发这个产品的 recipe”, “让研发/质量/工艺团队协同优化”, or asks for PET/PPAT/PMMA/PVA recipe optimization. In Claude Code, this skill should first verify MCP and backend connectivity, then create a real three-agent team where quality and R&D only read line data and process is the only role allowed to execute MCP write actions.
---

# Closed-Loop Optimizer

## Use This Skill When

Use this skill whenever the user provides a natural-language optimization goal and wants the system to keep working until the goal is met. The skill is the only entrypoint; it reads the goal and optional product/material grade, normalizes it into a unified goal request, creates a task folder, writes product-aware team briefs for quality / R&D / process, and then starts the team-based closed-loop campaign through shared artifacts and team messages.

In Claude Code, prefer the native teamwork path first:

1. verify that backend and MCP are already reachable;
2. create or reuse the task workspace;
3. create the team with TeamCreate;
4. spawn the three department agents with Agent;
5. use SendMessage plus file artifacts for every handoff;
6. let the process agent be the only role that can execute MCP write actions.

Do not fake a start. If backend or MCP is not reachable, stop immediately and report the exact missing dependency.

Team roles:

- Quality Agent: diagnose quality state, stage recommendation, and risk.
- R&D Agent: produce stage-aware optimization strategy and ranked levers.
- Process Agent: turn the plan into approval-aware proposals and MCP execution artifacts.

Canonical role ids and inboxes:

- `quality-engineer` → `team/inbox/quality-engineer/`
- `rd-engineer` → `team/inbox/rd-engineer/`
- `process-engineer` → `team/inbox/process-engineer/`

Legacy aliases `quality`, `rd`, and `process` may exist in older task folders, but new runs must use the canonical role ids above.

## Team Entry

## Native Claude Code Entry

When the user talks directly to Claude Code with a request such as:

- `请完成对产线的优化：使得双折射波动下降5%，并输出最终recipe`
- `请为 PMMA 产品开发满足高透和低波动目标的 recipe`
- `启动研发/质量/工艺团队，持续优化直到达标`

this skill should trigger as the first and only orchestration entry.

Primary behavior inside Claude Code:

1. Parse the goal and infer `product_grade` if the user already implied it.
2. Run the MCP connectivity gate before creating any team work:
   - verify read tools exist: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_list_writable_parameters`, `film_line_list_products`
   - verify process-write tools exist for the process role: `film_line_preview_proposal`, `film_line_apply_proposal`, `film_line_run_until_stable`, `film_line_rollback`, `film_line_save_candidate_recipe`, `film_line_load_recipe_baseline`
   - verify backend health when local backend is expected, for example `curl -fsS http://127.0.0.1:4317/api/health`
3. If the gate passes, create the task workspace and team artifacts.
4. Create the real team with `TeamCreate` whenever the host supports it.
5. Spawn the role agents with `Agent` and route structured messages with `SendMessage`.
6. Keep optimizing until the goal is reached or governance hard stops fire.

Fallback order:

1. Native `TeamCreate` + `Agent` + `SendMessage`
2. `Agent` only, with file-bus artifacts as the source of truth

If neither native mode is available, stop and report that the current Claude Code host does not expose the required teamwork tools. Do not switch to any npm/node optimization script during the conversational skill flow.

The npm commands below remain available only for offline regression tests and repository maintenance. They are not the runtime path for a user-triggered Claude Code optimization conversation.

This skill is not a shell wrapper. It is a native Claude Code orchestration entry.

When invoked from conversation, it should:

- read the user goal;
- infer product context;
- check MCP and backend readiness through native project hooks and native tools;
- create the team workspace;
- create the team with `TeamCreate`;
- dispatch the three expert agents with `Agent`;
- coordinate them with `SendMessage` plus file artifacts.

Do not present npm or node commands to the user as the normal way to run this skill.

This skill keeps its executable support scripts inside its own package:

- `scripts/mcp-preflight.mjs` for entry readiness gating
- `scripts/native-team-enforcer.mjs` for blocking shell-script optimization fallbacks

## Skill Startup Contract

When this skill is triggered from a Claude Code conversation:

1. Prefer native Claude Code teamwork instead of shell-first orchestration.
2. Check MCP connectivity before any team action.
3. Confirm that:
   - required MCP read tools are present;
   - required MCP write tools are present for the process role;
   - backend `/api/health` is healthy if local backend is part of this run;
   - current snapshot or line state is readable.
4. If the gate fails, stop and report the exact missing tool or unreachable backend endpoint.
5. If the gate passes, continue into AgentTeam orchestration.
6. If the host supports Claude native teams, prefer `TeamCreate` / `Agent` / `SendMessage`.
7. If native team mode is unavailable, block and report the missing native teamwork capability rather than silently falling back to shell-script orchestration.

Runtime selection reference:

- Use native Claude Code teamwork first when TeamCreate / Agent / SendMessage are available.
- If only native `Agent` is available, use it with the same artifacts and protocol.
- If native teamwork is unavailable, stop and report the environment gap.

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

After a team run, inspect the task workspace itself and verify that all required artifacts, messages, and final recipe outputs exist and are internally consistent.

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

Permission matrix for native teamwork:

- Orchestrator: no line-write MCP actions; coordinates only.
- Quality Agent: read-only MCP actions plus local artifact writes.
- R&D Agent: read-only MCP actions plus local artifact writes.
- Process Agent: full process MCP authority, including preview, apply, stable-run, rollback, and recipe memory operations.

The process agent is the only role allowed to change live process parameters. Quality and R&D may write files, reports, and team messages, but they must never execute line-write MCP actions.

For this skill, MCP is a native tool surface. Claude Code should rely on `.mcp.json` and the configured MCP server rather than treating optimization as an external shell-script workflow.

## Orchestration

- The entry skill first normalizes the user goal, then creates a department-style team workspace, then launches the campaign runner.
- Product/material grade is first-class state. It must be present in `goal_request.json`, `product_target.json`, `team/department_briefs.json`, `run_summary.json`, and `outputs/final_recipe.json`.
- The team lead writes `team/inbox/<role-id>/intake_brief.json` for each role and appends lifecycle events to `team/team_messages.jsonl`.
- `quality-engineer` writes `02_quality/quality_diagnosis_XXX.json` with metric-level gap analysis, process risk, response/history context, and stage recommendation.
- `rd-engineer` writes `03_rd_plan/rd_optimization_plan_XXX.json` with stage-aware ranked levers, plan rationale, and review focus.
- `process-engineer` writes `04_execution/parameter_delta_proposal_XXX.json` and `safety_gate_result_XXX.json` while preserving execution intent, control mode, and guardrails.

Artifact naming contract:

- New runs must use numbered immutable artifacts, for example `quality_diagnosis_001.json`, `rd_optimization_plan_001.json`, `parameter_delta_proposal_001.json`, `execution_receipt_001.json`.
- Unnumbered names like `quality_diagnosis.json` or `rd_optimization_plan.json` are legacy compatibility names only and must not be the source of truth for new runs.
- Every role should read the highest-numbered artifact in its family unless the team lead explicitly pins a different numbered file in `team/team_messages.jsonl`.
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
2. Native `Agent` runtime via project `agents` definitions when TeamCreate is unavailable.

The native teamwork path keeps the same artifact contract. The team behaves as:

- Outer strategy cycle: Quality publishes quality evidence, then R&D publishes the product-aware strategy.
- Inner process cycle: Process executes multiple bounded micro-tunes under the active R&D strategy.
- Replan trigger: no progress, repeated rejection, repeated worsening, safety gate block, or explicit quality/R&D/process request.
- Completion: freeze the best observed recipe only after target reach plus hold-window confirmation, otherwise preserve the best recipe and the evidence for the next cycle.

## Native Teamwork Rules

This skill is designed to match Claude Code’s custom skill and subagent model:

- keep the skill as the single user-facing entrypoint;
- keep specialist behavior in `.claude/agents/*.md`;
- use tool scoping on each subagent to enforce role boundaries;
- keep every cross-role decision in files and messages, not hidden context;
- fail fast on missing MCP/backend dependencies instead of silently switching to a fake mode.

Read these references before complex runs:

- `references/team-orchestration.md`
- `references/native-claude-code-teamwork.md`
- `references/coordination-protocol.md`
- `references/subagent-dispatch.md`
- `references/product-recipe-development.md`
- `references/real-line-adapter-contract.md`

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

The operational finish condition is stricter than one good sample:

- the team should only declare success after the selected recipe has improved the target metrics and held that improvement across the configured stable window;
- after success, the process role should persist the best recipe, communicate it through MCP-compatible artifacts, and keep the line on that recipe for hold confirmation;
- if success is not yet stable, continue the collaboration loop instead of exiting early.

## Rules

- Do not let an LLM write PLC tags directly.
- Keep deterministic safety gates outside the LLM.
- Semi-auto mode requires approval gating before write execution.
- Keep best-observed recipe memory synchronized with rollback baseline so later proposals can safely inherit the current best-known recipe.
- Never mix product contexts. A PMMA/PVA/PPAT optimization must not reuse PET target windows, safety limits, or final recipe metadata.
- Prefer artifact-driven collaboration over implicit prompt memory: diagnosis context, strategy state, approval packet, ranked planning rationale, and execution intent must be written into artifacts.
- Treat the user request as the top-level product objective, not as an instruction to tune one metric in isolation.
- Continue across strategy cycles until the goal is reached or configured governance limits fire. Safety rejection, repeated worsening, or no progress should first trigger replanning/recover unless the hard stop limit is reached.
- Treat the simulated MCP as if it were a real production-line MCP. Every proposal, hold, rollback, recipe save, and recipe import step must be auditable and safe enough for later migration to a real line.
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

Use `.claude/agents/closed-loop-optimization-orchestrator.md` for the campaign controller. It dispatches `closed-loop-optimization-quality-agent`, `closed-loop-optimization-rd-agent`, and `closed-loop-optimization-process-agent` through native Claude Code team primitives and the shared artifact protocol.
