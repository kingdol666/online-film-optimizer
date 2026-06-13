---
name: closed-loop-optimizer
description: |
  真实产线闭环优化入口 Skill。面向真实工业薄膜产线，接入真实产线 API。
  遵循「产线无小事」原则——每一次参数变更都必须经过完整的证据链审查。
  触发词：产线优化、recipe 开发、团队协同优化、双折射/厚度/透光率优化。
  在 Claude Code 中，先验证 MCP 和 Backend 连通性，然后创建三角色团队，
  其中 Quality 和 R&D 只读产线数据，Process 是唯一允许执行 MCP 写入的角色。
  所有角色都遵循真实产线行为规范：证据先行、最小动作、可回退、可审计。
---

# Closed-Loop Optimizer — 真实产线模式

> **⚠️ 真实产线声明：本系统接入的是真实运行中的工业薄膜产线 API。
> 每一次参数变更都直接影响产线运行——影响材料、产出、良率和商业结果。
> 所有团队成员必须遵循「产线无小事」原则：证据先行、最小有效动作、可回退、可审计。**

## Real-Line Behavioral Code

All team members must follow these behavioral principles:

1. **证据先行 (Evidence First)**: No write action without complete evidence chain - Quality diagnosis → R&D strategy → Process independent verification → Preview confirmation.
2. **最小有效动作 (Minimum Effective Action)**: Each step adjusts 1-2 parameters max. Step size should start conservative and stay below 75% of max_delta unless a previous move is already validated.
3. **可回退 (Always Reversible)**: Every execution must have a confirmed rollback path. Worsening triggers immediate rollback, no waiting for approval.
4. **可审计 (Fully Auditable)**: Every decision, every data point, every judgment is written to artifacts with timestamps, data sources, and confidence levels.
5. **诚实面对不确定性 (Honest About Uncertainty)**: Low-confidence judgments are labeled as such. "I don't know" is better than a wrong answer on a real production line.

## DEFAULT EXECUTION MODE: Real Agent Team

**When this skill is triggered, the default and mandatory mode is to spawn real expert agents using the `Agent` tool.** The orchestrator (team-lead) must NOT do the work of quality diagnosis, R&D planning, or process execution itself. It delegates to the three specialist agents and coordinates them.

### Why real agents, not team-lead solo

- Each agent has a distinct personality, experience background, and self-check protocol written in its `.claude/agents/*.md` definition.
- Agents produce independent, high-quality artifacts with their own judgment — not team-lead ghostwriting.
- Agents challenge each other: R&D verifies Quality's conclusions independently, Process independently validates safety. This cross-checking is the core safety mechanism.
- Team-lead solo mode loses the entire value of the team design: the personality, the challenge, the independent verification.

### Mandatory agent dispatch sequence

```
Step 1: Gate check (backend + MCP + line state)
Step 2: Create task workspace + intake briefs
Step 3: Spawn Quality Agent  → waits for quality_diagnosis artifact
Step 4: Spawn R&D Agent       → reads diagnosis, waits for rd_plan artifact
Step 5: Spawn Process Agent   → reads plan, executes MCP write actions
Step 6: Quality re-evaluates after each Process execution
Step 7: Repeat 3→4→5 cycle until goal reached or hard stop
```

### When team-lead solo mode is allowed (LAST RESORT ONLY)

Team-lead may drive the optimization directly ONLY if:
- The Agent tool is not available in the current host environment
- AND all fallback attempts have been exhausted

In solo mode, team-lead must still follow the three-role artifact protocol (write diagnosis → write plan → execute with safety gates). Solo mode must be explicitly reported to the user as degraded operation.

## Production Team Scheduling Model

This team should behave like a real plant optimization cell with three different cadences:

- **R&D cadence (long cycle)**: background research, historical mining, lever ranking, and strategy refresh. R&D should keep working even when no immediate write action is happening.
- **Quality cadence (real-time watch)**: continuous monitoring, window-by-window diagnosis, and trigger management. Quality is the system's alarm and evidence engine.
- **Process cadence (short cycle)**: bounded micro-tuning, safety-gated execution, and rollback management. Process is the only role allowed to touch live setpoints.

The orchestrator should schedule work by state:

