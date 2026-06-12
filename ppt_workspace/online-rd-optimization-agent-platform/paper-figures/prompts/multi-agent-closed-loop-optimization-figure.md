Create a publication-quality scientific architecture diagram, 16:9 landscape, high resolution, clean vector infographic style, white background, suitable for an academic paper figure.

Figure title at top:
"Multi-Agent Closed-Loop R&D Optimization Platform for Online BOPET Processing"

Overall layout:
Use a clear left-to-right and circular closed-loop architecture.

Left block: "Black-box BOPET Film Line / 黑盒 BOPET 产线"
Show a simplified real BOPET processing line with thin technical silhouettes:
Extrusion & Casting -> MD Stretching -> TD Tenter Stretching -> Heat Setting -> Winding.
Add online sensors above/below the line:
Online Thickness Gauge, Online Birefringence Inspection.
Important: emphasize black-box boundary: hidden process response is not visible to optimizer.

Middle block: "MCP Tool Interface & Safety Layer / MCP 工具接口与安全层"
Show four tool boxes:
1. Snapshot Reader
2. Writable Parameter Catalog
3. Safety Gate: min/max, maxDelta, ramp, rollback
4. Setpoint Apply + Readback
Use red safety rail around Safety Gate.

Right block: "Agent Collaboration Layer / 多智能体协作层"
Show three main agents as large rounded boxes:
Quality Engineer Agent / 质量工程师
- reads online quality
- outputs quality_diagnosis.json
R&D Engineer Agent / 研发工程师
- reads diagnosis + ontology + campaign history
- outputs rd_optimization_plan.json
Process Engineer Agent / 工艺工程师
- converts plan to tag/target setpoint request
- calls MCP safety tools

Top block: "Domain Knowledge & Ontology / 领域知识与本体"
Include physical process knowledge, BOPET mechanism, constraints, historical recipes.
Arrows from knowledge block to R&D Engineer and Quality Engineer.

Bottom block: "Campaign Ledger & Recipe Database / 试验账本与 Recipe 库"
Include experiment_result.json, execution_receipt.json, best_observed_recipe, offline validation labels.
Arrows from Process execution and online response to ledger, from ledger back to R&D Engineer.

Closed loop arrows:
1. BOPET line -> online sensors -> Quality Engineer
2. Quality Engineer -> R&D Engineer
3. R&D Engineer -> Process Engineer
4. Process Engineer -> MCP Safety Gate -> BOPET line setpoints
5. New online quality response -> Campaign Ledger -> R&D Engineer
6. When target met: save Candidate Recipe

Visual requirements:
- Academic journal style, not cartoon, not marketing poster.
- Use clean line art, subtle shadows, consistent typography, balanced spacing.
- Use color coding:
  cyan for data/sensor flow,
  amber for R&D planning,
  green for safe execution,
  red for safety gate and constraints,
  purple for knowledge/ontology,
  dark gray for black-box production line.
- Include a small legend: Data flow, Plan flow, Safe action, Learning feedback.
- Make labels readable and concise. Use bilingual labels only for the most important modules.
- Do not overcrowd; keep enough white space.
- No people, no robots, no cartoon icons.
- Avoid tiny unreadable text.

Key labels that must appear:
"Black-box BOPET Film Line"
"Online Thickness + Birefringence"
"MCP Tool Interface"
"Safety Gate"
"Quality Engineer Agent"
"R&D Engineer Agent"
"Process Engineer Agent"
"Domain Ontology"
"Campaign Ledger"
"Recipe Database"
"Candidate Recipe"
