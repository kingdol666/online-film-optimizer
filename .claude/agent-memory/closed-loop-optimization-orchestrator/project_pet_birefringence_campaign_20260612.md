---
name: pet_birefringence_campaign_20260612
description: PET_FILM_GRADE_A birefringence CV 5% reduction achieved 9.60% via historical recipe PET-HIST-001 jump strategy, 1 strategy cycle, 2 iterations, 3.7721 -> 3.4101
metadata:
  type: project
---

# PET 双折射优化 Campaign (2026-06-12) -- COMPLETED

## 目标
- 用户目标：birefringence_cv 从基线 3.7721 下降 5% → 目标 ≤ 3.5835
- **结果：GOAL REACHED + HOLD CONFIRMED**
- 最终 birefringence_cv: 3.4101 (9.60% 下降，超目标 4.84 个百分点)

## 策略
使用历史 PASS recipe PET-HIST-001 作为跳板，突破确定性引擎的局部最优陷阱。
- 确定性引擎在 3 次 campaign 中卡在 birefringence_cv=3.7529 (td_zone_2=112, heatset=219.92, td_draw=3.566)
- PET-HIST-001: td_zone_2_temp=114, heatset_temp=219.2, td_draw_ratio=3.68 → birefringence_cv=3.61

## 执行路径
1. Step 1: td_zone_2=113.5, heatset=219.2, td_draw=3.66 → biref_cv=3.4919 (已达标)
2. Step 2: td_zone_2=114, td_draw=3.68 (完整历史配方) → biref_cv=3.4844
3. Hold Window (10 ticks): biref_cv=3.4101 (持续稳定)

## 最终 Recipe: PET-OPT-001
| 参数 | 基线 | 最终 | 变化 |
|------|------|------|------|
| td_zone_2_temp | 112 | 114 | +2.0 |
| heatset_temp | 218 | 219.2 | +1.2 |
| td_draw_ratio | 3.62 | 3.68 | +0.06 |
| 其他参数 | - | - | 不变 |

## 质量验证
- birefringence_cv: 3.7721 → 3.4101 (-9.60%)
- thickness_cv: 1.4711 → 1.2318 (-16.26%)
- thickness_mean: 12.0948 → 12.0435 (稳定)
- 传感器健康: OK, 无报警, 废物计量器: 0

**Why:** 确定性引擎在 td_zone_2_temp=112 附近收敛到局部最优（biref_cv≈3.75）。加载 PET-HIST-001 直接跳跃到 td_zone_2=114 区域，该区域双折射性能显著更好。TD 热区 + heatset 耦合是 PET 双折射的主要控制通道。

**How to apply:** PET 双折射优化应从 PET-HIST-001 设置点开始（td_zone_2=114, heatset=219.2, td_draw=3.68），而非默认基线。后续 fine-tuning 应在历史配方附近进行，避免落入 112 区域的局部最优。
