# 在线闭环控制优化平台开发 PLAN

> 目标：先在虚拟产业工况中跑通“质量诊断 -> 研发策略 -> 工艺执行 -> 在线检测反馈 -> recipe 固化”的完整闭环，再把模拟黑盒替换为真实薄膜双拉中试线接口。

## 1. 背景与核心判断

当前项目已经具备工业诊断 skill，可以作为“质量工程师”角色的核心能力。后续应新增“研发工程师”和“工艺工程师”两个角色，并通过结构化产物协同，形成在线研发优化闭环。

第一阶段不要直接连接真实设备做自动优化，而是开发一个**模拟产业工况黑盒客户端**：

- 对平台来说，它像一台真实薄膜双拉中试线。
- 平台只能通过 API/MCP 调整工艺 setpoint。
- 平台只能读取过程快照、在线厚度、在线双折射、报警和实验结果。
- 平台不能读取黑盒内部函数、真实最优点、扰动模型或隐含缺陷机制。
- 平台必须通过实验和数据逐步学习如何优化。

这样做的价值是：先验证闭环控制逻辑、数据契约、安全门、Agent 协同和优化算法，再把模拟器替换成真实 PLC/DCS 与在线检测设备。

## 2. 总体目标

开发一个“在线闭环控制优化平台”的 MVP，能够在模拟产业工况下完成：

1. 创建新品研发优化 campaign。
2. 采集当前工艺快照和在线检测指标。
3. 使用质量工程师诊断当前质量状态。
4. 使用研发工程师提出下一步优化方案。
5. 使用工艺工程师将方案转成设备可执行参数调整。
6. 经过 safety gate 检查后写入模拟黑盒客户端。
7. 采集新响应窗口和在线质量指标。
8. 判断继续优化、局部微调、回滚、停止或固化 recipe。
9. 将最佳 recipe 写入模拟 recipe 数据库。

## 3. 开发原则

### 3.1 先闭环，再智能

第一阶段的核心成功标准不是算法最强，而是闭环真实可运行：

```text
objective
  -> process_snapshot
  -> quality_diagnosis
  -> rd_optimization_plan
  -> parameter_delta_proposal
  -> safety_gate_result
  -> execution_receipt
  -> experiment_result
  -> next_decision
  -> recipe_candidate
```

### 3.2 模拟客户端必须是黑盒

优化平台不能读取模拟函数内部逻辑。模拟器应作为独立服务运行，只暴露工业接口。

允许读取：

- 当前 setpoint
- 当前 process snapshot
- 在线 thickness profile
- 在线 birefringence profile
- 质量聚合指标
- 报警状态
- recipe version
- experiment result

不允许读取：

- 内部真实最优参数
- 质量函数公式
- 隐含工况类型
- 噪声模型参数
- 未暴露的缺陷机制

### 3.3 安全放行必须确定性

工艺参数写入必须经过 deterministic safety gate。Agent 可以解释安全门结果，但不能覆盖安全门拒绝。

### 3.4 每一步必须可学习

每次参数调整都必须产生 `experiment_id`，并记录：

- 调整前稳定窗口
- 参数变化
- 调整后滞后期
- 调整后稳定窗口
- 在线质量响应
- 是否报警
- 是否回滚
- 操作备注
- 研发判断

## 4. 系统角色设计

### 4.1 Quality Engineer Agent

现有 `industrial-deep-diagnostic` skill 应包装为质量工程师角色。

职责：

- 读取过程快照和在线检测指标。
- 判断当前质量是否达标。
- 识别厚度、双折射、均匀性、漂移、边中差等异常。
- 判断上一轮参数调整是否有效。
- 输出证据等级和置信度。
- 遇到证据不足时输出 `NEEDS_DATA`。

输入：

- `process_snapshot.json`
- `online_quality_map.json`
- `experiment_result.json`
- `product_target.json`
- `ontology.json`
- `recipe_version.json`

输出：

- `quality_diagnosis.json`
- `quality_state_report.md`
- `evidence.json`
- `confidence.json`

第一版判断范围：

- 在线厚度均值是否达标。
- 厚度横向 CV 是否达标。
- 双折射均值是否达标。
- 双折射横向 CV 是否达标。
- 边部与中部差异是否恶化。
- 本轮调整是否改善目标指标。

### 4.2 R&D Engineer Agent

