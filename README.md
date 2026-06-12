# Online Optimizer

企业级在线闭环优化平台，围绕一条模拟双拉薄膜产线与未来真实产线迁移边界构建三层能力：

- `simulator/industrial-film-line`
  - 黑盒工况模型
  - HTTP simulator service
  - MCP simulator service
- `scripts/optimization` + `.claude/skills`
  - 质量工程师 / 研发工程师 / 工艺工程师 / 闭环总编排 skill
  - team-mode 入口会为每个优化任务创建独立工作目录
  - `explore / exploit / recover` 三阶段控制策略
  - 通过 MCP 与适配层对模拟产线执行半自动闭环优化
- `app/backend` + `app/frontend`
  - 用户只输入“目标性能 / 研发目标”的正式 orchestrator 入口
  - 统一查看当前工况、审批包、阶段策略、ledger、campaign 状态
  - 从客户端执行审批、暂停、恢复、回退与调参
- `config/loader.mjs` + `scripts/optimization/lib/online-line-adapter.mjs`
  - 通过配置切换 `simulated-line` / `real-line`
  - 真实模式优先走 WebSocket 在线接入
  - 统一注入 historian / database / action server 地址

## 架构原则

- 前端只负责交互和状态展示
- 后端负责 orchestrator API、执行治理与控制状态，不直接嵌入黑盒逻辑
- 模拟器同时暴露 HTTP 和 MCP 两类接口
- 在线产线适配优先使用 WebSocket 服务器作为动作与数据中转层
- skill 的闭环优化通过 MCP 操作模拟器，从而改变客户端看到的同一份产线状态
- 默认执行模式为半自动闭环，保留真实产线 `approval / safety / historian / write / inspection` hook 边界
- 全流程以结构化 JSON 工件、`07_coordination` 标准交接协议和 schema 为核心

## 安装

```bash
npm --prefix app/backend install
npm --prefix app/frontend install
```

## 启动

1. 启动 HTTP 模拟器

```bash
npm run sim:http
```

2. 启动后端

```bash
npm run backend
```

3. 启动前端静态站点

```bash
npm run frontend
```

打开：

