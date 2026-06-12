import pptxgen from 'pptxgenjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('ppt_workspace/online-rd-optimization-agent-platform');
const OUT = path.join(ROOT, 'BOPET在线研发优化控制平台架构方案.pptx');
const imgArch = path.join(ROOT, 'images/bopet-architecture.png');
const imgAgents = path.join(ROOT, 'images/agent-coordination.png');

const pptx = new pptxgen();
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'WIDE';
pptx.author = 'Codex';
pptx.company = 'Industrial Deep Diagnostic';
pptx.subject = 'BOPET 在线研发优化控制平台';
pptx.title = 'BOPET 在线研发优化控制平台架构方案';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  lang: 'zh-CN'
};

const C = {
  navy: '081A2B',
  navy2: '102A43',
  grid: '24445D',
  ink: '102033',
  muted: '5E6E82',
  white: 'FFFFFF',
  bg: 'F5F8FB',
  line: 'D8E1EA',
  cyan: '0EA5C6',
  cyanSoft: 'DDF7FA',
  blue: '2563EB',
  blueSoft: 'E8F1FF',
  green: '198754',
  greenSoft: 'E5F6EE',
  amber: 'C77700',
  amberSoft: 'FFF1D8',
  red: 'C7352C',
  redSoft: 'FFE8E6',
  violet: '6D5BD0',
  violetSoft: 'EEEAFE'
};

function bg(slide, dark = false) {
  slide.background = { color: dark ? C.navy : C.bg };
  if (dark) {
    for (let x = 0; x < 13.333; x += 0.42) slide.addShape(pptx.ShapeType.line, { x, y: 0, w: 0, h: 7.5, line: { color: C.grid, transparency: 45, width: 0.35 } });
    for (let y = 0; y < 7.5; y += 0.42) slide.addShape(pptx.ShapeType.line, { x: 0, y, w: 13.333, h: 0, line: { color: C.grid, transparency: 45, width: 0.35 } });
  }
}

function title(slide, text, sub, page, dark = false) {
  slide.addText(text, { x: 0.55, y: 0.34, w: 9.9, h: 0.35, fontSize: 21, bold: true, color: dark ? C.white : C.ink, margin: 0 });
  if (sub) slide.addText(sub, { x: 0.57, y: 0.83, w: 10.8, h: 0.2, fontSize: 8.7, color: dark ? 'B9CEE3' : C.muted, margin: 0 });
  slide.addText(String(page).padStart(2, '0'), { x: 12.36, y: 6.96, w: 0.42, h: 0.12, fontSize: 7.2, bold: true, color: dark ? '7DD3FC' : C.blue, align: 'right', margin: 0 });
}

function footer(slide, page) {
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 6.78, w: 12.15, h: 0, line: { color: C.line, width: 0.6 } });
  slide.addText('BOPET Online R&D Optimization Control Platform', { x: 0.56, y: 6.96, w: 4.2, h: 0.12, fontSize: 6.4, color: C.muted, margin: 0 });
  slide.addText(String(page).padStart(2, '0'), { x: 12.36, y: 6.96, w: 0.42, h: 0.12, fontSize: 7.2, bold: true, color: C.blue, align: 'right', margin: 0 });
}

function card(slide, x, y, w, h, head, body, color = C.blue, fill = C.white, fs = 8.6) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color: C.line, width: 0.8 } });
  slide.addShape(pptx.ShapeType.line, { x: x + 0.04, y: y + 0.14, w: 0, h: h - 0.28, line: { color, width: 2.2 } });
  slide.addText(head, { x: x + 0.2, y: y + 0.17, w: w - 0.35, h: 0.2, fontSize: 11.6, bold: true, color: C.ink, margin: 0 });
  slide.addText(body, { x: x + 0.2, y: y + 0.52, w: w - 0.35, h: h - 0.62, fontSize: fs, color: C.muted, fit: 'shrink', valign: 'top', margin: 0.02, breakLine: false });
}

function node(slide, text, x, y, w, h, color, fill = C.white, fs = 8.4) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color, width: 0.9 } });
  slide.addText(text, { x: x + 0.05, y: y + h / 2 - 0.06, w: w - 0.1, h: 0.12, fontSize: fs, bold: true, color, align: 'center', margin: 0 });
}

