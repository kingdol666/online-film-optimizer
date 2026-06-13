# Online_optimizer 项目记忆 / PROJECT MAP

> 本文件由 Claude Code 通读整个项目后生成，作为「项目记忆」固化在本仓库内。
> 目的：让任何后续会话无需重新摸索，即可快速掌握项目结构、Skill 作业流程、Teamwork 能力与 MCP 权限边界。
> 生成日期：2026-06-13。

---

## 1. 项目本质与边界

这是一个**工业薄膜双拉产线（Biaxial Film Line）在线闭环优化平台**。

它刻意把「产线模拟器」和「优化大脑」分离开：

| 层 | 角色 | 是否含优化逻辑 |
|----|------|---------------|
| `simulator/industrial-film-line/` | 真实产线的替身：黑盒物理模型 + HTTP 控制接口 + MCP 服务 | ❌ 只有产线，没有优化 |
| `app/backend` | 代理模拟器 HTTP 接口，向前端推 WebSocket 快照 | ❌ 只做状态中转 |
| `app/frontend` | 实时可视化控制台（参数预览/应用/稳定化/回退/质量趋势） | ❌ 只做展示与手动调节 |
| `.claude/` | **优化闭环的真正执行者**：Skill + 4 个 Agent + 团队编排协议 | ✅ 所有优化逻辑都在这里 |

**核心原则（来自 CLAUDE.md）：**
- 优化闭环由 Claude Code 通过 MCP 完成，**不是**由项目内置的 agent 流程完成
- 不要把 agent/orchestrator/campaign 逻辑塞回前后端
- 前后端只服务于模拟器状态展示和参数调节
- 不要动 `.claude/` 目录，除非用户明确要求

> ⚠️ 一句话定性：模拟器对外伪装成「真实运行中的产线 API」。整个 `.claude/` 团队都被要求**像对待真实产线一样**对待它——「产线无小事」，每次参数变更都要有完整证据链、可回退、可审计。

---

## 2. 目录结构

```
Online_optimizer/
├── simulator/industrial-film-line/
│   ├── line-simulator.mjs        # 黑盒物理模型（厚度/双折射响应）
│   ├── blackbox-model.mjs        # 响应函数 + 最优点
│   ├── product-catalog.mjs       # 4 个产品档（PET/PPAT/PMMA/PVA）的 baseline/safety/targets
│   ├── server.mjs                # HTTP 服务（:8877）
│   ├── mcp-server.mjs            # MCP 服务（stdio，17 个 film_line_* 工具）
│   ├── simple-time-mcp.mjs       # 独立时间 MCP
│   └── workspace/runtime/        # 产线运行时状态 JSON
├── app/
│   ├── backend/src/              # :4317，HTTP + WebSocket，代理模拟器
│   └── frontend/src/App.vue      # :5418，可视化控制台
├── .mcp.json                     # 注册 industrial-film-line-sim + simple-time 两个 MCP
├── .claude/
│   ├── skills/
│   │   ├── closed-loop-optimizer/   # ★ 唯一的用户入口 Skill
│   │   │   ├── SKILL.md
│   │   │   ├── references/*.md       # 9 份编排/协议契约
│   │   │   └── scripts/              # mcp-preflight.mjs, native-team-enforcer.mjs
│   │   ├── quality-engineer/SKILL.md
│   │   ├── process-engineer/SKILL.md
│   │   └── rd-engineer/SKILL.md
│   ├── agents/                   # 4 个团队角色 + 一批工业诊断 agents
│   │   ├── closed-loop-optimization-orchestrator.md   # 团队负责人（model: opus）
│   │   ├── closed-loop-optimization-quality-agent.md  # 质量部长（只读）
│   │   ├── closed-loop-optimization-rd-agent.md       # 研发主任（只读）
│   │   └── closed-loop-optimization-process-agent.md  # 首席工艺（唯一可写）
│   ├── agent-memory/<role>/      # 每个角色的长期记忆（黑盒机理、质量门规则等）
│   └── hooks/mcp-preflight.mjs   # 会话启动前的 MCP/Backend 连通性门禁
├── workspace/
│   ├── optimization-tasks/<task-id>/   # ★ 每次优化任务的工件根目录
│   └── *.mjs / *.json                  # 历史调试临时文件
└── docs/PROJECT_MAP.md           # ← 本文件
```

---

## 3. 三大运行端口

| 服务 | 命令 | 端口 | 健康检查 |
|------|------|------|---------|
| 产线模拟器 HTTP | `npm run sim:http` | :8877 | `http://127.0.0.1:8877/sim/state` |
| 产线 MCP | `npm run sim:mcp` | stdio | 由 `.mcp.json` 自动拉起 |
| 后端（状态中转+WS） | `npm run backend` | :4317 | `http://127.0.0.1:4317/api/health` |
| 前端（可视化） | `npm run frontend` | :5418 | `http://127.0.0.1:5418` |

---

## 4. MCP 工具面 & 权限矩阵（核心安全机制）

