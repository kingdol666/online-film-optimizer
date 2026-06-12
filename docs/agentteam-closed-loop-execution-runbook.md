# AgentTeam 闭环优化执行流程与验收记录

本文档记录 `closed-loop-optimizer` AgentTeam 的标准执行方式、三类 Agent 的协同职责、运行工件、验收命令和一次真实模拟验证结果。目标是确保用户只输入“研发目标/目标性能”后，系统可以启动团队协作、调用 MCP/adapter 操作模拟产线、生成最佳 recipe，并留下完整证据链。

## 1. 标准入口

推荐入口：

```bash
npm run optimize:team -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>" --max-iters <N> --seed <SEED>
```

示例：

```bash
npm run optimize:team -- \
  --product-grade PVA_FILM_GRADE_A \
  --goal-text "请完成对 PVA 产线的优化：使得厚度波动下降6%，并输出最终recipe" \
  --max-iters 5 \
  --seed 20260612
```

支持产品：

- `PET_FILM_GRADE_A`
- `PPAT_FILM_GRADE_A`
- `PMMA_FILM_GRADE_A`
- `PVA_FILM_GRADE_A`

如果用户文本中出现 PET/PPAT/PMMA/PVA，入口会自动推断产品；如果显式传入 `--product-grade`，以显式参数为准。

## 2. 执行前配置验收

先确认 Claude Code Skill、Agent 配置、团队协议和运行入口一致：

```bash
npm run agentteam:validate
```

该命令检查：

- `.claude/skills/closed-loop-optimizer/SKILL.md`
- `.claude/agents/closed-loop-optimization-orchestrator.md`
- `.claude/agents/closed-loop-optimization-quality-agent.md`
- `.claude/agents/closed-loop-optimization-rd-agent.md`
- `.claude/agents/closed-loop-optimization-process-agent.md`
- `scripts/optimization/run-team-campaign.mjs`
- `scripts/optimization/lib/team-message-protocol.mjs`
- `scripts/optimization/lib/task-workspace.mjs`

通过标准：

```json
{
  "ok": true,
  "execution_entrypoint": "npm run optimize:team -- --product-grade <PRODUCT_GRADE> --goal-text \"<研发目标>\""
}
```

## 3. AgentTeam 协同顺序

每次优化任务会创建独立目录：

```text
workspace/optimization-tasks/<task-id>/
```

团队初始化阶段写入：

- `goal_request.json`
- `orchestrator_goal_request.json`
- `product_target.json`
- `team/department_briefs.json`
- `team/team_contract.json`
- `team/team_messages.jsonl`
- `team/inbox/<role>/intake_brief.json`

标准角色顺序：

1. Team Lead / Orchestrator 解析用户目标，确定 `product_grade`，创建任务目录和团队契约。
2. Quality Agent 读取目标、产品上下文、快照和在线质量，输出质量诊断与阶段建议。
3. R&D Agent 读取质量诊断、产品历史、当前阶段和 response memory，输出优化策略和候选杠杆排序。
4. Process Agent 读取研发方案、快照、安全边界和 rollback baseline，生成 MCP 可执行 proposal、safety gate 和 approval packet。
5. Adapter/MCP 只执行通过 safety gate 与审批治理的动作。
6. Quality Agent 读取 after-window 结果，判断响应是否有效。
7. Orchestrator 达标时冻结最佳 recipe；未达标时记录停止原因、最佳观测 recipe 和下一步建议。

## 4. 三类 Agent 是否各司其职

Quality Agent 只做质量判断：

- 输入：`product_target.json`、`process_snapshot_XXX.json`、`online_quality_XXX.json`
- 输出：`quality_diagnosis_XXX.json`、`quality_review_XXX.json`、`strategy_state_XXX.json`
- 禁止：生成 setpoint、绕过工艺和安全门

R&D Agent 只做研发策略：

- 输入：质量诊断、产品目标、产品历史 recipe、campaign history、strategy state
- 输出：`rd_optimization_plan_XXX.json`、`rd_brief_XXX.json`
- 禁止：直接写 MCP/PLC、跳过质量结论、跨产品复用参数范围

Process Agent 只做工艺执行包：

- 输入：研发方案、当前快照、产品安全边界、rollback baseline
- 输出：`parameter_delta_proposal_XXX.json`、`safety_gate_result_XXX.json`、`process_brief_XXX.json`、`approval_packet_XXX.json`
- 禁止：绕过 safety gate、缺失 rollback_recipe、跨产品使用 recipe

正式交接全部通过：

- `team/inbox/**`
- `team/team_messages.jsonl`
- `07_coordination/**`
- `08_trial_evidence/trial_XXX/**`

因此当前不是“prompt 口头协作”，而是文件总线和结构化工件驱动的 AgentTeam 协作。

## 5. 运行后验收命令

任务级验收：