function arrow(slide, x1, y1, x2, y2, color = C.muted, width = 1) {
  slide.addShape(pptx.ShapeType.line, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color, width, endArrowType: 'triangle' } });
}

function pill(slide, text, x, y, w, color, fill) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.3, rectRadius: 0.07, fill: { color: fill }, line: { color, transparency: 50 } });
  slide.addText(text, { x: x + 0.05, y: y + 0.075, w: w - 0.1, h: 0.1, fontSize: 7, bold: true, color, align: 'center', margin: 0 });
}

// 1
{
  const s = pptx.addSlide();
  bg(s, true);
  if (fs.existsSync(imgArch)) s.addImage({ path: imgArch, x: 6.55, y: 0.55, w: 6.25, h: 3.52 });
  s.addText('BOPET 在线研发优化', { x: 0.65, y: 0.82, w: 5.8, h: 0.45, fontSize: 28, bold: true, color: C.white, margin: 0 });
  s.addText('Agent 控制平台架构方案', { x: 0.65, y: 1.42, w: 6.2, h: 0.45, fontSize: 26, bold: true, color: '7DD3FC', margin: 0 });
  s.addText('面向真实双拉产线：MCP 接入、三 Agent 协作、黑盒工况调参、安全闭环与 Recipe 沉淀', { x: 0.68, y: 2.18, w: 5.7, h: 0.35, fontSize: 11.5, color: 'C8D9EA', fit: 'shrink', margin: 0 });
  ['质量诊断', '研发策略', '工艺执行', 'MCP 安全门', 'Recipe Ledger'].forEach((t, i) => pill(s, t, 0.7 + i * 1.16, 2.88, 1.02, ['7DD3FC', 'FBBF24', '86EFAC', 'FCA5A5', 'C4B5FD'][i], C.navy2));
  card(s, 0.76, 5.05, 3.5, 0.86, '一句话目标', '让 Agent 像研发团队一样协作，但所有设备动作都经 MCP 和确定性安全门硬卡控。', '7DD3FC', C.navy2, 8.1);
  card(s, 4.55, 5.05, 3.5, 0.86, '当前状态', '已有模拟黑盒客户端、MCP setpoint 工具、三角色 Skill 和 campaign 验收脚本。', '86EFAC', C.navy2, 8.1);
  s.addText('2026.06', { x: 11.7, y: 6.92, w: 0.9, h: 0.14, fontSize: 7.5, color: '7DD3FC', align: 'right', margin: 0 });
}

// 2
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '设计判断：平台逻辑可行，但必须是受控研发闭环', '在线优化不是让 LLM 直接控制产线，而是让 Agent 编排“可审计的试验”。', 2);
  card(s, 0.7, 1.35, 3.7, 3.25, '为什么可行', '真实 BOPET 双拉线已经有挤出到收卷设备、在线厚度和双折射检测。\n\n这些在线指标可以作为快速代理反馈，让研发方案在安全窗口内快速迭代。', C.green, C.greenSoft, 9.2);
  card(s, 4.82, 1.35, 3.7, 3.25, '关键约束', '优化器必须把客户端当黑盒。\n\n只能看到 MCP 暴露的快照、参数目录、在线检测和执行回执，不能读取底层响应函数。', C.red, C.redSoft, 9.2);
  card(s, 8.95, 1.35, 3.7, 3.25, '正确落点', '三角色协作：质量工程师判断问题，研发工程师设计方案，工艺工程师执行安全设定值请求。\n\n最终沉淀 best recipe。', C.blue, C.blueSoft, 9.2);
  card(s, 1.15, 5.15, 10.95, 0.7, '工程原则', 'Agent 可以推理、解释、规划；MCP/Safety Gate 负责硬约束；PLC/模拟客户端负责执行与回读。', C.violet, C.violetSoft, 9.2);
  footer(s, 2);
}

