High-end systems diagram, 16:9, clean white and light steel background with colored agent lanes.

Subject: coordination workflow among three AI agents for online BOPET process optimization.

Create a circular closed-loop workflow:
1. Quality Engineer Agent reads process snapshot and online quality, writes quality diagnosis.
2. R&D Engineer Agent reads diagnosis, ontology, historical campaign ledger, writes DOE optimization plan.
3. Process Engineer Agent converts plan into setpoint request, calls safety gate, executes through MCP.
4. Simulated or real BOPET line changes process state.
5. Online thickness and birefringence response returns to diagnosis and ledger.
6. Best recipe is saved when target is satisfied or best observed.

Add a side safety rail:
hard constraints, writable parameter catalog, min/max thresholds, max delta, ramp limits, rollback recipe, operator approval.

Add a black-box client boundary around the production line:
optimizer cannot see hidden physical response function; it only sees MCP tool outputs and online measurements.

Style: executive technical slide, modern infographics, clean arrows, restrained colors: cyan for data, green for safe execution, amber for R&D plan, red for safety blocks. Use Chinese labels.

Important labels:
质量工程师 Agent, 研发工程师 Agent, 工艺工程师 Agent, 诊断报告, DOE 方案, 设定值请求, MCP 工具动作, 安全卡控, 黑盒产线客户端, 在线检测反馈, 最佳 Recipe.
