# Native Claude Code Teamwork Profile

This file defines how the closed-loop optimizer should behave when it is run directly inside Claude Code as a custom skill plus project subagents.

## Design Intent

Use Claude Code the way it is meant to be used:

- one skill as the user-facing entrypoint;
- one orchestrator agent as the team lead;
- three specialist agents with explicit tool boundaries;
- SendMessage and file artifacts as the official handoff layer;
- MCP used as the real execution surface for line observation and process control.

## Native Execution Order

1. Read the user goal.
2. Infer or confirm `product_grade`.
3. Run the MCP connectivity gate.
4. Verify backend health if local backend participates in the run.
5. Create the task workspace.
6. Create the team with `TeamCreate`.
7. Spawn the three agents with `Agent`.
8. Route all requests and replies through `SendMessage` plus `team/team_messages.jsonl`.
9. Keep the loop alive until:
   - goal reached plus hold validation, or
   - governance hard stop, or
   - backend/MCP dependency failure.

For direct Claude Code conversational runs, this native path is mandatory. If the host cannot provide TeamCreate or the native Agent runtime, stop and report the environment gap. Do not substitute shell-based campaign scripts.

## Role Permission Matrix

### Orchestrator

- Allowed:
  - team creation
  - task dispatch
  - artifact review
  - validation
- Forbidden:
  - any MCP write action
  - direct parameter import to the line

### Quality

- Allowed:
  - read-only MCP tools
  - quality diagnosis artifacts
  - stage recommendation
  - alerting and hold validation
- Forbidden:
  - apply proposal
  - rollback
  - save candidate recipe

### R&D

- Allowed:
  - read-only MCP tools
  - strategy reasoning
  - lever ranking
  - replan requests
- Forbidden:
  - apply proposal
  - rollback
  - save candidate recipe

### Process

- Allowed:
  - read-only MCP tools
  - preview proposal
  - apply proposal
  - stable-run
  - rollback
  - save candidate recipe
  - load rollback baseline
- Forbidden:
  - bypass safety gate
  - bypass approval path
  - modify product context

## Message Discipline

Every cross-role message must contain:

- `from`
- `to`
- `purpose`
- `summary`
- `artifact_refs`
- `requested_actions`
- `requires_response`
- `payload`

The live chat is never the source of truth. Artifacts and protocol messages are.

## Offline Debug Exception

The deterministic file-bus and script runtimes are offline debug paths only. They may be used by developers for repository validation, but they are not an acceptable replacement for the native Claude Code teamwork flow during a live user-triggered optimization conversation.
