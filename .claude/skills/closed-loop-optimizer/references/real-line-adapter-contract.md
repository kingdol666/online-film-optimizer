# Real-Line Adapter Contract

真实产线迁移时，闭环 orchestrator 不直接接触 PLC/DCS 实现细节，只通过适配层访问以下能力：

- `readSnapshot`
- `readOnlineQuality`
- `listWritableParameters`
- `previewProposal` / `checkSafetyGate`
- `requestApproval`
- `applyApprovedProposal`
- `rollbackToRecipe`
- `saveCandidateRecipe`
- `readHistorianWindow`

## Required Principles

- LLM 永不直接写 PLC tag。
- 写入必须经过 deterministic safety gate。
- 半自动模式下必须经过 approval hook。
- adapter 可以接入真实 historian / 在线检测 / recipe 系统，但交接工件协议不变。

## Provider Modes

- `simulated-line`
  - 用于开发、回归、MCP smoke 与 demo。
- `real-line`
  - 首版只允许 skeleton / shadow mode / mock hooks。

## Hook Points

- `inspection`
- `historian`
- `approval`
- `write`
- `safety`
- `reporting`

这些 hook 必须通过配置注册，不要在 orchestrator 中硬编码具体厂商接口。
