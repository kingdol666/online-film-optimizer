import fs from 'node:fs';
import path from 'node:path';

const PROJECT_AGENT_NAMES = Object.freeze([
  'closed-loop-optimization-orchestrator',
  'closed-loop-optimization-quality-agent',
  'closed-loop-optimization-rd-agent',
  'closed-loop-optimization-process-agent'
]);

const ROLE_SKILLS = Object.freeze({
  'closed-loop-optimization-orchestrator': ['closed-loop-optimizer'],
  'closed-loop-optimization-quality-agent': ['quality-engineer'],
  'closed-loop-optimization-rd-agent': ['rd-engineer'],
  'closed-loop-optimization-process-agent': ['process-engineer']
});

const ROLE_TOOLS = Object.freeze({
  'closed-loop-optimization-orchestrator': ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'Agent', 'SendMessage', 'TeamCreate', 'TeamDelete', 'TaskOutput', 'TaskStop', 'TodoWrite'],
  'closed-loop-optimization-quality-agent': ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
  'closed-loop-optimization-rd-agent': ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
  'closed-loop-optimization-process-agent': ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'TodoWrite']
});

const ROLE_DISALLOWED_TOOLS = Object.freeze({
  'closed-loop-optimization-orchestrator': ['Edit'],
  'closed-loop-optimization-quality-agent': ['Edit'],
  'closed-loop-optimization-rd-agent': ['Edit'],
  'closed-loop-optimization-process-agent': ['Edit']
});

// Maps each role to the list of agent names it may request work from.
// This is the runtime enforcement of the communication matrix.
const ROLE_COMMUNICATION_TARGETS = Object.freeze({
  'closed-loop-optimization-orchestrator': [
    'closed-loop-optimization-quality-agent',
    'closed-loop-optimization-rd-agent',
    'closed-loop-optimization-process-agent'
  ],
  'closed-loop-optimization-quality-agent': [
    'closed-loop-optimization-rd-agent',
    'closed-loop-optimization-process-agent',
    'closed-loop-optimization-orchestrator'
  ],
  'closed-loop-optimization-rd-agent': [
    'closed-loop-optimization-quality-agent',
    'closed-loop-optimization-process-agent',
    'closed-loop-optimization-orchestrator'
  ],
  'closed-loop-optimization-process-agent': [
    'closed-loop-optimization-quality-agent',
    'closed-loop-optimization-rd-agent',
    'closed-loop-optimization-orchestrator'
  ]
});

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      frontmatter: {},
      body: markdown
    };
  }
  const frontmatter = {};
  const lines = match[1].split('\n');
  let currentListKey = null;
  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      frontmatter[currentListKey].push(listMatch[1].trim());
      continue;
    }
    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValueMatch) continue;
    const [, key, rawValue] = keyValueMatch;
    const value = rawValue.trim();
    if (value.length === 0) {
      frontmatter[key] = [];
      currentListKey = key;
    } else {
      frontmatter[key] = value;
      currentListKey = null;
    }
  }
  return {
    frontmatter,
    body: markdown.slice(match[0].length)
  };
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}

/**
 * Builds the Claude Agent SDK `Record<string, AgentDefinition>` map from
 * project `.claude/agents/*.md` files so the runtime can invoke each expert
 * through the SDK Agent tool as a true team member.
 *
 * Each agent receives:
 * 1. Its full role prompt from the agent definition .md file
 * 2. The SDK AgentTeam Runtime Contract (artifact-driven coordination)
 * 3. Cross-artifact understanding instructions (how to parse other roles' outputs)
 * 4. Autonomy trigger rules (when to act without being told)
 */
export function loadClaudeSdkAgentDefinitions({
  projectRoot = process.cwd()
} = {}) {
  const agents = {};
  const agentFiles = {};

  for (const agentName of PROJECT_AGENT_NAMES) {
    const filePath = path.join(projectRoot, '.claude', 'agents', `${agentName}.md`);
    const markdown = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(markdown);
    const name = frontmatter.name || agentName;
    const isOrchestrator = name === 'closed-loop-optimization-orchestrator';
    const isTeammate = !isOrchestrator;

    // Build the runtime contract appendix for each agent type
    const runtimeContract = isOrchestrator
      ? buildOrchestratorRuntimeContract()
      : buildTeammateRuntimeContract(name, agentName);

    agents[name] = {
      description: frontmatter.description || `${name} for closed-loop optimization`,
      prompt: [
        body.trim(),
        '',
        runtimeContract
      ].join('\n'),
      model: frontmatter.model || 'inherit',
      tools: normalizeList(frontmatter.tools, ROLE_TOOLS[name] || ['Read', 'Write', 'Bash', 'Glob', 'Grep']),
      disallowedTools: normalizeList(frontmatter.disallowedTools, ROLE_DISALLOWED_TOOLS[name] || []),
      skills: normalizeList(frontmatter.skills, ROLE_SKILLS[name] || []),
      memory: frontmatter.memory || 'project'
    };
    agentFiles[name] = path.relative(projectRoot, filePath);
  }

  return {
    agents,
    agentFiles,
    teamRoster: {
      lead: 'closed-loop-optimization-orchestrator',
      teammates: [
        'closed-loop-optimization-quality-agent',
        'closed-loop-optimization-rd-agent',
        'closed-loop-optimization-process-agent'
      ],
      communication_matrix: ROLE_COMMUNICATION_TARGETS
    }
  };
}

