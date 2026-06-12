# BOPET 在线研发优化控制平台架构方案

## 交付物

- `BOPET在线研发优化控制平台架构方案.pptx`
- `images/bopet-architecture.png`
- `images/agent-coordination.png`
- `prompts/bopet-architecture-img2.md`
- `prompts/agent-coordination-img2.md`

## 风格

深海工业蓝图 + 白底工程卡片。面向研发负责人、工艺负责人和自动化/IT 团队，强调真实 BOPET 线对接、MCP 安全卡控、Agent 角色边界和闭环运行逻辑。

## 页码结构

1. 封面：BOPET 在线研发优化 Agent 控制平台。
2. 设计判断：可行，但必须是受控研发闭环。
3. 真实 BOPET 产线对接对象：挤出、铸片、MD、TD、热定型、收卷、在线检测。
4. 总体架构图：黑盒产线 + MCP 工具层 + Skill/Agent 编排层。
5. MCP 接入方式：工具动作、设定值预检、执行、回读和严格卡控。
6. 三个 Agent 角色定义：质量工程师、研发工程师、工艺工程师。
7. Agent 协调搭配工作图：结构化产物交接和 campaign ledger。
8. 整体运行逻辑：一轮在线研发优化如何发生。
9. Skill 与工程产物：每个 Agent 的输入、输出和价值。
10. 安全策略：模型可参与，但不能裸控产线。
11. 开发实施路线：从模拟黑盒到真实 BOPET 线。
12. 总结：把研发优化变成可执行工业闭环。

## 图像说明

两张配图使用 `gpt-image-2` Mode A 生成，提示词保存在 `prompts/`，可后续继续迭代或重新出图。
