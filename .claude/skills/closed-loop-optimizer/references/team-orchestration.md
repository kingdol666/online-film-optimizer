# Team Orchestration Contract

The closed-loop optimizer must be used as a team-based workflow.

## Top-Level Entry

The only user-facing entry skill should accept a natural-language optimization request and create a task-specific workspace.

## Claude Code Project Agents

Project-level agents live in `.claude/agents/` and define the reusable expert identities for Claude Code:

- `closed-loop-optimization-orchestrator`
- `closed-loop-optimization-quality-agent`
- `closed-loop-optimization-rd-agent`
- `closed-loop-optimization-process-agent`

When native AgentTeam execution is available, the orchestrator should spawn the three role agents and give each the task directory, current iteration, dispatch plan, and required artifacts. When native AgentTeam execution is unavailable, `npm run optimize:team` must preserve the same contract through the file bus.

## Claude Code Standard Trigger

The project supports three compatible team triggers:

1. Experimental Claude Code Agent Teams. Enable with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and use the host-provided TeamCreate / TaskCreate / SendMessage style tools when available.
2. Claude Agent SDK subagents. Run `npm run optimize:claude-sdk -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>"`. The SDK runner registers `.claude/agents/*.md` as `AgentDefinition`s and starts the main session with `agent='closed-loop-optimization-orchestrator'`.
3. Deterministic file-bus fallback. Run `npm run optimize:team -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>"`. This is the acceptance-test runtime and must always remain available.

The SDK and fallback paths must write the same evidence types:

- `team/team_contract.json`
- `team/team_messages.jsonl`
- `team/inbox/<role>/*.json`
- `07_coordination/team_dispatch_plan_XXX.json`
- `08_trial_evidence/trial_XXX/**`
- `outputs/final_recipe.json`

## Native Team Semantics

If TeamCreate / TaskCreate / SendMessage are available, the team lead should:

- create one team named from the task id;
- create tasks for quality review, R&D strategy, process execution, and verification;
- spawn teammates with subagent types `closed-loop-optimization-quality-agent`, `closed-loop-optimization-rd-agent`, and `closed-loop-optimization-process-agent`;
- send each teammate the task folder, current campaign folder, required artifacts, and expected output files;
- require each teammate to write standard team-message JSON before reporting completion;
- delete or close the native team only after file-based validation passes.

If only the Agent tool is available, invoke the same subagent types through Agent calls and keep the file-bus artifacts as the source of truth.

## Team Roles

- Quality agent
  - reads snapshot + online quality
  - writes quality diagnosis and stage recommendation
  - may request R&D replan or Process revision
- R&D agent
  - reads quality diagnosis + history
  - writes stage-aware optimization plan
  - may request quality recheck or process feasibility revision
- Process agent
  - reads R&D plan + snapshot
  - writes approval-aware proposal and safety gate artifacts
  - may request R&D replan or quality hold validation

## Workspace Rules

- Every optimization task gets its own task folder under `workspace/optimization-tasks/<task-id>/`.
- Every campaign run and all evidence for that task stay inside the same task folder.
- Team messages are appended to `team/team_messages.jsonl`.
- Role-specific mailboxes live under `team/inbox/<role>/`.
- Task summary, best recipe, and output recipe must be persisted before completion.
- Team briefs for quality, R&D, and process should be written at task start so each agent has a stable contract.
- Every iteration must write `07_coordination/team_dispatch_plan_XXX.json`.
- Every trial must write `08_trial_evidence/trial_XXX/05d_team_dispatch_plan.json`.

## Dispatch Model

The team uses a two-level control loop:

- Outer strategy cycle: Quality reviews the stable window and R&D creates or refreshes the strategy.
- Inner process cycle: Process executes multiple bounded micro-tunes under the active R&D strategy.

The dispatch plan must state:

- `strategy_cycle_id`
- `process_iteration_in_cycle`
- `plan_source`: `replanned` or `carry_forward`
- `replan_reason`
- `assigned_roles`
- `role_requests`
- `shared_artifacts_to_read`
- `active_strategy_digest`
- `recent_responses`

## Role Requests

Formal team requests use the same team message protocol plus:

- `requested_actions`
- `requires_response`
- `reply_to_message_id`
- `payload.reason`

Supported purposes:

- `request_quality_review`
- `request_rd_replan`
- `request_process_revision`
- `request_hold_validation`
- `role_response`

All requests must reference artifacts. Hidden chat context is not a valid team handoff.

## Stop Rule

Terminate the team when:

- the goal is reached, or
- the campaign hits the configured hard iteration or strategy-cycle limit, or
- safety / approval / rollback governance requests termination.

No progress, repeated rejection, or repeated worsening should first trigger a new strategy cycle or recover path before termination.