模拟器通过 MCP 暴露 **17 个 `film_line_*` 工具**。工具分两类，权限严格按角色切分：

**只读类（Quality / R&D / Process 都可用）：**
`film_line_list_products` · `film_line_get_state` · `film_line_get_ledger` · `film_line_get_snapshot` · `film_line_list_writable_parameters` · `film_line_get_online_quality`

**写入类（只有 Process 可用）：**
`film_line_preview_proposal` · `film_line_preview_setpoints` · `film_line_apply_proposal` · `film_line_apply_setpoints` · `film_line_run_until_stable` · `film_line_tick` · `film_line_rollback` · `film_line_save_candidate_recipe` · `film_line_load_recipe_baseline`

**硬性权限边界（写在每个 agent 的 `tools:` frontmatter 里，由 Claude Code 强制）：**

| 角色 | MCP 读 | MCP 写 | 协调/审批 |
|------|--------|--------|----------|
| Orchestrator（负责人） | ❌ 不直接读线 | ❌ 绝不写 | ✅ 团队调度+最终审批 |
| Quality（质量部长） | ✅ | ❌ | ✅ 写诊断工件 |
| R&D（研发主任） | ✅ | ❌ | ✅ 写策略工件 |
| **Process（首席工艺）** | ✅ | ✅ **唯一** | ✅ 写执行回执 |

> 权限不是「君子协定」——是写死在 agent frontmatter 的 `tools:` 白名单里，越权调用会被 Claude Code 直接拒绝。

---

## 5. 支持的产品（4 个档）

由 `product-catalog.mjs` 定义，每个产品有独立的 baseline recipe / safety_limits / 黑盒最优点 / target 模板 / 历史配方记忆：

| product_grade | 材料 | 厚度目标 | 双折射均值目标 |
|--------------|------|---------|--------------|
| `PET_FILM_GRADE_A`（默认） | PET 双向拉伸光学膜 | 12.0 μm | 0.078 |
| `PPAT_FILM_GRADE_A` | PPAT 可降解柔性膜 | 18.0 μm | 0.046 |
| `PMMA_FILM_GRADE_A` | PMMA 高透光硬质膜 | 25.0 μm | 0.032 |
| `PVA_FILM_GRADE_A` | PVA 水溶/阻隔膜 | 30.0 μm | 0.055 |

> ⚠️ **不可跨产品复用**：不同产品的安全极限、目标窗口、配方元数据完全不同。

---

## 6. ★ Skill 完整作业流程（closed-loop-optimizer）

`closed-loop-optimizer` 是**唯一**的用户入口。触发词：产线优化 / recipe 开发 / 团队协同优化 / 双折射·厚度·透光率优化。

### 阶段一：启动门禁（Gate Check）—— 不许假装开工
1. 解析用户目标，推断 `product_grade`
2. Backend 可达：`curl -fsS http://127.0.0.1:4317/api/health`
3. MCP 只读工具齐全（get_state/snapshot/online_quality/list_writable/list_products）
4. Process 写工具齐全（preview/apply/run_until_stable/rollback/save_recipe/load_baseline）
5. 当前产线可读且 STABLE、无 ALARM
> 任一失败 → 立即停止，明确报告缺什么。

### 阶段二：建立任务 Workspace
在 `workspace/optimization-tasks/<task-id>/` 下生成标准目录：
- `goal_request.json` / `product_target.json` —— 归一化目标 + 产品上下文
- `team/department_briefs.json` —— 三角色 brief
- `team/inbox/<role>/intake_brief.json` —— 每角色收件箱
- `team/team_messages.jsonl` —— 协议消息流（唯一事实源）
- `team/team_contract.json`

### 阶段三：建立原生团队（team-first）
1. `TeamCreate` 用 task-id 命名一个团队
2. `Agent` **一次性**派生全部三个常驻角色，贯穿整个 campaign（不是每轮临时拉起再销毁）
3. 用 `SendMessage` + 文件工件驱动每一次交接

### 阶段四：严格串行的首轮启动（信息有依赖，不可并行）
```
4a. Quality  → 02_quality/quality_diagnosis_001.json   （数据支撑+置信度标注）
       ↓ Orchestrator 审查：根因有无物理机理？置信度与数据是否一致？
4b. R&D      → 03_rd_plan/rd_optimization_plan_001.json （可证伪假设+量化预期+步长≤75%）
       ↓ Orchestrator 审查：假设可证伪？步长保守？有恢复方案？
4c. Process  → 04_execution/ 下的 parameter_delta_proposal + safety_gate + execution_receipt
       ↓ 唯一执行 MCP 写入：preview → safety gate → apply → run_until_stable → before/after 对比
```

### 阶段五：节拍循环（两层控制环）
- **外层策略环**：Quality 每个稳定窗口判定 `effective / ineffective / worse`；R&D 后台持续吸收 ledger/历史，准备下一轮假设
- **内层工艺环**：Process 在当前策略下做多轮 bounded 微调（每步 ≤2 参数、≤75% max_delta）
- **节拍调度（由 Orchestrator 决定谁上场）：**

