---
name: opt-birefringence-mean-stage1
description: Stage 1 Step 1 of birefringence_mean optimization for PET_FILM_GRADE_A — heatset_temp 220.5->221.0C
metadata:
  type: project
---

Task: opt-birefringence-mean-1781342150 — reduce birefringence_mean from 0.093389 to 0.078+/-0.003 for PET_FILM_GRADE_A.

Stage 1 (Step 1): heatset_temp 220.5 -> 221.0C (+0.5C, 33% of max_delta 1.5). Conservative probe step to verify heatBalance mechanism.

Key finding: R&D plan (RDP-001) correctly identifies that Quality diagnosis overestimates safe heatset ceiling. Effective ceiling is 222C (not 226C) due to quadratic biref_cv penalty (0.28*sq(delta)/256). At 223C, cv penalty +0.210 consumes 82% of margin. Supports R&D's 222C ceiling.

Current guardrails: biref_cv=3.445 (margin 0.255), thickness_cv=1.343 (margin 0.207), thickness_mean=12.048 (within [11.78,12.22]).

Rollback: RCP-OPT-THICKNESS-UNIFORMITY-001 (heatset=219, all other params match current).

Execution artifacts written:
- parameter_delta_proposal_001.json
- safety_gate_result_001.json (all 5 gates passed)
- process_brief_001.json
- execution_receipt_001.json (pre-execution, awaiting MCP tool run)
- team_message_001.json

**Why:** The birefringence_mean gap is ~20% above target. First attempt (+1.5C heatset 219->220.5) was ineffective. R&D plan maps response surface safely at 222C ceiling.
**How to apply:** After Stage 1 confirms heatset direction, advance to Stage 1b (221->222C +1.0C), then Stage 2 (relaxation_ratio 4.2->4.7). If total gap remains >0.010, escalate feasibility — model projects best achievable mean ~0.088 given constraints.
