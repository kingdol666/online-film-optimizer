# Online_optimizer 完整架构报告

> **文档定位**：本文件是 `Online_optimizer` 项目「薄膜双拉中试线 DOE 配方研发系统」的完整架构说明。
> 它是单一权威架构视图——当其他文档（PROJECT_MAP、DOE-optimization-flow、各 skill/agent）与本文件冲突时，以本文件为准。
> 生成时间：2026-06-13｜对应提交：`17923ab`

---

## 0. 一句话架构

> 一条**数字中试线**（模拟器，伪装成真实产线 API）+ 一个**Claude Code 原生智能体团队**（PI + 3 专家），用**4 阶段顺序 DOE**（筛选→响应面→优化→确认）在数字产线上系统化试验，凭**统计证据 stage-gate** 推进，产出一个满足所有性能目标、经确认与稳健性验证的**可转产 recipe**。优化大脑全在 `.claude/`，前后端只做可视化。

---

## 1. 设计哲学（5 条核心原则）

| 原则 | 含义 |
|------|------|
| **DOE 而非盲目试错** | 用试验设计（部分析因/响应面/期望函数）系统化提取工艺知识，每个 run 都是矩阵里一个数据点 |
| **证据驱动的 stage-gate** | 阶段推进只凭统计证据（active 因子/曲率/无失拟/最优点入窗/确认通过），不靠"看起来变好" |
| **职责严格分工 + 交叉验证** | 4 角色各司其职（设计/分析/执行/治理），三方独立验证彼此结论 |
| **单一写线授权** | 只有 Process 角色能授权写线；其他角色只读/协调 |
| **可审计、可回退** | 每个设计/run/分析/gate 决策都落带时间戳的工件，每步都有回退路径 |

---

## 2. 运行时分层架构（4 层）

```
┌─────────────────────────────────────────────────────────────────────┐
│  层 4 · 优化大脑（Claude Code 原生）         .claude/                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ 1 个入口 skill + 4 个团队 agent + 3 个角色 skill + DOE 框架   │  │
│  │  → 通过 MCP 操作产线，跑 DOE campaign，产出 recipe            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │ MCP (stdio)                           │
│                              ▼                                       │
│  层 3 · 产线模拟器（数字中试线）   simulator/industrial-film-line/   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ 黑盒物理模型 + HTTP(:8877) + MCP 服务(16 工具) + 产品目录     │  │
│  │ 伪装成真实产线 API；4 产品档(PET/PPAT/PMMA/PVA)              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │ HTTP/WebSocket                        │
│                              ▼                                       │
│  层 2 · 最小后端（状态中转）         app/backend/ (:4317)            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ 代理模拟器 HTTP 接口 + 向前端推 WebSocket 实时快照            │  │
│  │ 不含任何优化逻辑（优化全在层 4）                              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │ WebSocket                             │
│                              ▼                                       │
│  层 1 · 可视化前端                   app/frontend/ (:5418)           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ 实时控制台：参数预览/应用/稳定化/回退/质量趋势                │  │
│  │ 仅展示与手动调节，不做自动优化                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**关键边界**：层 1-3 是"产线 + 可视化"，**不含任何 agent/优化逻辑**；层 4 是"大脑"，**全部优化智能都在 `.claude/`**。这是项目 CLAUDE.md 钉死的边界。

---

## 3. 智能体团队架构

### 3.1 团队拓扑

```
                    ┌─────────────────────────┐
                    │  PI 编排器 (opus, blue)  │  ← campaign 指挥、stage-gate、预算
                    │  closed-loop-optimization│
                    │  -orchestrator           │
                    └────────────┬────────────┘
                                 │ TeamCreate + Agent(mode:auto) 一次性派生
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ R&D agent       │ │ Quality agent   │ │ Process agent   │
    │ DOE Designer    │ │ Stats Lead      │ │ Trial Exec      │
    │ (opus,yellow)   │ │ (opus,cyan)     │ │ (opus,green)    │
    │ 只读·设计       │ │ 只读·统计       │ │ 唯一写线授权     │
    │ →rd-engineer    │ │ →quality-eng    │ │ →process-eng    │
    │   skill         │ │   skill         │ │   skill         │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 ▼
                    SendMessage + 工件总线（编号 JSON）
