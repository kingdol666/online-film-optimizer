# Team Orchestration Contract

The closed-loop optimizer must be used as a team-based workflow.

This contract is intentionally aligned with Claude Code native skills and subagents:

- one user-facing skill as the entrypoint;
- project agents under `.claude/agents/`;
- tool restrictions on each role;
- explicit file and message handoffs between roles.

## Top-Level Entry

The only user-facing entry skill should accept a natural-language optimization request and create a task-specific workspace.

The preferred Claude Code path is:

1. run the MCP connectivity gate;
2. verify local backend health when applicable;
3. create the task workspace;
4. create the team with TeamCreate;
5. dispatch the three role agents;
6. continue the loop until target reach or governance hard stop.

## Claude Code Project Agents

Project-level agents live in `.claude/agents/` and define the reusable expert identities for Claude Code:

- `closed-loop-optimization-orchestrator`
- `closed-loop-optimization-quality-agent`
- `closed-loop-optimization-rd-agent`
- `closed-loop-optimization-process-agent`

When native AgentTeam execution is available, the orchestrator should spawn the three role agents and give each the task directory, current iteration, dispatch plan, and required artifacts.

## MCP Permission Boundary

The permission boundary is a hard rule, not a suggestion:

- `closed-loop-optimization-orchestrator`
  - may inspect task files and overall backend readiness
  - must not execute any line-write MCP action
- `closed-loop-optimization-quality-agent`
  - may use read-only MCP tools such as snapshot, state, quality, product list, writable parameter catalog
  - must not execute apply, rollback, or recipe-memory write actions
- `closed-loop-optimization-rd-agent`
  - may use read-only MCP tools such as snapshot, state, quality, product list, writable parameter catalog
  - must not execute apply, rollback, or recipe-memory write actions
- `closed-loop-optimization-process-agent`
  - is the only role allowed to use process-write MCP tools including proposal preview, apply, stable-run, rollback, and candidate recipe persistence

Quality and R&D are read-only with respect to the line. They may still write local artifacts and team messages.

## Claude Code Standard Trigger

The project supports two conversational team triggers:

1. Experimental Claude Code Agent Teams via TeamCreate / TaskCreate / SendMessage.
2. Native Claude Code Agent runtime via project agents when TeamCreate is unavailable.

For direct Claude Code conversational use of the `closed-loop-optimizer` skill, only these native teamwork modes are allowed.

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
- state the MCP permission boundary in each teammate brief;
- require each teammate to write standard team-message JSON before reporting completion;
- delete or close the native team only after file-based validation passes.

If only the Agent tool is available, invoke the same subagent types through Agent calls and keep the file-bus artifacts as the source of truth.

If neither TeamCreate nor Agent is available, stop and report that native teamwork is unavailable. Do not swap to shell-script orchestration during the user conversation.

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