研发工程师负责“想下一步怎么优化”，不是直接写设备。

职责：

- 读取质量工程师诊断。
- 读取当前快照、在线检测、历史 experiment ledger。
- 使用本体模型和物理加工知识推断候选参数。
- 输出低维 DOE 或局部微调计划。
- 判断是否继续优化、回滚、等待更多数据或固化 recipe。

输入：

- `quality_diagnosis.json`
- `process_snapshot.json`
- `online_quality_map.json`
- `experiment_ledger.jsonl`
- `product_target.json`
- `ontology.json`
- `recipe_history.json`

输出：

- `rd_optimization_plan.json`
- `experiment_plan.json`
- `parameter_window.json`
- `stop_or_continue_decision.json`
- `recipe_release_recommendation.json`

第一版策略：

- 不做复杂全局优化。
- 每轮只选择 1-2 个主变量。
- 优先低风险参数。
- 必须声明固定参数。
- 必须声明预期响应和停止条件。
- 如果连续两轮响应方向与预期矛盾，输出 `needs_reanalysis`。

### 4.3 Process Engineer Agent

工艺工程师负责“怎么安全执行研发方案”。

职责：

- 将研发计划拆成设备 setpoint delta。
- 检查稳态、报警、参数范围、变化率。
- 调用 safety gate。
- 第一版要求人工确认后写入模拟客户端。
- 记录写入、回读、滞后、响应和回滚。

输入：

- `experiment_plan.json`
- `parameter_window.json`
- `process_snapshot.json`
- `recipe_version.json`
- `safety_policy.json`

输出：

- `parameter_delta_proposal.json`
- `safety_gate_result.json`
- `execution_receipt.json`
- `experiment_result.json`

第一版执行规则：

- 未稳态不执行。
- 有报警不执行。
- safety gate 未通过不执行。
- 没有 rollback recipe 不执行。
- 每次只执行一个 proposal。
- 写入后必须回读确认。

## 5. 黑盒模拟产业客户端设计

### 5.1 模拟对象

模拟对象是一条薄膜双拉中试线，包含：

- 挤出段
- 铸片段
- MD 纵拉段
- TD 横拉段
- 热定型段
- 冷却段
- 收卷段
- 在线厚度检测
- 在线双折射检测

### 5.2 平台可调参数

第一版建议控制 8-12 个变量，不要太多：

| 参数 | 物理含义 | 类型 | 第一版是否开放 |
|---|---|---|---|
| `extruder_speed` | 挤出量 / 产量 | continuous | 只读或低风险微调 |
| `melt_temp` | 熔体温度 | continuous | P1 开放 |
| `casting_roll_temp` | 铸片辊温度 | continuous | P1 开放 |
| `md_draw_ratio` | 纵拉比 | continuous | P1/P2 开放 |
| `md_zone_temp` | 纵拉区温度 | continuous | P1 开放 |
| `td_draw_ratio` | 横拉比 | continuous | P1/P2 开放 |
| `td_zone_1_temp` | 横拉前区温度 | continuous | P1 开放 |
| `td_zone_2_temp` | 横拉中区温度 | continuous | P1 开放 |
| `heatset_temp` | 热定型温度 | continuous | P1 开放 |
| `relaxation_ratio` | 热定型松弛 | continuous | P2 开放 |
| `line_speed` | 线速度 | continuous | P2 开放 |
| `winder_tension` | 收卷张力 | continuous | P1 开放 |

### 5.3 模拟输出指标

在线检测指标：

- `thickness_mean`
- `thickness_cv`
- `thickness_edge_center_delta`
- `thickness_profile`
- `birefringence_mean`
- `birefringence_cv`
- `birefringence_edge_center_delta`
- `birefringence_profile`

过程状态：

- `line_stable`
- `alarm_active`
- `transition_state`
- `time_since_last_change_sec`
- `waste_meter`
- `energy_index`

离线慢标签，第一版可模拟但不作为闭环强依赖：

- `tensile_strength_md`
- `tensile_strength_td`
- `thermal_shrinkage`
- `haze`
- `surface_defect_index`

### 5.4 黑盒内部建议逻辑

模拟器内部可以有复杂函数，但平台不能读取。

建议内部包含这些工业特征：

1. 多变量耦合  
   厚度受挤出速度、线速度、TD 拉伸比影响；双折射受 MD/TD 拉伸比、温度、热定型影响。