```

### 3.2 智能体清单（14 个，分 3 组）

**A. DOE 团队（4 个 · opus · 常驻 campaign）**

| agent | DOE 帽子 | 工具 | 职责 |
|-------|---------|------|------|
| `closed-loop-optimization-orchestrator` | **PI / 项目首席** | 基本+Agent/TeamCreate/TeamDelete (9) | 路线图、stage-gate、预算、最终负责 |
| `closed-loop-optimization-rd-agent` | **DOE 设计师** | 基本 (6) | 设计矩阵、因子空间、模型预测、期望函数优化 |
| `closed-loop-optimization-quality-agent` | **测量与统计主管** | 基本 (6) | MSA、效应/曲率/ANOVA/失拟/R²、gate 统计证据 |
| `closed-loop-optimization-process-agent` | **试执行主管** | 基本 (6) | 逐 run proposal、（主会话执行 MCP）、run 间复位、偏离记录 |

**B. 在线 Worker（3 个 · 无状态单发）** —— `online-{quality,rd,process}-engineer`
并行/一次性任务用，加载同一套角色 skill；正式团队首选 A 组常驻角色。

**C. 诊断流水线（7 个 · 属 industrial-deep-diagnostic，非闭环优化）**
`context-builder / data-processor / diagnostician / judge / reporter / report-reviewer / vlm-visual-analyzer` —— 另一条工作流（工业深度诊断），与 DOE campaign 独立。

> 所有 14 个 agent 均为 **auto 权限**（`defaultMode:auto` + 派生 `mode:"auto"`），frontmatter 全部为官方标准字段（`name/description/model/tools/color`）。

---

## 4. 技能方法学架构（progressive disclosure 三层）

```
┌─────────────────────────────────────────────────────────────────┐
│ 元数据层（~100词，常驻上下文）                                    │
│   name + description（触发词驱动自动调用）                        │
├─────────────────────────────────────────────────────────────────┤
│ SKILL.md 正文（<500行，触发时加载）                               │
│   • closed-loop-optimizer (119行) — 入口编排协议                  │
│   • quality-engineer (135行) — DOE 统计分析方法学                 │
│   • rd-engineer (142行) — DOE 试验设计方法学                      │
│   • process-engineer (168行) — 中试线试执行方法学                 │
├─────────────────────────────────────────────────────────────────┤
│ references/（按需加载，无上限）                                   │
│   • doe-campaign-framework.md ★ 4阶段DOE单一事实源               │
│   • team-orchestration / native-claude-code-teamwork             │
│   • coordination-protocol / subagent-dispatch / ... (共10份)     │
└─────────────────────────────────────────────────────────────────┘
```

**技能↔智能体映射**：每个团队 agent 加载对应 skill 取方法学；skill 是"怎么做"，agent 是"谁来做 + 行为准则"。

---

## 5. DOE 控制流程架构（核心闭环）

### 5.1 4 阶段顺序 DOE

```
Phase0 FRAME → Phase1 SCREEN → Phase2 CHARACTERIZE → Phase3 OPTIMIZE → Phase4 CONFIRM → FREEZE
锁定Y/X/预算   部分析因+中心点    CCD/Box-Behnken      期望函数多响应      重复+稳健性
MSA           找vital few+曲率   二阶模型ANOVA+LOF     预测最优点+预测区间  hold-window
              ◄─重框定          ◄─扩充设计            ◄─最陡上升移区      ◄─迭代
```

### 5.2 每阶段节拍循环（5 步）

```
① R&D 出设计矩阵 ─► ② PI 评审 ─► ③ Process 逐run proposal(主会话执行MCP)
                                  ─► ④ Quality 统计分析 ─► ⑤ PI stage-gate 裁决
                                                                        │
                                              ┌─────────────────────────┤
                                              ▼            ▼            ▼
                                          推进下一阶段   迭代(补设计/移区)  硬停
```

### 5.3 Stage-Gate 判据（证据驱动）

| Gate | 通过条件（统计证据） |
|------|---------------------|
| 0→1 | Y/X/预算锁定，MSA 可信 |
| 1→2 | active 因子 + 中心点曲率显著 |
| 2→3 | 无失拟 LOF、R²/pred-R² 可接受、残差干净 |
| 3→4 | 预测最优点落所有 Y 窗口内 |
| 4→FREEZE | 确认重复在目标+预测区间、稳健扰动在规格、hold-window 满足 |

> 详细流程图见 `docs/DOE-optimization-flow.md`（ASCII + Mermaid）。

---

## 6. 权限与执行架构

### 6.1 权限模式
- **全局** `settings.json` → `"defaultMode": "auto"`
- **派生** orchestrator spawn 时 `mode: "auto"`
- → 所有 agent 无权限打断运行

### 6.2 工具白名单（已精简到基本内置）
| agent 类 | 工具 |
|---------|------|
| 3 角色 agent | `Read, Write, Glob, Grep, TodoWrite, SendMessage` (6) |
| PI 编排器 | 上述 + `Agent, TeamCreate, TeamDelete` (9) |

### 6.3 MCP 执行模型（关键设计）

> **MCP 工具不注入 subagent**——`film_line_*` 只在**主会话**可用。

```
Process agent 产出 proposal 工件（通过五门）
        │
        ▼
   主会话（持 MCP）执行: preview → apply → run_until_stable → collect
        │
        ▼
   回执写回 workspace → Process/Quality 复核