// 3
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '真实 BOPET 产线对接对象', '从挤出铸片到收卷，在线检测提供厚度与双折射反馈；Agent 不改变工艺物理，只改变试验效率。', 3);
  const steps = [
    ['PET 干燥/挤出', 'melt_temp\nextruder_speed'],
    ['模头/铸片', 'casting_roll_temp\nextruder_pressure'],
    ['MD 纵拉', 'md_draw_ratio\nmd_zone_temp'],
    ['TD 横拉', 'td_draw_ratio\ntd_zone_1/2_temp'],
    ['热定型', 'heatset_temp\nrelaxation_ratio'],
    ['收卷', 'line_speed\nwinder_tension']
  ];
  steps.forEach((st, i) => {
    const x = 0.55 + i * 2.08;
    node(s, st[0], x, 1.45, 1.58, 0.55, [C.amber, C.amber, C.blue, C.blue, C.green, C.green][i], C.white, 8.2);
    s.addText(st[1], { x: x + 0.1, y: 2.18, w: 1.38, h: 0.45, fontSize: 7.4, color: C.muted, align: 'center', fit: 'shrink', margin: 0 });
    if (i < steps.length - 1) arrow(s, x + 1.58, 1.73, x + 2.0, 1.73, C.muted, 1);
  });
  node(s, '在线厚度检测', 3.05, 3.55, 2.0, 0.55, C.cyan, C.cyanSoft);
  node(s, '在线双折射检测', 5.65, 3.55, 2.0, 0.55, C.cyan, C.cyanSoft);
  node(s, '离线拉伸/热收缩/雾度', 8.25, 3.55, 2.2, 0.55, C.violet, C.violetSoft);
  arrow(s, 4.05, 3.55, 4.05, 2.25, C.cyan, 1);
  arrow(s, 6.65, 3.55, 6.65, 2.25, C.cyan, 1);
  card(s, 0.85, 5.05, 3.6, 0.95, '在线快标签', '厚度均值/CV、边中差、双折射均值/CV、profile 形状。', C.cyan, C.cyanSoft, 8.5);
  card(s, 4.85, 5.05, 3.6, 0.95, '慢标签校准', '离线力学、热收缩、雾度等用于后续代理模型校准。', C.violet, C.violetSoft, 8.5);
  card(s, 8.85, 5.05, 3.6, 0.95, '写入边界', '所有设定值变更必须经 MCP 安全门和回读确认。', C.red, C.redSoft, 8.5);
  footer(s, 3);
}

// 4
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '总体架构图：黑盒产线 + MCP 工具层 + Skill/Agent 编排层', '这一页是系统落地的主图：优化器看不到底层物理函数，只能通过 MCP 工具动作学习。', 4);
  if (fs.existsSync(imgArch)) s.addImage({ path: imgArch, x: 0.72, y: 1.18, w: 11.9, h: 4.15 });
  card(s, 0.9, 5.7, 3.55, 0.55, '黑盒原则', 'Agent 不能读取 hidden response，只能读工具输出。', C.red, C.redSoft, 7.8);
  card(s, 4.85, 5.7, 3.55, 0.55, 'MCP 原则', '参数目录、预检、执行、回读全部工具化。', C.blue, C.blueSoft, 7.8);
  card(s, 8.8, 5.7, 3.55, 0.55, '闭环原则', '每轮实验都进入 ledger，供研发策略迭代。', C.green, C.greenSoft, 7.8);
  footer(s, 4);
}

// 5
{
  const s = pptx.addSlide();
  bg(s);
  title(s, 'MCP 接入方式：真实产线和模拟客户端使用同一类工具动作', '第一版先用模拟黑盒客户端验证，真实上线时替换 MCP adapter，不替换 Agent 协议。', 5);
  const tools = [
    ['参数目录', 'film_line_list_writable_parameters\n返回 12 个参数、min/max、maxDelta、ramp'],
    ['稳定窗口', 'film_line_run_until_stable\n返回 snapshot + online_quality'],
    ['设定值预检', 'film_line_preview_setpoints\n只传 tag/target，客户端算 delta'],
    ['执行设定值', 'film_line_apply_setpoints\n通过 safety gate 才执行'],
    ['在线质量', 'film_line_get_online_quality\n厚度/双折射指标与 profile'],
    ['回滚/保存', 'film_line_rollback\nfilm_line_save_candidate_recipe']
  ];
  tools.forEach((t, i) => {
    const x = 0.7 + (i % 3) * 4.12;
    const y = 1.25 + Math.floor(i / 3) * 1.78;
    card(s, x, y, 3.55, 1.18, t[0], t[1], [C.blue, C.cyan, C.red, C.green, C.violet, C.amber][i], C.white, 8);
  });
  card(s, 1.05, 5.2, 11.1, 0.75, '严格卡控', 'Safety Gate 会拒绝未知 tag、重复 tag、目标越界、单步 delta 超限、ramp 超限、current/delta 伪造、rollback recipe 不匹配。', C.red, C.redSoft, 8.8);
  footer(s, 5);
}