2. 非线性  
   某些参数存在最佳窗口，过高或过低都会变差。

3. 滞后响应  
   参数变化后不会立即反映在检测指标上，需要若干分钟或若干模拟 tick。

4. 噪声  
   在线检测存在随机噪声、周期扰动和局部 profile 波动。

5. 工况漂移  
   模拟材料批次、环境温度或设备热平衡导致慢漂移。

6. 约束和报警  
   参数越界、变化率过快或组合不合理时触发报警。

7. 隐含产品目标  
   每个 product grade 有不同目标窗口，平台只知道目标，不知道内部最优点。

### 5.5 黑盒 API

建议模拟器作为独立 Node.js 或 Python FastAPI 服务。

端点：

```text
POST /sim/reset
GET  /sim/state
GET  /sim/snapshot
GET  /sim/online-quality
POST /sim/proposal/preview
POST /sim/apply
POST /sim/tick
POST /sim/run-until-stable
POST /sim/rollback
GET  /sim/recipe
POST /sim/recipe/save-candidate
GET  /sim/ledger
```

### 5.6 黑盒状态机

```text
IDLE
  -> BASELINE_RUNNING
  -> READY_FOR_EXPERIMENT
  -> APPLYING_CHANGE
  -> TRANSITION
  -> STABLE
  -> EVALUATING
  -> READY_FOR_NEXT
```

异常状态：

```text
ALARM
ROLLBACK_REQUIRED
SENSOR_FAULT
OUT_OF_CONTROL
```

## 6. 数据契约

### 6.1 product_target.json

```json
{
  "campaign_id": "CMP-20260610-001",
  "product_grade": "BOPET_NEW_GRADE_A",
  "targets": {
    "thickness_mean": { "target": 12.0, "tolerance": 0.25 },
    "thickness_cv": { "max": 1.8 },
    "birefringence_mean": { "target": 0.082, "tolerance": 0.004 },
    "birefringence_cv": { "max": 3.0 }
  },
  "constraints": {
    "max_waste_meter": 800,
    "max_iterations": 20,
    "manual_approval_required": true
  }
}
```

### 6.2 process_snapshot.json

```json
{
  "timestamp": "2026-06-10T10:00:00Z",
  "campaign_id": "CMP-20260610-001",
  "experiment_id": "EXP-000",
  "recipe_id": "RCP-BASELINE",
  "line_state": "STABLE",
  "setpoints": {
    "md_draw_ratio": 3.2,
    "td_draw_ratio": 3.7,
    "heatset_temp": 218.0
  },
  "process_values": {
    "melt_temp": 278.4,
    "line_speed": 42.0,
    "winder_tension": 118.0
  },
  "alarm_active": false,
  "time_since_last_change_sec": 900
}
```

### 6.3 online_quality_map.json

```json
{
  "timestamp": "2026-06-10T10:00:00Z",
  "campaign_id": "CMP-20260610-001",
  "experiment_id": "EXP-000",
  "metrics": {
    "thickness_mean": 12.16,
    "thickness_cv": 2.1,
    "thickness_edge_center_delta": 0.18,
    "birefringence_mean": 0.077,
    "birefringence_cv": 3.8,
    "birefringence_edge_center_delta": -0.006
  },
  "profiles": {
    "position_norm": [0, 0.25, 0.5, 0.75, 1.0],
    "thickness": [12.22, 12.11, 12.02, 12.14, 12.31],
    "birefringence": [0.073, 0.076, 0.079, 0.076, 0.072]
  },
  "sensor_health": "OK"
}
```

### 6.4 quality_diagnosis.json

```json
{
  "quality_state": "WARNING",
  "primary_quality_gap": "birefringence_cv_high",
  "affected_metrics": ["birefringence_mean", "birefringence_cv"],
  "suspected_process_regions": ["TD_stretching", "heat_setting"],
  "evidence_level": 3,
  "confidence": 0.68,
  "recommended_next_action": "continue_optimization",
  "blocking_issues": []
}
```

### 6.5 rd_optimization_plan.json

