# 07 Coordination Protocol — Team Communication Standard

`07_coordination/` 是标准多 Agent 交接协议层，不是可选附属目录。

## Required Artifacts

- `quality_review_XXX.json`
- `rd_brief_XXX.json`
- `process_brief_XXX.json`
- `strategy_state_XXX.json`
- `approval_packet_XXX.json`
- `coordination_index.json`
- `executive_summary_XXX.md`
- `executive_summary.md`
- `team_dispatch_plan_XXX.json`

## Intent

- Quality 提供统一事实基线、阶段建议、风险状态。
- R&D 提供策略模式与候选杠杆排序。
- Process 提供可执行包、审批需求与回退边界。
- Coordination index 提供所有正式工件索引，方便后端、前端、审计与真实产线系统集成。

---

## Team Communication Matrix

| 发送方 | 接收方 | 典型目的 | 时机 |
|--------|--------|----------|------|
| **Team Lead** | All | intake_brief / dispatch_plan | 任务启动 / 每轮迭代 |
| **Team Lead** | Quality | quality-review | 新策略循环 |
| **Team Lead** | R&D | rd-strategy | 新策略循环 |
| **Team Lead** | Process | process-execution / process-micro-tune | 策略循环 or 内层工艺循环 |
| **Quality** | R&D | quality_diagnosis | 每次诊断后 |
| **Quality** | Process | experiment_feedback | 工艺执行后 |
| **Quality** | R&D | request_rd_replan | 连续无效/恶化 |
| **Quality** | All | request_hold_validation | quality_state == PASS |
| **Quality** | All | ALERT（sensor 异常） | sensor_health 异常 |
| **R&D** | Process | rd_strategy（plan + brief） | 新策略生成后 |
| **R&D** | Quality | request_quality_review | 质量信号模糊 |
| **Process** | R&D | request_rd_replan | safety gate 拒绝 / 多轮无改善 |
| **Process** | Quality | execution_complete（请求质量复评） | 执行后等待稳定 |

Mailbox routing for new runs:

- Quality → `team/inbox/quality-engineer/`
- R&D → `team/inbox/rd-engineer/`
- Process → `team/inbox/process-engineer/`

Do not emit new artifacts into legacy inboxes such as `team/inbox/quality/`, `team/inbox/rd/`, or `team/inbox/process/`.

## 跨角色工件理解协议

### Quality Agent 理解 R&D Plan：
- `candidate_parameters[0].name` → 本轮主杠杆（用于快速判断质量趋势）
- `hypothesis` → 研发假设（用于验证质量数据是否支持）
- `control_mode` → 策略模式（explore 宽松 / exploit 严格）
- `success_criteria` → 成功标准（决定了 quality 的判定阈值）
- `stop_rules` → 停止条件（quality 需要在 feedback 中显式判定是否触发）

### R&D Agent 理解 Quality Diagnosis：
- `primary_quality_gap` → 最需要解决的问题
- `metric_evaluations` → 逐指标详情（不是只看 PASS/FAIL，要看具体数值和偏差）
- `history_signal_summary` → 哪些方向已被证明有效/无效
- `strategy_recommendation.next_stage` → 质量建议的阶段
- `process_risk_summary` → 避免选到受限杠杆

### Process Agent 理解 R&D Plan：
- `execution_intent` → 研发希望达成的效果（保留到 proposal 中）
- `candidate_parameters[].step` → 建议步长（结合 ramp limit 调整实际 delta）
- `strategy_guidance` → 执行注意事项
- `success_criteria` / `stop_rules` → 在 safety gate 中作为额外检查项

### R&D Agent 理解 Process 反馈：
- `safety_gate_result.violations` → 哪些杠杆不可行 → 帮你筛选替代方案
- `safety_gate_result.limit_applied` → 具体被哪个限制挡住了
- `process_brief` → 工艺的执行限制和条件 → 影响下一轮策略边界

## Replan 触发矩阵

| 条件 | 触发者 | 动作 |
|------|--------|------|
| 连续 3 轮 ineffective | Quality Agent | 发 request_rd_replan |
| 连续 2 轮 worse | Quality Agent | 发 request_rd_replan |
| safety gate 拒绝 | Process Agent | 发 request_rd_replan（附替代范围） |
| 策略循环达到 process_iterations_per_cycle | Campaign Runner | 自动进入新策略循环 |
| 质量 PASS + hold-window 确认 | Quality Agent | 发 freeze 确认给所有人 |
| sensor_health 异常 | Quality Agent | 发 ALERT，建议暂停 |
| 设备 alarm_active | Process Agent | 通知 team-lead 和 quality |
