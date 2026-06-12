# Semi-Auto Execution Governance

平台默认执行模式为 `semi_auto`。

## Execution Path

1. 工艺 Agent 生成 proposal。
2. safety gate 预审。
3. 生成 `approval_packet_XXX.json`。
4. approval hook 决定 `pending / approved / rejected / expired`。
5. 仅当 `approved` 时允许 approved write adapter 下发。
6. 下发后重新收集稳定窗口并更新质量评估。

## Governance Rules

- 模拟环境允许 `auto_approve_simulator=true`，用于端到端回归。
- 真实产线默认禁用自动批准。
- `recover` 阶段允许回退请求优先于继续探索。
- 审批拒绝也是正式实验结果，必须写入 ledger。
