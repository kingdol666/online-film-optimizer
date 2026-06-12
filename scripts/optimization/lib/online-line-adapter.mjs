import { loadPlatformConfig } from './platform-config.mjs';
import { McpClient } from './mcp-client.mjs';
import { decideApprovalMode } from './approval-hooks.mjs';
import {
  ONLINE_ACTIONS,
  assertOnlineResponseOk,
  createOnlineRequest,
  makeBridgeUnavailableReceipt,
  normalizeOnlineResponse
} from './online-bridge-protocol.mjs';

function normalizeWsUrl(url) {
  if (!url) return '';
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  return `ws://${url}`;
}

function normalizeHttpUrl(url) {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWebSocketOpen(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function resolveActionData(data, keys = []) {
  if (!data || typeof data !== 'object') return data;
  for (const key of keys) {
    if (data[key] !== undefined) return data[key];
  }
  return data;
}

class BaseOnlineLineAdapter {
  constructor({ config, goalRequest }) {
    this.config = config;
    this.goalRequest = goalRequest;
  }

  async start() {}
  async stop() {}
  async reset() {}
  async readCompactState() {}
  async readSnapshot() {}
  async readOnlineQuality() {}
  async listWritableParameters() {}
  async runUntilStable() {}
  async previewProposal() {}
  async checkSafetyGate(proposal) {
    return this.previewProposal(proposal);
  }
  async requestApproval() {
    return decideApprovalMode({
      config: this.config,
      goalRequest: this.goalRequest,
      provider: 'real-line'
    });
  }
  async applyApprovedProposal() {}
  async rollbackToRecipe() {}
  async saveCandidateRecipe() {}
  async loadRecipeBaseline() {}
  async readHistorianWindow() {}
}

export class WebSocketOnlineLineAdapter extends BaseOnlineLineAdapter {
  constructor({ config, goalRequest }) {
    super({ config, goalRequest });
    this.wsBaseUrl = normalizeWsUrl(process.env.PROCESS_WS_URL || config.online?.ws_url || '');
    this.httpBaseUrl = normalizeHttpUrl(process.env.PROCESS_HTTP_URL || config.online?.http_url || '');
    this.lineId = process.env.LINE_ID || config.online?.line_id || 'default-line';
    this.requestTimeoutMs = Number(process.env.PROCESS_WS_TIMEOUT_MS || config.online?.timeout_ms || 10_000);
    this.reconnectMs = Number(process.env.PROCESS_WS_RECONNECT_MS || config.online?.reconnect_ms || 3000);
    this.requireOnline = Boolean(config.online?.require_online);
    this.ws = null;
    this.pending = new Map();
    this.started = false;
    this.provider = 'real-line-websocket';
  }

  get configured() {
    return Boolean(this.wsBaseUrl || this.httpBaseUrl);
  }

  async start() {
    if (!this.configured) {
      if (this.requireOnline) throw new Error('online_bridge_not_configured');
      return { started: false, provider: this.provider, fallback_allowed: true };
    }
    this.started = true;
    if (this.wsBaseUrl) {
      await this.#connectWebSocket();
      await this.#request(ONLINE_ACTIONS.HEARTBEAT, {
        capabilities: [
          'snapshot',
          'inspection',
          'historian',
          'safety',
          'approval',
          'write',
          'recipe'
        ]
      }, { allowHttpFallback: false });
    }
    return { started: true, provider: this.provider, transport: this.wsBaseUrl ? 'websocket' : 'http' };
  }

  async stop() {
    this.started = false;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('online_bridge_client_stopped'));
    }
    this.pending.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async reset() {
    return this.#requestData(ONLINE_ACTIONS.RESET, {
      campaign_id: this.goalRequest.campaign_id,
      product_grade: this.goalRequest.product_grade
    }, ['state', 'snapshot']);
  }

  async readCompactState() {
    return this.#requestData(ONLINE_ACTIONS.COMPACT_STATE, {}, ['state', 'compact_state']);
  }

  async readSnapshot() {
    return this.#requestData(ONLINE_ACTIONS.SNAPSHOT, {}, ['snapshot']);
  }

  async readOnlineQuality() {
    return this.#requestData(ONLINE_ACTIONS.ONLINE_QUALITY, {}, ['online_quality', 'quality']);
  }

  async listWritableParameters() {
    return this.#requestData(ONLINE_ACTIONS.WRITABLE_PARAMETERS, {}, ['parameters', 'writable_parameters']);
  }

  async runUntilStable(params = {}) {
    return this.#requestData(ONLINE_ACTIONS.RUN_UNTIL_STABLE, params, ['window']);
  }

  async previewProposal(proposal) {
    return this.#requestData(ONLINE_ACTIONS.SAFETY_PREVIEW, { proposal }, ['safety_gate_result', 'gate']);
  }

  async requestApproval({ proposal, safetyGate, strategyState } = {}) {
    const localDecision = await super.requestApproval();
    if (localDecision.default_status === 'approved' && !safetyGate?.approval_required) return localDecision;
    try {
      const remoteDecision = await this.#requestData(ONLINE_ACTIONS.REQUEST_APPROVAL, {
        proposal,
        safety_gate: safetyGate,
        strategy_state: strategyState,
        local_decision: localDecision
      }, ['approval', 'approval_decision']);
      return {
        ...localDecision,
        ...remoteDecision,
        manual_approval_required: remoteDecision.manual_approval_required ?? localDecision.manual_approval_required,
        default_status: remoteDecision.default_status || remoteDecision.approval_status || localDecision.default_status
      };
    } catch (error) {
      if (this.requireOnline) throw error;
      return {
        ...localDecision,
        default_status: localDecision.manual_approval_required ? 'pending' : localDecision.default_status,
        online_approval_bridge_error: error.message
      };
    }
  }

  async applyApprovedProposal(proposal) {
    return this.#requestData(ONLINE_ACTIONS.APPLY_PROPOSAL, { proposal }, ['receipt', 'execution_receipt']);
  }

  async rollbackToRecipe(reason) {
    return this.#requestData(ONLINE_ACTIONS.ROLLBACK_RECIPE, { reason }, ['receipt', 'rollback_receipt']);
  }

  async saveCandidateRecipe({ recipeId, metadata }) {
    return this.#requestData(ONLINE_ACTIONS.SAVE_CANDIDATE_RECIPE, {
      recipe_id: recipeId,
      recipeId,
      metadata
    }, ['recipe', 'record']);
  }

  async loadRecipeBaseline({ recipeId, setpoints, reason }) {
    return this.#requestData(ONLINE_ACTIONS.LOAD_RECIPE_BASELINE, {
      recipe_id: recipeId,
      recipeId,
      setpoints,
      reason
    }, ['receipt', 'baseline_receipt']);
  }

  async readHistorianWindow(params = {}) {
    return this.#requestData(ONLINE_ACTIONS.HISTORIAN_WINDOW, params, ['historian_window', 'window']);
  }

  async #requestData(action, payload = {}, keys = []) {
    const data = await this.#request(action, payload);
    return resolveActionData(data, keys);
  }

  async #connectWebSocket() {
    if (!this.wsBaseUrl) return;
    if (isWebSocketOpen(this.ws)) return;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsBaseUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`online_bridge_connect_timeout:${this.wsBaseUrl}`));
      }, this.requestTimeoutMs);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });
      ws.addEventListener('message', (event) => this.#handleMessage(event.data));
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`online_bridge_connect_failed:${this.wsBaseUrl}`));
      }, { once: true });
      ws.addEventListener('close', () => {
        if (this.ws === ws) this.ws = null;
        for (const waiter of this.pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error('online_bridge_connection_closed'));
        }
        this.pending.clear();
      });
    });
  }

  async #request(action, payload = {}, { allowHttpFallback = true } = {}) {
    if (!this.configured) {
      throw new Error('online_bridge_not_configured');
    }
    if (this.wsBaseUrl) {
      try {
        await this.#connectWebSocket();
        return await this.#requestViaWebSocket(action, payload);
      } catch (error) {
        if (!allowHttpFallback || !this.httpBaseUrl) throw error;
        await sleep(Math.min(this.reconnectMs, 1000));
      }
    }
    if (this.httpBaseUrl) {
      return this.#requestViaHttp(action, payload);
    }
    throw new Error('online_bridge_transport_unavailable');
  }

  #requestViaWebSocket(action, payload = {}) {
    const request = createOnlineRequest({
      action,
      lineId: this.lineId,
      goalRequest: this.goalRequest,
      payload,
      timeoutMs: this.requestTimeoutMs
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.request_id);
        reject(new Error(`online_bridge_timeout:${action}`));
      }, this.requestTimeoutMs);
      this.pending.set(request.request_id, {
        timer,
        resolve: (response) => resolve(assertOnlineResponseOk(response)),
        reject
      });
      this.ws.send(JSON.stringify(request));
    });
  }

  async #requestViaHttp(action, payload = {}) {
    const request = createOnlineRequest({
      action,
      lineId: this.lineId,
      goalRequest: this.goalRequest,
      payload,
      timeoutMs: this.requestTimeoutMs
    });
    const response = await fetch(`${this.httpBaseUrl}/api/online-line/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    });
    const raw = await response.json();
    if (!response.ok) {
      throw new Error(raw?.error?.message || raw?.error || `online_bridge_http_${response.status}`);
    }
    return assertOnlineResponseOk(normalizeOnlineResponse(raw, request));
  }

  #handleMessage(raw) {
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      return;
    }
    const requestId = parsed.request_id || parsed.id;
    if (!requestId) return;
    const waiter = this.pending.get(requestId);
    if (!waiter) return;
    this.pending.delete(requestId);
    clearTimeout(waiter.timer);
    waiter.resolve(normalizeOnlineResponse(parsed));
  }
}

class SimulatedFallbackAdapter extends BaseOnlineLineAdapter {
  constructor({ config, goalRequest, cwd }) {
    super({ config, goalRequest });
    this.client = new McpClient({ cwd, ensureServices: true });
    this.provider = 'simulated-line-mcp-fallback';
  }

  async start() {
    await this.client.start();
  }

  async stop() {
    await this.client.stop();
  }

  async reset() {
    return this.client.callTool('film_line_reset', {
      campaignId: this.goalRequest?.campaign_id,
      productGrade: this.goalRequest?.product_grade
    });
  }

  async readCompactState() {
    return this.client.callTool('film_line_get_state');
  }

  async readSnapshot() {
    return this.client.callTool('film_line_get_snapshot');
  }

  async readOnlineQuality() {
    return this.client.callTool('film_line_get_online_quality');
  }

  async listWritableParameters() {
    return this.client.callTool('film_line_list_writable_parameters');
  }

  async runUntilStable(params = {}) {
    return this.client.callTool('film_line_run_until_stable', params);
  }

  async previewProposal(proposal) {
    return this.client.callTool('film_line_preview_proposal', { proposal });
  }

  async requestApproval() {
    return decideApprovalMode({
      config: this.config,
      goalRequest: this.goalRequest,
      provider: 'simulated-line'
    });
  }

  async applyApprovedProposal(proposal) {
    return this.client.callTool('film_line_apply_proposal', { proposal });
  }

  async rollbackToRecipe(reason) {
    return this.client.callTool('film_line_rollback', { reason });
  }

  async saveCandidateRecipe({ recipeId, metadata }) {
    return this.client.callTool('film_line_save_candidate_recipe', { recipeId, metadata });
  }

  async loadRecipeBaseline({ recipeId, setpoints, reason }) {
    return this.client.callTool('film_line_load_recipe_baseline', { recipeId, setpoints, reason });
  }

  async readHistorianWindow() {
    const snapshot = await this.readSnapshot();
    const quality = await this.readOnlineQuality();
    return { snapshot, quality, source: 'simulated-mcp-fallback' };
  }
}

export function shouldUseOnlineProvider({ config, goalRequest } = {}) {
  const provider = goalRequest?.execution?.provider || config.orchestrator.provider;
  const onlineConfigured = Boolean(config.online?.enabled && (config.online?.ws_url || config.online?.http_url));
  return provider === 'real-line' && onlineConfigured;
}

export function createRuntimeLineAdapter({ goalRequest, cwd, projectRoot = process.cwd() } = {}) {
  const config = loadPlatformConfig({ projectRoot });
  if (shouldUseOnlineProvider({ config, goalRequest })) {
    return new WebSocketOnlineLineAdapter({ config, goalRequest });
  }
  return new SimulatedFallbackAdapter({ config, goalRequest, cwd });
}
