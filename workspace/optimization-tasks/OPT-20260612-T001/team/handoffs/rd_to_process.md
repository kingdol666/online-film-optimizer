# R&D Optimization Plan Handoff: R&D -> Process Engineer

**Task:** OPT-20260612-T001 | **Product:** PET_FILM_GRADE_A | **Date:** 2026-06-12
**Strategy Cycle:** SC-001 | **Stage:** EXPLORE

## Summary

基于 quality diagnosis 的三项根因分析和当前 process snapshot，制定分步渐进探索策略。核心假说：TD 热区温差 (4°C) + 热定型温度偏低 (218°C) 耦合导致 birefringence_cv 和 birefringence_mean 双双超标。

## Key Insight

- **Ledger 记录关键信息**：历史曾执行 SC-001 Round 1 (heatset_temp 218->219, td_zone_1_temp 108->109) 但随后被 rollback。当前 setpoints 已恢复基线。需要确认 rollback 原因 — 如果非质量恶化导致，应重试该方向。
- **birefringence_mean=0.09186 严重偏离 target 0.078 (+17.8%)**，说明全局取向应力过剩，heatset_temp 是最优先的调节杠杆。
- **birefringence 剖面 center-peaked** 证实 TD 热区温度不均匀假说。

## Recommended Execution Order

| Round | Parameters | Delta | Expected Effect |
|-------|-----------|-------|-----------------|
| 1 | heatset_temp | 218->219 (+1) | 建立 heatset 灵敏度基线 |
| 2 | heatset_temp + td_zone_1_temp | 219->220 (+1), 108->109 (+1) | 协同验证耦合假说 |
| 3 | heatset_temp + td_zone_1_temp | 220->222 (+2), 109->111 (+2) | 推进至中间目标 |
| 4 | heatset_temp + td_zone_1_temp | 222->223 (+1), 111->112 (+1) | TD 温差归零 |
| 5 | relaxation_ratio | 4.2->4.5 (+0.3) | 仅在 birefringence 仍超标时执行 |
| 6 | winder_tension | 118->115 (-3) | 仅在 birefringence 达标后执行 |

## Critical Constraints

- **Fixed**: extruder_speed=100, line_speed=42, td_zone_2_temp=112, md_draw_ratio=3.18
- **Guard**: thickness_mean 保持 12±0.22, thickness_cv 恶化不超过 15%
- **Stop**: 连续 2 轮无改善 → re-diagnose; 安全门拒绝 → 降步长; 报警 → 立即停止

## What Process Engineer Must Do

1. 每轮执行前通过 `film_line_preview_proposal` 验证安全门
2. 每轮执行后等待 10 分钟 hold time
3. 联系 quality agent 做自动复评
4. 如果 quality review 确认无改善，联系 R&D 重规划
