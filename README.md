# Online Optimizer

这个仓库现在只保留 4 个运行面：

- `simulator/industrial-film-line`
  - 双拉薄膜产线黑盒模拟器
  - HTTP 控制接口
  - MCP 服务
- `app/backend`
  - 代理模拟器 HTTP 接口
  - 向前端推送实时 WebSocket 快照
- `app/frontend`
  - 模拟器实时可视化控制台
  - 参数预览、应用、稳定化、回退和质量趋势展示
- `.claude/`
  - 保留给 Claude Code 原生执行优化任务使用

项目目标已经收缩为：

1. 启动模拟器
2. 启动前后端可视化客户端
3. 通过 `.mcp.json` 让 Claude Code 直接操作模拟器 MCP
4. 由 Claude Code 在仓库外层逻辑中完成闭环优化

## 安装

```bash
npm install
npm --prefix app/backend install
npm --prefix app/frontend install
```

## 启动

1. 启动模拟器 HTTP 服务

```bash
npm run sim:http
```

2. 启动后端

```bash
npm run backend
```

3. 启动前端

```bash
npm run frontend
```

默认地址：

- 前端: [http://127.0.0.1:5418](http://127.0.0.1:5418)
- 后端健康检查: [http://127.0.0.1:4317/api/health](http://127.0.0.1:4317/api/health)
- 模拟器状态: [http://127.0.0.1:8877/sim/state](http://127.0.0.1:8877/sim/state)

## MCP

`.mcp.json` 已配置本地模拟器 MCP：

```json
{
  "mcpServers": {
    "industrial-film-line-sim": {
      "command": "node",
      "args": ["simulator/industrial-film-line/mcp-server.mjs"]
    }
  }
}
```

Claude Code 可直接调用以下核心工具：

- `film_line_reset`
- `film_line_get_state`
- `film_line_get_snapshot`
- `film_line_list_writable_parameters`
- `film_line_preview_setpoints`
- `film_line_apply_setpoints`
- `film_line_run_until_stable`
- `film_line_rollback`

## 验证 MCP

```bash
npm run sim:mcp:smoke
```

## 前端能力

前端只做模拟器相关事情：

- 选择产品并重置基线
- 推进稳定窗口
- 手动推进 tick
- 回退到最近最佳配方
- 实时查看质量指标、横向 profile、过程值、ledger
- 实时预览和应用设定值改动

## 后端 API

- `GET /api/health`
- `GET /api/simulator/overview`
- `GET /api/simulator/products`
- `POST /api/simulator/reset`
- `POST /api/simulator/stabilize`
- `POST /api/simulator/tick`
- `POST /api/simulator/preview-setpoints`
- `POST /api/simulator/apply-setpoints`
- `POST /api/simulator/rollback`
- `WS /ws/simulator`
