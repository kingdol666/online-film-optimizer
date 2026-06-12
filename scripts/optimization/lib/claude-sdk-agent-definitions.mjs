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
  'closed-loop-optimization-orchestrator': ['Read', 'Write', 'Bash', 'Glob', 'Grep', 'Agent'],
  'closed-loop-optimization-quality-agent': ['Read', 'Write', 'Bash', 'Glob', 'Grep'],
  'closed-loop-optimization-rd-agent': ['Read', 'Write', 'Bash', 'Glob', 'Grep'],
  'closed-loop-optimization-process-agent': ['Read', 'Write', 'Bash', 'Glob', 'Grep']
});

// Builds the Claude Agent SDK `Record<string, AgentDefinition>` map from
// project `.claude/agents/*.md` files so the runtime can invoke each expert
// through the SDK Agent tool instead of relying on prompt-only personas.
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
    agents[name] = {
      description: frontmatter.description || `${name} for closed-loop optimization`,
      prompt: [
        body.trim(),
        '',
        '## SDK AgentTeam Runtime Contract',
        '- You are running as a Claude Agent SDK subagent or main agent.',
        '- You must coordinate through explicit artifacts, never hidden chat context.',
        '- When you need another role, use the Agent tool with the role subagent type and include task_dir, campaign_dir, iteration, dispatch plan, and required artifacts.',
        '- If native experimental Agent Teams are unavailable, preserve the same semantics by invoking `npm run optimize:team` and validating the generated file-bus workspace.',
        '- Never write equipment parameters directly from an LLM response; all actions must pass the project adapter/MCP safety gate, approval packet, and rollback baseline.'
      ].join('\n'),
      model: frontmatter.model || 'inherit',
      tools: normalizeList(frontmatter.tools, ROLE_TOOLS[name] || ['Read', 'Write', 'Bash', 'Glob', 'Grep']),
      disallowedTools: normalizeList(frontmatter.disallowedTools, []),
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
      ]
    }
  };
}

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
    '你是 closed-loop-optimization-orchestrator 主 Agent。请按 Claude Code subagent/Agent SDK 标准启动一次多 Agent 闭环优化。',
    '',
    '必须遵守：',
    '1. 先读取 `.claude/skills/closed-loop-optimizer/SKILL.md` 和 `docs/agentteam-closed-loop-execution-runbook.md`。',
    '2. 使用 Agent 工具分别触发 quality / rd / process 三个项目级 subagent 做职责确认或并行审查；subagent_type 必须使用项目定义的 agent name。',
    '3. 正式执行仍以仓库标准命令为准，确保产生可验收的任务目录、team messages、07_coordination、08_trial_evidence 和最终 recipe。',
    '4. 如果宿主没有实验 Agent Teams 的 TeamCreate/TaskCreate/SendMessage 工具，不要失败；使用 deterministic file-bus AgentTeam 作为标准回退。',
    '5. 执行完成后运行 `npm run agentteam:validate`，并对 task workspace 与 campaign 各运行一次 validate。',
    '',
    '建议先发给三个 teammate 的任务：',
    '- quality: 检查目标、质量窗口、质量 gate 和 hold-window 验收标准。',
    '- rd: 检查产品型号、长期/历史 recipe、主杠杆策略和重规划条件。',
    '- process: 检查 proposal、safety gate、approval、MCP/adapter 写入和 rollback recipe。',
    '',
    '然后运行：',
    command,
    '',
    `用户研发目标：${normalizedGoal}`,
    productGrade ? `产品型号固定为：${productGrade}` : '产品型号由目标文本或目标协议推断。',
    '',
    '最终输出必须包含 task_dir、campaign_dir、goal_reached、final_quality_state、candidate_recipe_id、best recipe setpoints、验证命令结果摘要。'
  ].join('\n');
}
