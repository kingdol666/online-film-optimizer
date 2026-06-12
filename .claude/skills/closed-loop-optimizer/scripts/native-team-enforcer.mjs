function safeJsonParse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

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

function shouldBlock(command) {
  const normalized = String(command || '').replace(/\s+/g, ' ').trim();
  return (
    /npm run optimize:team\b/.test(normalized)
    || /npm run optimize:claude-sdk\b/.test(normalized)
    || /node scripts\/optimization\/run-team-campaign\.mjs\b/.test(normalized)
    || /node scripts\/optimization\/run-skill-entry\.mjs\b/.test(normalized)
  );
}

async function main() {
  const input = safeJsonParse(await readStdin());
  const toolInput = input.tool_input || {};
  const command = toolInput.command || toolInput.cmd || '';

  if (!shouldBlock(command)) {
    process.stdout.write('{}');
    return;
  }

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'closed-loop-optimizer 已配置为 Claude Code 原生团队编排模式。禁止使用 optimize:team / optimize:claude-sdk / run-team-campaign.mjs / run-skill-entry.mjs 作为对话式优化主路径。请改用 TeamCreate + Agent + SendMessage 组织质量、研发、工艺团队。'
  }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `native team enforcer hook crashed: ${error.message}`
  }));
});
