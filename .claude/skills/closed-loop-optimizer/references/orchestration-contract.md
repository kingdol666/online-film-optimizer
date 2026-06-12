# Closed-Loop Optimization Orchestration Contract

## Sequential Dependency

The online loop has a hard dependency chain:

1. Stable process snapshot and online quality are collected.
2. Quality engineer writes quality diagnosis.
3. R&D engineer writes optimization plan.
4. Process engineer writes parameter proposal and safety precheck.
5. Simulator/equipment adapter applies only if safety gate allows.
6. New stable window is collected and judged against the previous window.
7. Approval packet and strategy state are written into `07_coordination/`.

## Safe Parallelism

Use SubAgents in parallel only for independent work:

- Quality diagnosis can run alongside sensor-health and profile-shape review.
- R&D plan can run alongside history-response review and physical-plausibility review.
- Process proposal can run alongside rollback-readiness and safety-limit review.
- Campaign validation can run schema checks for different artifact groups in parallel.

Do not parallelize steps that have data dependency, such as generating a process proposal before the R&D plan exists.

## Real-Line Adapter Boundary

The LLM never writes PLC tags directly. Replace simulator sources with MCP tools:

- snapshot reader MCP;
- online inspection MCP;
- safety gate MCP;
- approved equipment write MCP;
- historian/recipe database MCP.

The artifact contract stays unchanged.
In semi-auto mode, approval is mandatory before write execution.

## Simulated MCP Tools

The project includes a stdio MCP server configured in `.mcp.json` as `industrial-film-line-sim`.

Available tool actions:

- `film_line_reset`
- `film_line_get_state`
- `film_line_get_snapshot`
- `film_line_get_online_quality`
- `film_line_run_until_stable`
- `film_line_preview_proposal`
- `film_line_apply_proposal`
- `film_line_tick`
- `film_line_rollback`
- `film_line_save_candidate_recipe`

Use `film_line_preview_proposal` before `film_line_apply_proposal`. The model may propose a parameter action, but deterministic safety gate approval is required before execution.

Prefer `film_line_preview_setpoints` and `film_line_apply_setpoints` for online tuning. These tools accept only `tag` and target setpoint values, then the simulator computes current values and deltas internally. This prevents an optimizer from bypassing the safety gate by fabricating `current` or `delta`.

## Strategy State

Closed-loop control must explicitly operate in:

- `explore`
- `exploit`
- `recover`

The switch reason must be written to `strategy_state_XXX.json`, never left implicit in prompt memory.

## Black-Box Boundary

During optimization, agents may use only:

- writable parameter catalog and limits from MCP;
- process snapshots;
- online quality measurements;
- campaign history and diagnostic/R&D/process artifacts;
- domain ontology and process knowledge.

Agents must not inspect or depend on the simulator's hidden response implementation (`blackbox-model.mjs`). That file represents the real plant physics unknown to the optimizer.
