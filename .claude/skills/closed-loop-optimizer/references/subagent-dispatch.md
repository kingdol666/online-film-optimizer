# SubAgent Dispatch Guide

## Hard Serial Loop

Do not parallelize these dependent steps:

1. collect stable snapshot and online quality;
2. run `online-quality-engineer`;
3. run `online-rd-engineer`;
4. run `online-process-engineer`;
5. run simulator/equipment adapter;
6. collect next stable window.

## Parallel Review Points

Use SubAgents in parallel only after the required upstream artifact exists:

- After snapshot and online quality exist: dispatch quality diagnosis plus sensor-health/profile-shape review.
- After quality diagnosis exists: dispatch R&D history review, physics-plausibility review, and constraint review.
- After R&D plan exists: dispatch proposal generation, rollback readiness review, and safety-limit review.
- After campaign completes: dispatch independent schema/artifact checks for quality, R&D, process, execution, and recipe groups.

## Example SubAgent Prompts

Quality:

```text
Use online-quality-engineer. SNAPSHOT_PATH=<path>, QUALITY_PATH=<path>, TARGET_PATH=<path>, OUTPUT_PATH=<path>.
```

R&D:

```text
Use online-rd-engineer. DIAGNOSIS_PATH=<path>, SNAPSHOT_PATH=<path>, QUALITY_PATH=<path>, TARGET_PATH=<path>, HISTORY_PATH=<path>, OUTPUT_PATH=<path>.
```

Process:

```text
Use online-process-engineer. PLAN_PATH=<path>, SNAPSHOT_PATH=<path>, CAMPAIGN_ID=<id>, ITERATION=<n>, PROPOSAL_OUTPUT_PATH=<path>, SAFETY_OUTPUT_PATH=<path>.
```

Campaign:

```text
Use closed-loop-optimization-orchestrator to run the simulation campaign and validate the resulting RUN_DIR.
```
