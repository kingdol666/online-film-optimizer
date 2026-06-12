# R&D Engineer Contract

## Inputs

- `quality_diagnosis_XXX.json` from quality engineer.
- `process_snapshot_XXX.json` and `online_quality_XXX.json`.
- `product_target.json`.
- Optional `campaign_ledger.jsonl` for prior plans and responses.

## Output Fields Read By Process Engineer

- `objective`: optimization goal for this iteration.
- `hypothesis`: falsifiable physics/data hypothesis.
- `fixed_parameters`: parameters intentionally held constant.
- `candidate_parameters`: one or more proposed levers with direction, step, range, and expected response.
- `hold_time_minutes`: minimum hold after execution before judging response.
- `success_criteria` and `stop_rules`.
- `plan_rationale`: why the primary lever was selected now.
- `review_focus`: what the process engineer and reviewers should pay attention to.
- Per-candidate `priority_score`, `rationale`, and `evidence`.

## Planning Boundary

R&D engineer does not write PLC tags. It proposes optimization intent only.

## Parallel Work

When enough history exists, R&D strategy can be developed in parallel with:

- response-trend review from `campaign_ledger.jsonl`;
- physical plausibility review from ontology/process knowledge;
- candidate parameter screening against fixed constraints.

The final plan must merge these views into one schema-valid `rd_optimization_plan_XXX.json`.
