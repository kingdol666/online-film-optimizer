import fs from 'node:fs';
import path from 'node:path';

function readStdin() {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
  });
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    payload = {
      parse_error: true,
      raw: raw.slice(0, 2000)
    };
  }

  const event = {
    timestamp: new Date().toISOString(),
    hook_event_name: payload.hook_event_name || process.env.CLAUDE_HOOK_EVENT || 'unknown',
    cwd: payload.cwd || process.cwd(),
    agent_type: payload.agent_type || null,
    agent_id: payload.agent_id || null,
    tool_name: payload.tool_name || payload.tool?.name || null,
    command: payload.tool_input?.command || payload.tool?.input?.command || null,
    status: payload.status || payload.tool_response?.status || null
  };

  const runtimeDir = path.join(process.cwd(), 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.appendFileSync(
    path.join(runtimeDir, 'agentteam-hooks.jsonl'),
    JSON.stringify(event) + '\n'
  );

  process.stdout.write(JSON.stringify({
    continue: true,
    suppressOutput: true
  }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    continue: true,
    suppressOutput: true,
    hook_error: error.message
  }));
});