- **Startup**: Quality diagnoses first, then R&D plans, then Process validates and executes.
- **Steady optimization**: Process runs a short tuning loop under the active R&D strategy while Quality watches every stable window.
- **Background research**: R&D continues to deepen analysis on a longer horizon using the latest quality and historian evidence.
- **Escalation**: any worsening, safety rejection, or inconsistent signal pauses Process and forces a re-review by Quality and R&D.
- **Hold / freeze**: when Quality declares PASS, Process stops exploration and the team enters hold validation.
- **Recovery**: repeated worsening or alarm state forces rollback to the best known baseline before any new tuning.

Canonical loop order:

1. Startup gate check.
2. Quality initial diagnosis.
3. R&D strategy generation.
4. Process safety-gated execution.
5. Quality post-execution evaluation.
6. R&D background learning refresh.
7. Repeat from step 4 until hold, replan, recover, or stop.

Canonical verdict definitions:

- **effective**: the primary target gap improves by at least the meaningful response threshold, and no guardrail metric worsens beyond tolerance.
- **ineffective**: the primary target gap changes by less than the meaningful response threshold, and no guardrail metric worsens beyond tolerance.
- **worse**: any guardrail metric breaks spec, or the primary target gap worsens beyond the meaningful response threshold.

Only Quality owns the canonical verdict for a stable window. Process must mirror that verdict in execution receipts, but Process must not redefine it.

R&D background learning is allowed only as a draft lane. While a Process micro-cycle is active, R&D may update notes, evidence summaries, and next-hypothesis candidates, but it must not overwrite the active strategy used by Process until the orchestrator opens a replan window.

Emergency rollback recovery order:

1. Process executes rollback immediately.
2. Quality performs post-rollback recovery check on the next stable window.
3. R&D switches to recover mode and writes the next safe hypothesis only after the rollback result is known.
4. Orchestrator keeps Process paused until Quality and R&D both acknowledge recovery or a new safe plan.

Recommended role trigger matrix:

- **Quality acts** when new stable data arrives, when a process receipt lands, when quality is PASS, when noise or drift is unclear, or when a sensor-health concern appears.
- **R&D acts** when a fresh diagnosis exists, when a strategy cycle begins, when Process asks for replan, or when the long-cycle learning backlog should be refreshed.
- **Process acts** only when Quality and R&D artifacts exist, the line is stable, the safety gate is open, and a bounded action can be executed or rolled back.

The orchestrator should prefer one active Process action per loop while letting R&D continue background synthesis. Do not force all roles to move at the same pace; the production goal is coordinated cadence, not simultaneous activity.

## Use This Skill When

Use this skill whenever the user provides a natural-language optimization goal and wants the system to keep working until the goal is met. The skill is the only entrypoint; it reads the goal and optional product/material grade, normalizes it into a unified goal request, creates a task folder, writes product-aware team briefs for quality / R&D / process, and then starts the team-based closed-loop campaign through shared artifacts and team messages.

When this skill is triggered, the default behavior is **team-first orchestration**:

- create one native team for the task;
- create all three specialist Agents at startup;
- keep those Agents alive for the whole optimization campaign;
- dispatch work to them in rounds through SendMessage and shared artifacts;
- kill or delete the team only after completion or hard stop.

This skill must not degrade into "run one Agent once" unless the host environment lacks native team capability and has already fallen back to the documented degraded mode.

In Claude Code, prefer the native teamwork path first:

1. verify that backend and MCP are already reachable;
2. create or reuse the task workspace;
3. create the team with TeamCreate;
4. spawn **all three** department agents with Agent at startup;
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
2. Build the scheduling frame first:
   - identify the primary quality KPI,
   - identify the likely main lever family,
   - identify the expected Process action cadence,
   - identify whether the run starts in `explore`, `exploit`, `recover`, or `hold_validation`.
3. Run the MCP connectivity gate before creating any team work:
   - verify read tools exist: `film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_list_writable_parameters`, `film_line_list_products`
   - verify process-write tools exist for the process role: `film_line_preview_proposal`, `film_line_apply_proposal`, `film_line_run_until_stable`, `film_line_rollback`, `film_line_save_candidate_recipe`, `film_line_load_recipe_baseline`
   - verify backend health when local backend is expected, for example `curl -fsS http://127.0.0.1:4317/api/health`