function buildOrchestratorRuntimeContract() {
  return [
    '## SDK AgentTeam Runtime Contract — Orchestrator',
    '',
    'You are the team lead. Your job is to CREATE A REAL TEAM and coordinate your teammates.',
    '',
    '### Team Creation Priority (MANDATORY)',
    '1. **FIRST**: Use `TeamCreate` to create a team with the task ID as team name.',
    '2. **SECOND**: Use `Agent` tool to spawn each teammate with their subagent_type and the team_name.',
    '   - `subagent_type: "closed-loop-optimization-quality-agent"` named `quality`',
    '   - `subagent_type: "closed-loop-optimization-rd-agent"` named `rd`',
    '   - `subagent_type: "closed-loop-optimization-process-agent"` named `process`',
    '3. **THIRD**: Use `SendMessage` to send each teammate their initial task brief, including:',
    '   - `task_dir`: absolute path to the task workspace',
    '   - `campaign_dir`: path to the current campaign run directory',
    '   - `iteration`: current iteration number',
    '   - `phase`: team-intake / quality-review / rd-strategy / process-execution',
    '   - `required_reads`: list of artifact file paths to read',
    '   - `required_writes`: list of artifact file paths to write',
    '',
    '### If TeamCreate is NOT available',
    'Fall back to the deterministic file-bus AgentTeam via:',
    '```bash',
    'npm run optimize:team -- --product-grade <GRADE> --goal-text "<GOAL>" --max-iters <N>',
    '```',
    'This is a valid team execution mode. The file bus still uses the same team_contract,',
    'team_messages.jsonl, and inbox/architecture.',
    '',
    '### Team Communication Rules',
    '- Use `SendMessage` to communicate with teammates when native team is available.',
    '- All communication must reference artifact file paths, not just natural language.',
    '- Each message must state `purpose`, `requested_actions`, and `requires_response`.',
    '- Every iteration must produce a `team_dispatch_plan_XXX.json` in `07_coordination/`.',
    '- After campaign completes, validate with agentteam:validate and team-workspace validators.',
  ].join('\n');
}

function buildTeammateRuntimeContract(agentName, agentFileName) {
  const roleName = agentName.replace('closed-loop-optimization-', '').replace('-agent', '');
  const isQuality = roleName === 'quality';
  const isRd = roleName === 'rd';
  const isProcess = roleName === 'process';

  const autonomyRules = [];
  const communicationTargets = ROLE_COMMUNICATION_TARGETS[agentName] || [];

  if (isQuality) {
    autonomyRules.push(
      '### Autonomy Triggers',
      '- When you read a new `process_snapshot_XXX.json` → run diagnosis automatically.',
      '- When you read a new `experiment_result_XXX.json` → evaluate effective/ineffective/worse automatically.',
      '- When consecutive ineffective >= 3 → send `request_rd_replan` to rd-engineer without waiting.',
      '- When consecutive worse >= 2 → send `request_rd_replan` + rollback suggestion.',
      '- When quality_state == PASS → send `request_hold_validation` to process-engineer.',
      '- When sensor_health is degraded → send ALERT to all teammates.'
    );
  } else if (isRd) {
    autonomyRules.push(
      '### Autonomy Triggers',
      '- When you read a new `quality_diagnosis_XXX.json` → generate/refresh optimization plan automatically.',
      '- When you receive `request_rd_replan` from quality or process → replan immediately.',
      '- When you read campaign_ledger and see consecutive ineffective/worse → replan without waiting.',
      '- When quality_state == PASS → only allow hold/validation, stop exploration.',
      '- When safety_gate_result shows your lever was rejected → select alternative within limits.'
    );
  } else if (isProcess) {
    autonomyRules.push(
      '### Autonomy Triggers',
      '- When you read a new `rd_optimization_plan_XXX.json` → convert to proposal + safety gate automatically.',
      '- When safety gate ALLOWS → execute via MCP/adapter immediately (auto_gate mode).',
      '- When safety gate REJECTS → send `request_rd_replan` with violations and executable alternatives.',
      '- When quality requests hold-window → keep current recipe, stop exploration.',
      '- When multi-round micro-tune shows no progress → send `request_rd_replan`.',
      '- When snapshot shows alarm_active → notify team-lead and quality immediately.'
    );
  }

  const communicationTargetList = communicationTargets
    .map(t => `\`${t}\``)
    .join(', ');

  return [
    '## SDK AgentTeam Runtime Contract — Teammate',
    '',
    `You are a teammate agent (${roleName}) running in the closed-loop optimization team.`,
    'You are NOT the team lead. Your job is to execute your domain expertise autonomously.',
    '',
    '### Communication',
    `Your communication targets: ${communicationTargetList}.`,
    '- Use `SendMessage` to send structured messages to teammates when native team is available.',
    '- All coordination must persist to task artifacts, never hidden chat context.',
    '- When you need another role to do something, send them a message with `purpose`, `requested_actions`, and `requires_response: true`.',
    '- Always reference artifact file paths in your messages (`artifact_refs`).',
    '',
    ...autonomyRules,
    '',
    '### Safety Boundaries',
    '- Never write equipment parameters directly from an LLM response.',
    '- All actions must pass the project adapter/MCP safety gate, approval packet, and rollback baseline.',
    '- If you detect product_grade mismatch across artifacts, BLOCK and notify all teammates.',
    '- If native Agent Teams are unavailable, the orchestrator will use `npm run optimize:team` as fallback.',
    '',
    '### Task Context',
    'When spawned by the orchestrator, you will receive: task_dir, campaign_dir, iteration, phase, required_reads, required_writes.',
    'Always read the required artifacts before acting. Always write your outputs to the specified paths.'
  ].join('\n');
}

