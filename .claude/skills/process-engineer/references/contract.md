# Process Engineer Contract

## Inputs

- `rd_optimization_plan_XXX.json` from R&D engineer.
- `process_snapshot_XXX.json` from the current stable window.
- `campaign_id` and iteration number.

## Outputs

- `parameter_delta_proposal_XXX.json`: executable setpoint delta proposal.
- `safety_gate_result_XXX.json`: deterministic safety gate result.
- Equipment/simulator adapter later writes `execution_receipt_XXX.json`.
- `execution_intent`: preserved objective, hypothesis, and guardrails from upstream planning.
- Per-change `expected_response` and role marker for execution review.

## Safety Rules

- Never execute without safety gate.
- Never write tags unknown to the safety table or equipment adapter.
- Always include rollback recipe.
- If rejected, return violations to R&D engineer instead of trying a hidden workaround.

## Parallel Work

Before execution, the process engineer can parallelize:

- proposal generation from R&D plan;
- safety-limit inspection;
- rollback readiness inspection.

Only the merged, gate-approved proposal may proceed to simulator/equipment execution.
