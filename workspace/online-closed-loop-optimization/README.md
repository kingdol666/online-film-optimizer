# 在线闭环控制优化平台工作目录

本目录用于承载在线闭环控制优化平台的虚拟工况开发工作。当前第一版已经实现了：

- 黑盒薄膜双拉模拟器：`simulator/industrial-film-line/`
- 优化数据契约：`schemas/optimization/`
- 示例产品目标：`examples/targets/bopet_new_grade_a.json`
- MVP 闭环 runner：`scripts/optimization/run-sim-campaign.mjs`
- Campaign 输出目录：`workspace/optimization-campaigns/`

## 快速运行

```bash
npm run opt:campaign:demo
```

运行后会在 `workspace/optimization-campaigns/<campaign_id>/` 生成一次完整闭环优化记录。

## 可选启动黑盒 HTTP 服务

```bash
npm run sim:film-line
```

服务默认监听：

```text
http://localhost:8877
```

当前 MVP runner 直接使用本地黑盒模块，后续可以切换为 HTTP/MCP wrapper。

## 当前闭环产物

每次 campaign 输出：

```text
00_objective/product_target.json
01_snapshots/process_snapshot_*.json
01_snapshots/online_quality_*.json
02_quality/quality_diagnosis_*.json
03_rd_plan/rd_optimization_plan_*.json
04_execution/parameter_delta_proposal_*.json
04_execution/safety_gate_result_*.json
04_execution/execution_receipt_*.json
05_results/experiment_result_*.json
06_recipe/recipe_release_recommendation.json
campaign_ledger.jsonl
simulator_ledger.jsonl
run_summary.json
report.md
```

## MVP 边界

当前版本用于验证“虚拟工况下的闭环是否真实可跑”，不是最终优化算法。

已实现：

- 质量工程师 MVP：识别在线质量 gap。
- 研发工程师 MVP：生成低维局部优化计划。
- 工艺工程师 MVP：生成 delta proposal，调用确定性 safety gate。
- 黑盒工况：多变量耦合、滞后、噪声、漂移、报警风险。
- best observed recipe：探索失败后保留历史最佳候选 recipe。

尚未实现：

- 独立 MCP server 包装。
- 独立 `.claude/skills/quality-engineer` / `rd-engineer` / `process-engineer`。
- 前端 dashboard。
- 低维 DOE 批量计划。
- 约束贝叶斯优化。
- 离线性能慢标签校准。

## 下一步建议

1. 把 runner 中的三个 MVP 函数拆成三个独立 skill/agent 协议。
2. 把本地 simulator 调用替换为 MCP wrapper。
3. 增加更多目标场景：厚度 CV 高、双折射均值低、报警越界、传感器异常。
4. 增加 dashboard 展示每一轮参数轨迹和质量响应。
5. 引入低维 DOE，再引入约束贝叶斯优化。
