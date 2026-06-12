import pptxgen from 'pptxgenjs';
import fs from 'node:fs';
import path from 'node:path';

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Codex';
pptx.company = 'Industrial Deep Diagnostic';
pptx.subject = '薄膜双拉在线工艺优化 Agent 平台';
pptx.title = '薄膜双拉在线工艺优化 Agent 平台';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  lang: 'zh-CN',
};
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'CUSTOM_WIDE';
pptx.margin = 0;

const C = {
  bg: 'F5F7FA',
  white: 'FFFFFF',
  ink: '0F2942',
  muted: '5B6B80',
  line: 'D9E1EA',
  blue: '1C6DD0',
  blueSoft: 'E5F0FF',
  green: '198754',
  greenSoft: 'E5F6EE',
  red: 'C7352C',
  redSoft: 'FFE8E6',
  amber: 'BD6B00',
  amberSoft: 'FFF2DC',
  teal: '087F8C',
  tealSoft: 'DDF7FA',
  violet: '7256C9',
  violetSoft: 'EEE9FF',
  dark: '091827',
};

const W = 13.333;
const H = 7.5;
const OUT = path.resolve('ppt_workspace/output/online-film-agent-platform.pptx');
const coverImg = path.resolve('ppt_workspace/garden-gpt-image-2/image/cover-industrial-blueprint.png');

function addBg(slide, mode = 'light') {
  slide.background = { color: mode === 'dark' ? C.dark : C.bg };
  if (mode === 'blueprint') {
    slide.background = { color: '102A43' };
    for (let x = 0; x < W; x += 0.42) {
      slide.addShape(pptx.ShapeType.line, { x, y: 0, w: 0, h: H, line: { color: '234964', transparency: 40, width: 0.4 } });
    }
    for (let y = 0; y < H; y += 0.42) {
      slide.addShape(pptx.ShapeType.line, { x: 0, y, w: W, h: 0, line: { color: '234964', transparency: 40, width: 0.4 } });
    }
  }
}

function addTitle(slide, title, subtitle, opts = {}) {
  const color = opts.dark ? C.white : C.ink;
  slide.addText(title, { x: 0.55, y: 0.34, w: 8.8, h: 0.42, fontFace: 'Microsoft YaHei', fontSize: 21, bold: true, color, margin: 0 });
  if (subtitle) slide.addText(subtitle, { x: 0.56, y: 0.82, w: 9.8, h: 0.28, fontSize: 8.8, color: opts.dark ? 'C7D7E8' : C.muted, margin: 0 });
  slide.addText(String(opts.page ?? ''), { x: 12.45, y: 6.98, w: 0.35, h: 0.16, fontSize: 7.5, bold: true, color: opts.dark ? '8DDDF1' : C.blue, align: 'right', margin: 0 });
}

function pill(slide, text, x, y, color = C.blue, fill = C.blueSoft, w = 1.25) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.28, rectRadius: 0.06, fill: { color: fill }, line: { color, transparency: 70, width: 0.7 } });
  slide.addText(text, { x: x + 0.06, y: y + 0.062, w: w - 0.12, h: 0.1, fontSize: 6.8, bold: true, color, align: 'center', margin: 0 });
}

function card(slide, { x, y, w, h, title, body, color = C.blue, fill = C.white, titleSize = 12, bodySize = 8.2 }) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color: C.line, width: 0.8 } });
  slide.addShape(pptx.ShapeType.line, { x: x + 0.03, y: y + 0.12, w: 0, h: h - 0.24, line: { color, width: 2.2 } });
  slide.addText(title, { x: x + 0.2, y: y + 0.16, w: w - 0.32, h: 0.25, fontSize: titleSize, bold: true, color: C.ink, margin: 0 });
  if (body) slide.addText(body, { x: x + 0.2, y: y + 0.53, w: w - 0.32, h: h - 0.66, fontSize: bodySize, color: C.muted, breakLine: false, fit: 'shrink', valign: 'top', margin: 0.01 });
}

function arrow(slide, x1, y1, x2, y2, color = C.muted, width = 1.2) {
  slide.addShape(pptx.ShapeType.line, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color, width, beginArrowType: 'none', endArrowType: 'triangle' } });
}

