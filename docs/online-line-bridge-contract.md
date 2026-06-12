# Online Line Bridge Contract

This project treats the real production line as an external online bridge service.
The optimizer never talks to PLC/DCS/MES/database systems directly. It sends
standard WebSocket request/response messages to your bridge server, and that
server owns plant-specific drivers, database clients, write approval, and tag
mapping.

## Runtime Selection

Default mode is simulated MCP.

Real online mode is selected only when:

- `LINE_PROVIDER=real-line`
- online config is enabled by `ONLINE_ENABLED=true` or by a configured `online.ws_url`
- at least one transport is configured: `PROCESS_WS_URL` or `online.ws_url`

If no online bridge is configured, the optimizer falls back to simulated MCP.
If `REQUIRE_ONLINE_BRIDGE=true`, missing or failed bridge connection is fatal.

## Request Envelope

Every WebSocket message from optimizer to bridge uses this envelope:

```json
{
  "protocol_version": "online-line-bridge.v1",
  "kind": "request",
  "request_id": "REQ-...",
  "action": "line.snapshot",
  "source": "online-optimizer",
  "line_id": "bopet-pilot-line-01",
  "campaign_id": "CMP-...",
  "product_grade": "BOPET_NEW_GRADE_A",
  "timestamp": "2026-06-11T10:00:00.000Z",
  "timeout_ms": 10000,
  "payload": {},
  "context": {
    "goal_request_id": "REQ-...",
    "execution_mode": "semi_auto",
    "provider": "real-line"
  }
}
```

## Response Envelope

The bridge must answer with the same `request_id`.

```json
{
  "protocol_version": "online-line-bridge.v1",
  "kind": "response",
  "request_id": "REQ-...",
  "action": "line.snapshot",
  "line_id": "bopet-pilot-line-01",
  "ok": true,
  "data": {},
  "timestamp": "2026-06-11T10:00:01.000Z",
  "meta": {
    "source": "dcs-gateway"
  }
}
```

Error response:

```json
{
  "protocol_version": "online-line-bridge.v1",
  "kind": "response",
  "request_id": "REQ-...",
  "action": "line.apply_proposal",
  "ok": false,
  "error": {
    "code": "write_rejected",
    "message": "approval packet was not approved by shift supervisor"
  }
}
```

## Required Actions

`line.heartbeat`

- Purpose: connectivity and capability check.
- Payload: `{ "capabilities": ["snapshot", "inspection", "write"] }`
- Response data: `{ "ok": true, "capabilities": ["snapshot", "inspection", "historian", "safety", "approval", "write", "recipe"] }`

`line.reset`

- Purpose: initialize an optimization campaign or attach to an existing batch.
- Payload: `{ "campaign_id": "...", "product_grade": "..." }`
- Response data: compact state or snapshot.

`line.compact_state`

- Purpose: current line state for dashboards and waste/recipe summary.
- Response data must include `campaign_id`, `experiment_id`, `recipe_id`, `line_state`, `alarm_active`, `setpoints`.

`line.snapshot`

- Purpose: process values and setpoints.
- Response data must match `schemas/optimization/process_snapshot_schema.json`.

`line.online_quality`

- Purpose: online inspection result.
- Response data must match `schemas/optimization/online_quality_map_schema.json`.

`line.writable_parameters`

- Purpose: list writable parameters and safety limits.
- Response data: array of `{ tag, current, min, max, max_delta_per_action, max_ramp_per_min, writable }`.

`line.run_until_stable`

- Purpose: wait for a stable window after a write or before diagnosis.
- Payload: `{ "minStableTicks": 8, "maxTicks": 50 }`
- Response data: `{ "stable": true, "window_id": "...", "start": "...", "end": "...", "snapshot": {}, "online_quality": {} }`

`line.safety_preview`

- Purpose: deterministic plant-side safety gate.
- Payload: `{ "proposal": { "setpoint_changes": [] } }`
- Response data must match `schemas/optimization/safety_gate_result_schema.json`.

`line.request_approval`

- Purpose: optional enterprise approval integration.
- Payload: `{ "proposal": {}, "safety_gate": {}, "strategy_state": {}, "local_decision": {} }`
- Response data: `{ "manual_approval_required": true, "default_status": "pending|approved|rejected", "approval_status": "pending|approved|rejected", "approval_source": "mes|operator|shift-lead" }`

`line.apply_proposal`

- Purpose: write approved parameter changes.
- Payload: `{ "proposal": {} }`
- Response data: `{ "executed": true, "write_confirmed": true, "before_setpoints": {}, "after_setpoints": {}, "timestamp": "..." }`

`line.rollback_recipe`

- Purpose: recover to best observed rollback baseline.
- Payload: `{ "reason": "recover_to_best_observed_recipe" }`
- Response data: `{ "rolled_back": true, "before_setpoints": {}, "after_setpoints": {}, "timestamp": "..." }`

`line.load_recipe_baseline`

- Purpose: sync the best observed recipe as rollback baseline.
- Payload: `{ "recipe_id": "...", "setpoints": {}, "reason": "sync best observed recipe as rollback baseline" }`
- Response data: `{ "loaded": true, "baseline_synced": true, "rollback_recipe": "..." }`

`line.save_candidate_recipe`

- Purpose: persist final recipe into recipe/MES store.
- Payload: `{ "recipe_id": "...", "metadata": {} }`
- Response data: `{ "recipe_id": "...", "setpoints": {}, "saved_at": "..." }`

`line.historian_window`

- Purpose: pull historian/database data for reports or future model learning.
- Payload: `{ "start": "...", "end": "...", "tags": [] }`
- Response data: `{ "samples": [], "source": "historian|database" }`

`line.database_query`

- Purpose: optional read-only database query hook, usually hidden behind bridge-side allowlists.
- Payload: `{ "query_id": "quality_last_24h", "params": {} }`
- Response data: bridge-defined JSON object.

## Recommended Bridge Server Shape

Your production bridge server should expose:

- WebSocket endpoint, for example `ws://line-gateway:19081/ws/online-line`.
- Optional HTTP fallback endpoint `POST /api/online-line/action`.
- A tag-map layer from optimizer parameter names to PLC/DCS tags.
- A safety layer that rejects unknown tags, out-of-bound writes, unstable line state, missing rollback recipe, and stale snapshot writes.
- An approval layer that returns `pending` unless the request is already approved by MES/operator policy.
- A historian/database layer with allowlisted query IDs rather than arbitrary SQL from the optimizer.

The optimizer receives only standardized process/quality/write receipts. It
does not need to know whether the bridge uses OPC UA, Modbus, REST, SQL, PI,
MES APIs, or lab systems internally.
