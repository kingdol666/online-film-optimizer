# 三角色团队 Skill/Agent 标准化报告

**生成时间**: 2026-06-13T11:03:08Z

## 1. Agent 层标准化

### 4 个 Agent — 100% Claude Code 合规

| Agent | name | description | model | tools | color | skills | disallowedTools |
|-------|:----:|:-----------:|:-----:|:-----:|:-----:|:------:|:---------------:|
| orchestrator | ✅ | ✅ | opus | TeamCreate+Agent+SendMessage+Read+Write | blue | closed-loop-optimizer | Edit |
| quality-agent | ✅ | ✅ | opus | MCP只读 + Write+SendMessage | cyan | quality-engineer | Edit |
| rd-agent | ✅ | ✅ | opus | MCP只读 + Write+SendMessage | yellow | rd-engineer | Edit |
| process-agent | ✅ | ✅ | opus | MCP全权限 + Write+SendMessage | green | process-engineer | Edit |

### 工具权限矩阵

| 工具 | Orchestrator | Quality | R&D | Process |
|------|:-----------:|:-------:|:---:|:-------:|
| MCP 只读 (get_state, snapshot, quality...) | ❌ | ✅ | ✅ | ✅ |
| MCP 写入 (preview, apply, rollback...) | ❌ | ❌ | ❌ | ✅ |
| TeamCreate | ✅ | ❌ | ❌ | ❌ |
| Agent | ✅ | ❌ | ❌ | ❌ |
| SendMessage | ✅ | ✅ | ✅ | ✅ |

## 2. Skill 层标准化

### 4 个 Skill — 全部可触发

| Skill | 触发条件 | 参考 Agent |
|-------|---------|-----------|
| closed-loop-optimizer | 产线优化、双折射/厚度优化 | orchestrator |
| quality-engineer | 质量工程师、在线诊断、厚度双折射判定 | quality-agent |
| rd-engineer | 研发工程师、DOE策略、参数优化方案 | rd-agent |
| process-engineer | 工艺工程师、在线调参、参数下发、safety gate | process-agent |

## 3. 卡控机制

### 冷却期间隔 (inter_tick_control.json v1.1)

| 项 | 值 |
|----|-----|
| 全局间隔 | 360s (6 min) |
| 温度参数 | 480s (8 min) |
| 拉伸比 | 360s (6 min) |
| 松弛比 | 420s (7 min) |
| 线速度/收卷 | 300s (5 min) |
| 震荡检测 | 3 ticks, cv < 0.08 |
| 停止条件 | close-zone < 0.092, 20 ticks stable |

### ANALYZE 模式 (Process Agent Phase 0.5)

被卡控时：
1. 趋势快照 (实时数据 + 波动分析)
2. 参数响应验证 (预测 vs 实测)
3. 微调候选生成 (3 方向, 附评分)
4. 数据报告 (发给 Quality + R&D)

## 4. 记忆体系

| 类型 | 数量 | 示例 |
|------|:---:|------|
| 项目记忆 | 7 | pet-birefringence-cv-optimization, inter-tick-cooldown-system |
| 角色记忆 | 11 | quality-agent/cv-decomposition, rd-agent/heatBalance-driver |

## 5. 规范合规检查清单

- [x] 所有 Agent frontmatter 包含 name, description, model, tools, color
- [x] 所有 Agent 正确引用对应 Skill
- [x] 所有 Skill frontmatter 合法 YAML (no broken bars)
- [x] Skill description 包含中英文触发词
- [x] Process Agent 包含完整 Phase 0.5 (冷却期+震荡+ANALYZE+停止条件)
- [x] Quality Agent 包含 三维交叉验证原则
- [x] R&D Agent 包含 期待响应对标历史规范
- [x] 卡控脚本 + 配置 + Agent 规范三合一
- [x] 卡控脚本 executable (chmod +x)

**结论**: 三角色团队完全符合 Claude Code 官方 Skill/Agent 标准。