// 6
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '三个 Agent 角色定义', '角色必须有清晰边界：谁判断质量，谁设计研发方案，谁执行工艺动作。', 6);
  card(s, 0.75, 1.25, 3.65, 3.75, '质量工程师 Agent', '输入：process snapshot、online quality、product target。\n\n输出：quality_diagnosis。\n\n职责：判断 PASS/WARNING/FAIL，识别主要质量 gap，给研发工程师提供诊断证据。\n\n禁止：生成或下发 setpoint。', C.cyan, C.cyanSoft, 8.8);
  card(s, 4.85, 1.25, 3.65, 3.75, '研发工程师 Agent', '输入：质量诊断、历史 ledger、本体模型、工艺知识。\n\n输出：rd_optimization_plan。\n\n职责：提出 DOE/单变量/局部搜索策略，定义预期响应、保持时间和停止条件。\n\n禁止：直接写设备。', C.amber, C.amberSoft, 8.8);
  card(s, 8.95, 1.25, 3.65, 3.75, '工艺工程师 Agent', '输入：研发方案、当前 snapshot、MCP 参数目录。\n\n输出：parameter proposal、safety result、execution receipt。\n\n职责：把研发方案转成安全设定值请求，执行后记录响应。\n\n禁止：绕过安全门。', C.green, C.greenSoft, 8.8);
  node(s, '诊断报告', 2.1, 5.6, 1.2, 0.4, C.cyan, C.white);
  arrow(s, 3.3, 5.8, 5.1, 5.8, C.muted);
  node(s, '研发方案', 5.1, 5.6, 1.2, 0.4, C.amber, C.white);
  arrow(s, 6.3, 5.8, 8.1, 5.8, C.muted);
  node(s, '安全执行', 8.1, 5.6, 1.2, 0.4, C.green, C.white);
  footer(s, 6);
}

// 7
{
  const s = pptx.addSlide();
  bg(s);
  title(s, 'Agent 协调搭配工作图', '三 Agent 不是聊天协作，而是通过结构化 JSON 产物和 campaign ledger 交接。', 7);
  if (fs.existsSync(imgAgents)) s.addImage({ path: imgAgents, x: 0.7, y: 1.05, w: 11.95, h: 4.65 });
  card(s, 1.05, 5.95, 3.25, 0.42, '文件合同', 'diagnosis -> rd_plan -> proposal -> receipt', C.blue, C.blueSoft, 7.4);
  card(s, 5.05, 5.95, 3.25, 0.42, '并行边界', '审查可并行，依赖链路不可并行', C.violet, C.violetSoft, 7.4);
  card(s, 9.05, 5.95, 3.25, 0.42, '学习闭环', '每轮结果写入 campaign ledger', C.green, C.greenSoft, 7.4);
  footer(s, 7);
}

// 8
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '整体运行逻辑：一轮在线研发优化如何发生', '从稳定窗口到下一轮方案，每一步都有输入、输出和可审计记录。', 8);
  const steps = [
    ['1 稳定窗口', 'MCP 采集 snapshot + 在线检测'],
    ['2 质量诊断', '质量 Agent 输出 gap 与状态'],
    ['3 研发计划', '研发 Agent 输出 DOE/参数窗口'],
    ['4 工艺提案', '工艺 Agent 转成 tag/target 请求'],
    ['5 安全卡控', 'MCP safety gate 硬拒绝风险动作'],
    ['6 执行回读', 'PLC/模拟客户端执行并确认'],
    ['7 响应评估', '新窗口质量变化写入 ledger'],
    ['8 Recipe 沉淀', '满足目标或保存 best observed']
  ];
  steps.forEach((st, i) => {
    const x = 0.55 + (i % 4) * 3.15;
    const y = 1.35 + Math.floor(i / 4) * 2.05;
    card(s, x, y, 2.55, 1.15, st[0], st[1], [C.blue, C.cyan, C.amber, C.green, C.red, C.violet, C.cyan, C.green][i], C.white, 8.2);
    if (i % 4 !== 3) arrow(s, x + 2.55, y + 0.58, x + 2.95, y + 0.58, C.muted);
  });
  arrow(s, 10.02, 2.5, 10.02, 3.35, C.muted);
  arrow(s, 0.9, 4.0, 0.9, 2.1, C.green, 1.2);
  s.addText('继续下一轮', { x: 0.38, y: 3.0, w: 0.9, h: 0.12, fontSize: 7.6, bold: true, color: C.green, rotate: 270, margin: 0 });
  footer(s, 8);
}

