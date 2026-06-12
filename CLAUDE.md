# CLAUDE.md — Online_optimizer

## 项目概述
在线闭环优化平台 — 多智能体协作系统（总编排Agent + 质量/研发/工艺3个子Agent）+ 薄膜产线模拟器 + Web应用。

## 关键文件

| 文件 | 说明 |
|------|------|
| `.claude/skills/closed-loop-optimizer/SKILL.md` | 闭环优化主Skill入口 |
| `.claude/skills/process-engineer/SKILL.md` | 工艺工程师Skill |
| `.claude/skills/quality-engineer/SKILL.md` | 质量工程师Skill |
| `.claude/skills/rd-engineer/SKILL.md` | 研发工程师Skill |
| `schemas/optimization/` | 9个JSON Schema覆盖全部结构化工件 |
| `scripts/optimization/` | 6个执行脚本 |
| `simulator/industrial-film-line/` | 薄膜产线黑盒模拟器 |

## 启动命令
```bash
# 模拟器 HTTP
npm run sim:http

# 前端
npm run frontend

# 后端
npm run backend

# 验证 AgentTeam 配置
npm run agentteam:validate

# 运行完整 product-aware AgentTeam campaign
npm run optimize:team -- --product-grade PMMA_FILM_GRADE_A --goal-text "请完成对 PMMA 产线的优化：使得双折射波动下降5%，并输出最终recipe"
```

## 多智能体工作流
```
用户需求 → orchestrator 编排
  → 创建 task workspace + team/team_contract.json
  → quality-engineer: 读取产品目标+快照+在线检测 → quality_diagnosis.json / quality_review.json / strategy_state.json
  → rd-engineer: 读取质量诊断+产品上下文+历史 → rd_optimization_plan.json / rd_brief.json
  → process-engineer: 转 setpoint proposals + safety gate + approval packet → parameter_delta_proposal.json
  → 模拟器执行 → 结果评估
  → 循环直到达标或 max_iters，并输出 outputs/final_recipe.json
```

## 入参原则
所有Schema first — 写结构化JSON前先读对应schema文件

## 当前标准入口

用户只需要给研发目标；如果目标中出现 PET/PPAT/PMMA/PVA 会自动推断产品，也可以显式指定：

```bash
npm run optimize:team -- --product-grade PVA_FILM_GRADE_A --goal-text "请完成对 PVA 产线的优化：使得厚度波动下降6%，并输出最终recipe"
```

每次任务必须生成独立工作目录 `workspace/optimization-tasks/<task-id>/`，其中 `team/inbox`、`team/team_messages.jsonl`、`07_coordination`、`08_trial_evidence` 和 `outputs/final_recipe.json` 是判断 AgentTeam 是否真的协作的关键证据。
