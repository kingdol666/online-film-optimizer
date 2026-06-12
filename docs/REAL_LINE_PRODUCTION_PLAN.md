# 双向拉伸薄膜产线 — 真实场景闭环优化方案

> 从本项目的现状出发，不推倒重来，而是逐层替换核心引擎，逐步从模拟器演进到真实产线。

---

## 目录

1. [现状诊断](#1-现状诊断)
2. [整体架构](#2-整体架构)
3. [六层替换路线图](#3-六层替换路线图)
4. [Layer 1: 数据采集与设备网关 (OPC UA)](#4-layer-1-数据采集与设备网关)
5. [Layer 2: SPC 质量诊断引擎](#5-layer-2-spc-质量诊断引擎)
6. [Layer 3: 物理信息贝叶斯优化引擎](#6-layer-3-物理信息贝叶斯优化引擎)
7. [Layer 4: 数字孪生 + 降阶模型](#7-layer-4-数字孪生--降阶模型)
8. [Layer 5: 原料批次与漂移管理](#8-layer-5-原料批次与漂移管理)
9. [Layer 6: 影子模式 → 全自动闭环](#9-layer-6-影子模式--全自动闭环)
10. [安全体系](#10-安全体系)
11. [分阶段部署计划](#11-分阶段部署计划)
12. [附录: 关键接口契约](#12-附录-关键接口契约)

---

## 1. 现状诊断

### 1.1 当前系统的真实性质

| 组件 | 现状 | 判定 |
|------|------|:---:|
| orchestrator 编排流程 (`run-sim-campaign.mjs`) | 目标解析→基线→循环(诊断→方案→Safety Gate→执行→评估) | ✅ 架构可复用 |
| Safety Gate (`deterministicSafetyGate`) | 纯 JS 规则: 参数边界/ramp rate/rollback一致性 | ✅ 产线可用 |
| Best Recipe Memory | 锁最优配方 → 作为下次 rollback 基线 | ✅ 产线可用 |
| 工件审计链 `07_coordination/` + `08_trial_evidence/` | 每轮 19 个文件完整审计足迹 | ✅ 产线可用 |
| 产品感知系统 (`product-catalog.mjs`) | 4种材料各有独立 target/safety/history | ✅ 设计正确 |
| Skill/MCP 接口层 (`.mcp.json` → mcp-server) | Stdio MCP → 16 个工具 | ✅ 架构正确 |
| **质量诊断** (`role-engines.mjs:qualityEngineer`) | 逐指标阈值比较 → PASS/WARNING | ❌ 需替换 |
| **研发决策** (`role-engines.mjs:rdEngineer`) | 参数-杠杆硬编码映射表 | ❌ 需替换 |
| **模拟器** (`blackbox-model.mjs`) | 二次型响应面 + 高斯噪声 + 硬编码最优 | ❌ 需替换 |
| **MCP 后端** | 连接内存 simulator 实例 | ❌ 需替换为 OPC UA |

### 1.2 关键设计原则

1. **确定性安全永远在 LLM 之外。** Safety Gate、Ramp Rate、Rollback 基线三者是真实产线的最低安全保障，当前实现已经正确。
2. **Artifact 驱动的协作不依赖提示词记忆。** 当前 07_coordination/ 的协议设计已经正确。
3. **三阶段策略模式 (explore/exploit/recover) 是工业闭环优化的标准范式。** 保留。
4. **数学优化（贝叶斯/高斯过程）+ 物理约束 + SPC 统计** 是替代三个核心引擎的正确方向。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Orchestrator (保留 + 增强)                │
│  run-sim-campaign.mjs → 重构为 run-production-campaign.mjs   │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  诊断层 (新)  │ │  决策层 (新)  │ │  执行层 (新)  │
│              │ │              │ │              │
│ SPC 多变量   │ │ 贝叶斯优化   │ │ OPC UA/MQTT  │
│ PCA+T²统计   │ │ GP+PINN约束  │ │ Ramp监控     │
│ 设备健康评分 │ │ 多目标Pareto │ │ Interlock    │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       │         ┌──────┴──────┐         │
       │         │ 数字孪生层  │         │
       │         │            │         │
       │         │ 降阶模型   │         │
       │         │ 高斯过程   │         │
       │         │ 数据驱动   │         │
       │         └────────────┘         │
       │                                │
       ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│                     Safety Gate (保留)                        │
│  deterministicSafetyGate: bounds + ramp + rollback一致性      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     审批层 (增强)                              │
│  semi_auto → 影子模式 → auto (经长期验证后)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    真实产线 (PLC/DCS)                          │
│  挤出机/流延辊/MD拉伸/TD拉伸/热定型/收卷                       │
│  + 在线测厚仪 + 在线双折射仪                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 六层替换路线图

| Layer | 组件 | 当前 | 目标 | 复杂度 | 优先级 |
|:---:|------|------|------|:---:|:---:|
| 1 | 数据采集网关 | MCP→内存simulator | OPC UA + MQTT + Historian | 中 | P0 |
| 2 | 质量诊断 | 阈值比较 | 多变量SPC + 设备健康 | 中 | P0 |
| 3 | 研发决策 | 参数硬编码映射 | 贝叶斯优化 (GP-BO) + 物理约束 | 高 | P0 |
| 4 | 数字孪生 | 二次型RSM | 高斯过程 + 物理信息正则化 | 高 | P1 |
| 5 | 批次与漂移 | 无 | 原料指纹 + 漂移检测 | 中 | P1 |
| 6 | 影子模式 | system_auto | Shadow → Semi-auto → Full-auto | 中 | P1 |

---

## 4. Layer 1: 数据采集与设备网关

### 4.1 当前问题

[line-adapters.mjs](scripts/optimization/lib/line-adapters.mjs) 中的 `SimulatedLineAdapter` 通过 stdio MCP 调用内存中的 simulator 实例。`WebSocketOnlineLineAdapter` 有接口但未实现真正的产线连接。

### 4.2 真实产线数据流

```
PLC/DCS 层
  ├── Siemens S7-1500 / Rockwell ControlLogix
  ├── 在线测厚仪 (NDC / Mahlo / Scantech)
  ├── 在线双折射仪 (Strainoptics)
  └── 在线张力/压力/温度传感器

        ↓ OPC UA / Modbus TCP

OPC UA Server (Kepware / Siemens OPC UA / node-opcua)
  ├── 工艺参数 (setpoints + actuals): 12 tags
  ├── 质量数据 (thickness_profile, birefringence_profile)
  ├── 设备状态 (alarm, interlock, maintenance)
  └── 批次信息 (batch_id, raw_material_lot)

        ↓ 实时流 + 历史

数据中台
  ├── 时序库: InfluxDB / TimescaleDB
  ├── Historian: PI System / OSIsoft
  └── MES: 批次管理 + 质量管理
```

### 4.3 MCP 工具合约改造

当前 MCP 工具 (`.mcp.json`) 的 16 个工具签名**保持不变**，只替换后端实现：

```json
// .mcp.json 改造方案
{
  "mcpServers": {
    "industrial-film-line-real": {
      "command": "node",
      "args": ["infra/opcua/mcp-server.mjs"],
      "env": {
        "OPCUA_ENDPOINT": "opc.tcp://10.0.1.50:4840",
        "OPCUA_USERNAME": "${OPCUA_USER}",
        "OPCUA_PASSWORD": "${OPCUA_PASS}",
        "LINE_ID": "line-3",
        "PRODUCT_GRADE": "${PRODUCT_GRADE}"
      }
    }
  }
}
```

MCP 后端实现关键代码：

```javascript
// infra/opcua/mcp-server.mjs (伪代码)
import { OPCUAClient } from 'node-opcua';
import { InfluxDB } from '@influxdata/influxdb-client';

const client = OPCUAClient.create({ endpoint: process.env.OPCUA_ENDPOINT });
const influx = new InfluxDB({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN });

const TOOLS = [
  // 8个读操作 — 直接从 OPC UA 读取
  {
    name: 'film_line_get_snapshot',
    description: '读取当前产线快照：setpoints + actuals + 设备状态',
    handler: async () => {
      const [setpoints, actuals, alarms] = await Promise.all([
        client.readNode('ns=3;s=Line3.Setpoints'),
        client.readNode('ns=3;s=Line3.Actuals'),
        client.readNode('ns=3;s=Line3.Alarms')
      ]);
      return { line_state: alarms.active ? 'ALARM' : actuals.stable ? 'STABLE' : 'TRANSITION', ... };
    }
  },
  {
    name: 'film_line_get_online_quality',
    description: '读取在线检测数据（测厚仪+双折射仪）',
    handler: async () => {
      // 从时序库读最近 60s 的质量数据
      const query = `from(bucket:"quality")
        |> range(start: -60s)
        |> filter(fn: (r) => r._measurement == "thickness" or r._measurement == "birefringence")
        |> aggregateWindow(every: 10s, fn: mean)`;
      return await influx.collectRows(query);
    }
  },
  // ... 其余读工具类似

  // 4个写操作 — 必须经过 safety gate + 审批
  {
    name: 'film_line_preview_proposal',
    description: '预览参数变更后的 safety gate 结果（不写设备）',
    handler: async ({ proposal }) => {
      // 用当前 snapshot + proposal 计算 gate — 这部分逻辑可从当前
      // deterministicSafetyGate 直接复制
      return deterministicSafetyGate({ proposal, snapshot: currentSnapshot, ... });
    }
  },
  {
    name: 'film_line_apply_proposal',
    description: '写入 PLC 参数（必须已通过 safety gate 和审批）',
    handler: async ({ proposal, approvalRef }) => {
      // 1. 重新验证 gate
      // 2. 验证 approval 状态
      // 3. 按 ramp rate 逐步写入 OPC UA
      // 4. 监控 transition → stable
      // 5. 返回 execute receipt
    }
  }
];
```

### 4.4 Ramp Rate 写入机制（关键安全点）

真实 PLC 写入不是瞬间的。必须按 ramp rate 逐步逼近：

```javascript
async function rampedWriteProposal(proposal, client, pollIntervalMs = 500) {
  const receipts = [];
  for (const change of proposal.setpoint_changes) {
    const steps = Math.ceil(Math.abs(change.delta) / change.ramp_limit_per_min);
    const stepDelta = change.delta / steps;
    for (let i = 1; i <= steps; i++) {
      const target = change.current + stepDelta * i;
      await client.writeNode(`ns=3;s=Line3.Setpoints.${change.tag}`, target);
      await sleep(pollIntervalMs);
      // 读取 actual 值确认 ramp 成功
      const actual = await client.readNode(`ns=3;s=Line3.Actuals.${change.tag}`);
      if (Math.abs(actual - target) > change.ramp_limit_per_min) {
        throw new Error(`ramp_deviation:${change.tag}:expected=${target}:actual=${actual}`);
      }
    }
    receipts.push({ tag: change.tag, reached: true });
  }
  return { executed: true, receipts };
}
```

---

## 5. Layer 2: SPC 质量诊断引擎

### 5.1 当前问题

[role-engines.mjs] 中的 `qualityEngineer` 只是将每个质量指标与 target 做归一化比较：

```
gap = (actual - target) / tolerance
quality_state = gap > 1 ? 'FAIL' : gap > 0 ? 'WARNING' : 'PASS'
```

**这在真实产线上不够。** 真实产线的质量诊断需要：

1. **区分传感器噪声和真正的工艺漂移**
2. **识别多变量之间的互作用异常**（例如厚度 CV 和双折射 CV 同时 out-of-spec 意味着 TD 拉伸区问题）
3. **设备健康状态的影响**（模头积碳、辊面磨损等）

### 5.2 新的诊断引擎设计

```javascript
// infra/diagnostics/spc-engine.mjs

/**
 * 多变量统计过程控制 (MSPC) 诊断引擎
 *
 * 流程:
 *   1. 采集最近 N 个稳定窗口的质量数据
 *   2. PCA 降维 → 计算 Hotelling T² 和 SPE (Q statistic)
 *   3. 如果 T² 超限 → 系统性的工艺漂移 (explore/recover)
 *   4. 如果 SPE 超限 → 异常点 (检查传感器/设备)
 *   5. 如果均正常 → 检测单个指标偏差 (exploit)
 */

export function spcDiagnose({
  currentWindow,        // 当前稳定窗口
  historicalWindows,     // 最近 N 个同产品稳定窗口
  target,               // 产品目标
  deviceHealth,          // 设备健康状态
}) {
  // Step 1: 构建特征矩阵
  const features = FEATURE_KEYS; // ['thickness_mean','thickness_cv','birefringence_mean','birefringence_cv']
  const referenceWindows = historicalWindows.slice(-50); // 最近50个窗口

  // Step 2: PCA — 用 in-control 历史窗口训练
  const pca = computePCA(referenceWindows, features);
  const currentProjected = pca.project(currentWindow, features);

  // Step 3: Hotelling T² — 检测系统性的均值漂移
  const t2 = computeHotellingT2(currentProjected.scores, pca);
  const t2Limit = computeT2Limit(referenceWindows.length, pca.retainedComponents);
  const t2Flag = t2 > t2Limit;

  // Step 4: SPE (Q statistic) — 检测异常观测
  const spe = computeSPE(currentProjected, pca);
  const speLimit = computeSPELimit(referenceWindows, pca);
  const speFlag = spe > speLimit;

  // Step 5: 贡献度分析 — 如果 T² 超限，找出贡献最大的变量
  const contributions = t2Flag ? computeT2Contributions(currentProjected, pca) : {};

  // Step 6: 设备健康影响因子
  const healthFactor = assessDeviceHealth(deviceHealth);

  // Step 7: 单变量合规检查 (保留当前逻辑作为补充)
  const univariateCheck = checkTargetCompliance(currentWindow.metrics, target.targets);

  // Step 8: 综合判定
  const qualityState = determineQualityState({ t2Flag, speFlag, univariateCheck, healthFactor });
  const primaryGap = identifyPrimaryGap({ contributions, univariateCheck });

  return {
    quality_state: qualityState,           // 'PASS' | 'WARNING' | 'FAIL'
    primary_quality_gap: primaryGap,
    affected_metrics: contributions.affectedMetrics || [],
    spc_details: {
      t2_statistic: t2,
      t2_limit: t2Limit,
      t2_contributions: contributions,      // {"thickness_cv": 0.62, "birefringence_cv": 0.31}
      spe_statistic: spe,
      spe_limit: speLimit,
    },
    device_health_factor: healthFactor,
    univariate_check: univariateCheck,
    stage_recommendation: recommendStage({ t2Flag, speFlag, univariateCheck, healthFactor }),
    // 保留当前架构的字段以兼容下游
    metric_evaluations: univariateCheck,
    process_risk_summary: { alarm_active: deviceHealth.alarm, sensor_health: deviceHealth.sensor },
    current_loss: computeLoss(currentWindow.metrics, target.targets),
  };
}
```

### 5.3 SPC 关键公式

| 统计量 | 公式 | 判据 |
|--------|------|------|
| Hotelling T² | `T² = t' * diag(1/λ₁,...,1/λₖ) * t` | 超 99% 置信限 → 系统性漂移 |
| SPE (Q) | `SPE = ‖x - PₖPₖ'x‖²` | 超 95% 置信限 → 异常观测 |
| 贡献度 | `cⱼ = (xⱼ - PₖPₖ'x)ⱼ²` | ≥贡献度阈值 → 主要影响变量 |

### 5.4 与现有系统的集成

SPC 引擎替换 `qualityEngineer` 的返回值**向后兼容**当前 orchestrator 的所有下游消费者（R&D plan、strategy state、team messages）：

```javascript
// 在 run-sim-campaign.mjs 或 run-production-campaign.mjs 中
// 原来的:
const diagnosis = qualityEngineer({ snapshot, quality, target, ... });
// 变为:
const diagnosis = spcDiagnose({
  currentWindow: { snapshot, quality },
  historicalWindows: await historianAdapter.getRecentWindows({
    productGrade: target.product_grade,
    limit: 50
  }),
  target,
  deviceHealth: await deviceGateway.getHealth(tag, target.product_grade),
});
// 返回结构保持兼容 ✓
```

---

## 6. Layer 3: 物理信息贝叶斯优化引擎

### 6.1 当前问题

`rdEngineer` 是参数-杠杆的硬编码映射表。它不学习产线的真实响应，也不利用历史数据。

### 6.2 贝叶斯优化 (GP-BO) 基础

对于双向拉伸薄膜产线，Bayesian Optimization 是最合适的方法，原因是：

1. **产线试验成本极高** — 每次 trial 消耗原料 + 产生废料 + 占用生产时间
2. **观测有噪声** — 在线传感器有测量噪声
3. **参数空间有约束** — safety limits 天然形成 bounded search space
4. **多目标** — 厚度 CV 和双折射 CV 需要同时优化

```
贝叶斯优化循环:
  repeat:
    1. 用历史 (x₁,f(x₁)),...,(xₙ,f(xₙ)) 训练高斯过程替代模型
    2. 最大化采集函数 (acquisition function) 选择下一个候选点 xₙ₊₁
    3. 评估 xₙ₊₁ (产线执行 + 质量测量)
    4. 更新模型
  until 收敛 or 达到预算
```

### 6.3 实现架构

```javascript
// infra/optimization/gp-bayesian-engine.mjs

import { GaussianProcess, AcquisitionFunctions, Constraints } from './gp-kernel.mjs';

/**
 * 物理信息贝叶斯优化引擎
 *
 * 核心: 高斯过程替代模型 + 物理约束正则化 + 采集函数指导探索
 */

export class PhysicsInformedBayesianOptimizer {
  constructor({
    productGrade,         // 产品牌号 → 加载对应的 safety limits
    searchSpace,          // 可写参数空间 (来自 product-catalog 的 limits)
    physicsConstraints,   // 物理先验约束 (来自 Layer 4 降阶模型)
    historicalData = [],   // 历史 trial 数据 (输入+输出)
  }) {
    this.productGrade = productGrade;
    this.searchSpace = searchSpace; // [{name, min, max, ramp}×12]
    this.physics = physicsConstraints;
    this.gp = this._initGP(historicalData);
  }

  _initGP(data) {
    // 使用 Matern 5/2 核 — 对工程响应面平滑度假设合理
    // 各向异性长度尺度 — 每个参数有独立的 lengthscale
    // 物理正则化 — 在损失函数中加入来自降阶模型的先验
    return new GaussianProcess({
      kernel: new Matern52Kernel({
        lengthScales: this._estimateLengthScales(), // 来自 safety limits span
        anisotropy: true,                           // 各向异性
      }),
      priorMean: this._physicsPriorMean(),          // 来自 Layer 4 降阶模型
      noiseVariance: this._estimateNoiseVariance(),
      regularizer: new PhysicsRegularizer({
        constraints: this.physics,
        weight: 0.15,  // 物理约束的权重 — 可调节
      }),
    });
  }

  _estimateLengthScales() {
    // 粗估计: 每个参数至少移动 safety span 的 1/3 才能看到显著质量变化
    return this.searchSpace.map(s => {
      const span = s.max - s.min;
      return Math.max(span / 3, s.ramp * 5); // ramp_rate×5 = 最小有效步长
    });
  }

  _physicsPriorMean() {
    // 来自降阶模型的物理先验:
    // - TD拉伸↑ → 双折射均值↑ (取向度增加)
    // - 热定型温度↑ → 双折射CV↓ (应力松弛)
    // - 收卷张力↑ → 厚度CV↑ (边部拉伸)
    const physics = {
      td_draw_ratio: { birefringence_mean: +0.008, thickness_cv: -0.15 },
      td_zone_2_temp: { birefringence_cv: -0.25, birefringence_mean: -0.002 },
      heatset_temp: { birefringence_cv: -0.30, thickness_cv: -0.10 },
      winder_tension: { thickness_cv: +0.12 },
      relaxation_ratio: { birefringence_cv: +0.15 },
    };
    return (x) => physics[x.parameter] || {};
  }

  async recommendNext({
    currentSetpoints,     // 当前 setpoints
    diagnosis,            // SPC 诊断结果
    strategyStage,         // 'explore' | 'exploit' | 'recover'
    maxRecommendations,    // 默认 3
  }) {
    const normalizedCurrent = this._normalize(currentSetpoints);

    // 根据策略阶段选择采集函数
    let acquisitionFn;
    switch (strategyStage) {
      case 'explore':
        // Upper Confidence Bound — 高方差区域探索
        acquisitionFn = AcquisitionFunctions.UCB({
          beta: 2.0, // 探索权重（高→探索，低→利用）
        });
        break;
      case 'exploit':
        // Expected Improvement — 在当前最优附近寻优
        acquisitionFn = AcquisitionFunctions.EI({
          xi: 0.01, // 改善阈值
        });
        break;
      case 'recover':
        // 回到已知安全区域 — 从 bestHistory 中选最近的 PASS 点
        return this._recoveryCandidates(diagnosis);
    }

    // 约束优化: 最大化采集函数，约束在 safety limits 内
    const candidates = this._optimizeAcquisition({
      acquisitionFn,
      constraints: [
        ...this._safetyBounds(),          // min/max/maxDelta bounds
        ...this._rampConstraints(),       // 每个参数的 ramp rate 限制
        ...this._physicsConstraints(),    // 物理可行性约束
        ...this._qualityConstraints(),    // 不允许副指标大幅变差
      ],
      nCandidates: maxRecommendations,
      searchBudget: 5000, // L-BFGS 迭代上限
    });

    // 排序并输出杠杆
    return {
      objective: diagnosis.primary_quality_gap
        ? `reduce_${diagnosis.primary_quality_gap}`
        : 'maintain_current_quality_state',
      hypothesis: this._generateHypothesis(candidates[0], diagnosis),
      control_mode: strategyStage,
      ranked_levers: candidates.map((c, rank) => ({
        rank: rank + 1,
        parameter: c.name,
        direction: c.delta > 0 ? 'increase' : 'decrease',
        step: c.delta,
        current: c.current,
        target: c.current + c.delta,
        priority_score: c.ei_value || c.ucb_value,
        expected_impact: {
          metric: diagnosis.primary_quality_gap,
          predicted_change: this.gp.predict(c),
          uncertainty: this.gp.predictiveVariance(c),
        },
        rationale: this._rationaleFor(c, diagnosis),
      })),
      // 保持与现有 rdEngineer 返回值的兼容性
      candidate_parameters: candidates.map(c => ({
        name: c.name,
        direction: c.delta > 0 ? 'increase' : 'decrease',
        step: Math.abs(c.delta),
        allowed_range: [c.min, c.max],
        current: c.current,
        priority_score: c.ei_value || c.ucb_value,
        expected_response: this._expectedResponse(c, diagnosis),
      })),
      stop_rules: ['alarm_active', 'safety_gate_reject', 'consecutive_worse_count>=2'],
      review_focus: ['gp_model_convergence', 'response_reproducibility'],
    };
  }
}
```

### 6.4 采集函数策略

| 策略阶段 | 采集函数 | 行为 |
|---------|---------|------|
| **explore** | UCB (β=2.0) | 偏向高不确定性的区域 → 建立全局模型 |
| **exploit** | Expected Improvement | 在已知最优附近精调 |
| **recover** | 无采集 | 回退到 bestHistory 中最近的 PASS 点 |

### 6.5 Ramp Rate 约束的数学建模

真实产线的 ramp rate 限制了每一步的参数变化幅度。在贝叶斯优化中，这不是简单的 min/max bound：

```javascript
_rampConstraints() {
  // maxDelta 约束: |x_new - x_current| ≤ maxDelta
  // 这意味着候选点必须在以当前 setpoint 为中心的超矩形内
  return this.searchSpace.map(s => ({
    type: 'ineq',
    name: `ramp_${s.name}`,
    fn: (x) => s.maxDelta - Math.abs(x[s.name] - s.current),
  }));
}
```

---

## 7. Layer 4: 数字孪生 + 降阶模型

### 7.1 目的

贝叶斯优化需要一个**先验模型**来加速收敛和注入物理约束。数字孪生层的作用是：

1. **提供物理先验均值和方差** — 告诉 GP 哪些区域物理上不可能或不可能
2. **虚拟试验预筛选** — 在真实线上执行前，先在孪生模型中"预演"
3. **异常检测** — 真实产出与孪生预测差异过大 → 可能有设备故障

### 7.2 多保真度模型架构

```
高保真度模型 (离线)
  ├── 计算流体力学 (CFD) — Polyflow / Ansys Fluent
  │     → 模头流道 + MD拉伸区 的完整流场仿真
  │     → 耗时: 数小时/次
  │     → 使用: 定期离线校准
  │
  ├── 有限元热力耦合 — Abaqus / Moldflow
  │     → TD拉伸区 + 热定型区 的应力-应变-光学耦合
  │     → 耗时: 数十分钟/次
  │     → 使用: 批量生成训练数据

中保真度模型 (在线更新)
  ├── 降阶模型 (POD-ROM / Autoencoder)
  │     → 用高保真度的仿真结果训练
  │     → 使用神经网络拟合输入输出映射
  │     → 耗时: 毫秒级
  │
  └── 多保真度高斯过程 (MF-GP)
        → 结合高保真仿真 + 中保真 ROM + 低保真历史数据
        → 作为贝叶斯优化的先验

低保真度模型 (实时)
  └── 实时高斯过程 (Bayesian Optimizer 的 surrogate model)
        → 只使用真实产线观测更新
        → 物理约束来自中保真度模型
```

### 7.3 降阶模型的集成接口

```javascript
// infra/digital-twin/rom-adapter.mjs

import { TensorFlowModel } from './tf-model-loader.mjs';

export class ReducedOrderModel {
  constructor({ productGrade }) {
    // 为每种产品加载预训练的 ROM
    this.model = TensorFlowModel.load(`infra/digital-twin/models/${productGrade}_rom`);
    this.inputNormalizer = loadNormalizer(productGrade, 'input');
    this.outputNormalizer = loadNormalizer(productGrade, 'output');
  }

  /**
   * 预测给定 setpoint 的稳态质量指标
   * 输入: 12 维 setpoint 向量
   * 输出: 6 维质量指标 (thickness_mean/cv/delta, birefringence_mean/cv/delta)
   */
  async predict(setpoints) {
    const normalized = this.inputNormalizer.transform(setpoints);
    const rawPrediction = await this.model.predict(normalized);
    const prediction = this.outputNormalizer.inverseTransform(rawPrediction);
    return {
      metrics: {
        thickness_mean: prediction[0],
        thickness_cv: prediction[1],
        thickness_edge_center_delta: prediction[2],
        birefringence_mean: prediction[3],
        birefringence_cv: prediction[4],
        birefringence_edge_center_delta: prediction[5],
      },
      uncertainty: this.model.predictiveVariance(normalized), // 如使用 MC Dropout
    };
  }

  /**
   * 梯度信息 — 每个参数对每个质量指标的偏导数
   * 用于 GP 的物理正则化
   */
  async computeGradients(setpoints) {
    return this.model.computeJacobian(setpoints);
    // 返回: { td_zone_2_temp: { birefringence_cv: -0.025, ... }, ... }
  }
}
```

### 7.4 用于 GP 先验的物理约束

```javascript
export class PhysicsRegularizer {
  constructor({ rom, weight = 0.15 }) {
    this.rom = rom;
    this.weight = weight;
  }

  /**
   * 在 GP 的负对数边际似然 (NLML) 中加入物理正则化项:
   *
   * NLML_regularized = NLML_data + λ * NLML_physics
   *
   * NLML_physics = Σᵢ ‖μ_GP(x̃ᵢ) - y_ROM(x̃ᵢ)‖² / σ²_ROM(x̃ᵢ)
   *
   * 其中 x̃ᵢ 是在参数空间中等距采样的虚拟点
   */
  async computePhysicsLoss(gpModel) {
    const virtualPoints = this._sampleVirtualPoints(500); // 500个虚拟点
    let loss = 0;

    for (const point of virtualPoints) {
      const gpPred = gpModel.predict(point);
      const romPred = await this.rom.predict(point);
      const romUncertainty = romPred.uncertainty;

      for (const metric of QUALITY_METRICS) {
        const diff = gpPred.metrics[metric] - romPred.metrics[metric];
        loss += (diff * diff) / Math.max(romUncertainty[metric], 1e-6);
      }
    }

    return this.weight * loss / virtualPoints.length;
  }
}
```

---

## 8. Layer 5: 原料批次与漂移管理

### 8.1 真实产线的核心挑战

在一个双向拉伸薄膜产线上，以下因素会导致"最优配方"漂移：

1. **原料批次差异** — 不同批次的 PET 切片分子量分布、端羧基含量不同
2. **设备老化** — 模头唇口积碳、辊面磨损、加热器效率衰减
3. **环境变化** — 车间温湿度、冷却水温度季节性变化
4. **产品切换** — 换产后的热历史残留

### 8.2 批次指纹系统

```javascript
// infra/batch/batch-fingerprint.mjs

export class BatchFingerprintSystem {
  /**
   * 每次换料/换批时记录"原料指纹"
   *
   * 指纹包含:
   *   - 原料供应商 + 批次号
   *   - IV (特性粘度) — PET 的关键质量指标
   *   - COOH 端基含量 — 影响热稳定性
   *   - DSC 熔融峰温度 — 影响挤出机设定
   *   - 灰分/添加剂含量
   *
   * 这些数据通常来自 MES/LIMS 系统
   */
  async captureFingerprint({ batchId, mesData }) {
    return {
      batch_id: batchId,
      timestamp: new Date().toISOString(),
      supplier: mesData.supplier,
      lot_number: mesData.lotNumber,
      iv: mesData.intrinsicViscosity,        // dL/g
      cooh: mesData.carboxylEndGroup,         // mmol/kg
      tm: mesData.meltingTemperature,          // °C
      additives: mesData.additiveProfile,      // {silica: 0.05, ...}
    };
  }

  /**
   * 根据批次指纹计算"基线偏移"
   *
   * 如果新批次的 IV 比参考批次高 5%，则:
   *   - 挤出机转速可能需要微调
   *   - 熔体温度可能需要调整
   *   - MD 拉伸条件可能需要适配
   *
   * 这个偏移作为贝叶斯优化的初始条件调整
   */
  computeBatchDrift(currentFingerprint, referenceFingerprint) {
    const ivRatio = currentFingerprint.iv / referenceFingerprint.iv;
    const tmDelta = currentFingerprint.tm - referenceFingerprint.tm;

    return {
      extruder_speed: (1 - ivRatio) * 5,    // IV↑ → speed↓ 微调
      melt_temp: tmDelta * 0.3,              // Tm↑ → melt_temp↑
      // 其余参数保持当前 baseline
    };
  }
}
```

### 8.3 在线漂移检测

```javascript
// infra/drift/online-drift-detector.mjs

export class OnlineDriftDetector {
  /**
   * 使用 CUSUM (Cumulative Sum) 检测参数-质量关系的漂移
   *
   * CUSUM 对缓慢漂移敏感，适合检测设备老化导致的渐进变化
   */
  detectDrift({ recentWindows, gpModel }) {
    // 对每个关键质量指标维护一个 CUSUM 控制器
    const driftFlags = {};

    for (const metric of QUALITY_METRICS) {
      const residuals = recentWindows.map(w => {
        const predicted = gpModel.predict(w.setpoints);
        return w.actual[metric] - predicted.metrics[metric];
      });

      const cusum = computeCUSUM(residuals, {
        target: 0,
        slack: 0.2 * std(residuals),  // 允许的 slack
        decisionInterval: 3 * std(residuals),  // 漂移告警阈值
      });

      driftFlags[metric] = {
        drift_detected: cusum.alarm,
        direction: cusum.direction,           // 'up' | 'down'
        magnitude: cusum.cumulativeDeviation,
        since_window: cusum.alarmStartWindow,
      };
    }

    // 如果检测到漂移，建议重新校准 GP 模型或触发 explore 阶段
    return {
      any_drift: Object.values(driftFlags).some(d => d.drift_detected),
      flags: driftFlags,
      recommendation: this._driftRecommendation(driftFlags),
    };
  }
}
```

---

## 9. Layer 6: 影子模式 → 全自动闭环

### 9.1 三阶段演进路径

| 阶段 | 名称 | 行为 | 持续时间 | 必要条件 |
|:---:|------|------|:---:|------|
| 1 | **Shadow** | 系统生成推荐 → 人工确认 → 人工写入 PLC | 2-4 周 | OPC UA 读通 + SPC 可用 |
| 2 | **Semi-Auto** | 系统生成推荐 → Safety Gate → 人工审批 → 自动写入 | 4-12 周 | Shadow 达成 ≥90% 推荐接受率 |
| 3 | **Full-Auto** | 全自动: 诊断 → 贝叶斯优化 → 写入 (exploit 阶段才允许) | 持续 | Semi-auto ≥95% 通过 + 零安全事件 |

### 9.2 Shadow Mode 实现

```javascript
// infra/shadow/shadow-mode.mjs

export class ShadowModeController {
  constructor({ config, lineAdapter, orchestrator }) {
    this.mode = config.orchestrator.execution_mode;  // 'shadow' | 'semi_auto' | 'full_auto'
    this.lineAdapter = lineAdapter;
    this.orchestrator = orchestrator;
  }

  async executeIteration({ proposal, gate, strategyStage }) {
    if (!gate.allowed) {
      return { executed: false, reason: 'safety_gate_rejected' };
    }

    switch (this.mode) {
      case 'shadow': {
        // 不写设备，只记录"如果执行会怎样"
        const prediction = await this.orchestrator.surrogateModel.predict(proposal);
        await this._notifyOperator({
          type: 'shadow_recommendation',
          proposal,
          predicted_metrics: prediction.metrics,
          confidence: prediction.uncertainty,
        });
        return {
          executed: false,
          mode: 'shadow',
          recommendation_logged: true,
          predicted_metrics: prediction.metrics,
        };
      }

      case 'semi_auto': {
        // 需要人工审批
        const approval = await this._requestOperatorApproval({ proposal, gate });
        if (approval.status !== 'approved') {
          return { executed: false, reason: `approval_${approval.status}` };
        }
        // 审批通过 → 自动写入
        return await this.lineAdapter.applyApprovedProposal(proposal);
      }

      case 'full_auto': {
        // 仅 exploit 阶段允许全自动
        if (strategyStage !== 'exploit') {
          return { executed: false, reason: 'full_auto_only_in_exploit' };
        }
        return await this.lineAdapter.applyApprovedProposal(proposal);
      }
    }
  }

  async _notifyOperator(message) {
    // 推送通知到: 控制台UI / 微信/钉钉 / 邮件
    await notificationService.push({
      channel: this.config.orchestrator.notification_channel,
      message,
    });
  }

  async _requestOperatorApproval({ proposal, gate }) {
    // 写入审批文件 → 等待人工确认
    // 与当前 approval-hooks.mjs 的 waitForApprovalDecision 兼容
    const approvalPacket = buildApprovalPacket({ proposal, gate });
    await writeApprovalFile(approvalPacket);
    return await waitForApprovalDecision({
      approvalFile: approvalPacket.path,
      pollMs: 1500,
      timeoutMs: 15 * 60 * 1000, // 15分钟超时
    });
  }
}
```

### 9.3 全自动的安全前置条件

```javascript
function canAutoExecute({ strategyStage, diagnosis, driftStatus, gate }) {
  // 必须同时满足以下全部条件:
  return (
    strategyStage === 'exploit' &&           // 必须是 exploit 阶段（精调已知参数）
    diagnosis.quality_state !== 'FAIL' &&     // 当前质量不能 FAIL
    !driftStatus.any_drift &&                // 没有检测到漂移
    gate.allowed &&                          // Safety Gate 通过
    gate.violations.length === 0             // 零违规
  );
  // 任何条件不满足 → 降级为 semi_auto 或 shadow
}
```

---

## 10. 安全体系

### 10.1 多层安全防护

```
┌──────────────────────────────────────────────┐
│ Layer 6: 人工 override (物理急停)             │ ← E-Stop 最高优先级
├──────────────────────────────────────────────┤
│ Layer 5: 审批超时降级                          │ ← 15分钟无响应 → 自动拒绝
├──────────────────────────────────────────────┤
│ Layer 4: PLC Interlock                        │ ← 硬件级安全连锁
├──────────────────────────────────────────────┤
│ Layer 3: Safety Gate (确定性规则)              │ ← 当前已实现
│  - bounds check: target ∈ [min, max]          │
│  - delta check: |delta| ≤ maxDelta            │
│  - ramp check: ramp_rate ≤ maxRamp            │
│  - alarm check: no active alarm               │
│  - stability check: line_state === STABLE     │
│  - rollback check: rollback recipe is valid   │
├──────────────────────────────────────────────┤
│ Layer 2: Ramp Rate 监控 (实时)                 │ ← 新增
│  - 写入期间 500ms 轮询 actual value           │
│  - actual 偏离预期 > 阈值 → 停止 ramp          │
├──────────────────────────────────────────────┤
│ Layer 1: 模型不确定性阈值                       │ ← 新增
│  - GP 预测方差 > 3×baseline → 拒绝自动执行     │
│  - 降级为 shadow 推荐                          │
└──────────────────────────────────────────────┘
```

### 10.2 Safety Gate 增强

当前 `deterministicSafetyGate` 已有 6 项检查。为真实产线需要增加：

```javascript
// 真实产线 safety gate 的增强检查
const REAL_LINE_GATE_CHECKS = [
  ...SIMULATED_GATE_CHECKS,           // 当前已有的 6 项
  {
    name: 'ramp_in_progress',
    check: () => !isRampInProgress(), // 不能同时执行两个 ramp
    message: 'another_ramp_in_progress',
  },
  {
    name: 'interlock_status',
    check: () => allInterlocksHealthy(),
    message: 'interlock_not_healthy',
  },
  {
    name: 'maintenance_window',
    check: () => !isScheduledMaintenance(),
    message: 'maintenance_window_active',
  },
  {
    name: 'gp_uncertainty',
    check: (proposal) => gpPredictiveVariance(proposal) < UNCERTAINTY_THRESHOLD,
    message: 'model_uncertainty_too_high',
  },
  {
    name: 'batch_drift_severe',
    check: () => !driftDetector.isSevere(),
    message: 'severe_batch_drift_detected',
  },
];
```

---

## 11. 分阶段部署计划

### Phase 0: 基础设施准备 (2-4 周)

| 任务 | 产出 | 负责人 |
|------|------|:---:|
| OPC UA 服务器部署 + 标签映射 | `infra/opcua/tag-mapping.json` | 自动化工程师 |
| InfluxDB/TimescaleDB 搭建 | 时序数据库就绪 | 数据工程师 |
| MES/LIMS 批次数据接口对接 | `infra/batch/mes-adapter.mjs` | 系统集成 |
| 历史数据采集 (至少 3 个月) | ≥1000 个稳定窗口 | 数据工程师 |

### Phase 1: 影子模式上线 (4-8 周)

| 任务 | 产出 |
|------|------|
| OPC UA MCP Server 开发 | `infra/opcua/mcp-server.mjs` |
| SPC 诊断引擎开发 + 离线验证 | `infra/diagnostics/spc-engine.mjs` |
| 历史数据上训练初始 GP 模型 | `infra/optimization/models/` 目录下的 `.json` 模型文件 |
| Shadow mode 控制器 | 推荐不写入，记录接受率 |
| 前端实时 Dashboard | 推荐 vs 实际 的对比视图 |

**验收标准:** 推荐接受率 ≥ 80%（连续 2 周）

### Phase 2: Semi-Auto 上线 (8-16 周)

| 任务 | 产出 |
|------|------|
| 数字孪生 ROM 训练 | `infra/digital-twin/models/` |
| 物理信息 GP-BO 引擎对接 | `infra/optimization/gp-bayesian-engine.mjs` |
| 审批工作流（Webhook → IM/邮件） | `infra/approval/workflow.mjs` |
| Ramp Rate 实时监控 | `infra/safety/ramp-monitor.mjs` |
| 批次漂移检测集成 | `infra/drift/online-drift-detector.mjs` |
| 真实线 adapter 替换 simulated adapter | 更新 `.mcp.json` |

**验收标准:** 安全事件 = 0，优化目标在 5 轮以内达成 ≥ 85%

### Phase 3: Full-Auto (仅 exploit 阶段) (16-24 周)

**验收标准:** Semi-auto 连续 4 周 ≥95% 审批通过 + 零安全事件 + 无人工干预成功率达 90%

---

## 12. 附录: 关键接口契约

### 12.1 Adapter 接口（向后兼容）

```typescript
// 与当前 line-adapters.mjs 定义的接口一致
// 真实产线 adapter 必须实现相同接口
interface LineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  reset(): Promise<WindowResult>;
  readCompactState(): Promise<CompactState>;
  readSnapshot(): Promise<Snapshot>;
  readOnlineQuality(): Promise<OnlineQuality>;
  listWritableParameters(): Promise<WritableParameter[]>;
  runUntilStable(params: StableParams): Promise<WindowResult>;
  previewProposal(proposal: Proposal): Promise<SafetyGateResult>;
  checkSafetyGate(proposal: Proposal): Promise<SafetyGateResult>;
  requestApproval(context: ApprovalContext): Promise<ApprovalDecision>;   // 新增
  applyApprovedProposal(proposal: Proposal): Promise<ExecutionReceipt>;
  rollbackToRecipe(reason: string): Promise<RollbackReceipt>;
  saveCandidateRecipe(params: SaveRecipeParams): Promise<RecipeRecord>;
  loadRecipeBaseline(params: LoadBaselineParams): Promise<LoadReceipt>;
  readHistorianWindow(params: HistorianParams): Promise<WindowResult>;    // 新增
}
```

### 12.2 配置驱动切换

```json
// config/online-line.config.json
{
  "orchestrator": {
    "provider": "real-line",
    "execution_mode": "shadow",
    "auto_approve_simulator": false
  },
  "online": {
    "enabled": true,
    "ws_url": "wss://10.0.1.50:9443/line/events",
    "http_url": "https://10.0.1.50:9443/api/line",
    "historian_url": "https://historian.internal:8086",
    "line_id": "line-3"
  }
}
```

### 12.3 GP 模型持久化格式

```json
{
  "product_grade": "PET_FILM_GRADE_A",
  "model_version": "3.2.1",
  "trained_at": "2026-06-15T08:00:00Z",
  "training_data_points": 247,
  "kernel": {
    "type": "Matern52",
    "length_scales": {
      "td_zone_2_temp": 2.4,
      "heatset_temp": 3.1,
      "td_draw_ratio": 0.08,
      "winder_tension": 4.5
    },
    "output_scale": 1.15
  },
  "noise_variance": 0.022,
  "physics_regularization_weight": 0.15,
  "inducing_points": 500,
  "search_space": { "..." },
  "model_file": "gp_pet_v3.2.1.json"
}
```

### 12.4 与现有项目的文件结构集成

```
Online_optimizer/
├── .claude/skills/closed-loop-optimizer/   # 保留 Skill
│   ├── SKILL.md
│   ├── references/                          # 保留参考文档
│   └── scripts/                             # 保留验证脚本
├── config/
│   └── online-line.config.json              # 已有 → 扩展
├── infra/                                   # 新增：真实产线基础设施
│   ├── opcua/
│   │   ├── mcp-server.mjs                   # OPC UA MCP Server
│   │   └── tag-mapping.json
│   ├── diagnostics/
│   │   └── spc-engine.mjs                   # SPC 诊断引擎
│   ├── optimization/
│   │   ├── gp-bayesian-engine.mjs           # 贝叶斯优化引擎
│   │   ├── gp-kernel.mjs                    # GP 核函数实现
│   │   └── models/                          # 持久化 GP 模型
│   ├── digital-twin/
│   │   ├── rom-adapter.mjs                  # 降阶模型适配器
│   │   └── models/                          # TensorFlow 模型文件
│   ├── batch/
│   │   ├── batch-fingerprint.mjs            # 批次指纹
│   │   └── mes-adapter.mjs                  # MES/LIMS 对接
│   ├── drift/
│   │   └── online-drift-detector.mjs        # CUSUM 漂移检测
│   ├── safety/
│   │   └── ramp-monitor.mjs                 # Ramp rate 实时监控
│   ├── shadow/
│   │   └── shadow-mode.mjs                  # 影子模式控制器
│   └── approval/
│       └── workflow.mjs                     # 审批工作流
├── scripts/optimization/
│   ├── lib/
│   │   ├── role-engines.mjs                 # 保留：接口兼容，内部调用新引擎
│   │   ├── line-adapters.mjs                # 保留：扩展 RealLineAdapter
│   │   └── ...                              # 其余 lib 保留
│   ├── run-sim-campaign.mjs                 # 保留：模拟器回归
│   └── run-production-campaign.mjs          # 新增：真实产线campaign
├── schemas/optimization/                    # 保留：15 schemas + 可能扩展
├── simulator/                               # 保留：开发/回归测试
└── workspace/
    └── optimization-tasks/                  # 保留：任务目录
```

---

## 总结

这个方案的核心思路是：**保留当前系统所有做对的部分（编排流程、Safety Gate、产品感知、工件审计链、MCP 接口设计），替换三个核心引擎（模拟器→OPC UA 真实数据、质量诊断→SPC 多变量统计、参数决策→贝叶斯优化），并在安全边界上增加四层新的防护。**

从模拟器到真实产线不是"重写"，而是**逐层替换** — 每替换一层，都可以在影子模式下独立验证 2-4 周，确认安全后再进入下一层。
