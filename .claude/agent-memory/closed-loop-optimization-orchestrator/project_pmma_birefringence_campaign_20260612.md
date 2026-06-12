# PMMA 双折射优化 — 2026-06-12 成功 Campaign 记录

## 事实

- **Campaign ID**: `CMP-SIM-PMMA_FILM_GRADE_A-20260612122729262-UERP`
- **Task ID**: `请完成对-pmma-产线的优化-使得双折射波动下降4-并输出最终recipe-20260612122729217-CQON`
- **产品**: `PMMA_FILM_GRADE_A` (PMMA 高透光硬质膜 A 级)
- **目标**: 双折射波动下降 4% (birefringence_cv: 3.409 → ≤3.27264)
- **结果**: 目标达成 (birefringence_cv → 3.1025, 降幅 9.0%), 2 轮迭代, 1 个策略周期
- **主杠杆**: `td_zone_2_temp` increase (123 → 123.576)
- **候选 recipe**: `RCP-CANDIDATE-20260612122729348-C06Q`

**Why**: 这是 PMMA 产品的标准确定性优化示范，验证了 AgentTeam 文件总线在 birefringence 指标上的闭环能力。

**How to apply**: 后续 PMMA 双折射优化任务可作为参照。td_zone_2_temp 在 PMMA 上提升双折射均匀性已被验证有效；出现边际递减时应切换到 heatset_temp 或 winder_tension。
