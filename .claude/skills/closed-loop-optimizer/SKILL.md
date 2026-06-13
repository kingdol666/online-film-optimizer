---
name: closed-loop-optimizer
description: |
  DOE-driven pilot-line recipe-development entry skill for biaxial film. Treats the MCP-connected line as a 中试线 (pilot line) and runs a rigorous 4-phase Design-of-Experiments campaign (screening → response-surface → optimization → confirmation/robustness) to develop a production-ready recipe that meets all performance targets. Verifies backend + MCP connectivity, creates a three-role expert team (DOE Designer / Measurement & Stats Lead / Trial Execution Lead) coordinated by a Principal-Investigator orchestrator, and drives the team through evidence-based stage gates until a recipe is confirmed and frozen. Trigger words: 产线优化, recipe 开发/研发, DOE 试验, 配方开发, 团队协同优化, 双折射/厚度/透光率优化, 中试线试验. The full DOE methodology lives in `references/doe-campaign-framework.md`; each role's methods live in the `quality-engineer` / `rd-engineer` / `process-engineer` skills.
---

# Closed-Loop Optimizer — DOE Campaign on the Pilot Line

> **What this is:** the MCP-connected line is a **中试线 (pilot line)** — an instrumented, reduced-scale representation of the production biaxial-film process. Its job is R&D. We run **designed experiments (DOE)** on it to develop a **production-ready recipe** (a setpoint vector meeting all performance targets, confirmed robust). This is how a real film R&D team develops a recipe — not by guessing parameters, but by a disciplined experimental campaign.

## Behavioral Code (the whole team follows these)

A pilot line is still real equipment, real material, real money. Every team member obeys:

1. **Evidence first.** No run is executed without a reviewed design matrix and a passed safety gate. No phase advances without statistical evidence.
2. **Minimum effective action.** Designs stay inside the safety envelope; step sizes respect `max_delta`; a run is one data point in a matrix, not a free-form tweak.
3. **Always reversible.** Every execution has a confirmed rollback baseline. A worsening run triggers rollback without waiting for approval.
4. **Fully auditable.** Every design, every run, every analysis, every gate decision is written to a timestamped artifact with its evidence.
5. **Honest about uncertainty.** Low-confidence analyses are labeled. "I don't know — we need another replicate" beats a confident wrong answer.

## The DOE Campaign (4 sequential phases)

Detailed methodology: `references/doe-campaign-framework.md`. Summary:

```
Phase 0 FRAME   → Phase 1 SCREEN   → Phase 2 CHARACTERIZE → Phase 3 OPTIMIZE → Phase 4 CONFIRM
lock Y/X/budget   fractional          CCD / Box-Behnken      desirability       replicates +
MSA sanity        factorial + center  2nd-order model        multi-response     robustness
                  points              ANOVA + LOF            predicted recipe   hold-window
                  vital few + curve?  model adequate?        opt in window?     PASS+robust?
                  ◄── rework          ◄── augment            ◄── steepest asct  ◄── iterate → FREEZE
```

The campaign is **sequential**: each phase's statistical analysis decides the next phase's design. The PI (orchestrator) enforces the stage gates — see the gate table in the framework.

## Team Roles (DOE expert hats)

| Role | DOE hat | Owns | Tools |
|---|---|---|---|
| Orchestrator | **Principal Investigator (PI)** / Campaign Director | roadmap, stage gates, budget, final accountability | coordination only — no line writes |
| `quality-engineer` agent | **Measurement & Statistical-Analysis Lead** | MSA, response measurement, ANOVA/effects/curvature/LOF, significance vs practicality, gate evidence | read-only MCP |
| `rd-engineer` agent | **DOE Designer / Process-Development Scientist** | design matrices, factor space, model-based prediction, multi-response optimum, confirmation plan | read-only MCP |
| `process-engineer` agent | **Pilot-Line Trial-Execution Lead** | run-by-run MCP execution in randomized order, stabilization, run-to-run reset, response collection, deviation logging | **only role with MCP writes** |

Each role invokes its own skill (`quality-engineer` / `rd-engineer` / `process-engineer`) for its methodology. The three experts **cross-validate**: Quality's analysis must match R&D's model predictions; Process's observed run responses must match Quality's measurements. Disagreement is investigated before the campaign advances.

## Skill Startup Contract (when triggered from a Claude Code conversation)

