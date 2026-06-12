---
name: pet_birefringence_campaign_20260612
description: PET_FILM_GRADE_A birefringence_cv 优化 campaign — 目标降1%，产品规格≤3.7
metadata:
  type: project
---

# PET 双折射优化 Campaign (2026-06-12)

## 目标
- 用户目标：birefringence_cv 从基线 3.8994 下降 1% → 目标 3.8604
- 产品规格：birefringence_cv ≤ 3.7
- 实际操作目标：将 birefringence_cv 从 3.7201 压至 ≤ 3.7

## 进度
- 2026-06-12: 文件总线模式运行 2 轮，best observed recipe RCP-EXP-002 (birefringence_cv=3.7201)，未达产品规格
- 2026-06-12 13:04: 创建原生 Agent Team `PET-birefringence-optimization-20260612`，启动 quality/rd/process 三个 Agent

## 关键数据
- 历史 PASS recipe (PET-HIST-001): td_zone_2_temp=114, heatset_temp=219.2, td_draw_ratio=3.68 → birefringence_cv=3.61
- 当前最佳: td_zone_2_temp=112, heatset_temp=218, td_draw_ratio=3.593 → birefringence_cv=3.7201
- 差距: 0.0201 (需要从 3.72 到 3.70)

**Why:** 这是首次使用原生 AgentTeam 模式的 BOPET campaign。文件总线模式已证明优化方向可行（通过调整 td 热区参数降低双折射），需要 AgentTeam 继续精细优化。

**How to apply:** 后续 campaign 可参考此次的 levers 排序和 safety gate 配置。