function node(slide, text, x, y, w, color, fill) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.58, rectRadius: 0.06, fill: { color: fill }, line: { color, width: 1 } });
  slide.addText(text, { x: x + 0.08, y: y + 0.18, w: w - 0.16, h: 0.14, fontSize: 8.2, bold: true, color, align: 'center', margin: 0 });
}

function bulletList(slide, items, x, y, w, h, color = C.ink, fs = 9) {
  const runs = items.map((t) => ({ text: t, options: { bullet: { type: 'bullet' }, hanging: 3 } }));
  slide.addText(runs, { x, y, w, h, fontSize: fs, color, fit: 'shrink', breakLine: false, margin: 0.03, paraSpaceAfterPt: 6 });
}

function addFooter(slide, page) {
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 6.82, w: 12.2, h: 0, line: { color: C.line, width: 0.6 } });
  slide.addText('Biaxial Film Online R&D Agent Platform', { x: 0.56, y: 6.98, w: 3.6, h: 0.12, fontSize: 6.6, color: C.muted, margin: 0 });
  slide.addText(String(page).padStart(2, '0'), { x: 12.45, y: 6.98, w: 0.35, h: 0.12, fontSize: 7, color: C.blue, bold: true, align: 'right', margin: 0 });
}

// 1 Cover
{
  const s = pptx.addSlide();
  addBg(s, 'blueprint');
  if (fs.existsSync(coverImg)) s.addImage({ path: coverImg, x: 5.9, y: 0.55, w: 6.95, h: 3.92, transparency: 5 });
  s.addText('薄膜双拉在线工艺优化', { x: 0.62, y: 0.78, w: 5.6, h: 0.48, fontSize: 27, bold: true, color: C.white, margin: 0 });
  s.addText('Agent 平台设计方案', { x: 0.62, y: 1.32, w: 5.2, h: 0.45, fontSize: 25, bold: true, color: '8DDDF1', margin: 0 });
  s.addText('从设备接口到可审计、可回滚、可学习的研发参数闭环', { x: 0.64, y: 2.04, w: 5.1, h: 0.42, fontSize: 12.5, color: 'C7D7E8', breakLine: false, margin: 0 });
  ['MCP 工业连接', 'Skill 标准作业', 'Agent 编排决策', 'Safety Gate 硬放行'].forEach((t, i) => pill(s, t, 0.64 + i * 1.45, 2.74, ['8DDDF1', '7AE0B8', 'C8B6FF', 'FFB5AD'][i], '163B54', 1.32));
  card(s, { x: 0.64, y: 4.95, w: 3.1, h: 0.92, title: '核心原则', body: 'LLM 不直接裸写设备参数；所有动作必须经过计划、提案、安全门、回读和实验账本。', color: '8DDDF1', fill: '102A43', titleSize: 11, bodySize: 8 });
  card(s, { x: 3.95, y: 4.95, w: 3.1, h: 0.92, title: '第一目标', body: '先打通 MVP-1 安全闭环，再逐步引入深度研发优化和自动执行。', color: '7AE0B8', fill: '102A43', titleSize: 11, bodySize: 8 });
  s.addText('2026', { x: 11.85, y: 6.88, w: 0.8, h: 0.14, fontSize: 7.5, color: '8DDDF1', align: 'right', margin: 0 });
}

// 2 Conclusion
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, '结论先行：模式合理，但必须收敛成受控闭环', '设备与检测接口已具备，成败取决于闭环治理，而不是接口本身。', { page: 2 });
  card(s, { x: 0.7, y: 1.45, w: 3.55, h: 3.6, title: '为什么可行', body: '1. 薄膜双拉天然是多变量、慢响应、强耦合工艺。\n2. 在线厚度和双折射提供快速代理反馈。\n3. Claude Code 适合做工具编排和结构化流程。\n4. 现有诊断 Skill 可复用为深环审计内核。', color: C.green, fill: C.greenSoft, titleSize: 15, bodySize: 10 });
  card(s, { x: 4.88, y: 1.45, w: 3.55, h: 3.6, title: '必须避免', body: '1. LLM 直接控制 PLC。\n2. 第一版同时做全量自动化。\n3. 快环自行扩大探索空间。\n4. 只看在线指标却宣称最终性能最优。\n5. 用 Agent 推理替代确定性安全门。', color: C.red, fill: C.redSoft, titleSize: 15, bodySize: 10 });
  card(s, { x: 9.05, y: 1.45, w: 3.55, h: 3.6, title: '正确落点', body: '做成“受控在线研发优化平台”：\n\n深环设计试验，快环安全执行，MCP 连接设备，Safety Gate 硬放行，Ledger 让每次调参变成可学习样本。', color: C.blue, fill: C.blueSoft, titleSize: 15, bodySize: 10 });
  addFooter(s, 2);
}

