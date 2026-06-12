# Claude Code AgentTeam Standard

This project uses a three-lane team standard so the optimizer can run in Claude Code environments with different native team capabilities.

## 1. Preferred Claude SDK Subagent Entry

Use this when Claude Code / Claude Agent SDK is available:

```bash
npm run optimize:claude-sdk -- \
  --product-grade PVA_FILM_GRADE_A \
  --goal-text "请完成对 PVA 产线的优化：使得厚度波动下降3%，并输出最终recipe" \
  --max-iters 12 \
  --seed 20260612
```

The SDK runner:

- loads `.claude/agents/*.md`;
- registers the project agents as SDK `AgentDefinition`s;
- starts the main thread with `agent='closed-loop-optimization-orchestrator'`;
- enables the `closed-loop-optimizer` skill;
- forwards subagent text with `forwardSubagentText=true`;
- sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`;
- asks the orchestrator to invoke the quality, R&D, and process teammates through the Agent tool;
- runs the auditable optimization command and validators.

Core implementation:

- `scripts/optimization/run-claude-sdk-skill.mjs`
- `scripts/optimization/lib/claude-sdk-agent-definitions.mjs`

## 2. Native Experimental Agent Teams

When the host exposes native TeamCreate / TaskCreate / SendMessage style tools, the orchestrator should use them directly.

Required native team semantics:

- Team lead: `closed-loop-optimization-orchestrator`.
- Teammate 1: `closed-loop-optimization-quality-agent`.
- Teammate 2: `closed-loop-optimization-rd-agent`.
- Teammate 3: `closed-loop-optimization-process-agent`.
- Shared state must still be persisted to the task folder.
- The native team may discuss, but the source of truth is always the file evidence.

Required file evidence:

- `team/team_contract.json`
- `team/team_messages.jsonl`
- `team/inbox/<role>/*.json`
- `07_coordination/team_dispatch_plan_XXX.json`
- `07_coordination/quality_review_XXX.json`
- `07_coordination/rd_brief_XXX.json`
- `07_coordination/process_brief_XXX.json`
- `08_trial_evidence/trial_XXX/**`
- `outputs/final_recipe.json`

## 3. Deterministic File-Bus Fallback

This is the acceptance-test runtime and must always remain functional:

```bash
npm run optimize:team -- \
  --product-grade PVA_FILM_GRADE_A \
  --goal-text "请完成对 PVA 产线的优化：使得厚度波动下降3%，并输出最终recipe" \
  --max-iters 12 \
  --seed 20260612
```

It implements the same team contract through files:

- the team lead writes dispatch plans;
- quality writes diagnosis and quality review;
- R&D writes stage-aware strategy;
- process writes safety-gated execution proposals;
- the adapter/MCP executes only approved safe actions;
- quality evaluates after-window results;
- the best recipe memory and rollback baseline stay synchronized.

## Validation

Run these after any AgentTeam change:

```bash
npm run agentteam:validate
node scripts/optimization/validate-team-workspace.mjs --task-dir "<task_dir>"
node .claude/skills/closed-loop-optimizer/scripts/validate-campaign.mjs --run-dir "<campaign_dir>"
```

The current standard was verified on 2026-06-12 with:

```bash
npm run optimize:team -- \
  --product-grade PVA_FILM_GRADE_A \
  --goal-text "请完成对 PVA 产线的优化：使得厚度波动下降3%，并输出最终recipe" \
  --max-iters 3 \
  --seed 20260612
```

Result:

- task workspace validation: passed;
- campaign validation: passed;
- final quality state: `PASS_BEST_OBSERVED`;
- candidate recipe: `RCP-CANDIDATE-20260612102547159-HSNZ`;
- goal reached: true.
