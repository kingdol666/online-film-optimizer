import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  buildSdkTeamPrompt,
  loadClaudeSdkAgentDefinitions
} from './lib/claude-sdk-agent-definitions.mjs';

function parseArgs(argv) {
  const args = {
    goalText: '',
    productGrade: '',
    maxIters: 8,
    seed: 20260612,
    maxTurns: 8,
    permissionMode: 'bypassPermissions',
    model: null,
    reasoningMode: 'deterministic'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--goal-text') args.goalText = argv[++i];
    else if (arg === '--product-grade') args.productGrade = argv[++i];
    else if (arg === '--max-iters') args.maxIters = Number(argv[++i]);
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--max-turns') args.maxTurns = Number(argv[++i]);
    else if (arg === '--permission-mode') args.permissionMode = argv[++i];
    else if (arg === '--model') args.model = argv[++i];
    else if (arg === '--reasoning-mode') args.reasoningMode = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.goalText) {
    throw new Error('--goal-text is required');
  }

  const { agents, agentFiles, teamRoster } = loadClaudeSdkAgentDefinitions({
    projectRoot: process.cwd()
  });
  const prompt = buildSdkTeamPrompt(args);
  const options = {
    cwd: process.cwd(),
    maxTurns: args.maxTurns,
    permissionMode: args.permissionMode,
    allowDangerouslySkipPermissions: args.permissionMode === 'bypassPermissions',
    model: args.model || undefined,
    agent: 'closed-loop-optimization-orchestrator',
    agents,
    skills: ['closed-loop-optimizer'],
    forwardSubagentText: true,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: [
        'You are running the Online Optimizer production-migration AgentTeam.',
        'Use project subagents registered in the SDK `agents` option when invoking the Agent tool.',
        'The required teammate subagent types are closed-loop-optimization-quality-agent, closed-loop-optimization-rd-agent, and closed-loop-optimization-process-agent.',
        'All team coordination must persist to task artifacts, not just this chat.'
      ].join('\n')
    },
    settings: {
      permissions: {
        allow: [
          'Bash(npm run optimize:team*)',
          'Bash(npm run agentteam:validate*)',
          'Bash(node scripts/optimization/validate-team-workspace.mjs*)',
          'Bash(node .claude/skills/closed-loop-optimizer/scripts/validate-campaign.mjs*)',
          'Bash(npm run sim:mcp:smoke*)'
        ]
      }
    },
    env: {
      ...process.env,
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS || '1',
      ONLINE_OPTIMIZER_AGENTTEAM_MODE: 'claude_sdk_subagents'
    },
    allowedTools: [
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'LS',
      'Agent',
      'WebFetch',
      'WebSearch'
    ],
    title: 'Online Optimizer Claude SDK AgentTeam'
  };

  console.log(JSON.stringify({
    sdk_team_start: true,
    mode: 'claude_sdk_subagents',
    main_agent: options.agent,
    team_roster: teamRoster,
    agent_files: agentFiles,
    product_grade: args.productGrade || null,
    max_iters: args.maxIters,
    seed: args.seed
  }, null, 2));

  const sdkQuery = query({
    prompt,
    options
  });

  for await (const message of sdkQuery) {
    if (message?.type === 'result') {
      const resultText = message.result ?? '';
      process.stdout.write(resultText);
      if (resultText && !resultText.endsWith('\n')) process.stdout.write('\n');
    } else if (message?.type === 'assistant' && message.message?.content) {
      for (const part of message.message.content) {
        if (part?.type === 'text' && part.text) {
          process.stdout.write(part.text);
          if (!part.text.endsWith('\n')) process.stdout.write('\n');
        }
      }
    }
  }

  if (args.goalText) {
    const taskRoot = path.join(process.cwd(), 'workspace', 'optimization-tasks');
    if (fs.existsSync(taskRoot)) {
      const latestTaskDir = fs.readdirSync(taskRoot)
        .map((name) => path.join(taskRoot, name))
        .filter((fullPath) => fs.statSync(fullPath).isDirectory())
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      if (latestTaskDir) {
        const runtimeFile = path.join(latestTaskDir, 'orchestrator_runtime.json');
        const current = fs.existsSync(runtimeFile)
          ? JSON.parse(fs.readFileSync(runtimeFile, 'utf8'))
          : {};
        fs.writeFileSync(runtimeFile, JSON.stringify({
          ...current,
          launch_mode: 'claude_sdk',
          reasoning_mode: args.reasoningMode,
          agentteam_mode: 'claude_sdk_subagents',
          main_agent: 'closed-loop-optimization-orchestrator',
          team_roster: teamRoster,
          agent_files: agentFiles,
          product_grade: args.productGrade || current.product_grade || null,
          goal_text: args.goalText,
          claude_sdk: {
            max_turns: args.maxTurns,
            permission_mode: args.permissionMode,
            model: args.model || null,
            max_iters: args.maxIters,
            seed: args.seed
          },
          updated_at: new Date().toISOString()
        }, null, 2) + '\n');
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
