import { uniqueNowId } from './ids.mjs';

export const ONLINE_BRIDGE_PROTOCOL_VERSION = 'online-line-bridge.v1';

export const ONLINE_ACTIONS = Object.freeze({
  RESET: 'line.reset',
  COMPACT_STATE: 'line.compact_state',
  SNAPSHOT: 'line.snapshot',
  ONLINE_QUALITY: 'line.online_quality',
  WRITABLE_PARAMETERS: 'line.writable_parameters',
  RUN_UNTIL_STABLE: 'line.run_until_stable',
  SAFETY_PREVIEW: 'line.safety_preview',
  REQUEST_APPROVAL: 'line.request_approval',
  APPLY_PROPOSAL: 'line.apply_proposal',
  ROLLBACK_RECIPE: 'line.rollback_recipe',
  SAVE_CANDIDATE_RECIPE: 'line.save_candidate_recipe',
  LOAD_RECIPE_BASELINE: 'line.load_recipe_baseline',
  HISTORIAN_WINDOW: 'line.historian_window',
  DATABASE_QUERY: 'line.database_query',
  HEARTBEAT: 'line.heartbeat'
});

export function createOnlineRequest({
  action,
  lineId,
  goalRequest,
  payload = {},
  requestId = `REQ-${uniqueNowId()}`,
  timeoutMs = null,
  source = 'online-optimizer'
}) {
  if (!action) throw new Error('online_action_required');
  return {
    protocol_version: ONLINE_BRIDGE_PROTOCOL_VERSION,
    kind: 'request',
    request_id: requestId,
    action,
    source,
    line_id: lineId || 'default-line',
    campaign_id: goalRequest?.campaign_id || null,
    product_grade: goalRequest?.product_grade || null,
    timestamp: new Date().toISOString(),
    timeout_ms: timeoutMs,
    payload,
    context: {
      goal_request_id: goalRequest?.request_id || null,
      execution_mode: goalRequest?.execution?.manual_approval_required ? 'semi_auto' : 'auto_gate',
      provider: goalRequest?.execution?.provider || null
    }
  };
}

export function normalizeOnlineResponse(raw, request) {
  const response = raw && typeof raw === 'object' ? raw : { ok: true, data: raw };
  const ok = response.ok !== false && !response.error;
  return {
    protocol_version: response.protocol_version || ONLINE_BRIDGE_PROTOCOL_VERSION,
    kind: response.kind || 'response',
    request_id: response.request_id || request?.request_id || null,
    action: response.action || request?.action || null,
    line_id: response.line_id || request?.line_id || null,
    ok,
    data: response.data ?? response.result ?? response.payload ?? response,
    error: response.error || null,
    timestamp: response.timestamp || new Date().toISOString(),
    meta: response.meta || {}
  };
}

export function assertOnlineResponseOk(response) {
  if (response?.ok) return response.data;
  const code = response?.error?.code || 'online_bridge_request_failed';
  const message = response?.error?.message || response?.error || code;
  throw new Error(`${code}:${message}`);
}

export function makeBridgeUnavailableReceipt({ provider, reason, action }) {
  return {
    provider,
    action,
    executed: false,
    write_confirmed: false,
    online_bridge_available: false,
    message: reason || 'online bridge is not configured'
  };
}