// 3 Risks
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, '原设计中最需要修正的 5 个点', '不是否定方向，而是把它改造成工程上能验收、能上线、能长期学习的系统。', { page: 3 });
  const rows = [
    ['全量同时开发', '开发面太宽，任一层不稳定都会闭环失败', '先打通 MVP-1 安全闭环'],
    ['深环直接给多参数最优', '样本少、变量强耦合，易产生伪最优', '先做低维 DOE 和固定参数清单'],
    ['快环既优化又执行', '在线波动会诱导短期追逐，导致研发目标漂移', '快环只执行计划、记录响应、异常暂停'],
    ['离线性能进入第一闭环核心', '慢标签延迟长，MVP 很难快速迭代', '先优化在线代理指标，P1 再校准代理模型'],
    ['Safety Judge 由 Agent 放行', '无法满足工业写入的可验证要求', '确定性 safety-gate-mcp 硬放行']
  ];
  const x = [0.55, 3.55, 7.05, 10.15];
  ['不合理点', '落地风险', '最可行修正'].forEach((h, i) => card(s, { x: x[i], y: 1.22, w: i === 0 ? 2.75 : i === 1 ? 3.25 : 2.75, h: 0.52, title: h, body: '', color: [C.red, C.amber, C.green][i], fill: [C.redSoft, C.amberSoft, C.greenSoft][i], titleSize: 11 }));
  rows.forEach((r, i) => {
    const y = 1.92 + i * 0.83;
    s.addText(`${i + 1}. ${r[0]}`, { x: 0.72, y, w: 2.45, h: 0.3, fontSize: 9.2, bold: true, color: C.ink, margin: 0 });
    s.addText(r[1], { x: 3.62, y, w: 3.05, h: 0.36, fontSize: 8.5, color: C.muted, fit: 'shrink', margin: 0 });
    s.addText(r[2], { x: 7.2, y, w: 4.8, h: 0.36, fontSize: 8.8, color: C.green, bold: true, fit: 'shrink', margin: 0 });
    if (i < rows.length - 1) s.addShape(pptx.ShapeType.line, { x: 0.65, y: y + 0.55, w: 11.85, h: 0, line: { color: C.line, width: 0.6 } });
  });
  addFooter(s, 3);
}

// 4 Architecture
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, '总体架构：五层协同，不让任何一层越权', '设备与检测在底层，MCP 是唯一接口，Skill 是标准作业，Agent 做编排和解释。', { page: 4 });
  const layers = [
    ['人机协同层', ['研发负责人', '工艺工程师', '操作员控制台', '管理看板'], C.ink],
    ['Agent 编排层', ['Orchestrator', 'Process Engineer', 'R&D Engineer', 'Safety Reviewer'], C.violet],
    ['Skill 流程层', ['Online Tuner', 'R&D Optimizer', 'Deep Diagnostic', 'Simulation 后置'], C.blue],
    ['MCP 接口层', ['historian/inspection', 'safety/plc', 'recipe/ledger', 'quality/lab'], C.teal],
    ['设备与数据层', ['挤出-铸片', 'MD/TD 拉伸', '热定型-收卷', '在线检测'], C.amber],
  ];
  layers.forEach((l, idx) => {
    const y = 1.18 + idx * 0.95;
    s.addShape(pptx.ShapeType.roundRect, { x: 0.72, y, w: 1.7, h: 0.62, rectRadius: 0.05, fill: { color: 'EEF3F8' }, line: { color: C.line } });
    s.addText(l[0], { x: 0.88, y: y + 0.2, w: 1.36, h: 0.12, fontSize: 8.6, bold: true, color: C.ink, align: 'center', margin: 0 });
    l[1].forEach((t, i) => node(s, t, 2.78 + i * 2.32, y + 0.02, 1.9, l[2], 'FFFFFF'));
    if (idx < layers.length - 1) arrow(s, 6.67, y + 0.78, 6.67, y + 0.92, C.muted, 0.8);
  });
  card(s, { x: 0.72, y: 6.18, w: 11.75, h: 0.48, title: '上线原则', body: '所有自动写入必须经过结构化计划、确定性安全门、PLC 回读确认和实验账本；深环可以提出假设，快环只能执行受限动作。', color: C.red, fill: C.redSoft, titleSize: 9.8, bodySize: 8.5 });
  addFooter(s, 4);
}