- 客户端: [http://127.0.0.1:5418](http://127.0.0.1:5418)
- 后端健康检查: [http://127.0.0.1:4317/api/health](http://127.0.0.1:4317/api/health)
- 模拟器: [http://127.0.0.1:8877/sim/state](http://127.0.0.1:8877/sim/state)

## 在线接入

你的设计是合理的：用一个独立“产线通信服务器”承接真实 PLC/DCS/MES/数据库通信，再让当前优化平台通过 WebSocket 与它双向通信。这样优化器保持通用，产线差异都被隔离在 bridge server 的 tag map、driver、historian、approval 和 safety 层里。项目默认仍走模拟 MCP；只有启用在线配置后才切换到真实在线桥接。

当你要接入真实产线或在线仿真服务器时，建议通过环境变量配置：

```bash
export ONLINE_ENABLED=true
export LINE_PROVIDER=real-line
export PROCESS_WS_URL=ws://your-line-server:PORT/ws
export PROCESS_HTTP_URL=http://your-line-server:PORT
export HISTORIAN_URL=http://your-historian:PORT
export ONLINE_DB_URL=postgres://user:pass@host:5432/db
```

也可以复制配置模板：

```bash
cp config/online-line.config.example.json config/online-line.config.json
export PLATFORM_CONFIG=config/online-line.config.json
```

接入规则：

- 如果 `ONLINE_ENABLED=true` 且 `PROCESS_WS_URL` 有效，优化器优先使用在线 provider
- 如果没有配置 WebSocket/HTTP，自动回退到 `simulated-line` + MCP
- 如果希望在线桥接不可用时直接失败，设置 `REQUIRE_ONLINE_BRIDGE=true`
- 在线 provider 负责读 snapshot、读质量、写参数、读 historian、读数据库
- MCP 继续保留给模拟、回归、smoke test 和本地开发
- 真实产线建议把 server 端接口拆成 `snapshot / inspection / historian / write / safety / approval` 六类动作
- WebSocket/HTTP 动作协议详见 `docs/online-line-bridge-contract.md`
- 请求/响应 schema 见 `schemas/optimization/online_bridge_request_schema.json` 与 `schemas/optimization/online_bridge_response_schema.json`

你的产线通信服务器至少实现这些动作：

- `line.snapshot`: 获取当前 setpoints、process values、报警与状态
- `line.online_quality`: 获取在线检测质量指标和 profile
- `line.writable_parameters`: 返回可写工艺参数和安全边界
- `line.run_until_stable`: 等待或判断稳定窗口
- `line.safety_preview`: 执行确定性安全门
- `line.request_approval`: 接入人工/MES/班组审批
- `line.apply_proposal`: 下发已批准的参数调整
- `line.load_recipe_baseline`: 同步最佳 recipe 为 rollback 基线
- `line.rollback_recipe`: 回退到最佳已知 recipe
- `line.save_candidate_recipe`: 保存最终候选 recipe
- `line.historian_window`: 获取 historian/数据库窗口数据

服务端可以内部使用 OPC UA、Modbus、REST、SQL、PI、MES API 或实验室系统；优化平台只关心标准 JSON 响应。

## MCP 验证

```bash
npm run sim:mcp:smoke
```

## Orchestrator 闭环优化

```bash
npm run opt:campaign:demo
```

或者直接输入自然语言目标：

```bash
node .claude/skills/closed-loop-optimizer/scripts/run-sim-campaign.mjs \
  --goal-text "获得厚度均匀、双折射稳定、可进入真实产线 shadow validation 的新产品配方"
```

也可以直接用命令式入口：

```bash
npm run optimize:line -- --goal-text "请完成对产线的优化：使得双折射波动下降10%，并输出最终recipe"
```

如果要按任务隔离运行并沉淀完整协作证据，使用 team 入口：

```bash
npm run optimize:team -- --goal-text "请完成对产线的优化：使得双折射波动下降10%，并输出最终recipe"
```

平台会先解析自然语言目标，再基于基线工况把目标映射为结构化 `targets` 和 `stop criteria`，然后持续进行 Agent 循环，直到：

- 达到目标；
- 进入恢复治理；
- 到达硬试验上限；
- 或者被人工暂停 / 回退 / 终止。

运行后会在 `workspace/optimization-campaigns` 下生成完整工件目录，包括：

- `00_objective/orchestrator_goal_request.json`
- `07_coordination/strategy_state_XXX.json`
- `07_coordination/approval_packet_XXX.json`
- `07_coordination/best_recipe_memory.json`
- `07_coordination/coordination_index.json`
- `07_coordination/executive_summary*.md`
- `08_trial_evidence/trial_XXX/`
- team 模式则会额外在 `workspace/optimization-tasks/<task-id>/` 下保存整套任务目录、团队消息与最终 recipe

其中 `08_trial_evidence/trial_XXX/` 会把每一次试验的前窗口、诊断、策略、proposal、安全门、审批包、执行回执、结果和总结都单独保存，作为本次优化的完整证据链。

## 客户端闭环验证

在浏览器控制台中可以：

- 输入研发目标并启动 orchestrator
- 查看质量/研发/工艺三角色协同摘要
- 查看待审批执行包与 safety gate
- 暂停、恢复、回退闭环
- 手动预览或应用参数

由于 simulator 共享同一份状态文件，客户端看到的数据与 MCP/skill 改动的是同一条模拟工况。

## 新 API

- `POST /api/orchestrator/run`
- `GET /api/orchestrator/status`
- `GET /api/orchestrator/runs/:id`
- `POST /api/orchestrator/runs/:id/approve`
- `POST /api/orchestrator/runs/:id/pause`
- `POST /api/orchestrator/runs/:id/resume`
- `POST /api/orchestrator/runs/:id/rollback`

旧 `POST /api/campaign/run` 仍保留，但内部已经委托到新的 orchestrator。