```json
{
  "objective": "reduce_birefringence_cv_without_worsening_thickness_cv",
  "hypothesis": "TD temperature profile and heatset temperature are driving transverse birefringence nonuniformity",
  "fixed_parameters": ["extruder_speed", "line_speed", "casting_roll_temp"],
  "candidate_parameters": [
    {
      "name": "td_zone_2_temp",
      "direction": "increase",
      "step": 1.0,
      "allowed_range": [108, 116],
      "expected_response": "birefringence_cv_decrease"
    }
  ],
  "hold_time_minutes": 10,
  "success_criteria": ["birefringence_cv_decrease_gt_2_percent", "thickness_cv_not_worse"],
  "stop_rules": ["alarm_active", "thickness_cv_worse_gt_5_percent"]
}
```

### 6.6 parameter_delta_proposal.json

```json
{
  "campaign_id": "CMP-20260610-001",
  "experiment_id": "EXP-001",
  "source_plan": "rd_optimization_plan.json",
  "setpoint_changes": [
    {
      "tag": "td_zone_2_temp",
      "current": 112.0,
      "target": 113.0,
      "delta": 1.0,
      "ramp_limit_per_min": 0.5
    }
  ],
  "rollback_recipe": "RCP-BASELINE",
  "expected_lag_minutes": 8
}
```

### 6.7 experiment_result.json

```json
{
  "campaign_id": "CMP-20260610-001",
  "experiment_id": "EXP-001",
  "executed": true,
  "write_confirmed": true,
  "stable_window_before": "win_before_001",
  "stable_window_after": "win_after_001",
  "online_response": {
    "thickness_cv_change_pct": 0.4,
    "birefringence_cv_change_pct": -3.2
  },
  "decision": "effective",
  "waste_meter": 46.5,
  "operator_note": "simulated stable run"
}
```

## 7. 优化算法计划

### 7.1 MVP-1：规则 + 局部响应

第一版算法不追求复杂，只要可靠：

1. 计算当前质量 gap。
2. 根据本体映射选择候选参数。
3. 每次只调整一个参数或一组强相关参数中的一个。
4. 根据响应方向判断有效、无效、恶化。
5. 有效则继续同方向小步。
6. 恶化则回滚或反方向微调。
7. 连续改善达到目标则停止并生成 candidate recipe。

伪代码：

```text
while iteration < max_iterations:
  snapshot = sim.get_snapshot()
  quality = sim.get_online_quality()
  diagnosis = quality_engineer(snapshot, quality)

  if diagnosis.quality_state == PASS:
    rd_engineer.recommend_freeze_recipe()
    break

  plan = rd_engineer.make_plan(diagnosis, snapshot, ledger)
  proposal = process_engineer.make_delta(plan, snapshot)
  gate = safety_gate.check(proposal)

  if not gate.allowed:
    ledger.append_rejected(proposal, gate)
    plan = rd_engineer.replan(gate)
    continue

  receipt = sim.apply(proposal)
  result = sim.run_until_stable_and_evaluate()
  ledger.append(result)

  rd_decision = rd_engineer.decide_next(result, diagnosis, ledger)
  if rd_decision in [freeze_recipe, stop, rollback]:
    execute_decision(rd_decision)
    break
```

### 7.2 P1：低维 DOE

当 MVP-1 跑通后，引入低维 DOE：

- 单因素扫描
- 2 因素 3 水平小型 DOE
- 中心点重复
- 响应曲面局部拟合

适合用于：

- 双折射均匀性优化
- 厚度 CV 优化
- 热定型窗口探索

### 7.3 P2：约束贝叶斯优化

当积累足够实验样本后，引入 constrained Bayesian optimization：

目标函数：

```text
minimize:
  weighted_quality_loss
  + waste_penalty
  + instability_penalty

subject to:
  no_alarm
  setpoint_bounds
  ramp_limits
  thickness_cv <= max
  birefringence_cv <= max
```

但 P2 之前不能使用它作为核心闭环，否则样本不足会导致伪最优。

## 8. 项目目录规划

建议新增：

```text
simulator/
  industrial-film-line/
    server.mjs
    blackbox-model.mjs
    state-machine.mjs
    recipe-store.mjs
    schemas/
    tests/

mcp/
  industrial-historian/
  online-inspection/
  safety-gate/
  plc-control-gateway/
  recipe-ledger/

.claude/skills/
  quality-engineer/
  rd-engineer/
  process-engineer/

workspace/
  optimization-campaigns/
    <campaign_id>/
      00_objective/
      01_snapshots/
      02_quality/
      03_rd_plan/
      04_execution/
      05_results/
      06_recipe/
      campaign_ledger.jsonl
```