// 5 MVP loop
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, 'MVP-1 安全闭环：第一版必须先打通这 7 步', '不要一开始追求完整自动研发；先让每次参数试验真实、可审计、可回滚、可学习。', { page: 5 });
  const steps = [
    ['采集快照', '过程量、厚度、双折射、报警、当前 recipe', C.blue],
    ['生成实验计划', '低维 DOE、参数窗口、保持时间、停止条件', C.violet],
    ['快环拆步', '稳态检查、偏差识别、单步 delta proposal', C.green],
    ['安全门预审', '白名单、限幅、限速、联锁、回滚配方', C.red],
    ['人工确认', '第一版所有写入都由工艺工程师确认', C.amber],
    ['写入与回读', 'PLC MCP 下发参数并回读确认', C.teal],
    ['形成样本', 'experiment_result + 前后稳态窗口 + 备注', C.blue],
  ];
  steps.forEach((st, i) => {
    const x = 0.48 + i * 1.78;
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.55, w: 1.46, h: 2.25, rectRadius: 0.05, fill: { color: 'FFFFFF' }, line: { color: C.line, width: 0.8 } });
    s.addText(String(i + 1), { x: x + 0.12, y: 1.77, w: 0.28, h: 0.2, fontSize: 17, bold: true, color: st[2], margin: 0 });
    s.addText(st[0], { x: x + 0.18, y: 2.2, w: 1.1, h: 0.32, fontSize: 9.2, bold: true, color: C.ink, fit: 'shrink', margin: 0 });
    s.addText(st[1], { x: x + 0.18, y: 2.72, w: 1.13, h: 0.56, fontSize: 7.2, color: C.muted, fit: 'shrink', margin: 0 });
    if (i < steps.length - 1) arrow(s, x + 1.46, 2.68, x + 1.74, 2.68, C.muted, 1);
  });
  card(s, { x: 0.9, y: 4.65, w: 3.65, h: 1.05, title: 'P0 必做', body: '统一数据与时间对齐；安全门和配方账本。没有这两件事，后续智能都是不可验证的。', color: C.blue, fill: C.blueSoft, titleSize: 12, bodySize: 8.8 });
  card(s, { x: 4.85, y: 4.65, w: 3.65, h: 1.05, title: 'P1 再做', body: '深环低维 DOE 策略和在线代理模型校准，开始让平台从每次试验中学习。', color: C.green, fill: C.greenSoft, titleSize: 12, bodySize: 8.8 });
  card(s, { x: 8.8, y: 4.65, w: 3.65, h: 1.05, title: 'P2 后置', body: '数字孪生、贝叶斯优化和半自动写入，必须等 MVP 稳定后再开放。', color: C.amber, fill: C.amberSoft, titleSize: 12, bodySize: 8.8 });
  addFooter(s, 5);
}

