# Closed Loop Optimizer Runtimes And Teamwork

## 运行模式

| Mode | Purpose | Roles | Best For |
| --- | --- | --- | --- |
| `claude_sdk` | Claude Agent SDK 子 Agent 协作 | 总编排 + 质量 + 研发 + 工艺 | Claude Code 可用时的首选入口 |
| `team_claude_cli` | 三角色都由 Claude CLI 推理 | 总编排 + 质量 + 研发 + 工艺 | 想最大化“角色会思考”的模式 |
| `team_deterministic` | 文件总线确定性 Teamwork | 总编排 + 质量 + 研发 + 工艺 | 回归、验收、稳定复现 |
| `single_campaign` | 单次 campaign 调试 | 仅总编排 | 基线检查、局部调试 |

## Teamwork 规则

1. 用户只输入研发目标。
2. 总编排先解析目标和产品型号，创建独立 task workspace。
3. 质量 Agent 先判定当前质量状态和阶段建议。
4. 研发 Agent 基于质量诊断和历史 recipe 生成策略。
5. 工艺 Agent 将策略转为安全门通过的 proposal 和 approval packet。
6. 执行后等待稳定窗口，再由质量 Agent 复评。
7. 若多轮无效，回到研发重新规划，但保留 best observed recipe 作为 rollback baseline。
8. 只在 `goal_reached + hold-window confirmed` 后冻结最终 recipe。

## 三个 Agent 的职责边界

- 质量 Agent：只负责诊断、风险、阶段建议、稳定性复核。
- 研发 Agent：只负责策略、候选杠杆、假设、重规划。
- 工艺 Agent：只负责 proposal、safety gate、审批包、执行回执、回退基线。

## Recipe 收敛原则

- 保留每次 trial 的完整证据。
- 保存 `best_recipe_memory.json` 与 `outputs/final_recipe.json`。
- 最终 recipe 必须可回退、可复测、可 shadow validation。
- 不允许跨产品复用 recipe。

## 推荐入口

```bash
npm run optimize:claude-sdk -- --product-grade PMMA_FILM_GRADE_A --goal-text "请完成对 PMMA 产线的优化：使得双折射波动下降10%，并输出最终recipe"
npm run optimize:team -- --product-grade PMMA_FILM_GRADE_A --goal-text "请完成对 PMMA 产线的优化：使得双折射波动下降10%，并输出最终recipe"
```
