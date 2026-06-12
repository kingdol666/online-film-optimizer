# PMMA 双折射主杠杆排序 — R&D Agent 审查结论

## 排序

PMMA 产品 birefringence_cv 主杠杆（按优先级）：

1. **td_zone_2_temp** (increase) — 提高 TD 区温度改善分子链取向均匀性。历史验证：PMMA-HIST-001 at 126°C → PASS (birefringence_cv=2.94)
2. **heatset_temp** (increase) — 提高热定型温度充分松弛残余双折射
3. **winder_tension** (decrease) — 降低收卷张力减少后拉伸取向。PASS recipe 用 88.5，WARNING recipe 用 96

## 辅助杠杆

4. relaxation_ratio (increase) — 热松弛关键杠杆
5. td_draw_ratio (注意上限，过高放大边中差)
6. td_zone_1_temp (与 td_zone_2 交互)

## 固定参数

- line_speed 通常固定（影响全局热历史，风险大）
- 熔体/挤出相关参数对双折射影响间接

**Why**: 来自产品上下文 "PMMA 对残余应力和双折射均值更敏感，热松弛与收卷张力是关键质量杠杆" + 历史 recipe 实证。

**How to apply**: 新建 PMMA birefringence 优化任务时，优先探索 td_zone_2_temp increase；出现边际递减时切换到 heatset_temp 或 winder_tension。td_draw_ratio 的高值在 PMMA 上已知是有害的（PMMA-HIST-002 at 2.22 → WARNING）。
