import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isHttpReady(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

export async function isHttpJsonReady(url, validate = null) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return false;
    const data = await response.json();
    return typeof validate === 'function' ? Boolean(validate(data)) : true;
  } catch {
    return false;
  }
}

export async function waitForHttp(url, {
  timeoutMs = 20000,
  intervalMs = 500
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpReady(url)) return true;
    await sleep(intervalMs);
  }
  throw new Error(`service_not_ready:${url}`);
}

export async function ensureProcess({
  healthUrl,
  readinessCheck = null,
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  label
}) {
  const ready = readinessCheck ? await readinessCheck() : await isHttpReady(healthUrl);
  if (ready) {
    return { started: false, label, healthUrl };
  }

  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  if (readinessCheck) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20000) {
      if (await readinessCheck()) {
        return { started: true, label, healthUrl };
      }
      await sleep(500);
    }
    throw new Error(`service_not_ready:${label}`);
  }
  await waitForHttp(healthUrl);
  return { started: true, label, healthUrl };
}

export async function ensurePlatformServices({
  projectRoot,
  backendPort = 4317,
  frontendPort = 5418,
  simPort = 8877,
  ensureFrontend = true
}) {
  const services = [];
  services.push(await ensureProcess({
    label: 'simulator-http',
    healthUrl: `http://127.0.0.1:${simPort}/sim/state`,
    command: process.execPath,
    args: ['simulator/industrial-film-line/server.mjs'],
    cwd: projectRoot,
    env: { ...process.env, SIM_PORT: String(simPort) }
  }));
  services.push(await ensureProcess({
    label: 'backend',
    healthUrl: `http://127.0.0.1:${backendPort}/api/health`,
    readinessCheck: async () => (
      await isHttpJsonReady(`http://127.0.0.1:${backendPort}/api/health`, (data) => data?.success === true)
    ) && (
      await isHttpJsonReady(`http://127.0.0.1:${backendPort}/api/orchestrator/status`, (data) => data?.success === true)
    ),
    command: 'npm',
    args: ['run', 'backend'],
    cwd: projectRoot
  }));
  if (ensureFrontend) {
    services.push(await ensureProcess({
      label: 'frontend',
      healthUrl: `http://127.0.0.1:${frontendPort}`,
      command: 'npm',
      args: ['run', 'frontend'],
      cwd: projectRoot
    }));
  }
  return services;
}