| 场景 | 谁工作 | Orchestrator 动作 |
|------|--------|------------------|
| 当前策略活跃 | Process 微调 + Quality 监控 | 监控不干预 |
| 连续 2 轮 ineffective | R&D 预备新策略 | 发 replan 预警 |
| 连续 3 轮 ineffective | —— | 强制新策略循环/recover |
| 连续 2 轮 worse | 🚨 | 回退最佳基线，全员重评 |
| 安全门拒绝 | R&D 换方案 | 不许 Process 绕路 |
| Quality 判 PASS | —— | 进入 hold-window |

### 阶段六：停止与收尾（5 种合法停止条件）
1. `goal_reached_and_hold_confirmed`：Quality PASS + hold 窗口 + recipe 已存 + 团队一致 → ✅ 冻结 final_recipe.json
2. 反复被安全门拒
3. 达迭代上限
4. 人工终止
5. 安全/质量紧急 → 回退基线

收尾契约（必须留齐）：`task_summary.json` · `best_recipe.json` · `outputs/final_recipe.json` · `team/handoffs/final.md` · `campaigns/<id>/run_summary.json` · `campaigns/<id>/07_coordination/best_recipe_memory.json` · `campaigns/<id>/08_trial_evidence/trial_XXX/`。验证通过后 `TeamDelete` 销毁团队。

### 工件命名契约
- 新运行必须用**带编号的不可变工件**：`quality_diagnosis_001.json`、`rd_optimization_plan_001.json`、`parameter_delta_proposal_001.json`、`execution_receipt_001.json`
- 每轮迭代写 `07_coordination/team_dispatch_plan_XXX.json`（声明：当前 cadence 状态、谁活跃、下次触发、停止条件）
- `live chat 绝不是事实源`——所有跨角色决策必须落到工件

---

## 7. ★ Teamwork 支持情况

**结论：本项目的 Skill 设计完全围绕原生 Teamwork，且当前 Claude Code 环境完整支持。**

### 设计意图（Skill 里写死的优先级）
团队触发有两档，**只允许原生 teamwork 路径**，禁止退回 shell 脚本编排：

1. **首选：Experimental Agent Teams** —— `TeamCreate` + `TaskCreate` + `SendMessage`（团队常驻，跨轮协作）
2. **次选：Native Agent runtime** —— 仅 `Agent` + 文件工件总线（同一套工件契约）

> Skill 明确要求：若 host 既无 `TeamCreate` 也无 `Agent`，**必须停止并报告环境缺失**，不得偷偷换成 npm/node 优化脚本。Solo 模式（team-lead 自己跑三角色）只在 Agent 工具完全不可用时作为最后降级手段，且必须向用户显式声明是降级运行。

### 当前环境实测能力（我自己的工具集）
- `TeamCreate` / `TeamDelete` ✅
- `Agent`（含 `closed-loop-optimization-*` 全部 4 个 subagent_type）✅
- `SendMessage` ✅
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` ✅
- 全套 `film_line_*` MCP 工具 ✅
- Preflight hook：`Sim(8877):already_running Back(4317):already_running Health:ok` ✅

→ **当前环境可以完整跑原生 Teamwork 闭环。** 一旦用户给出优化目标（如「让双折射波动下降 5% 并输出 recipe」），Skill 会：过门禁 → `TeamCreate` → 一次性派生 3 个常驻角色 agent → SendMessage 驱动串行首启 + 节拍循环 → 持续优化到达标或硬停 → 验证工件 → `TeamDelete`。

---

## 8. 关键文件速查表

| 想了解 | 看这里 |
|--------|--------|
| 入口 Skill 全貌 | `.claude/skills/closed-loop-optimizer/SKILL.md` |
| 团队编排契约 | `.claude/skills/closed-loop-optimizer/references/team-orchestration.md` |
| 原生 Teamwork 行为 | `references/native-claude-code-teamwork.md` |
| 协调协议 | `references/coordination-protocol.md` |
| 子代理调度 | `references/subagent-dispatch.md` |
| 团队负责人行为规范 | `.claude/agents/closed-loop-optimization-orchestrator.md` |
| 黑盒物理模型 | `simulator/industrial-film-line/blackbox-model.mjs` |
| 产品定义 | `simulator/industrial-film-line/product-catalog.mjs` |
| MCP 工具实现 | `simulator/industrial-film-line/mcp-server.mjs` |
| 已完成优化任务样例 | `workspace/optimization-tasks/OPT-20260612-T001/` |

### 已知小瑕疵（不影响运行）
- SKILL.md 第 231 行引用 `docs/closed-loop-optimizer-runtimes-and-teamwork.md`，但该文件在仓库里**不存在**（悬空引用）。
- `workspace/` 下有若干 `tmp-*.json` / `exec-cv-stage1.mjs` 临时调试文件，属历史调试残留。
- `agent-memory/` 里沉淀了真实有效的黑盒知识（如 PET 双折射的结构性 floor、td_draw_ratio 与厚度 CV 的 U 型关系），是优化能成功的关键经验。