## 9. 开发阶段拆解

### Phase 0：文档与 Schema

目标：把闭环合同写死。

任务：

- 定义所有 JSON schema。
- 定义 campaign 目录结构。
- 定义模拟客户端 API。
- 定义 safety policy。
- 定义三角色输入输出。

验收：

- 每个 schema 有 sample。
- 每个 sample 能被 schema validator 通过。
- campaign 目录能被初始化。

### Phase 1：黑盒模拟客户端

目标：模拟一个不可见内部函数的产业工况。

任务：

- 实现模拟线状态机。
- 实现 setpoint 写入。
- 实现质量响应函数。
- 实现滞后、噪声、漂移、报警。
- 实现在线 profile 输出。
- 实现 recipe 存储。

验收：

- 修改不同参数会产生不同质量响应。
- 响应存在滞后，不是瞬时变化。
- 越界或变化过快会报警。
- `run-until-stable` 能输出稳定窗口。
- 平台无法读取内部真实函数。

### Phase 2：MCP/API Wrapper

目标：优化平台通过工业接口访问模拟器。

任务：

- `industrial-historian` 读取过程快照。
- `online-inspection` 读取在线质量。
- `safety-gate` 检查参数修改。
- `plc-control-gateway` 写入模拟器。
- `recipe-ledger` 记录 recipe 和 experiment。

验收：

- 不直接调用 simulator 内部函数。
- 所有写入必须经过 safety gate。
- 所有写入有 receipt。

### Phase 3：Quality Engineer

目标：复用诊断 skill 作为质量工程师。

任务：

- 包装当前 `industrial-deep-diagnostic`。
- 新增在线质量诊断 schema。
- 支持 process snapshot + online quality map 的轻量诊断。
- 输出质量状态和下一步建议。

验收：

- 能判断 PASS/WARNING/FAIL/NEEDS_DATA。
- 能识别主要质量 gap。
- 能判断本轮实验是否改善。

### Phase 4：R&D Engineer

目标：研发工程师能生成下一轮计划。

任务：

- 读取质量诊断和历史 ledger。
- 根据本体参数映射选择候选参数。
- 生成低维优化计划。
- 输出固定参数、候选参数、预期响应、停止条件。
- 判断继续、回滚、固化 recipe。

验收：

- 不输出越界参数。
- 每个计划都有主假设。
- 每个计划都有成功标准和停止规则。

### Phase 5：Process Engineer

目标：工艺工程师能安全执行研发计划。

任务：

- 读取实验计划。
- 生成 parameter delta proposal。
- 调用 safety gate。
- 写入模拟器。
- 等待稳定。
- 生成 experiment result。

验收：

- 未稳态不执行。
- safety gate 不通过不执行。
- 写入后必须回读确认。
- 每次执行进入 ledger。

### Phase 6：闭环 Orchestrator

目标：自动跑完整 campaign。

任务：

- 创建 campaign。
- 循环调度三角色。
- 管理 max iterations。
- 管理停止条件。
- 管理回滚。
- 生成最终报告。

验收：

- 给定 product target，系统能自动迭代。
- 能在达到目标后停止。
- 能在恶化时回滚。
- 能生成 candidate recipe。

### Phase 7：可视化 UI

目标：展示闭环过程。

任务：

- Campaign dashboard。
- 当前 recipe。
- 当前质量指标。
- 参数调整记录。
- Safety gate 结果。
- Agent 决策解释。
- 最佳 recipe 候选。

验收：

- 能看到每一轮调参。
- 能看到质量曲线变化。
- 能看到为什么继续/停止/回滚。

## 10. 验收场景

### 场景 A：双折射偏低

初始状态：

- `birefringence_mean` 低于目标。
- `thickness_cv` 合格。

期望：

- 研发工程师优先选择 MD/TD 拉伸或热定型相关参数。
- 工艺工程师小步执行。
- 系统提升双折射且不恶化厚度。

### 场景 B：厚度横向不均

初始状态：

- `thickness_cv` 高。
- `birefringence_mean` 合格。

期望：

- 系统避免盲目调整取向参数。
- 优先考虑流量、线速度、TD 拉伸或模拟 profile 相关参数。

### 场景 C：参数越界

初始状态：

- 研发计划提出超出 safety window 的参数。