4. If the gate passes, create the task workspace and team artifacts.
5. Create the real team with `TeamCreate` whenever the host supports it.
6. Spawn all role agents with `Agent` up front and keep them as the active task team for the full run.
7. Route structured messages with `SendMessage`.
8. Keep optimizing until the goal is reached or governance hard stops fire.
9. After final validation, close or delete the team.

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

Supported products are `PET_FILM_GRADE_A`, `PPAT_FILM_GRADE_A`, `PMMA_FILM_GRADE_A`, and `PVA_FILM_GRADE_A`. Legacy `BOPET_NEW_GRADE_A` maps to `PET_FILM_GRADE_A`. Product selection changes baseline recipe, writable parameter limits, target template, process response model, historical recipe memory, and AgentTeam brief context.

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

When the host exposes `.mcp.json`, use the `industrial-film-line-sim` MCP server for live line actions:

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

### Scheduling Responsibilities

- **R&D owns the long-cycle map**: it should refresh the lever ranking when the current strategy is exhausted, when the quality diagnosis changes materially, or when the process loop cannot advance safely.
- **Quality owns the live truth**: it should compare each stable window to the prior window, decide whether the current move is effective, and trigger hold/replan/recover when thresholds are crossed.
- **Process owns the short-cycle move**: it should execute one bounded action at a time, keep the rollback path ready, and immediately stop if the line or the safety gate disagrees.
- **Orchestrator owns cadence and escalation**: it decides which role is active now, which role stays in background research, and when the team must stop, freeze, or reset.

Artifact naming contract:

- New runs must use numbered immutable artifacts, for example `quality_diagnosis_001.json`, `rd_optimization_plan_001.json`, `parameter_delta_proposal_001.json`, `execution_receipt_001.json`.
- Unnumbered names like `quality_diagnosis.json` or `rd_optimization_plan.json` are legacy compatibility names only and must not be the source of truth for new runs.
- Every role should read the highest-numbered artifact in its family unless the team lead explicitly pins a different numbered file in `team/team_messages.jsonl`.
- `07_coordination/` is the mandatory handoff protocol layer and includes quality review, R&D brief, process brief, strategy state, approval packet, coordination index, best recipe memory, and executive summary.
- `08_trial_evidence/trial_XXX/` stores the full evidence chain for each experiment.
- The line adapter writes `execution_receipt_XXX.json`, new snapshots, result summaries, and final recipe recommendation.
- Every iteration writes `07_coordination/team_dispatch_plan_XXX.json`; it explains which expert roles act in that iteration, whether R&D strategy is refreshed or carried forward, and what each role is being asked to do.

The dispatch plan should also record:

- the current cadence state (`startup`, `explore`, `exploit`, `recover`, `hold_validation`);
- which role is in active work mode and which role is in background mode;
- the next trigger that will wake R&D, Quality, or Process;
- the stop condition for the current loop.

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
- Background learning cycle: R&D continues to mine history, refine hypotheses, and rank levers even when Process is holding or waiting.
- Replan trigger: no progress, repeated rejection, repeated worsening, safety gate block, or explicit quality/R&D/process request.
- Completion: freeze the best observed recipe only after target reach plus hold-window confirmation, otherwise preserve the best recipe and the evidence for the next cycle.
- Team deletion: once completion is validated, the orchestrator should close or delete the native team after final artifact validation passes.

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
- Treat the MCP as a REAL production-line API. Every proposal, hold, rollback, recipe save, and recipe import step must be auditable and safe enough for real production.
- Treat R&D as a background capability, not a one-shot deliverable. It should deepen the next hypothesis while Process is still executing the current one.
- Treat Quality as a continuous watch function, not a post-hoc report. It should keep the team honest about drift, noise, and stability.
- Treat Process as a bounded actuator, not a strategy owner. It executes, measures, rolls back, and reports, but it does not define the research direction.
- **Real-Line Guardrails (mandatory)**:
  - Every MCP write must be preceded by preview + safety gate check — no exceptions.
  - Step size ≤ 75% of max_delta_per_action by default. Only approach max_delta after confirmed positive response.
  - Maximum 2 parameters changed per action. Never change 3+ simultaneously.
  - Any metric worsening beyond spec triggers immediate rollback without waiting for approval.
  - Process Agent must complete the 10-point self-check before every execution.
  - Quality Agent must provide confidence levels on every judgment.
  - R&D Agent must provide falsifiable hypotheses with quantified predictions.
  - Orchestrator must review each stage gate before allowing the next stage to proceed.
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
