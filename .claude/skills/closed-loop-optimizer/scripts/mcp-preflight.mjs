import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MCP_CONFIG_PATH = path.join(PROJECT_ROOT, '.mcp.json');
const OPTIMIZATION_TRIGGER = /(closed-loop|online optimizer|优化|调参|recipe|研发目标|双折射|厚度波动|产线)/i;

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

function inferGoalText(input) {
  return String(
    input.prompt
    || input.user_prompt
    || input.hook_event_input?.prompt
    || input.hook_event_input?.user_prompt
    || input.args
    || ''
  ).trim();
}

function inferProductGrade(goalText) {
  const upper = goalText.toUpperCase();
  if (upper.includes('PPAT')) return 'PPAT_FILM_GRADE_A';
  if (upper.includes('PMMA')) return 'PMMA_FILM_GRADE_A';
  if (upper.includes('PVA')) return 'PVA_FILM_GRADE_A';
  if (upper.includes('PET') || upper.includes('BOPET')) return 'PET_FILM_GRADE_A';
  return '';
}

function shouldRunPreflight(input, goalText) {
  if (input.hook_event_name === 'UserPromptExpansion' && input.command_name === 'closed-loop-optimizer') {
    return true;
  }
  return OPTIMIZATION_TRIGGER.test(goalText);
}

function loadMcpConfig() {
  if (!fs.existsSync(MCP_CONFIG_PATH)) {
    throw new Error('missing_.mcp.json');
  }
  const raw = fs.readFileSync(MCP_CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const server = parsed?.mcpServers?.['industrial-film-line-sim'];
  if (!server?.command) {
    throw new Error('missing_mcp_server:industrial-film-line-sim');
  }
  return server;
}

async function checkBackendHealth() {
  const response = await fetch('http://127.0.0.1:4317/api/health').catch(() => null);
  if (!response?.ok) {
    throw new Error('backend_unreachable:http://127.0.0.1:4317/api/health');
  }
  const payload = await response.json().catch(() => null);
  if (payload?.success !== true) {
    throw new Error('backend_health_failed');
  }
}

function print(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  const input = safeJsonParse(await readStdin());
  const goalText = inferGoalText(input);

  if (!shouldRunPreflight(input, goalText)) {
    print({});
    return;
  }

  loadMcpConfig();
  await checkBackendHealth();
  const productGrade = inferProductGrade(goalText);

  print({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'UserPromptSubmit',
      additionalContext: `已完成 closed-loop-optimizer 入口预热：backend health 正常，.mcp.json 中已配置 industrial-film-line-sim，Claude Code 在第一次 MCP tool 调用时会自动拉起该服务。当前产品型号推断为 ${productGrade || '未指定'}。请继续使用原生 TeamCreate / Agent / SendMessage 组织团队，并让 Process Agent 独占 MCP 写权限。`
    }
  });
}

main().catch((error) => {
  print({
    decision: 'block',
    reason: `closed-loop-optimizer MCP 预热失败：${error.message}`
  });
});
