# CLAUDE.md — Online_optimizer

## 当前项目边界

这个仓库只保留以下内容：

- 薄膜产线模拟器 HTTP 服务
- 薄膜产线模拟器 MCP 服务
- 一个最小后端，用于前端读取和推送模拟器状态
- 一个最小前端，用于实时查看和调节模拟器参数
- `.claude/` 目录完整保留，供 Claude Code 原生执行优化任务

## 你在这个仓库里应该优先关注

- `simulator/industrial-film-line/`
- `app/backend/src/server.mjs`
- `app/backend/src/routes/simulator.routes.mjs`
- `app/backend/src/services/simulator.service.mjs`
- `app/backend/src/transport/simulator-ws-server.mjs`
- `app/frontend/src/App.vue`
- `.mcp.json`

## 启动命令

```bash
npm run sim:http
npm run backend
npm run frontend
npm run sim:mcp
```

## 核心原则

- 不要动 `.claude/` 目录，除非用户明确要求
- 不要把 agent/orchestrator/campaign 逻辑重新塞回前后端
- 前后端只服务于模拟器状态展示和参数调节
- 优化闭环由 Claude Code 通过 MCP 完成，而不是由项目内置 agent 流程完成