// 9
{
  const s = pptx.addSlide();
  bg(s);
  title(s, 'Skill 与工程产物：让每个 Agent 都能读懂上下游', 'Skill 负责标准作业，Schema 负责互操作，MCP 负责动作，Ledger 负责记忆。', 9);
  const rows = [
    ['quality-engineer', 'process_snapshot + online_quality', 'quality_diagnosis.json', '判定质量状态和主要 gap'],
    ['rd-engineer', 'diagnosis + target + ledger', 'rd_optimization_plan.json', '给出 DOE/假设/候选参数'],
    ['process-engineer', 'rd_plan + snapshot + MCP catalog', 'parameter proposal + safety result', '执行安全设定值请求'],
    ['closed-loop-optimizer', 'campaign target + artifacts', 'run_summary + recipe recommendation', '编排全链路并验收']
  ];
  ['Skill', '读取输入', '输出产物', '核心价值'].forEach((h, i) => {
    s.addText(h, { x: [0.75, 3.15, 6.2, 9.2][i], y: 1.25, w: [2.0, 2.4, 2.55, 2.8][i], h: 0.14, fontSize: 9.2, bold: true, color: C.ink, margin: 0 });
  });
  rows.forEach((r, i) => {
    const y = 1.75 + i * 0.95;
    s.addShape(pptx.ShapeType.roundRect, { x: 0.58, y: y - 0.15, w: 12.1, h: 0.68, rectRadius: 0.04, fill: { color: i % 2 ? 'FFFFFF' : 'EEF5FF' }, line: { color: C.line, transparency: 50 } });
    r.forEach((txt, j) => s.addText(txt, { x: [0.75, 3.15, 6.2, 9.2][j], y, w: [2.0, 2.5, 2.55, 3.0][j], h: 0.25, fontSize: 8.2, color: j === 0 ? C.blue : C.muted, bold: j === 0, fit: 'shrink', margin: 0 }));
  });
  card(s, 0.9, 5.65, 11.4, 0.55, '当前已落地', '.claude/skills 四个 Skill、.claude/agents 四个 SubAgent、MCP 黑盒客户端、schema validator、campaign validator。', C.green, C.greenSoft, 8.4);
  footer(s, 9);
}

// 10
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '安全策略：为什么模型可以参与，但不能裸控产线', '真实 BOPET 线必须把“建议”和“执行”分离，硬安全由确定性服务负责。', 10);
  card(s, 0.7, 1.25, 3.6, 3.3, '模型能做', '解释质量变化\n提出研发假设\n设计参数试验\n总结响应规律\n发现矛盾和异常', C.blue, C.blueSoft, 9.4);
  card(s, 4.85, 1.25, 3.6, 3.3, '安全门必须做', '参数白名单\nmin/max 阈值\nmaxDelta 单步限制\nramp 限速\nrollback recipe\n报警/稳态检查', C.red, C.redSoft, 9.4);
  card(s, 9.0, 1.25, 3.6, 3.3, '设备网关必须做', 'preview/apply 分离\nPLC 写入确认\n回读确认\n执行 receipt\n异常 rollback\n权限审计', C.green, C.greenSoft, 9.4);
  s.addShape(pptx.ShapeType.roundRect, { x: 1.1, y: 5.25, w: 11.15, h: 0.72, rectRadius: 0.06, fill: { color: C.redSoft }, line: { color: C.red, transparency: 50 } });
  s.addText('平台底线：Agent 可以提出设定值请求，但 MCP 客户端必须自己计算 current/delta 并强制校验，不能信任模型给出的 delta。', { x: 1.35, y: 5.56, w: 10.65, h: 0.12, fontSize: 10, bold: true, color: C.red, align: 'center', margin: 0 });
  footer(s, 10);
}

