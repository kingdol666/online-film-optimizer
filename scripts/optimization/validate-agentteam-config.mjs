import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FILES = [
  '.claude/skills/closed-loop-optimizer/SKILL.md',
  '.claude/skills/closed-loop-optimizer/references/team-orchestration.md',
  '.claude/skills/closed-loop-optimizer/references/product-recipe-development.md',
  '.claude/agents/closed-loop-optimization-orchestrator.md',
  '.claude/agents/closed-loop-optimization-quality-agent.md',
  '.claude/agents/closed-loop-optimization-rd-agent.md',
  '.claude/agents/closed-loop-optimization-process-agent.md',
  'scripts/optimization/run-team-campaign.mjs',
  'scripts/optimization/run-skill-entry.mjs',
  'scripts/optimization/run-claude-sdk-skill.mjs',
  'scripts/optimization/validate-team-workspace.mjs',
  'scripts/optimization/claude-agentteam-hook.mjs',
  'scripts/optimization/lib/claude-sdk-agent-definitions.mjs',
  'scripts/optimization/lib/team-message-protocol.mjs',
  'scripts/optimization/lib/task-workspace.mjs',
  '.claude/settings.json'
];

const REQUIRED_AGENT_NAMES = [
  'closed-loop-optimization-orchestrator',
  'closed-loop-optimization-quality-agent',
  'closed-loop-optimization-rd-agent',
  'closed-loop-optimization-process-agent'
];

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function frontmatterName(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const nameMatch = match[1].match(/^name:\s*(.+)$/m);
  return nameMatch?.[1]?.trim() || null;
}

function requireContains({ filePath, content, needles, failures }) {
  for (const needle of needles) {
    if (!content.includes(needle)) failures.push(`missing_text:${filePath}:${needle}`);
  }
}

function main() {
  const root = process.cwd();
  const failures = [];
  const warnings = [];

  for (const relativePath of REQUIRED_FILES) {
    if (!exists(path.join(root, relativePath))) failures.push(`missing_file:${relativePath}`);
  }
  if (failures.length > 0) {
    console.log(JSON.stringify({ ok: false, failures, warnings }, null, 2));
    process.exit(1);
  }

  for (const agentName of REQUIRED_AGENT_NAMES) {
    const filePath = path.join(root, '.claude', 'agents', `${agentName}.md`);
    const content = read(filePath);
    const actualName = frontmatterName(content);
    if (actualName !== agentName) failures.push(`agent_name_mismatch:${agentName}:actual=${actualName}`);
    requireContains({
      filePath: path.relative(root, filePath),
      content,
      needles: [
        'product_grade',
        'team message',
        'validate-team-workspace',
        '07_coordination'
      ],
      failures
    });
  }

  const skill = read(path.join(root, '.claude/skills/closed-loop-optimizer/SKILL.md'));
  requireContains({
    filePath: '.claude/skills/closed-loop-optimizer/SKILL.md',
    content: skill,
    needles: [
      'npm run optimize:team',
      'npm run optimize:skill',
      '--product-grade',
      'team/department_briefs.json',
      'outputs/final_recipe.json',
      'product-recipe-development.md'
    ],
    failures
  });

  const protocol = read(path.join(root, 'scripts/optimization/lib/team-message-protocol.mjs'));
  requireContains({
    filePath: 'scripts/optimization/lib/team-message-protocol.mjs',
    content: protocol,
    needles: ['TEAM_MESSAGE_PROTOCOL_VERSION', 'quality-engineer', 'rd-engineer', 'process-engineer', 'validateTeamMessage'],
    failures
  });

  const workspace = read(path.join(root, 'scripts/optimization/lib/task-workspace.mjs'));
  requireContains({
    filePath: 'scripts/optimization/lib/task-workspace.mjs',
    content: workspace,
    needles: ['team_contract.json', 'closed-loop-optimization-quality-agent', 'closed-loop-optimization-rd-agent', 'closed-loop-optimization-process-agent'],
    failures
  });

  const runTeam = read(path.join(root, 'scripts/optimization/run-team-campaign.mjs'));
  requireContains({
    filePath: 'scripts/optimization/run-team-campaign.mjs',
    content: runTeam,
    needles: ['--product-grade', 'createDepartmentTeamTask', 'finalizeDepartmentTeamTask', 'run-sim-campaign.mjs'],
    failures
  });

  const runSkillEntry = read(path.join(root, 'scripts/optimization/run-skill-entry.mjs'));
  requireContains({
    filePath: 'scripts/optimization/run-skill-entry.mjs',
    content: runSkillEntry,
    needles: [
      'ensurePlatformServices',
      'McpClient',
      'run-claude-sdk-skill.mjs',
      'run-team-campaign.mjs',
      'ONLINE_OPTIMIZER_SKILL_ENTRY'
    ],
    failures
  });

  const sdkRunner = read(path.join(root, 'scripts/optimization/run-claude-sdk-skill.mjs'));
  requireContains({
    filePath: 'scripts/optimization/run-claude-sdk-skill.mjs',
    content: sdkRunner,
    needles: [
      'loadClaudeSdkAgentDefinitions',
      "agent: 'closed-loop-optimization-orchestrator'",
      'forwardSubagentText',
      'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
      'skills: ['
    ],
    failures
  });

  const sdkDefinitions = read(path.join(root, 'scripts/optimization/lib/claude-sdk-agent-definitions.mjs'));
  requireContains({
    filePath: 'scripts/optimization/lib/claude-sdk-agent-definitions.mjs',
    content: sdkDefinitions,
    needles: [
      'AgentDefinition',
      'closed-loop-optimization-quality-agent',
      'closed-loop-optimization-rd-agent',
      'closed-loop-optimization-process-agent',
      'buildSdkTeamPrompt'
    ],
    failures
  });

  const settings = read(path.join(root, '.claude/settings.json'));
  requireContains({
    filePath: '.claude/settings.json',
    content: settings,
    needles: [
      'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
      'SubagentStop',
      'PostToolUse',
      'claude-agentteam-hook.mjs',
      'npm run optimize:claude-sdk'
    ],
    failures
  });

  const report = {
    ok: failures.length === 0,
    checked_files: REQUIRED_FILES.length,
    checked_agents: REQUIRED_AGENT_NAMES,
    execution_entrypoint: 'npm run optimize:claude-sdk -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>"',
    fallback_entrypoint: 'npm run optimize:team -- --product-grade <PRODUCT_GRADE> --goal-text "<研发目标>"',
    failures,
    warnings
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
