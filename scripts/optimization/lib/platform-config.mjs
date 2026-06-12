import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  ports: {
    backend: 4317,
    frontend: 5418,
    simulator: 8877
  },
  orchestrator: {
    provider: 'simulated-line',
    execution_mode: 'semi_auto',
    reasoning_mode: 'deterministic',
    auto_approve_simulator: true,
    approval_poll_ms: 1500,
    max_approval_wait_ms: 15 * 60 * 1000,
    max_consecutive_worse: 4,
    max_strategy_cycles: 36,
    production_campaign: {
      enabled: true,
      run_until_goal: true,
      max_trial_count: 36,
      max_strategy_cycles: 36,
      max_runtime_minutes: 480,
      pass_hold_iterations: 3,
      stable_recipe_hold_minutes: 30,
      shadow_validation_required: true,
      physics_constraints_enabled: true,
      spc_diagnosis_enabled: true,
      historian_window_minutes: 120,
      hard_stop_on_alarm: true,
      hard_stop_on_sensor_failure: true
    },
    process_iterations_per_strategy_cycle: {
      explore: 3,
      exploit: 4,
      recover: 2
    },
    no_progress_replan_threshold: {
      explore: 2,
      exploit: 2,
      recover: 1
    },
    review_cadence: 1,
    claude: {
      command: process.env.CLAUDE_CLI_PATH || 'claude',
      model: process.env.CLAUDE_MODEL || 'sonnet',
      effort: process.env.CLAUDE_EFFORT || 'medium',
      max_budget_usd: numberFromEnv(process.env.CLAUDE_MAX_BUDGET_USD, 2),
      enabled_roles: ['quality', 'rd', 'process']
    },
    stage_switch: {
      exploit_effective_count: 1,
      exploit_loss_threshold: 0.5,
      recover_worse_count: 4,
      recover_sensor_health: ['DEGRADED']
    },
    cadence: {
      quality_deep_review_every: {
        explore: 2,
        exploit: 3,
        recover: 1
      },
      rd_full_replan_every: {
        explore: 1,
        exploit: 2,
        recover: 1
      },
      settle_minutes: {
        explore: 10,
        exploit: 8,
        recover: 12
      },
      before_window_bias_ticks: 1,
      products: {
        PET: {
          quality_deep_review_every: { explore: 2, exploit: 2, recover: 1 },
          rd_full_replan_every: { explore: 1, exploit: 2, recover: 1 },
          settle_minutes: { explore: 14, exploit: 12, recover: 16 },
          before_window_bias_ticks: 2
        },
        PPAT: {
          quality_deep_review_every: { explore: 2, exploit: 2, recover: 1 },
          rd_full_replan_every: { explore: 1, exploit: 1, recover: 1 },
          settle_minutes: { explore: 12, exploit: 10, recover: 14 },
          before_window_bias_ticks: 2
        },
        PMMA: {
          quality_deep_review_every: { explore: 2, exploit: 3, recover: 1 },
          rd_full_replan_every: { explore: 1, exploit: 2, recover: 1 },
          settle_minutes: { explore: 11, exploit: 9, recover: 13 },
          before_window_bias_ticks: 1
        },
        PVA: {
          quality_deep_review_every: { explore: 2, exploit: 2, recover: 1 },
          rd_full_replan_every: { explore: 1, exploit: 2, recover: 1 },
          settle_minutes: { explore: 11, exploit: 9, recover: 13 },
          before_window_bias_ticks: 1
        }
      }
    },
    stable_window: {
      explore: { before: { minStableTicks: 6, maxTicks: 40 }, after: { minStableTicks: 8, maxTicks: 40 } },
      exploit: { before: { minStableTicks: 8, maxTicks: 50 }, after: { minStableTicks: 10, maxTicks: 50 } },
      recover: { before: { minStableTicks: 6, maxTicks: 40 }, after: { minStableTicks: 8, maxTicks: 50 } }
    },
    hooks: {
      approval: 'file-based',
      inspection: 'simulator-inline',
      historian: 'simulator-inline',
      write: 'simulator-mcp',
      safety: 'simulator-mcp',
      reporting: 'local-filesystem'
    }
  },
  online: {
    ws_url: process.env.PROCESS_WS_URL || '',
    http_url: process.env.PROCESS_HTTP_URL || '',
    historian_url: process.env.HISTORIAN_URL || '',
    db_url: process.env.ONLINE_DB_URL || '',
    line_id: process.env.LINE_ID || 'default-line',
    timeout_ms: numberFromEnv(process.env.PROCESS_WS_TIMEOUT_MS, 10000),
    reconnect_ms: numberFromEnv(process.env.PROCESS_WS_RECONNECT_MS, 3000),
    require_online: boolFromEnv(process.env.REQUIRE_ONLINE_BRIDGE, false),
    enabled: boolFromEnv(process.env.ONLINE_ENABLED, false),
    hooks: {
      inspection: 'websocket',
      historian: 'websocket',
      approval: 'websocket',
      write: 'websocket',
      safety: 'websocket',
      database: 'websocket'
    },
    action_contract: {
      websocket_request_response: true,
      http_fallback_path: '/api/online-line/action'
    }
  }
};