/**
 * Builds the main orchestrator system prompt for the SDK query() call.
 * The prompt instructs the orchestrator to create a real team and coordinate teammates.
 */
export function buildSdkTeamPrompt({
  goalText,
  productGrade,
  maxIters,
  seed,
  reasoningMode = 'deterministic'
}) {
  const normalizedGoal = goalText || '请完成对产线的优化，并输出最终recipe';
  const gradeArgs = productGrade ? `--product-grade ${productGrade}` : '';
  const command = [
    'npm run optimize:team --',
    gradeArgs,
    `--goal-text ${JSON.stringify(normalizedGoal)}`,
    `--reasoning-mode ${reasoningMode}`,
    `--max-iters ${Number(maxIters || 8)}`,
    `--seed ${Number(seed || 20260612)}`
  ].filter(Boolean).join(' ');

  return [
    '你是 closed-loop-optimization-orchestrator 主 Agent。请按 Claude Code Agent SDK Teamwork 标准启动一次真正的多 Agent 闭环优化团队。',
    '',
    '## 核心原则：你是团队负责人，不是一个人干活',
    '',
    '你的工作是建立团队、分配任务、协调节奏、验收结果。',
    'Quality / R&D / Process 三个 Agent 是独立专家，让他们各自发挥。',
    '',
    '## 必须执行的标准流程',
    '',
    '### Phase 1: 创建团队和任务 Workspace',
    '1. 先运行以下命令创建完整的任务目录结构：',
    '```bash',
    command,
    '```',
    '2. 读取生成的任务目录中的 `task_manifest.json` 获取 task_dir。',
    '3. 如果 TeamCreate 工具可用，创建团队：`TeamCreate({ team_name: "<task-id>", description: "..." })`',
    '',
    '### Phase 2: 启动团队 Agent',
    '使用 Agent 工具同时启动三个团队成员：',
    '- `subagent_type: "closed-loop-optimization-quality-agent"`, `name: "quality"`, `team_name: "<task-id>"`',
    '- `subagent_type: "closed-loop-optimization-rd-agent"`, `name: "rd"`, `team_name: "<task-id>"`',
    '- `subagent_type: "closed-loop-optimization-process-agent"`, `name: "process"`, `team_name: "<task-id>"`',
    '',
    '给每个 Agent 的 prompt 必须包含：',
    '- `task_dir`: 任务目录绝对路径',
    '- `campaign_dir`: 当前 campaign 目录',
    '- `iteration`: 当前迭代号',
    '- `phase`: team-intake / quality-review / rd-strategy / process-execution',
    '- `required_reads`: 必须读取的工件文件路径列表',
    '- `required_writes`: 必须写入的工件文件路径列表',
    '',
    '### Phase 3: 监控和调度',
    '每一轮迭代后根据质量反馈决策：',
    '- 继续当前策略 → 告诉 Process Agent 继续微调',
    '- 需要重规划 → 告诉 R&D Agent 出新的 plan',
    '- 需要质量深检 → 告诉 Quality Agent 重新诊断',
    '- 目标达成 → 进入 hold-window 验证',
    '- 安全门拒绝 → 要求 Process Agent 解释，R&D Agent 调整方向',
    '',
    '### Phase 4: 验收',
    '完成后运行三个验证：',
    '```bash',
    'npm run agentteam:validate',
    'node scripts/optimization/validate-team-workspace.mjs --task-dir "$TASK_DIR"',
    'node .claude/skills/closed-loop-optimizer/scripts/validate-campaign.mjs --run-dir "$RUN_DIR"',
    '```',
    '',
    '### 回退方案',
    '如果宿主没有 TeamCreate/SendMessage 工具，使用文件总线回退：',
    '```bash',
    'npm run optimize:team -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>"',
    '```',
    '',
    `用户研发目标：${normalizedGoal}`,
    productGrade ? `产品型号：${productGrade}` : '产品型号由目标文本推断。',
    '',
    '最终输出必须包含 task_dir、campaign_dir、goal_reached、final_quality_state、best recipe setpoints、验证结果摘要。'
  ].join('\n');
}