// 6 MCP
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, 'MCP 层：把工业接口变成可审计工具，而不是裸接口', 'MCP 是平台落地的“工业插座”，每个工具都要有输入输出、权限和验收。', { page: 6 });
  const modules = [
    ['industrial-historian', '读实时 tag / 时间窗口 / 稳态片段', C.blue],
    ['online-inspection', '厚度 profile / 双折射 profile / 检测健康', C.teal],
    ['safety-gate', '白名单 / 限幅 / 限速 / 联锁 / 回滚', C.red],
    ['plc-control-gateway', 'preview / write / readback / rollback', C.amber],
    ['recipe-ledger', 'recipe_version / experiment_id / 变更日志', C.green],
    ['quality-lab', '离线性能慢标签 / 代理模型校准', C.violet],
  ];
  modules.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    card(s, { x: 0.72 + col * 4.13, y: 1.28 + row * 1.78, w: 3.65, h: 1.3, title: m[0], body: m[1], color: m[2], fill: 'FFFFFF', titleSize: 12.2, bodySize: 9 });
  });
  s.addShape(pptx.ShapeType.roundRect, { x: 1.1, y: 5.28, w: 11.05, h: 0.8, rectRadius: 0.06, fill: { color: C.redSoft }, line: { color: C.red, transparency: 70 } });
  s.addText('最关键的工程判断：Safety Gate 必须是 deterministic service，Agent 只能解释和审计，不能覆盖硬安全拒绝。', { x: 1.35, y: 5.58, w: 10.55, h: 0.14, fontSize: 11, bold: true, color: C.red, align: 'center', margin: 0 });
  addFooter(s, 6);
}

// 7 Skills
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, 'Skill 层：用标准作业流程固定住“谁想、谁做、谁审”', 'Skill 不是提示词堆叠，而是产物合同、输入输出和质量门。', { page: 7 });
  card(s, { x: 0.7, y: 1.32, w: 3.65, h: 3.1, title: '快环：online-film-process-tuner', body: '像现场工艺工程师。\n\n输入：experiment_plan、process_snapshot、online_quality_map。\n输出：parameter_delta_proposal、execution_receipt。\n边界：只拆步执行，不扩大参数空间。', color: C.green, fill: C.greenSoft, titleSize: 14, bodySize: 9.2 });
  card(s, { x: 4.86, y: 1.32, w: 3.65, h: 3.1, title: '深环：film-rd-strategy-optimizer', body: '像研发工程师。\n\n输入：campaign 数据、离线标签、工艺本体、历史配方。\n输出：低维 DOE、参数窗口、停止条件。\n边界：样本不足时不宣称全局最优。', color: C.blue, fill: C.blueSoft, titleSize: 14, bodySize: 9.2 });
  card(s, { x: 9.02, y: 1.32, w: 3.65, h: 3.1, title: '审计：industrial-deep-diagnostic', body: '复用现有管线。\n\ncontext-builder 建本体；data-processor 做响应分析；diagnostician 做竞争假设；judge/reviewer 阻断低质量结论。', color: C.violet, fill: C.violetSoft, titleSize: 14, bodySize: 9.2 });
  node(s, '实验计划', 2.1, 5.22, 1.35, C.blue, 'FFFFFF');
  arrow(s, 3.45, 5.51, 4.46, 5.51, C.muted);
  node(s, '快环执行', 4.48, 5.22, 1.35, C.green, 'FFFFFF');
  arrow(s, 5.83, 5.51, 6.84, 5.51, C.muted);
  node(s, '响应样本', 6.86, 5.22, 1.35, C.teal, 'FFFFFF');
  arrow(s, 8.21, 5.51, 9.22, 5.51, C.muted);
  node(s, '深环更新', 9.24, 5.22, 1.35, C.violet, 'FFFFFF');
  addFooter(s, 7);
}

// 8 Agents
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, 'Agent 层：决策角色要清晰，不能互相越权', 'Agent 的价值是编排、解释、协同和审计，不是替代确定性控制系统。', { page: 8 });
  const agents = [
    ['Campaign Orchestrator', '创建 campaign、维护状态机、调度 Skill/MCP、处理异常暂停。', C.violet],
    ['Process Engineer Agent', '检查稳态、执行计划内 delta、记录响应、发现矛盾上报。', C.green],
    ['R&D Engineer Agent', '提出主假设、设计低维 DOE、定义预期响应和失败条件。', C.blue],
    ['Safety Reviewer Agent', '解释 safety-gate 结果、审计证据、升级人工审批。', C.red],
    ['Operator UI Agent', '把建议、风险、趋势、批准/拒绝/回滚压缩成可操作界面。', C.amber],
  ];
  agents.forEach((a, i) => {
    const x = i < 3 ? 0.78 + i * 4.05 : 2.82 + (i - 3) * 4.05;
    const y = i < 3 ? 1.35 : 4.0;
    card(s, { x, y, w: 3.45, h: 1.55, title: a[0], body: a[1], color: a[2], fill: 'FFFFFF', titleSize: 12.2, bodySize: 8.7 });
  });
  addFooter(s, 8);
}