1. Parse the user goal → infer `product_grade` (PET / PPAT / PMMA / PVA; default PET_FILM_GRADE_A).
2. **MCP connectivity gate** — verify read tools (`film_line_get_state`, `film_line_get_snapshot`, `film_line_get_online_quality`, `film_line_list_writable_parameters`, `film_line_list_products`) and, for the process role, write tools (`film_line_preview_proposal`, `film_line_apply_proposal`, `film_line_run_until_stable`, `film_line_rollback`, `film_line_save_candidate_recipe`, `film_line_load_recipe_baseline`). Verify backend health if the local backend participates (`curl -fsS http://127.0.0.1:4317/api/health`).
3. **If the gate fails, stop** and report the exact missing dependency. Do not fake a start.
4. Create the task workspace under `workspace/optimization-tasks/<task-id>/` and write the Phase-0 campaign charter (`00_frame/campaign_charter.json`: locked Y targets, factor ranges inside safety, budget, success criteria, product grade).
5. Create the team with `TeamCreate`; spawn **all three** role agents up front with `Agent`, **`mode: "auto"`** (so teammates run without permission prompts and inherit the project's `defaultMode: auto`). They are the standing team for the whole campaign.
6. Drive the team through the phases with `SendMessage` + file artifacts. Each phase: R&D designs → PI reviews → Process executes runs → Quality analyzes → PI gates → next phase.
7. Run until a recipe is confirmed-and-frozen, or a governance hard-stop fires.
8. Validate the final artifact set; `TeamDelete` to close the team.

**Fallback order:** (1) native `TeamCreate` + `Agent` + `SendMessage`; (2) native `Agent` only with file-bus artifacts. If neither is available, stop and report — do not substitute shell-script orchestration during a user-triggered campaign.

## Phase Orchestration Cadence

The PI does not micromanage every run. It owns the **cadence and the gates**:

- **Within a phase:** R&D emits the design → PI reviews it → Process executes the run matrix (gate → apply → stabilize → collect → reset, per run) → Quality analyzes the batch → PI gates.
- **At a stage gate:** the PI advances ONLY on Quality's documented statistical verdict + R&D's reviewed next design. No gate passes on a single run, a hunch, or "looks better."
- **Hard stops:** no active factors after screening (re-frame); persistent model LOF that augmentation won't fix; confirmation failure pointing to model error; budget exhaustion; safety emergency.

Gate criteria are in `references/doe-campaign-framework.md` §8.

## Native Teamwork Rules

- One user-facing skill (this one) as the entrypoint; specialist behavior in `.claude/agents/*.md`; methodology in the role skills.
- Tool scoping on each subagent enforces role boundaries (the permission matrix below).
- Every cross-role decision lives in files and messages, never hidden chat context.
- The three role agents are spawned once and stay alive for the whole campaign — not recreated per run.
- `SendMessage` + `team/team_messages.jsonl` + the numbered phase artifacts are the official handoff layer.

## MCP Permission & Execution Model

Role agents are **reasoning + artifact** agents — each carries only the basic tools (`Read, Write, Glob, Grep, TodoWrite, SendMessage`; the PI adds `Agent/TeamCreate/TeamDelete`). MCP line tools are **not** injected into spawned subagents in this environment; they live in the **main session** that runs the campaign. So the permission boundary is enforced as **authority**, not as a per-agent tool whitelist:

| Role | Line-write authority | How a line write actually happens |
|---|---|---|
| Orchestrator (PI) | ❌ never | — |
| Quality | ❌ never | — |
| R&D | ❌ never | — |
| **Process** | ✅ **sole proposer** | the process role emits a safety-gated `parameter_delta_proposal`; the **main session** executes it via MCP (preview → apply → run_until_stable → collect) and writes the receipt back to the task workspace |

Governance is unchanged in spirit: **only the process role can authorize a line write**, and every write still passes the Five-Gate Safety Protocol with a confirmed rollback baseline. What changed is *where* the MCP call is made — at the main session (where MCP is available), driven by the process role's proposal artifact — not inside a subagent that has no MCP access. The agents never need MCP tools in their own whitelist; they produce the proposal/analysis, the main session acts on the line.

## Completion Contract (recipe freeze + transfer)

A campaign ends in one of:

1. **FREEZE** — a recipe confirmed (Phase 4 PASS: confirmation replicates in target + within prediction interval, robustness perturbations in spec, hold-window met). Deliverable:
   - `outputs/final_recipe.json` — the frozen setpoint vector + predicted/confirmed responses + evidence refs
   - `04_confirm/confirmation_<n>.json` — replicate + robustness results
   - `stage_gate_confirm.json` — the freeze decision + justification
   - `team/handoffs/final.md`
   - The recipe is flagged **pilot-confirmed, ready for production transfer** (scale-up validation on the real production line is the next, separate step — out of scope here).
2. **Iterate** — best-observed recipe preserved with stop reason + recommended next phase (e.g. "RSM had LOF, augment design"; "optimum outside region, steepest ascent needed").
3. **Hard stop** — budget exhausted, persistent failure, or safety event. Output best-observed recipe + full evidence + stop reason.

After FREEZE/stop and artifact validation, the PI closes the team with `TeamDelete`.

## Rules

- Treat the MCP line as a real pilot line — every run auditable and safe.
- Keep deterministic safety gates outside the LLM (the Five-Gate Protocol).
- Never let an LLM write PLC tags directly; never bypass a safety gate.
- Every design is reviewed by the PI before execution; every gate is evidence-based.
- Don't mix product contexts (PET targets/limits never reused for PMMA/PVA/PPAT).
- Prefer artifact-driven collaboration over implicit context: charter, design, run logs, analysis, gate decisions all written to files.
- Keep best-observed recipe memory synced with the rollback baseline.
- Read these before complex runs: `references/doe-campaign-framework.md`, `references/team-orchestration.md`, `references/native-claude-code-teamwork.md`, `references/coordination-protocol.md`.

## SubAgent Use

The orchestrator agent `closed-loop-optimization-orchestrator` is the campaign controller (PI). It dispatches the three role agents — `closed-loop-optimization-quality-agent`, `closed-loop-optimization-rd-agent`, `closed-loop-optimization-process-agent` — via native Claude Code team primitives and the shared artifact protocol. Each role agent loads its own skill for methodology.
