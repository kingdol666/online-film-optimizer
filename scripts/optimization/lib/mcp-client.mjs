import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensurePlatformServices } from './service-guard.mjs';

export class McpClient {
  constructor({
    command = process.execPath,
    args = ['simulator/industrial-film-line/mcp-server.mjs'],
    cwd = process.cwd(),
    ensureServices = true
  } = {}) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.ensureServices = ensureServices;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
  }

  async start() {
    if (this.child) return;
    if (this.ensureServices) {
      await ensurePlatformServices({
        projectRoot: path.resolve(this.cwd),
        backendPort: Number(process.env.BACKEND_PORT || 4317),
        frontendPort: Number(process.env.FRONTEND_PORT || 5418),
        simPort: Number(process.env.SIM_PORT || 8877)
      });
    }
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.#consume();
    });

    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) process.stderr.write(text);
    });

    this.child.on('exit', () => {
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error('MCP server exited unexpectedly'));
      }
      this.pending.clear();
      this.child = null;
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'online-optimizer', version: '1.0.0' }
    });
    this.notify('notifications/initialized', {});
  }

  async stop() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.buffer = Buffer.alloc(0);
  }

  async listTools() {
    const result = await this.request('tools/list');
    return result.tools || [];
  }

  async assertReady(requiredTools = []) {
    const tools = await this.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of requiredTools) {
      if (!names.includes(name)) {
        throw new Error(`mcp_tool_missing:${name}`);
      }
    }
    return names;
  }

  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    const text = result?.content?.[0]?.text;
    return text ? JSON.parse(text) : result;
  }

  notify(method, params = {}) {
    this.#send({ jsonrpc: '2.0', method, params });
  }

  request(method, params = {}) {
    if (!this.child) throw new Error('MCP client not started');
    const id = this.nextId++;
    this.#send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  #send(message) {
    const payload = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
  }

  #consume() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);

      const message = JSON.parse(body);
      if (message.id === undefined) continue;
      const waiter = this.pending.get(message.id);
      if (!waiter) continue;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  }
}