function boolFromEnv(value, fallback) {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mergeObject(base, override) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeObject(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function loadPlatformConfig({
  projectRoot = process.cwd()
} = {}) {
  const configFile = path.resolve(projectRoot, process.env.PLATFORM_CONFIG || 'config/online-line.config.json');
  const fileConfig = readJsonIfExists(configFile);
  const mergedDefaults = mergeObject(DEFAULTS, fileConfig);
  const backend = Number(process.env.BACKEND_PORT || mergedDefaults.ports.backend);
  const frontend = Number(process.env.FRONTEND_PORT || mergedDefaults.ports.frontend);
  const simulator = Number(process.env.SIM_PORT || mergedDefaults.ports.simulator);
  const provider = process.env.LINE_PROVIDER || mergedDefaults.orchestrator.provider;
  const executionMode = process.env.EXECUTION_MODE || mergedDefaults.orchestrator.execution_mode;
  const reasoningMode = process.env.ORCHESTRATOR_REASONING_MODE || mergedDefaults.orchestrator.reasoning_mode;
  const productionCampaign = {
    ...mergedDefaults.orchestrator.production_campaign,
    enabled: boolFromEnv(
      process.env.PRODUCTION_CAMPAIGN_ENABLED,
      mergedDefaults.orchestrator.production_campaign?.enabled ?? true
    ),
    run_until_goal: boolFromEnv(
      process.env.RUN_UNTIL_GOAL,
      mergedDefaults.orchestrator.production_campaign?.run_until_goal ?? true
    ),
    max_trial_count: numberFromEnv(
      process.env.PRODUCTION_MAX_TRIALS,
      mergedDefaults.orchestrator.production_campaign?.max_trial_count ?? 36
    ),
    max_strategy_cycles: numberFromEnv(
      process.env.PRODUCTION_MAX_STRATEGY_CYCLES,
      mergedDefaults.orchestrator.production_campaign?.max_strategy_cycles ?? 12
    ),
    max_runtime_minutes: numberFromEnv(
      process.env.PRODUCTION_MAX_RUNTIME_MINUTES,
      mergedDefaults.orchestrator.production_campaign?.max_runtime_minutes ?? 480
    ),
    pass_hold_iterations: numberFromEnv(
      process.env.PRODUCTION_PASS_HOLD_ITERATIONS,
      mergedDefaults.orchestrator.production_campaign?.pass_hold_iterations ?? 3
    ),
    stable_recipe_hold_minutes: numberFromEnv(
      process.env.PRODUCTION_STABLE_RECIPE_HOLD_MINUTES,
      mergedDefaults.orchestrator.production_campaign?.stable_recipe_hold_minutes ?? 30
    )
  };
  const autoApproveSimulator = boolFromEnv(
    process.env.AUTO_APPROVE_SIMULATOR,
    mergedDefaults.orchestrator.auto_approve_simulator
  );
  const onlineEnabled = boolFromEnv(
    process.env.ONLINE_ENABLED,
    Boolean(mergedDefaults.online.enabled || mergedDefaults.online.ws_url || mergedDefaults.online.http_url)
  );

  return {
    ...mergedDefaults,
    project_root: path.resolve(projectRoot),
    runtime_dir: path.resolve(projectRoot, 'workspace', 'runtime'),
    config_file: configFile,
    ports: { backend, frontend, simulator },
    orchestrator: {
      ...mergedDefaults.orchestrator,
      provider,
      execution_mode: executionMode,
      reasoning_mode: reasoningMode,
      production_campaign: productionCampaign,
      auto_approve_simulator: autoApproveSimulator
    },
    online: {
      ...mergedDefaults.online,
      enabled: onlineEnabled,
      ws_url: process.env.PROCESS_WS_URL || mergedDefaults.online.ws_url,
      http_url: process.env.PROCESS_HTTP_URL || mergedDefaults.online.http_url,
      historian_url: process.env.HISTORIAN_URL || mergedDefaults.online.historian_url,
      db_url: process.env.ONLINE_DB_URL || mergedDefaults.online.db_url,
      line_id: process.env.LINE_ID || mergedDefaults.online.line_id,
      timeout_ms: numberFromEnv(process.env.PROCESS_WS_TIMEOUT_MS, mergedDefaults.online.timeout_ms),
      reconnect_ms: numberFromEnv(process.env.PROCESS_WS_RECONNECT_MS, mergedDefaults.online.reconnect_ms),
      require_online: boolFromEnv(process.env.REQUIRE_ONLINE_BRIDGE, mergedDefaults.online.require_online)
    }
  };
}