```

**权限边界以"授权"形式保留**：只有 Process 角色能授权写线（产出通过五门的 proposal），但实际 MCP 调用在主会话。这绕开了 subagent 无 MCP 的平台限制。

---

## 7. MCP 接口架构（16 工具）

| 类别 | 工具 | 谁用 |
|------|------|------|
| **只读 (6)** | `get_state` / `get_snapshot` / `get_online_quality` / `get_ledger` / `list_products` / `list_writable_parameters` | 主会话（agent 经工件间接用） |
| **写入 (9)** | `preview_proposal` / `preview_setpoints` / `apply_proposal` / `apply_setpoints` / `run_until_stable` / `tick` / `rollback` / `save_candidate_recipe` / `load_recipe_baseline` | 主会话（基于 Process proposal） |
| **控制 (1)** | `reset` | 主会话（campaign 重置） |

`.mcp.json` 注册两个 MCP server：`industrial-film-line-sim`（产线）+ `simple-time`（时间）。

---

## 8. 数据/工件流架构

### 8.1 任务工区结构
```
workspace/optimization-tasks/<task-id>/
├── 00_frame/campaign_charter.json          ← Phase0 章程（PI）
├── 01_screening/
│   ├── doe_design_001.json                 ← 筛选设计（R&D）
│   ├── trial_<run>/run_log.json            ← 每 run 执行记录（Process）
│   └── doe_analysis_001.json               ← 筛选分析（Quality）
├── 02_rsm/  (同结构，CCD/BB)
├── 03_optimize/optimum_001.json            ← 预测最优点（R&D）
├── 04_confirm/confirmation_001.json        ← 确认+稳健性（Process+Quality）
├── stage_gate_<phase>.json                 ← 阶段裁决（PI）
├── team/
│   ├── team_messages.jsonl                 ← 协议消息流（唯一事实源）
│   ├── inbox/<role>/                       ← 角色收件箱
│   └── handoffs/*.md                       ← 跨角色交接
└── outputs/final_recipe.json               ← ★ 最终冻结 recipe
```

### 8.2 编号不可变工件契约
- 新 run 必须用带编号文件：`doe_design_001`、`trial_001/run_log`、`doe_analysis_001`、`execution_receipt_001`
- 每个角色读同族最高编号工件
- `team_messages.jsonl` 是协调唯一事实源，不靠隐式聊天上下文

---

## 9. 完整文件清单

### 智能体（`.claude/agents/` · 14 个）
- **DOE 团队 (4)**：`closed-loop-optimization-{orchestrator,quality-agent,rd-agent,process-agent}.md`
- **Worker (3)**：`online-{quality,rd,process}-engineer.md`
- **诊断流水线 (7)**：`context-builder/data-processor/diagnostician/judge/reporter/report-reviewer/vlm-visual-analyzer.md`

### 技能（`.claude/skills/` · 4 个）
- `closed-loop-optimizer/`（入口）+ `references/`（10 份，含 ★`doe-campaign-framework.md`）
- `quality-engineer/` · `rd-engineer/` · `process-engineer/`

### 支撑（`.claude/`）
- `agent-memory/<role>/` —— 各角色长期记忆（黑盒机理、质量门规则等）
- `hooks/mcp-preflight.mjs` —— 会话启动 MCP/Backend 连通性门禁
- `settings.json` —— `defaultMode: auto` + 权限 allow/deny

### 文档（`docs/`）
- `PROJECT_MAP.md` —— 项目全景速查
- `DOE-optimization-flow.md` —— 流程图（ASCII + Mermaid）
- `ARCHITECTURE.md` —— ★ 本文件

---

## 10. 架构成熟度小结

| 维度 | 状态 |
|------|------|
| DOE 方法学专业度 | ✅ 4 阶段 + 统计判据 + 中心点/失拟/期望函数/最陡上升，角色职责化分布 |
| 智能体标准化 | ✅ 14 agent 全部官方 frontmatter，auto 权限 |
| 技能可触发 | ✅ 4 skill 推力型 description + progressive disclosure |
| 权限边界 | ✅ 单一写线授权（Process），MCP 在主会话执行 |
| 可审计 | ✅ 编号不可变工件 + 消息总线 + stage-gate 记录 |
| 团队可启动 | ✅ TeamCreate + Agent 派生已验证；MCP 经主会话执行已理顺 |
| 已提交 | ✅ 本地 `17923ab`（待用户手动 push 到 origin，沙箱无 GitHub 网络） |

> **已知限制**：当前 Claude Code 沙箱环境无法连接 GitHub（推送需用户在自有终端执行 `git push origin main`）。
