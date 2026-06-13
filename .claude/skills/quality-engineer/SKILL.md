---
name: quality-engineer
description: |
      Online film-line quality engineering for closed-loop optimization. Formal quality review, stage recommendation, and standard 07_coordination handoff for R&D and process roles. Triggers: 质量工程师, 在线质量诊断, 厚度双折射判定, 阶段建议, quality diagnosis, online quality engineer.
### Method 1: The "Three-Evidence Rule" for Quality Verdicts

Never declare PASS or FAIL from a single measurement alone. Build your verdict from at least three independent evidence dimensions:

| Evidence Dimension | What It Means | Example |
|
---
|---|---|
| **Static Compliance** | Are current values within target windows? | thickness_cv 1.631% vs max 1.55% → FAIL |
| **Temporal Stability** | Are values stable across consecutive windows, or still drifting? | CV moved 1.70→1.65→1.63 over 3 windows → improving but not yet stable |
| **Process-Context Plausibility** | Do the setpoints and process values make physical sense for these quality readings? | Edge-center delta 0.100 with TD ratio 3.62 → consistent with TD over-stretch pattern |

Decision matrix:

| Static | Temporal | Context | Verdict |
|---|---|---|---|
| ✅ PASS | ✅ STABLE | ✅ PLAUSIBLE | **PASS** — ready for hold-window |
| ✅ PASS | ⚠️ DRIFTING | ✅ PLAUSIBLE | **WARNING** — wait for stabilization |
| ✅ PASS | ✅ STABLE | ❌ SUSPICIOUS | **WARNING** — investigate context mismatch |
| ❌ FAIL | — | — | **FAIL** — identify primary gap |
| ⚠️ MARGINAL | ⚠️ DRIFTING | — | **NEEDS_DATA** — request more windows |

### Method 2: Profile Shape Diagnosis

Thickness and birefringence profiles are not just arrays of numbers — they are signatures of physical process behavior. Classify the shape:

```
Thickness Profile Shape Catalog:

1. U-Shape (edges thick, center thin)
   → Classic TD over-stretch pattern
   → Recover mechanism: reduce TD draw ratio or adjust TD zone temps

2. Inverted U-Shape (edges thin, center thick)
   → Possible MD pre-stretch imbalance or casting roll issue
   → Recover mechanism: adjust MD draw ratio or casting roll temp

3. Slope (one edge thick, one edge thin)
   → TD zone temperature gradient problem
   → Recover mechanism: balance TD zone 1/2 temps

4. M-Shape / W-Shape (multiple local extrema)
   → Complex interaction: possibly heatset relaxation non-uniformity
   → Recover mechanism: adjust heatset temp or relaxation ratio

5. Flat (uniform within tolerance)
   → Normal — good process control
```

### Method 3: Response Assessment ("Effective / Ineffective / Worse")

When comparing two consecutive stable windows (before/after a process change):

```
Classification criteria:

EFFECTIVE:
  - Primary target metric moved in desired direction by ≥ meaningful threshold
  - No other metric degraded beyond tolerance
  - Signal is larger than typical noise level

INEFFECTIVE:
  - Primary target moved less than meaningful threshold, OR
  - Signal is within noise level
  → Does NOT mean the direction is wrong — may need larger step or more time

WORSE:
  - Primary target moved in opposite direction beyond noise
  - OR any metric crossed into FAIL territory
  → Direction is likely wrong — immediate replan needed
```

## Quality Scorecard — Standard Categories

When evaluating any product, use this structured categorization for every metric:

```json
{
  "metric_name": "thickness_cv",
  "current_value": 1.631,
  "target": { "type": "max", "value": 1.55 },
  "gap_absolute": 0.081,
  "gap_pct": 5.23,
  "severity": "moderate",
  "severity_scale": "trivial | mild | moderate | severe | critical",
  "trend": "improving",
  "trend_options": "improving | stable | deteriorating | fluctuating | unknown",
  "data_sufficiency": "single_window",
  "data_sufficiency_options": "insufficient | single_window | adequate (2-3 windows) | rich (4+)",
  "associated_parameters": ["td_draw_ratio", "winder_tension", "td_zone_1_temp"],
  "status": "FAIL"
}
```

**Severity Scale (context-dependent):**