// 9 Roadmap
{
  const s = pptx.addSlide();
  addBg(s);
  addTitle(s, '开发路线：先闭环，再智能；先建议，再半自动', '每阶段都有可验收产物，避免“所有模块都有一点，但没有一条链路能跑”。', { page: 9 });
  const phases = [
    ['P0', '只读观测', '数据对齐、稳定窗口、profile 特征、账本框架'],
    ['P1', '人工确认建议', '建议卡片、原因、风险、人工批准按钮'],
    ['P2', '受控半自动', '低风险参数、小步幅、硬限幅、自动回滚'],
    ['P3', '闭环研发优化', 'DOE/贝叶斯优化、离线标签回灌、代理模型'],
    ['P4', '多牌号沉淀', 'best-known recipe、禁区、跨批次迁移'],
  ];
  phases.forEach((p, i) => {
    const x = 0.72 + i * 2.42;
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.35, w: 1.86, h: 0.68, rectRadius: 0.06, fill: { color: i < 2 ? C.blueSoft : i === 2 ? C.greenSoft : C.amberSoft }, line: { color: i < 2 ? C.blue : i === 2 ? C.green : C.amber } });
    s.addText(p[0], { x: x + 0.12, y: 1.56, w: 0.45, h: 0.12, fontSize: 12, bold: true, color: i < 2 ? C.blue : i === 2 ? C.green : C.amber, margin: 0 });
    s.addText(p[1], { x: x + 0.62, y: 1.57, w: 1, h: 0.12, fontSize: 8.8, bold: true, color: C.ink, margin: 0 });
    if (i < phases.length - 1) arrow(s, x + 1.86, 1.69, x + 2.32, 1.69, C.muted);
    card(s, { x, y: 2.52, w: 1.86, h: 2.55, title: p[1], body: p[2], color: i < 2 ? C.blue : i === 2 ? C.green : C.amber, fill: 'FFFFFF', titleSize: 10.5, bodySize: 8.4 });
  });
  card(s, { x: 1.22, y: 5.78, w: 10.4, h: 0.55, title: '验收节奏', body: 'P0 看数据可信度，P1 看建议方向命中率，P2 看零越界和回滚可靠性，P3 看试验效率和产品性能提升。', color: C.teal, fill: C.tealSoft, titleSize: 10, bodySize: 8.3 });
  addFooter(s, 9);
}

// 10 Close
{
  const s = pptx.addSlide();
  addBg(s, 'blueprint');
  s.addText('最终行动蓝图', { x: 0.62, y: 0.58, w: 3.8, h: 0.38, fontSize: 26, bold: true, color: C.white, margin: 0 });
  s.addText('把在线优化从“想法”变成“可开发、可验证、可上线”的研发控制平台', { x: 0.64, y: 1.14, w: 8.4, h: 0.18, fontSize: 10.5, color: 'C7D7E8', margin: 0 });
  const actions = [
    ['第一条链路', '打通 MVP-1：采集 -> 计划 -> 提案 -> 安全门 -> 确认 -> 写入回读 -> 样本。'],
    ['第一条原则', '安全放行必须 deterministic；Agent 负责解释、审计和协同。'],
    ['第一批模块', 'historian、inspection、safety-gate、plc-gateway、recipe-ledger、tuner skill。'],
    ['第一类指标', '在线厚度和双折射作为代理指标；离线性能用于 P1/P2 代理模型校准。'],
  ];
  actions.forEach((a, i) => card(s, { x: 0.84 + (i % 2) * 5.75, y: 2.05 + Math.floor(i / 2) * 1.42, w: 4.95, h: 0.9, title: a[0], body: a[1], color: ['8DDDF1', 'FFB5AD', '7AE0B8', 'C8B6FF'][i], fill: '102A43', titleSize: 12, bodySize: 8.4 }));
  s.addText('建议下一步：直接按 MVP-1 建目录、写 MCP schema、做 campaign 状态机和建议卡片 UI。', { x: 1.05, y: 5.8, w: 11.2, h: 0.24, fontSize: 14, bold: true, color: '8DDDF1', align: 'center', margin: 0 });
}

await pptx.writeFile({ fileName: OUT });
console.log(OUT);