```bash
node scripts/optimization/validate-team-workspace.mjs --task-dir "<task_dir>"
```

Campaign schema 验收：

```bash
node .claude/skills/closed-loop-optimizer/scripts/validate-campaign.mjs --run-dir "<campaign_dir>"
```

MCP smoke 验收：

```bash
npm run sim:mcp:smoke
```

关键通过项：

- `team_contract_valid=true`
- `required_fields_valid=true`
- `protocol_bus_contains_role_messages=true`
- `recipe_recommendation=true`
- `final_recipe_stability_check=true`
- `best_recipe_memory=true`
- `evidence_root=true`

## 6. 本次实测记录

执行命令：

```bash
npm run optimize:team -- \
  --product-grade PVA_FILM_GRADE_A \
  --goal-text "请完成对 PVA 产线的优化：使得厚度波动下降6%，并输出最终recipe" \
  --max-iters 5 \
  --seed 20260612
```

生成任务目录：

```text
workspace/optimization-tasks/请完成对-pva-产线的优化-使得厚度波动下降6-并输出最终recipe-20260611171143048-6R3U
```

生成 Campaign：

```text
campaigns/CMP-SIM-PVA_FILM_GRADE_A-20260611171143092-HDFK
```

目标解析：

```json
{
  "metric": "thickness_cv",
  "applied_as": "max",
  "baseline_value": 2.0134,
  "derived_value": 1.892596,
  "source_text": "厚度波动下降6%"
}
```

团队协同结果：

- Quality Agent 判断主质量缺口为 `thickness_cv`，建议进入 `exploit`。
- R&D Agent 选择主杠杆 `winder_tension`，方向为 `decrease`，产品安全范围为 `[42, 70]`。
- Process Agent 生成变更：`winder_tension: 54 -> 53.1`，delta `-0.9`，safety gate 通过。
- MCP/adapter 执行成功，写入 receipt。
- 最佳观测 recipe 达到目标。

最终 recipe：

```json
{
  "candidate_recipe_id": "RCP-CANDIDATE-20260611171143157-HKGZ",
  "product_grade": "PVA_FILM_GRADE_A",
  "material_family": "PVA",
  "goal_reached": true,
  "final_quality_state": "PASS_BEST_OBSERVED",
  "setpoints": {
    "extruder_speed": 55,
    "melt_temp": 188,
    "casting_roll_temp": 31,
    "md_draw_ratio": 2.42,
    "md_zone_temp": 72,
    "td_draw_ratio": 2.78,
    "td_zone_1_temp": 82,
    "td_zone_2_temp": 88,
    "heatset_temp": 98,
    "relaxation_ratio": 7.8,
    "line_speed": 18,
    "winder_tension": 53.1
  },
  "metrics": {
    "thickness_cv": 1.7791,
    "birefringence_cv": 4.0778
  },
  "production_use_policy": "shadow_validation_required_before_full_release"
}
```

目标达成判断：

- 基线 `thickness_cv=2.0134`
- 目标上限 `thickness_cv<=1.892596`
- 最佳观测 `thickness_cv=1.7791`
- 结论：目标达成，输出 candidate recipe。

## 7. 本次发现并修复的问题

问题：

“厚度波动下降6%”曾被自然语言解析器同时映射为 `thickness_cv` 和 `thickness_mean`，导致系统额外追求不合理的厚度均值目标。

修复：

将 `thickness_mean` 的中文触发词从泛化的“厚度”收窄为“厚度均值 / 厚度平均 / 膜厚均值 / 膜厚平均”，使“厚度波动”只映射到 `thickness_cv`。

修复后验证：

```json
[
  {
    "metric": "thickness_cv",
    "source_text": "厚度波动下降6%",
    "directive_type": "relative_percent",
    "percent": 6,
    "direction": "decrease"
  }
]
```

## 8. 合理性结论

当前执行过程是合理的。

原因：

- 用户入口只需要研发目标和可选产品型号。
- Orchestrator 能创建独立任务工作目录，并写入团队契约。
- Quality、R&D、Process 三个 Agent 的职责边界清晰，没有互相越权。
- 每个 Agent 都通过结构化 JSON 工件交接，而不是靠隐式上下文。
- Process Agent 只通过 safety gate 和 approval packet 形成可执行动作。
- MCP/adapter 的执行结果会反馈给质量评价，形成闭环。
- 最终 recipe、best recipe memory、rollback baseline、trial evidence 都会保存。
- 验收脚本能验证团队消息协议、产品一致性、campaign schema 和最终 recipe 可用性。

仍需注意：

- 当前是模拟产线验证，真实产线接入前必须启用真实 online bridge、审批系统、设备 tag map、historian 和 shadow validation。
- `PASS_BEST_OBSERVED` 表示最佳观测窗口达标，最终稳定窗口仍需在真实产线做更长 hold window 验证。
- 上线真实设备前必须保留人工审批、回退和 offline validation。
