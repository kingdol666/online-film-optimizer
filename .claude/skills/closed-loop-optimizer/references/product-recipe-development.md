# Product-Aware Recipe Development Contract

This platform treats product/material grade as first-class orchestration state. The selected product decides the baseline recipe, writable limits, target quality window, historical recipe context, and simulated response model.

## Supported Simulated Products

- `PET_FILM_GRADE_A`: PET/BOPET optical film, wide thermal window, TD heatset and orientation balance are primary levers.
- `PPAT_FILM_GRADE_A`: flexible biodegradable film, narrow thermal window, small temperature and draw-ratio moves are required.
- `PMMA_FILM_GRADE_A`: high-transparency rigid film, residual stress and birefringence require heat relaxation and winding-tension discipline.
- `PVA_FILM_GRADE_A`: water-soluble/barrier film, sensitive to heat history, prioritize thickness uniformity and avoid large draw-ratio moves.

Legacy `BOPET_NEW_GRADE_A` is accepted and normalized to `PET_FILM_GRADE_A`.

## Required Artifact Propagation

Every optimization task must keep the same `product_grade` in:

- `goal_request.json`
- `orchestrator_goal_request.json`
- `product_target.json`
- `team/department_briefs.json`
- `campaigns/<campaign-id>/00_objective/product_target.json`
- `campaigns/<campaign-id>/run_summary.json`
- `outputs/final_recipe.json`

Artifact naming for recipe memory:

- New recipe memory files should use numbered names when they belong to a campaign iteration, for example `best_recipe_memory_001.json`.
- `best_recipe_memory.json` is the canonical latest alias that may mirror the highest numbered entry for convenience.
- The latest alias must always match the highest numbered artifact in the same campaign folder.

`product_context` should include material family, process notes, and historical recipe records. `product_database_ref` should identify the provider used to load product history.

## Agent Responsibilities

Quality Agent:

- Read `product_target.json` before judging pass/fail.
- Evaluate metrics against product-specific targets, not global PET defaults.
- Mention product-specific risk from `product_context.process_notes` when recommending `explore / exploit / recover`.

R&D Agent:

- Use product-specific safety limits and historical recipe signals when ranking levers.
- Avoid reusing PET-only setpoint ranges for PPAT, PMMA, or PVA.
- Explain why the chosen lever is plausible for the selected material family.

Process Agent:

- Convert the R&D plan into a bounded MCP proposal using current product writable limits.
- Preserve rollback baseline and recipe memory for the same product only.
- Reject or replan when product context in proposal, target, and simulator snapshot diverge.

## Online Database Migration Hook

The simulated product catalog is implemented in `simulator/industrial-film-line/product-catalog.mjs`. For real production, replace or wrap this provider with a database-backed provider that returns the same contract:

- `product_grade`
- `display_name`
- `material_family`
- `baseline_setpoints`
- `safety_limits`
- `target_template`
- `process_notes`
- `historical_recipes`
- `product_database_ref`

The orchestrator should not change when moving from simulated product catalog to MES/LIMS/historian product sources.
