# Goal Request Contract

用户只需要输入目标性能或研发目标，但平台内部必须将其统一规范为 `orchestrator_goal_request.json`。

## Required Fields

- `request_id`
- `campaign_id`
- `product_grade`
- `goal_text`
- `user_objective`
- `targets`
- `constraints`
- `execution`

## Input Variants

- 纯自然语言目标
- demo target JSON
- 结构化研发请求

## Normalization Rule

如果用户只给自然语言目标，平台必须基于默认 target template 补齐：

- 产品牌号
- 基础目标窗口
- 业务上下文
- 试验预算
- 发布预期

这样三类 Agent 始终围绕统一目标工作，而不是各自理解不同版本的目标。
