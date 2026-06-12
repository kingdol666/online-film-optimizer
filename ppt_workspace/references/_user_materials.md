# 自动优化闭环控制平台设计素材摘要

## 项目目标

构建一个面向薄膜双拉中试线的在线研发工艺参数优化平台。设备从挤出到收卷已具备，在线厚度和双折射检测接口已具备。平台要通过 Claude Code 作为 Agent harness，编排 MCP、Skill、Agent，形成“快速调参 + 深度研发”的双闭环。

## 核心判断

- 模式合理，能够产业落地，但必须收敛成受控在线研发优化平台。
- PLC/DCS 继续负责硬实时控制，Agent 负责分钟级监督优化和研发试验编排。
- 安全放行不能由 LLM 决定，必须由确定性 safety-gate-mcp 和 PLC 网关执行。
- 快环只执行深环计划内的小步动作，不能自行扩大参数空间。
- 深环负责低维 DOE、机理分析、代理模型、后续贝叶斯优化。

## 最小可行闭环 MVP-1

1. 采集快照：过程量、厚度、双折射、报警、当前 recipe。
2. 生成实验计划：低维 DOE、参数窗口、保持时间、停止条件。
3. 快环拆步：稳态检查、偏差识别、单步 delta proposal。
4. 安全门预审：白名单、限幅、限速、联锁、回滚配方。
5. 人工确认：第一版所有写入都需确认。
6. 写入与回读：PLC MCP 下发参数并回读确认。
7. 形成样本：experiment_result，包含前后稳态窗口、响应、废料和备注。

## 三层架构

- MCP 工业连接层：industrial-historian、online-inspection、safety-gate、plc-control-gateway、recipe-ledger、quality-lab。
- Skill 作业流程层：online-film-process-tuner、film-rd-strategy-optimizer、industrial-deep-diagnostic、simulation-and-digital-twin。
- Agent 决策角色层：Campaign Orchestrator、Process Engineer Agent、R&D Engineer Agent、Safety Reviewer Agent、Operator UI Agent。

## 不合理点与修正

- 不合理：第一版同时做全量 MCP、复杂 Agent、仿真和自动优化。修正：先打通 MVP-1。
- 不合理：深环直接输出复杂多参数全局最优。修正：先做低维 DOE 和固定参数清单。
- 不合理：快环同时承担优化与执行。修正：快环只做执行和响应记录。
- 不合理：离线性能放入第一闭环核心路径。修正：MVP 先优化在线代理指标，P1 再校准代理模型。
- 不合理：Safety Judge 由 Agent 放行。修正：确定性 safety-gate-mcp 放行，Agent 只解释和审计。

## 开发实施清单

- mcp/industrial-historian：读实时 tag、读时间窗口、输出 process_snapshot 和 stable_window。
- mcp/online-inspection：解析厚度和双折射 profile，输出 profile features。
- mcp/safety-gate：确定性白名单、上下限、变化率、报警联锁、回滚检查。
- mcp/plc-control-gateway：preview、write、readback、rollback。
- mcp/recipe-ledger：recipe_version、experiment_id、变更日志、last_known_good_recipe。
- online-film-process-tuner Skill：稳态检查、偏差识别、单步 delta proposal、执行回执。
- film-rd-strategy-optimizer Skill：低维 DOE 计划、固定参数清单、预期响应、停止条件。
- app/backend + UI：campaign 状态机、建议卡片、批准/拒绝/暂停/回滚、事件流。