期望：

- safety gate 拒绝。
- 工艺工程师不执行。
- 研发工程师重新规划。

### 场景 D：响应方向与预期相反

初始状态：

- 某参数调整后质量恶化。

期望：

- 质量工程师判断 ineffective/worse。
- 研发工程师停止同方向探索。
- 系统回滚或换参数。

### 场景 E：达到目标并固化 recipe

初始状态：

- 经过多轮优化后指标达标。

期望：

- 研发工程师输出 `freeze_candidate_recipe`。
- recipe-ledger 保存最佳 recipe。
- 报告包含证据、适用范围和仍需验证事项。

## 11. 成功指标

MVP 成功指标：

- 能完成至少 5 个连续优化 campaign。
- 每个 campaign 都有完整 ledger。
- 所有写入都经过 safety gate。
- 无非法越界写入。
- 至少 3 个场景能达到目标或合理输出 `NEEDS_DATA` / `STOP`。
- 最佳 recipe 能被保存和复现。

算法效果指标：

- 在线质量 loss 相比 baseline 降低。
- 废料米数低于上限。
- 回滚机制有效。
- 连续无效实验不超过设定阈值。
- 研发工程师能解释每轮选择原因。

## 12. 从模拟迁移到真实产线

模拟阶段接口设计必须与真实接口一致。

迁移时替换：

```text
simulator server
  -> real historian / PLC / inspection interfaces
```

不应替换：

- 三角色 Agent 协议
- JSON schema
- campaign ledger
- safety gate 逻辑框架
- recipe governance
- optimization orchestrator

真实上线顺序：

1. 只读接入真实设备。
2. 对比模拟器和真实数据结构。
3. 在真实数据上只给建议，不写入。
4. 人工确认后写入低风险参数。
5. 半自动执行受限 experiment plan。
6. 形成新品 recipe 固化流程。

## 13. 第一批开发任务清单

### Task 1：Schema 与样例

- 创建 `schemas/optimization/`。
- 写 8 个核心 schema。
- 写 sample fixtures。
- 写 schema validation 脚本。

### Task 2：模拟黑盒服务

- 创建 `simulator/industrial-film-line/`。
- 实现状态机。
- 实现黑盒响应函数。
- 实现 API。
- 写单元测试。

### Task 3：MCP Wrapper

- 实现 historian/inspection/safety/plc/recipe wrapper。
- 所有 wrapper 只通过模拟器公开 API 访问。

### Task 4：Quality Engineer 包装

- 将当前诊断 skill 包装为质量工程师轻量入口。
- 输出 `quality_diagnosis.json`。

### Task 5：R&D Engineer Skill

- 实现低维 DOE planning。
- 实现 stop/continue/freeze 判断。

### Task 6：Process Engineer Skill

- 实现 delta proposal。
- 实现 safety gate 调用。
- 实现执行和 result 记录。

### Task 7：闭环 Orchestrator

- 实现 `run_campaign`。
- 支持 max iterations、stop rules、rollback。

### Task 8：Dashboard

- 展示 campaign 状态、质量趋势、参数轨迹、Agent 决策、recipe 候选。

## 14. 推荐第一版命令

```bash
# 启动模拟器
npm run sim:film-line

# 初始化优化 campaign
npm run opt:init -- --target examples/targets/bopet_new_grade_a.json

# 跑一次闭环
npm run opt:campaign -- --campaign CMP-20260610-001 --max-iters 10

# 查看结果
npm run opt:report -- --campaign CMP-20260610-001
```

## 15. 最终交付物

第一阶段完成后应交付：

- 黑盒模拟产业客户端。
- 三角色 Agent/Skill 协议。
- 核心 JSON schema。
- MCP/API wrapper。
- 闭环 orchestrator。
- campaign ledger。
- recipe candidate store。
- 至少 5 个模拟验收场景。
- 一份自动生成的 campaign 报告。

## 16. 关键结论

这个开发路线的核心不是先追求最强算法，而是先构造一个真实可信的虚拟产业闭环。只要模拟客户端足够像黑盒设备，平台就必须像面对真实产线一样，通过实验、诊断、策略、执行、反馈和账本逐步优化。

当这个闭环在模拟工况中稳定跑通，再替换真实设备接口时，系统架构、数据合同、Agent 协同、recipe governance 都可以复用。

