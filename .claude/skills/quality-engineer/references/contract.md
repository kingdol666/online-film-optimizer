# Quality Engineer Contract

## Inputs

- `process_snapshot_XXX.json`: line state, current recipe, setpoints, process values, alarm state.
- `online_quality_XXX.json`: online thickness and birefringence metrics/profiles.
- `product_target.json`: target windows.
- Optional previous online quality file for response assessment.

## Output Fields Read By Other Roles

- `quality_state`: `PASS`, `WARNING`, `FAIL`, or `NEEDS_DATA`.
- `primary_quality_gap`: most important quality gap.
- `affected_metrics`: all metrics outside target.
- `suspected_process_regions`: process regions likely related to the gaps.
- `recommended_next_action`: freeze, continue, rollback, or replan.
- `current_loss`: scalar online target loss when present.
- `metric_evaluations`: metric-by-metric gap table with normalized severity.
- `process_risk_summary`: readiness and operational risk view for downstream execution.
- `history_signal_summary`: compact summary of recent response quality.
- `decision_context`: compact collaboration payload for R&D prioritization.

## Safety Boundary

Quality engineer never proposes or writes process setpoints.

## Parallel Work

Can run in parallel with historical trend summarization or sensor-health checking, but its final diagnosis must use the current stable window as the source of truth.
