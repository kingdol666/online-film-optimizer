import { McpClient } from './mcp-client.mjs';
import { decideApprovalMode } from './approval-hooks.mjs';
import { WebSocketOnlineLineAdapter, shouldUseOnlineProvider } from './online-line-adapter.mjs';

const MCP_TOOLS = [
  'film_line_reset',
  'film_line_get_state',
  'film_line_get_snapshot',
  'film_line_get_online_quality',
  'film_line_get_ledger',
  'film_line_list_writable_parameters',
  'film_line_run_until_stable',
  'film_line_preview_proposal',
  'film_line_apply_proposal',
  'film_line_rollback',
  'film_line_save_candidate_recipe'
];

class SimulatedLineAdapter {
  constructor({ config, cwd, goalRequest }) {
    this.config = config;
    this.goalRequest = goalRequest;
    this.client = new McpClient({ cwd, ensureServices: true });
  }

  async start() {
    await this.client.start();
    await this.client.assertReady(MCP_TOOLS);
  }

  async stop() {
    await this.client.stop();
  }

  async reset() {
    return this.client.callTool('film_line_reset', {
      campaignId: this.goalRequest.campaign_id,
      productGrade: this.goalRequest.product_grade
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

  async runUntilStable(params) {
    return this.client.callTool('film_line_run_until_stable', params);
  }

  async previewProposal(proposal) {
    return this.client.callTool('film_line_preview_proposal', { proposal });
  }

  async checkSafetyGate(proposal) {
    return this.previewProposal(proposal);
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
    return { snapshot, quality };
  }
}

export function createLineAdapter({ config, cwd, goalRequest }) {
  if (shouldUseOnlineProvider({ config, goalRequest })) {
    return new WebSocketOnlineLineAdapter({ config, goalRequest });
  }
  return new SimulatedLineAdapter({ config, cwd, goalRequest });
}