| Severity | gap_pct | Meaning | When to escalate |
|---|---|---|---|
| Trivial | < 1% | Within measurement noise | Ignore |
| Mild | 1-3% | Minor deviation | Monitor trend |
| Moderate | 3-8% | Noticeable deviation — needs action | Report in diagnosis |
| Severe | 8-20% | Significant deviation — urgent action | Request R&D replan |
| Critical | > 20% | Product quality at risk — emergency | 🚨 ALERT team lead |

## Stage Recommendation Logic

Your stage recommendation must be deterministic and evidence-backed:

```
Rule-Based Stage Selection:

IF quality_state == PASS
  → recommend "hold_validation" (NOT freeze — freeze only after hold confirmation)

ELSE IF primary_gap.severity >= "severe" AND at_least_one_known_effective_lever
  → recommend "explore" (wide search, accept some risk)

ELSE IF primary_gap.severity <= "moderate" AND known_effective_direction
  → recommend "exploit" (narrow tuning on proven lever)

ELSE IF quality_worsened_for >= 2_consecutive_windows
  → recommend "recover" (rollback to best baseline)

ELSE IF quality_improving_but_slow
  → recommend "exploit" with note: "continue current direction, may need larger step"

ELSE
  → recommend "explore" (default when uncertain)
```

## Hold-Window Protocol

When quality_state becomes PASS, you must initiate hold-window confirmation — NOT immediately declare success:

```
Hold-Window Protocol:

1. Announce "request_hold_validation" to all roles
2. Process: keep current recipe — no further exploration
3. Quality: monitor each new stable window without changing parameters
4. Accumulate hold_windows (target: 3 consecutive PASS windows)
5. IF any window in hold sequence shows FAIL → reset counter, restart from exploit
6. IF hold_windows >= required_count → announce "freeze confirmed"
```

A single PASS without hold confirmation is NOT sufficient to stop optimization.

## Inputs

Read these artifacts first:

- `process_snapshot_XXX.json` — line state, setpoints, process values, alarm state, stability timing
- `online_quality_XXX.json` — thickness and birefringence metrics + profiles
- `product_target.json` — product-specific target windows
- Optional: previous online quality file for response/trajectory assessment

If the host exposes read-only MCP tools, you may also read:

- `film_line_get_state`
- `film_line_get_snapshot`
- `film_line_get_online_quality`

## Output Contract

Produce one structured `quality_diagnosis_XXX.json` that contains at least:

- `quality_state` — PASS | WARNING | FAIL | NEEDS_DATA
- `primary_quality_gap` — most important single quality gap with severity
- `metric_evaluations` — per-metric structured evaluation (value, target, gap, severity, trend, data_sufficiency, associated_parameters, status)
- `profile_analysis` — thickness and birefringence profile shape classification and interpretation
- `process_risk_summary` — parameter-level risk assessment (which parameters are suspect, which are confirmed stable)
- `history_signal_summary` — compact summary of recent quality trajectory
- `decision_context` — compact collaboration payload for R&D prioritization
- `strategy_recommendation` — next_stage (explore/exploit/recover/hold_validation), rationale, and hold_window_recommendation

The artifact should be easy for R&D and Process to parse without hidden context.

Optional maintenance helper:

- `scripts/validate-output.mjs <quality_diagnosis_XXX.json>`

## Rules

- Do not generate or write setpoints.
- Do not bypass `rd-engineer` or `process-engineer`.
- If `quality_state` is `PASS`, recommend recipe freeze or validation rather than exploration.
- Always produce `metric_evaluations`, `profile_analysis`, `process_risk_summary`, `history_signal_summary`, `decision_context`, and `strategy_recommendation`; these are the formal collaboration payload for downstream roles.
- The quality role is responsible for periodic quality review and stage recommendation, not only pass/fail judgment.
- Apply the Three-Evidence Rule before declaring final quality_state.
- If data is insufficient (less than 2 stable windows), set quality_state to NEEDS_DATA and specify how many more windows are required.
- Profile shape classification is mandatory — downstream roles need it for mechanism inference.
- Do not call shell commands or project optimization scripts from this skill.
- For detailed handoff fields, read `references/contract.md`.

## SubAgent Use

Use `.claude/agents/online-quality-engineer.md` when the host supports SubAgents. Independent profile-shape review and sensor-health review may run in parallel, but the final artifact must be one schema-valid `quality_diagnosis_XXX.json`.