// 11
{
  const s = pptx.addSlide();
  bg(s);
  title(s, '开发实施路线：从模拟黑盒到真实 BOPET 线', '每阶段都要有可验收产物，避免“大平台都在做，但没有一条闭环能跑”。', 11);
  const phases = [
    ['P0 模拟闭环', '黑盒客户端 + MCP setpoint 工具 + 三 Agent Skill + campaign validator'],
    ['P1 真实只读', '接 historian/inspection MCP，只读 shadow mode，对齐真实在线数据'],
    ['P2 人工确认写入', '低风险参数、人工批准、PLC 写入回读、自动生成实验账本'],
    ['P3 半自动研发', '深环 DOE/响应面/贝叶斯建议，快环安全执行和异常暂停'],
    ['P4 多牌号沉淀', 'best recipe 库、参数禁区、慢标签校准和跨牌号迁移']
  ];
  phases.forEach((p, i) => {
    const x = 0.72 + i * 2.42;
    node(s, p[0], x, 1.35, 1.82, 0.55, i < 2 ? C.blue : i === 2 ? C.green : C.amber, i < 2 ? C.blueSoft : i === 2 ? C.greenSoft : C.amberSoft, 7.9);
    if (i < phases.length - 1) arrow(s, x + 1.82, 1.63, x + 2.32, 1.63, C.muted);
    card(s, x, 2.35, 1.82, 2.75, p[0], p[1], i < 2 ? C.blue : i === 2 ? C.green : C.amber, C.white, 7.5);
  });
  card(s, 1.0, 5.85, 11.3, 0.45, '建议优先级', '先让模拟闭环和真实只读 shadow mode 稳定，再进入人工确认写入；半自动调参必须排在安全门和账本之后。', C.violet, C.violetSoft, 7.8);
  footer(s, 11);
}

// 12
{
  const s = pptx.addSlide();
  bg(s, true);
  s.addText('最终方案：把研发优化变成可执行的工业闭环', { x: 0.7, y: 0.72, w: 9.8, h: 0.42, fontSize: 25, bold: true, color: C.white, margin: 0 });
  s.addText('不是让模型“猜最优参数”，而是让三类 Agent 在安全 MCP 约束下持续做高质量研发试验。', { x: 0.72, y: 1.32, w: 9.8, h: 0.18, fontSize: 10.5, color: 'C8D9EA', margin: 0 });
  const takeaways = [
    ['1', '质量工程师 Agent', '把在线厚度/双折射转成结构化诊断和优化目标。'],
    ['2', '研发工程师 Agent', '结合本体/历史/诊断报告设计下一轮 DOE 或局部搜索。'],
    ['3', '工艺工程师 Agent', '通过 MCP 发送受限设定值请求，执行后回读和记账。'],
    ['4', '黑盒客户端', '底层响应未知，只通过 MCP 工具和在线检测暴露外部行为。']
  ];
  takeaways.forEach((t, i) => {
    const y = 2.05 + i * 0.88;
    s.addShape(pptx.ShapeType.ellipse, { x: 0.88, y, w: 0.42, h: 0.42, fill: { color: ['7DD3FC', 'FBBF24', '86EFAC', 'FCA5A5'][i] }, line: { color: 'FFFFFF', transparency: 85 } });
    s.addText(t[0], { x: 1.02, y: y + 0.14, w: 0.14, h: 0.08, fontSize: 8, bold: true, color: C.navy, align: 'center', margin: 0 });
    s.addText(t[1], { x: 1.55, y: y + 0.03, w: 2.5, h: 0.18, fontSize: 11, bold: true, color: C.white, margin: 0 });
    s.addText(t[2], { x: 4.15, y: y + 0.05, w: 7.2, h: 0.16, fontSize: 9, color: 'C8D9EA', margin: 0 });
  });
  s.addShape(pptx.ShapeType.roundRect, { x: 1.0, y: 5.95, w: 11.2, h: 0.55, rectRadius: 0.06, fill: { color: C.navy2 }, line: { color: '7DD3FC', transparency: 35 } });
  s.addText('下一步：把真实 historian / inspection / safety / PLC gateway 做成 MCP adapter，先跑 shadow mode，再进入人工确认写入。', { x: 1.25, y: 6.17, w: 10.7, h: 0.12, fontSize: 10.2, bold: true, color: '7DD3FC', align: 'center', margin: 0 });
}

await pptx.writeFile({ fileName: OUT });
console.log(OUT);
