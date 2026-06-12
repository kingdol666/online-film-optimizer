<template>
  <a-config-provider
    :theme="{
      token: {
        colorPrimary: '#3b82f6',
        borderRadius: 18,
        fontFamily: 'IBM Plex Sans, PingFang SC, sans-serif'
      }
    }"
  >
    <div class="console-shell">
      <aside class="console-sidebar">
        <div class="brand-zone">
          <div class="brand-kicker">Closed-Loop Command</div>
          <h1>Online Optimizer</h1>
          <p>输入研发目标后，系统自动编排质量、研发、工艺三个 Agent 协同完成工艺优化。</p>
        </div>

        <a-card class="glass-card sidebar-card" :bordered="false">
          <template #title>任务入口</template>
          <a-space direction="vertical" :size="14" style="width: 100%">
            <div>
              <div class="field-label">加工产品 / 材料型号</div>
              <a-select
                v-model:value="productGrade"
                :options="productOptions"
                size="large"
                style="width: 100%"
              />
            </div>

            <div v-if="selectedProduct" class="product-note-panel">
              <div class="product-note-title">
                <a-tag color="blue">{{ selectedProduct.material_family }}</a-tag>
                <span>{{ selectedProduct.display_name }}</span>
              </div>
              <p v-for="note in selectedProduct.process_notes?.slice(0, 3) || []" :key="note">
                {{ note }}
              </p>
            </div>

            <div>
              <div class="field-label">启动模式</div>
              <a-select
                v-model:value="launchMode"
                :options="launchModeOptions"
                size="large"
                style="width: 100%"
              />
            </div>

            <div>
              <div class="field-label">研发目标 / 目标性能</div>
              <a-textarea
                v-model:value="goalText"
                :rows="6"
                placeholder="例如：请完成对 PMMA 产线的优化：使得双折射波动下降5%，并输出最终recipe"
              />
            </div>

            <a-space wrap>
              <a-button type="primary" size="large" @click="runGoal">
                启动 Orchestrator
              </a-button>
              <a-button size="large" @click="resetSimulator">重置工况</a-button>
              <a-button size="large" @click="stabilizeLine">推进稳定窗口</a-button>
            </a-space>
          </a-space>
        </a-card>

        <a-card class="glass-card sidebar-card" :bordered="false">
          <template #title>执行控制</template>
          <a-space wrap>
            <a-button type="primary" @click="approveRun">批准</a-button>
            <a-button @click="pauseRun">暂停</a-button>
            <a-button @click="resumeRun">恢复</a-button>
            <a-button danger @click="rollbackRun">回退</a-button>
          </a-space>
        </a-card>

        <a-card class="glass-card sidebar-card" :bordered="false">
          <template #title>实时状态</template>
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="Active Run">
              {{ orchestrator?.activeRun?.status || 'idle' }}
            </a-descriptions-item>
            <a-descriptions-item label="Latest Task">
              {{ latestTask?.taskId || '-' }}
            </a-descriptions-item>
            <a-descriptions-item label="Launch Mode">
              {{ taskRuntime.launch_mode || launchMode }}
            </a-descriptions-item>
            <a-descriptions-item label="Reasoning">
              {{ taskRuntime.reasoning_mode || 'deterministic' }}
            </a-descriptions-item>
            <a-descriptions-item label="Realtime Stream">
              <a-badge :status="streamBadgeStatus" :text="streamStatusLabel" />
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </aside>

      <main class="console-main">
        <section class="hero-panel glass-panel">
          <div>
            <div class="hero-kicker">Enterprise Multi-Agent Workbench</div>
            <h2>真实产线迁移级闭环优化平台</h2>
            <p>
              统一呈现当前工况、策略阶段、三 Agent 交接信息、待审批执行包、在线质量结果和最终 Recipe。
            </p>
          </div>
          <div class="hero-tags">
            <a-tag color="processing">Task {{ latestTask?.taskId || 'pending' }}</a-tag>
            <a-tag color="purple">Run {{ runSummary?.run_id || 'pending' }}</a-tag>
            <a-tag :color="runSummary?.goal_reached ? 'success' : 'gold'">
              {{ runSummary?.goal_reached ? 'Goal Reached' : 'Optimizing' }}
            </a-tag>
          </div>
        </section>

        <section class="stats-grid">
          <a-card class="glass-card stat-card" :bordered="false">
            <a-statistic title="Line State" :value="overview?.state?.line_state || '-'" />
          </a-card>
          <a-card class="glass-card stat-card" :bordered="false">
            <a-statistic title="Recipe" :value="overview?.state?.recipe_id || '-'" />
          </a-card>
          <a-card class="glass-card stat-card" :bordered="false">
            <a-statistic title="Waste Meter" :value="overview?.state?.waste_meter || 0" :precision="2" />
          </a-card>
          <a-card class="glass-card stat-card" :bordered="false">
            <a-statistic title="Strategy Stage" :value="strategyStage" />
          </a-card>
        </section>

        <section class="content-grid cadence-grid">
          <a-card class="glass-card" :bordered="false" title="当前节奏计划">
            <a-descriptions :column="2" size="small">
              <a-descriptions-item label="Quality Review">
                {{ currentCadencePlan?.quality_review_mode || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="RD Cycle">
                {{ currentCadencePlan?.rd_cycle_mode || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="Settle Minutes">
                {{ currentCadencePlan?.process_settle_minutes ?? '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="Bias Ticks">
                {{ currentCadencePlan?.before_window_bias_ticks ?? '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="Product">
                {{ currentCadencePlan?.product_grade || runSummary?.product_grade || productGrade }}
              </a-descriptions-item>
              <a-descriptions-item label="Family">
                {{ currentCadencePlan?.material_family || selectedProduct?.material_family || '-' }}
              </a-descriptions-item>
            </a-descriptions>
            <div class="cadence-note">
              {{ currentCadencePlan?.orchestration_note || '等待节奏计划生成' }}
            </div>
          </a-card>

          <a-card class="glass-card" :bordered="false" title="最近决策趋势">
            <a-timeline v-if="recentDecisionTrail.length">
              <a-timeline-item
                v-for="item in recentDecisionTrail"
                :key="`${item.iteration}-${item.lever}`"
                :color="decisionColor(item.decision)"
              >
                <div class="timeline-role">Iter {{ item.iteration }}</div>
                <div class="timeline-summary">
                  {{ item.lever || '-' }} / {{ item.decision || '-' }}
                </div>
                <div class="timeline-meta">
                  {{ formatSignedPct(item.quality_loss_change_pct) }}
                </div>
              </a-timeline-item>
            </a-timeline>
            <a-empty v-else description="暂无最近决策趋势" />
          </a-card>
        </section>

        <section class="agent-studio-section">
          <a-card class="glass-card agent-studio-card" :bordered="false">
            <template #title>
              <div class="card-title-row">
                <span>AgentTeam 2D 协作现场</span>
                <a-space wrap>
                  <a-tag :color="strategyStage === 'recover' ? 'red' : strategyStage === 'exploit' ? 'blue' : 'green'">
                    {{ strategyStage || 'waiting' }}
                  </a-tag>
                  <a-tag color="cyan">事件绑定 {{ visualTeamEvents.length }}</a-tag>
                </a-space>
              </div>
            </template>

            <div class="agent-studio">
              <div class="studio-map">
                <div class="studio-grid-glow"></div>
                <div
                  v-for="lane in activeMessageLanes"
                  :key="lane.key"
                  class="message-lane"
                  :data-from="lane.from"
                  :data-to="lane.to"
                  :style="lane.style"
                >
                  <span class="message-packet">
                    <span class="packet-icon">{{ lane.icon }}</span>
                  </span>
                  <span class="lane-label">{{ lane.label }}</span>
                </div>

                <button
                  v-for="agent in studioAgents"
                  :key="agent.role"
                  class="studio-agent"
                  :class="`studio-agent-${agent.role}`"
                  :data-role="agent.role"
                  :data-state="agent.state"
                  :data-focused="focusAgent === agent.role"
                  :style="{ left: `${agent.position.x}%`, top: `${agent.position.y}%` }"
                  @click="focusAgent = agent.role"
                >
                  <span class="workspace-halo"></span>
                  <span class="cartoon-agent">
                    <span class="agent-head">
                      <span class="agent-hair"></span>
                      <span class="agent-eye left"></span>
                      <span class="agent-eye right"></span>
                      <span class="agent-mouth"></span>
                    </span>
                    <span class="agent-torso">
                      <span class="agent-badge-icon">{{ agent.icon }}</span>
                    </span>
                    <span class="agent-arm agent-arm-left"></span>
                    <span class="agent-arm agent-arm-right"></span>
                    <span class="agent-desk-tool">{{ agent.toolIcon }}</span>
                  </span>
                  <span class="studio-agent-name">{{ agent.label }}</span>
                  <span class="studio-agent-action">{{ agent.currentAction }}</span>
                </button>

                <div class="studio-center-console">
                  <div class="console-orbit"></div>
                  <div class="console-core">
                    <span>Goal</span>
                    <strong>{{ runSummary?.goal_reached ? '已达成' : '优化中' }}</strong>
                  </div>
                </div>
              </div>

              <div class="studio-side">
                <div class="studio-brief">
                  <div class="field-label">当前团队动作</div>
                  <h3>{{ focusedAgentInfo.label }}</h3>
                  <p>{{ focusedAgentInfo.currentAction }}</p>
                  <a-tag :color="agentStateColor(focusedAgentInfo.state)">
                    {{ agentStateText(focusedAgentInfo.state) }}
                  </a-tag>
                </div>

                <div class="message-console">
                  <div class="field-label">Agent 通信指令黑板</div>
                  <div
                    v-for="event in visualTeamEvents.slice(-5).reverse()"
                    :key="`${event.key}-console`"
                    class="message-console-row"
                    :data-role="event.from"
                  >
                    <div class="message-route">
                      <span>{{ agentMeta[event.from]?.label || event.from }}</span>
                      <span class="route-arrow">→</span>
                      <span>{{ event.to.map((role) => agentMeta[role]?.label || role).join(' / ') }}</span>
                    </div>
                    <div class="message-command">{{ event.actionText || event.summary }}</div>
                    <div class="message-artifacts">
                      {{ compactArtifacts(event.artifactRefs) }}
                    </div>
                  </div>
                  <a-empty v-if="!visualTeamEvents.length" description="等待团队通信" />
                </div>

                <div class="workspace-grid">
                  <div
                    v-for="agent in studioAgents"
                    :key="`${agent.role}-workspace`"
                    class="workspace-card"
                    :data-role="agent.role"
                    :data-focused="focusAgent === agent.role"
                    @click="focusAgent = agent.role"
                  >
                    <div class="workspace-head">
                      <span class="workspace-icon">{{ agent.icon }}</span>
                      <strong>{{ agent.workspaceTitle }}</strong>
                    </div>
                    <p>{{ agent.workspaceDescription }}</p>
                    <div class="workspace-event">
                      {{ agent.lastEvent?.summary || agent.summary || '等待上游交接文件' }}
                    </div>
                    <div class="workspace-artifacts">
                      <a-tag
                        v-for="artifact in agent.artifacts"
                        :key="artifact"
                        size="small"
                      >
                        {{ artifact }}
                      </a-tag>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </a-card>
        </section>

        <section class="content-grid triple-grid">
          <a-card class="glass-card" :bordered="false" title="实时执行脉冲">
            <div class="pulse-stack">
              <div class="pulse-row">
                <span class="field-label">后端事件流</span>
                <a-badge :status="streamBadgeStatus" :text="streamStatusLabel" />
              </div>
              <div class="pulse-row">
                <span class="field-label">最近刷新</span>
                <span>{{ formatTime(lastEventAt) }}</span>
              </div>
              <div class="pulse-row">
                <span class="field-label">活动任务</span>
                <span>{{ latestTask?.taskId || '-' }}</span>
              </div>
              <div class="pulse-row">
                <span class="field-label">活动 Run</span>
                <span>{{ currentRunId() || '-' }}</span>
              </div>
              <div class="pulse-row pulse-row-highlight">
                <span class="field-label">最近事件</span>
                <span class="pulse-strong">{{ latestEvent?.summary || '等待事件' }}</span>
              </div>
              <div v-if="streamError" class="stream-error">
                {{ streamError }}
              </div>
            </div>
          </a-card>

          <a-card class="glass-card" :bordered="false">
            <template #title>Agent 作业看板</template>
            <div class="agent-stageboard">
              <div
                v-for="agent in agentStatuses"
                :key="agent.role"
                class="agent-stagecard"
                :data-role="agent.role"
                :data-state="agent.state"
                :data-focused="focusAgent === agent.role"
                @click="focusAgent = agent.role"
              >
                <div class="agent-avatar-wrap">
                  <div class="agent-avatar" :data-role="agent.role">
                    <span class="agent-face">●</span>
                    <span class="agent-body"></span>
                    <span class="agent-tool"></span>
                  </div>
                  <div class="agent-aura" :data-state="agent.state"></div>
                </div>
                <div class="agent-stagecard-body">
                  <div class="agent-tile-head">
                    <strong>{{ agent.label }}</strong>
                    <a-tag :color="agentStateColor(agent.state)">{{ agentStateText(agent.state) }}</a-tag>
                  </div>
                  <div class="agent-stage">{{ agent.stage || '-' }}</div>
                  <div class="agent-summary">{{ agent.summary || '等待任务' }}</div>
                  <div class="agent-next">{{ agent.nextAction || '暂无下一步说明' }}</div>
                </div>
              </div>
            </div>
          </a-card>

          <a-card class="glass-card" :bordered="false">
            <template #title>
              <div class="card-title-row">
                <span>实时事件流</span>
                <a-segmented
                  v-model:value="eventFilter"
                  size="small"
                  :options="eventFilterOptions"
                />
              </div>
            </template>
            <div class="event-feed">
              <transition-group v-if="filteredEventFeed.length" name="event-pop" tag="div" class="event-feed-list">
                <div
                  v-for="(item, index) in filteredEventFeed"
                  :key="`${item.type}-${item.timestamp || index}`"
                  class="event-feed-item"
                  :data-role="item.role"
                >
                  <div class="event-feed-top">
                    <span class="event-role">{{ roleLabel(item) }}</span>
                    <span class="event-time">{{ formatTime(item.timestamp) }}</span>
                  </div>
                  <div class="event-feed-summary">{{ item.summary || '-' }}</div>
                  <div class="event-feed-stage">{{ item.stage || item.type || '-' }}</div>
                </div>
              </transition-group>
              <a-empty v-else description="等待实时事件" />
            </div>
          </a-card>
        </section>

        <section class="content-grid">
          <a-card class="glass-card" :bordered="false" title="任务总览">
            <a-descriptions :column="2" size="small">
              <a-descriptions-item label="Task Id">{{ latestTask?.taskId || '-' }}</a-descriptions-item>
              <a-descriptions-item label="Product">{{ runSummary?.product_grade || productGrade }}</a-descriptions-item>
              <a-descriptions-item label="Launch Mode">{{ taskRuntime.launch_mode || launchMode }}</a-descriptions-item>
              <a-descriptions-item label="Quality State">{{ runSummary?.final_quality_state || '-' }}</a-descriptions-item>
              <a-descriptions-item label="Stopped Reason">{{ runSummary?.stopped_reason || '-' }}</a-descriptions-item>
              <a-descriptions-item label="Evidence Root">{{ runSummary?.evidence_root || '-' }}</a-descriptions-item>
            </a-descriptions>
            <pre class="json-block">{{ formatJson(latestTask?.taskSummary || {}) }}</pre>
          </a-card>

          <a-card class="glass-card" :bordered="false" title="Agent Team Timeline">
            <a-timeline v-if="teamMessages.length">
              <a-timeline-item
                v-for="(item, index) in teamMessages"
                :key="item.message_id || item.timestamp || index"
                :color="timelineColor(item)"
              >
                <div class="timeline-role">{{ roleLabel(item) }}</div>
                <div class="timeline-summary">{{ item.summary || item.kind || '-' }}</div>
                <div class="timeline-meta">{{ item.stage || item.payload?.stage || '-' }}</div>
              </a-timeline-item>
            </a-timeline>
            <a-empty v-else description="暂无团队消息" />
          </a-card>
        </section>

        <section class="content-grid">
          <a-card class="glass-card" :bordered="false" title="在线质量指标">
            <a-table
              size="small"
              :pagination="false"
              :columns="metricColumns"
              :data-source="metricRows"
              row-key="metric"
            />
          </a-card>

          <a-card class="glass-card" :bordered="false" title="最终 Recipe">
            <template v-if="finalRecipe.candidate_recipe_id">
              <div class="recipe-header">
                <div>
                  <div class="field-label">Candidate Recipe</div>
                  <h3>{{ finalRecipe.candidate_recipe_id }}</h3>
                </div>
                <a-badge
                  :status="runSummary.goal_reached ? 'success' : 'processing'"
                  :text="finalRecipe.release_status || 'candidate'"
                />
              </div>

              <a-progress
                :percent="runSummary.goal_reached ? 100 : 72"
                :status="runSummary.goal_reached ? 'success' : 'active'"
              />

              <a-row :gutter="16" class="recipe-grid">
                <a-col :span="12">
                  <div class="field-label">Setpoints</div>
                  <a-table
                    size="small"
                    :pagination="false"
                    :columns="setpointColumns"
                    :data-source="setpointRows"
                    row-key="tag"
                  />
                </a-col>
                <a-col :span="12">
                  <div class="field-label">Metrics</div>
                  <a-table
                    size="small"
                    :pagination="false"
                    :columns="metricColumns"
                    :data-source="finalMetricRows"
                    row-key="metric"
                  />
                </a-col>
              </a-row>
            </template>
            <a-empty v-else description="暂无最终 Recipe" />
          </a-card>
        </section>

        <section class="content-grid">
          <a-card class="glass-card" :bordered="false" title="参数预览 / Safety Gate">
            <a-space direction="vertical" style="width: 100%" :size="14">
              <a-row :gutter="12">
                <a-col :span="12">
                  <div class="field-label">参数 Tag</div>
                  <a-select
                    v-model:value="previewTag"
                    :options="writableParameterOptions"
                    style="width: 100%"
                    @change="onPreviewTagChange"
                  />
                </a-col>
                <a-col :span="12">
                  <div class="field-label">目标值</div>
                  <a-input-number
                    v-model:value="previewTarget"
                    style="width: 100%"
                    :step="previewStep"
                  />
                </a-col>
              </a-row>
              <a-space wrap>
                <a-button @click="previewSetpoints">预览 Safety Gate</a-button>
                <a-button type="primary" @click="applySetpoints">直接应用参数</a-button>
              </a-space>
              <pre class="json-block">{{ formatJson(previewResult || { message: '尚未预览' }) }}</pre>
            </a-space>
          </a-card>

          <a-card class="glass-card" :bordered="false" title="审批包 / Coordination / Snapshot">
            <a-collapse ghost>
              <a-collapse-panel key="approval" header="Approval Packet">
                <pre class="json-block">{{ formatJson(approvalPacket) }}</pre>
              </a-collapse-panel>
              <a-collapse-panel key="coordination" header="Coordination Index">
                <pre class="json-block">{{ formatJson(coordinationIndex) }}</pre>
              </a-collapse-panel>
              <a-collapse-panel key="snapshot" header="Current Snapshot">
                <pre class="json-block">{{ formatJson(overview?.snapshot || {}) }}</pre>
              </a-collapse-panel>
              <a-collapse-panel key="ledger" header="MCP / Simulator Ledger">
                <pre class="json-block">{{ formatJson((overview?.ledger || []).slice(-12)) }}</pre>
              </a-collapse-panel>
              <a-collapse-panel key="run" header="Run Detail">
                <pre class="json-block">{{ formatJson(runDetail || {}) }}</pre>
              </a-collapse-panel>
            </a-collapse>
          </a-card>
        </section>
      </main>
    </div>
  </a-config-provider>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';

const apiBase = 'http://127.0.0.1:4317/api';
const wsBase = apiBase.replace(/^http/, 'ws').replace(/\/api$/, '/ws/orchestrator');

const launchModeOptions = [
  { value: 'claude_sdk', label: 'Claude SDK Team' },
  { value: 'team_deterministic', label: 'Deterministic Team' },
  { value: 'team_claude_cli', label: 'Claude CLI Team' },
  { value: 'single_campaign', label: 'Single Campaign' }
];

const metricColumns = [
  { title: 'Metric', dataIndex: 'metric', key: 'metric' },
  { title: 'Value', dataIndex: 'value', key: 'value' }
];

const setpointColumns = [
  { title: 'Tag', dataIndex: 'tag', key: 'tag' },
  { title: 'Value', dataIndex: 'value', key: 'value' }
];

const productGrade = ref('PMMA_FILM_GRADE_A');
const launchMode = ref('claude_sdk');
const goalText = ref('请完成对 PMMA 产线的优化：使得双折射波动下降4%，并输出最终recipe');

const products = ref([]);
const overview = ref(null);
const orchestrator = ref(null);
const latestTask = ref(null);
const runDetail = ref(null);
const agentStatusesRef = ref([]);
const eventFeedRef = ref([]);
const stdoutTailRef = ref([]);
const lastEventAt = ref('');
const streamStatus = ref('connecting');
const streamError = ref('');

const previewTag = ref('');
const previewTarget = ref(0);
const previewResult = ref(null);
const focusAgent = ref('team-lead');
const eventFilter = ref('all');
let refreshTimer = null;
let realtimeSocket = null;
let reconnectTimer = null;
let clientPingTimer = null;
let heartbeatWatchTimer = null;
let reconnectAttempts = 0;
let manuallyClosedRealtime = false;
let lastRealtimePongAt = 0;

const clientHeartbeatIntervalMs = 12000;
const clientHeartbeatTimeoutMs = 36000;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...options
    });
  } catch (error) {
    throw new Error(`后端 API 无法连接：${error.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    if (data.code === 'simulator_unavailable') {
      throw new Error('模拟产线服务未启动或不可达，请确认 8877 端口的 simulator 已运行');
    }
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data.data;
}

function formatValue(value) {
  return typeof value === 'number' ? Number(value.toFixed(4)) : value;
}

function formatJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

const selectedProduct = computed(() =>
  products.value.find((item) => item.product_grade === productGrade.value) || null
);

const productOptions = computed(() =>
  products.value.map((item) => ({
    value: item.product_grade,
    label: `${item.material_family} | ${item.display_name}`
  }))
);

const runSummary = computed(() =>
  latestTask.value?.latestCampaign?.runSummary
  || latestTask.value?.taskSummary?.run_summary
  || {}
);

const taskRuntime = computed(() =>
  latestTask.value?.runtime
  || latestTask.value?.taskSummary?.runtime
  || {}
);

const finalRecipe = computed(() =>
  latestTask.value?.finalRecipe
  || latestTask.value?.bestRecipe
  || {}
);

const strategyStage = computed(() =>
  runSummary.value.final_strategy_stage
  || latestTask.value?.latestCampaign?.strategyState?.stage
  || '-'
);

const teamMessages = computed(() => latestTask.value?.teamMessagesTail || []);
const agentStatuses = computed(() => agentStatusesRef.value || []);
const eventFeed = computed(() => {
  const liveFeed = eventFeedRef.value || [];
  if (liveFeed.length) return liveFeed;
  return (stdoutTailRef.value || []).map((line, index) => ({
    type: 'runtime_stdout',
    role: 'team-lead',
    summary: line,
    stage: orchestrator.value?.activeRun?.launchMode || '-',
    timestamp: `${lastEventAt.value || new Date().toISOString()}#${index}`
  }));
});
const latestEvent = computed(() => eventFeed.value.at(-1) || null);
const filteredEventFeed = computed(() => {
  const role = eventFilter.value;
  const roleFiltered = role === 'all'
    ? eventFeed.value
    : eventFeed.value.filter((item) => (item.role || item.actor || 'team-lead') === role);
  return roleFiltered;
});
const eventFilterOptions = computed(() => ([
  { label: '全部', value: 'all' },
  { label: '总编排', value: 'team-lead' },
  { label: '质量', value: 'quality-engineer' },
  { label: '研发', value: 'rd-engineer' },
  { label: '工艺', value: 'process-engineer' }
]));

const agentMeta = {
  'team-lead': {
    label: '总编排',
    icon: '◎',
    toolIcon: '📋',
    workspaceTitle: '调度室',
    workspaceDescription: '拆解目标、安排角色、检查收敛与 recipe 冻结。',
    position: { x: 50, y: 12 },
    artifacts: ['goal_request', 'dispatch_plan', 'run_summary']
  },
  'quality-engineer': {
    label: '质量 Agent',
    icon: 'Q',
    toolIcon: '⌁',
    workspaceTitle: '质量实验台',
    workspaceDescription: '读取稳定窗口、评价指标趋势、给出阶段建议。',
    position: { x: 17, y: 68 },
    artifacts: ['quality_review', 'strategy_state', 'quality_feedback']
  },
  'rd-engineer': {
    label: '研发 Agent',
    icon: 'R',
    toolIcon: '✦',
    workspaceTitle: '研发策略台',
    workspaceDescription: '结合产品知识和响应记忆，生成主假设与候选杠杆。',
    position: { x: 50, y: 78 },
    artifacts: ['rd_plan', 'rd_brief', 'lever_memory']
  },
  'process-engineer': {
    label: '工艺 Agent',
    icon: 'P',
    toolIcon: '⚙',
    workspaceTitle: '工艺控制台',
    workspaceDescription: '把研发策略转成安全门、审批包和 MCP 参数动作。',
    position: { x: 83, y: 68 },
    artifacts: ['proposal', 'safety_gate', 'execution_receipt']
  }
};

function normalizeRole(role) {
  if (!role) return 'team-lead';
  if (role === 'quality') return 'quality-engineer';
  if (role === 'rd') return 'rd-engineer';
  if (role === 'process') return 'process-engineer';
  return agentMeta[role] ? role : 'team-lead';
}

function eventSender(item) {
  return normalizeRole(item?.from || item?.actor || item?.role);
}

function eventRecipients(item) {
  const direct = Array.isArray(item?.to) ? item.to : item?.to ? [item.to] : [];
  const normalized = direct.map(normalizeRole).filter((role) => role !== eventSender(item));
  if (normalized.length) return [...new Set(normalized)];
  const role = normalizeRole(item?.role);
  const sender = eventSender(item);
  if (role !== sender) return [role];
  if (item?.purpose?.includes('quality')) return ['quality-engineer'];
  if (item?.purpose?.includes('rd')) return ['rd-engineer'];
  if (item?.purpose?.includes('process')) return ['process-engineer'];
  return ['team-lead'];
}

function eventActionText(item) {
  const purpose = item?.purpose || item?.kind || item?.type || 'team-event';
  if (purpose.includes('quality')) return '质量评估';
  if (purpose.includes('rd')) return '研发规划';
  if (purpose.includes('process')) return '工艺执行';
  if (purpose.includes('complete')) return '冻结结果';
  if (purpose.includes('intake')) return '任务交接';
  return purpose;
}

const visualTeamEvents = computed(() => {
  const messages = teamMessages.value.length
    ? teamMessages.value
    : eventFeed.value;
  return messages.map((item, index) => {
    const from = eventSender(item);
    const to = eventRecipients(item);
    return {
      ...item,
      key: item.message_id || `${item.kind || item.type || 'event'}-${item.created_at || item.timestamp || index}`,
      from,
      to,
      primaryTo: to[0] || 'team-lead',
      label: eventActionText(item),
      actionText: item.next_action || item.payload?.next_action || eventActionText(item),
      artifactRefs: item.artifact_refs || item.payload?.artifact_refs || [],
      timestamp: item.created_at || item.timestamp || null
    };
  });
});

function latestEventForRole(role) {
  return [...visualTeamEvents.value].reverse().find((item) => (
    item.from === role || item.to.includes(role) || normalizeRole(item.role) === role
  )) || null;
}

const studioAgents = computed(() => {
  const statusMap = Object.fromEntries(agentStatuses.value.map((agent) => [agent.role, agent]));
  return Object.entries(agentMeta).map(([role, meta]) => {
    const status = statusMap[role] || {};
    const lastEvent = latestEventForRole(role);
    return {
      role,
      ...meta,
      state: status.state || (orchestrator.value?.activeRun?.status === 'running' ? 'working' : 'idle'),
      stage: status.stage || strategyStage.value || '-',
      summary: status.summary || lastEvent?.summary || '等待任务',
      nextAction: status.nextAction || lastEvent?.actionText || '',
      currentAction: lastEvent?.actionText || status.nextAction || status.summary || '等待任务',
      lastEvent
    };
  });
});

const focusedAgentInfo = computed(() =>
  studioAgents.value.find((agent) => agent.role === focusAgent.value)
  || studioAgents.value[0]
  || { label: '团队', currentAction: '等待任务', state: 'idle' }
);

function laneGeometry(fromRole, toRole) {
  const from = agentMeta[fromRole]?.position || agentMeta['team-lead'].position;
  const to = agentMeta[toRole]?.position || agentMeta['team-lead'].position;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return {
    left: `${from.x}%`,
    top: `${from.y}%`,
    width: `${length}%`,
    transform: `rotate(${angle}deg)`,
    '--lane-delay': `${Math.abs(dx + dy) % 5 * -0.18}s`
  };
}

const activeMessageLanes = computed(() =>
  visualTeamEvents.value
    .filter((item) => item.from !== item.primaryTo)
    .slice(-7)
    .map((item, index) => ({
      key: `${item.key}-${item.from}-${item.primaryTo}`,
      from: item.from,
      to: item.primaryTo,
      label: item.label,
      icon: agentMeta[item.from]?.icon || '•',
      style: {
        ...laneGeometry(item.from, item.primaryTo),
        '--lane-order': String(index)
      }
    }))
);
const approvalPacket = computed(() =>
  latestTask.value?.latestCampaign?.approvalPacket
  || orchestrator.value?.latestRun?.latestApprovalPacket
  || {}
);
const coordinationIndex = computed(() =>
  latestTask.value?.latestCampaign?.coordinationIndex
  || orchestrator.value?.latestRun?.latestCoordinationIndex
  || {}
);

const currentCadencePlan = computed(() =>
  latestTask.value?.latestCampaign?.latestCadencePlan
  || runDetail.value?.latestCadencePlan
  || latestTask.value?.latestCampaign?.strategyState?.cadence_plan
  || null
);

const recentDecisionTrail = computed(() =>
  latestTask.value?.latestCampaign?.latestQualityReview?.recent_decision_trail
  || latestTask.value?.latestCampaign?.strategyState?.recent_decision_trail
  || []
);

const writableParameterOptions = computed(() =>
  (overview.value?.writableParameters || []).map((item) => ({
    value: item.tag,
    label: `${item.tag} [${item.min}, ${item.max}]`
  }))
);

const previewStep = computed(() => (previewTag.value || '').includes('draw_ratio') ? 0.01 : 0.1);

const metricRows = computed(() =>
  Object.entries(overview.value?.quality?.metrics || finalRecipe.value.metrics || {}).map(([metric, value]) => ({
    metric,
    value: formatValue(value)
  }))
);

const finalMetricRows = computed(() =>
  Object.entries(finalRecipe.value.metrics || runSummary.value.best_observed?.metrics || {}).map(([metric, value]) => ({
    metric,
    value: formatValue(value)
  }))
);

const setpointRows = computed(() =>
  Object.entries(finalRecipe.value.setpoints || runSummary.value.best_observed?.setpoints || {}).map(([tag, value]) => ({
    tag,
    value: formatValue(value)
  }))
);

const streamBadgeStatus = computed(() => {
  if (streamStatus.value === 'connected') return 'processing';
  if (streamStatus.value === 'error') return 'error';
  return 'warning';
});

const streamStatusLabel = computed(() => {
  if (streamStatus.value === 'connected') return '实时接收中';
  if (streamStatus.value === 'error') return '连接异常';
  return '连接中';
});

function roleLabel(item) {
  const role = item.role || item.actor || 'team-lead';
  if (role === 'team-lead') return '总编排';
  if (role === 'quality-engineer') return '质量 Agent';
  if (role === 'rd-engineer') return '研发 Agent';
  if (role === 'process-engineer') return '工艺 Agent';
  return role;
}

function timelineColor(item) {
  const role = item.role || item.actor || 'team-lead';
  if (role === 'quality-engineer') return 'green';
  if (role === 'rd-engineer') return 'blue';
  if (role === 'process-engineer') return 'purple';
  return 'gray';
}

function agentStateColor(state) {
  if (state === 'completed') return 'success';
  if (state === 'working' || state === 'orchestrating') return 'processing';
  if (state === 'awaiting_approval') return 'gold';
  if (state === 'error') return 'error';
  return 'default';
}

function agentStateText(state) {
  if (state === 'completed') return '已完成';
  if (state === 'working') return '执行中';
  if (state === 'orchestrating') return '编排中';
  if (state === 'awaiting_approval') return '待审批';
  if (state === 'error') return '异常';
  return '待命';
}

function decisionColor(decision) {
  if (decision === 'effective') return 'green';
  if (decision === 'worse') return 'red';
  if (decision === 'ineffective') return 'gold';
  return 'blue';
}

function formatSignedPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const num = Number(value);
  const prefix = num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return '-';
  const normalized = String(value).split('#')[0];
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function compactArtifacts(artifacts = []) {
  if (!artifacts.length) return 'artifact_refs: -';
  const names = artifacts
    .slice(0, 3)
    .map((item) => String(item).split('/').pop());
  return `artifact_refs: ${names.join(', ')}${artifacts.length > 3 ? ' ...' : ''}`;
}

function applyRealtimeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  overview.value = snapshot.overview || overview.value;
  orchestrator.value = snapshot.orchestrator || orchestrator.value;
  latestTask.value = snapshot.latestTask || latestTask.value;
  runDetail.value = snapshot.runDetail || runDetail.value;
  agentStatusesRef.value = snapshot.agentStatuses || [];
  eventFeedRef.value = snapshot.eventFeed || [];
  stdoutTailRef.value = snapshot.stdoutTail || [];
  lastEventAt.value = snapshot.timestamp || new Date().toISOString();
}

function cleanupRealtimeSocket() {
  if (realtimeSocket) {
    realtimeSocket.onopen = null;
    realtimeSocket.onmessage = null;
    realtimeSocket.onerror = null;
    realtimeSocket.onclose = null;
    realtimeSocket.close();
    realtimeSocket = null;
  }
  if (clientPingTimer) {
    clearInterval(clientPingTimer);
    clientPingTimer = null;
  }
  if (heartbeatWatchTimer) {
    clearInterval(heartbeatWatchTimer);
    heartbeatWatchTimer = null;
  }
}

function sendRealtimeMessage(payload) {
  if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) return;
  realtimeSocket.send(JSON.stringify(payload));
}

function scheduleRealtimeReconnect() {
  if (manuallyClosedRealtime) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(2000 + reconnectAttempts * 1000, 10000);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    connectRealtimeStream();
  }, delay);
}

function startRealtimeHeartbeat() {
  lastRealtimePongAt = Date.now();
  if (clientPingTimer) clearInterval(clientPingTimer);
  if (heartbeatWatchTimer) clearInterval(heartbeatWatchTimer);
  clientPingTimer = setInterval(() => {
    sendRealtimeMessage({
      type: 'ping',
      data: {
        ts: Date.now(),
        source: 'vue-console'
      }
    });
  }, clientHeartbeatIntervalMs);
  heartbeatWatchTimer = setInterval(() => {
    if (Date.now() - lastRealtimePongAt <= clientHeartbeatTimeoutMs) return;
    streamStatus.value = 'error';
    streamError.value = 'WebSocket 心跳超时，正在重连';
    cleanupRealtimeSocket();
    scheduleRealtimeReconnect();
  }, 5000);
}

function handleRealtimeMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'hello') {
    streamStatus.value = 'connected';
    streamError.value = '';
    return;
  }
  if (message.type === 'ping') {
    lastRealtimePongAt = Date.now();
    sendRealtimeMessage({
      type: 'pong',
      data: {
        ts: Date.now(),
        echo: message.data || null
      }
    });
    return;
  }
  if (message.type === 'pong') {
    lastRealtimePongAt = Date.now();
    return;
  }
  if (message.type === 'orchestrator_snapshot') {
    applyRealtimeSnapshot(message.data);
    streamStatus.value = 'connected';
    streamError.value = '';
    return;
  }
  if (message.type === 'stream_error') {
    streamStatus.value = 'error';
    streamError.value = message.data?.error || 'websocket_stream_error';
  }
}

function connectRealtimeStream() {
  manuallyClosedRealtime = false;
  cleanupRealtimeSocket();
  streamStatus.value = 'connecting';
  streamError.value = '';

  realtimeSocket = new WebSocket(wsBase);
  realtimeSocket.onopen = () => {
    reconnectAttempts = 0;
    streamStatus.value = 'connected';
    streamError.value = '';
    startRealtimeHeartbeat();
    sendRealtimeMessage({ type: 'subscribe_orchestrator', data: { source: 'vue-console' } });
  };
  realtimeSocket.onmessage = (event) => {
    try {
      handleRealtimeMessage(JSON.parse(event.data));
    } catch (error) {
      streamStatus.value = 'error';
      streamError.value = error.message || 'websocket_message_parse_failed';
    }
  };
  realtimeSocket.onerror = () => {
    streamStatus.value = 'error';
    streamError.value = 'WebSocket 实时通道异常，正在等待重连';
  };
  realtimeSocket.onclose = () => {
    if (manuallyClosedRealtime) return;
    streamStatus.value = 'error';
    streamError.value = 'WebSocket 实时通道已断开，正在重连';
    cleanupRealtimeSocket();
    scheduleRealtimeReconnect();
  };
}

async function refreshAll() {
  const [overviewData, orchestratorData, latestTaskData] = await Promise.all([
    request('/simulator/overview'),
    request('/orchestrator/status'),
    request('/orchestrator/tasks/latest').catch(() => null)
  ]);

  overview.value = overviewData;
  orchestrator.value = orchestratorData;

  if (latestTaskData?.taskId) {
    latestTask.value = await request(`/orchestrator/tasks/${encodeURIComponent(latestTaskData.taskId)}`).catch(() => latestTaskData);
  } else {
    latestTask.value = latestTaskData;
  }

  const runId = latestTask.value?.latestCampaign?.runSummary?.run_id
    || orchestratorData?.latestRun?.runId
    || null;

  if (runId) {
    runDetail.value = await request(`/orchestrator/runs/${runId}`).catch(() => null);
  } else {
    runDetail.value = null;
  }

  if (!previewTag.value && overviewData?.writableParameters?.length) {
    previewTag.value = overviewData.writableParameters[0].tag;
    previewTarget.value = overviewData.writableParameters[0].current;
  }
}

async function loadProducts() {
  products.value = await request('/simulator/products');
}

async function runGoal() {
  await request('/orchestrator/run', {
    method: 'POST',
    body: JSON.stringify({
      goalText: goalText.value,
      productGrade: productGrade.value,
      goalRequest: { product_grade: productGrade.value },
      launchMode: launchMode.value,
      reasoningMode: launchMode.value === 'team_claude_cli' ? 'claude_cli' : 'deterministic',
      maxIters: 12,
      seed: 20260611
    })
  });
  message.success('闭环任务已启动');
  await refreshAll();
  connectRealtimeStream();
}

async function resetSimulator() {
  await request('/simulator/reset', {
    method: 'POST',
    body: JSON.stringify({ productGrade: productGrade.value })
  });
  message.success('模拟工况已重置');
  await refreshAll();
}

async function stabilizeLine() {
  await request('/simulator/stabilize', {
    method: 'POST',
    body: JSON.stringify({ minStableTicks: 6, maxTicks: 40 })
  });
  message.success('已推进到稳定窗口');
  await refreshAll();
}

function currentRunId() {
  return latestTask.value?.latestCampaign?.runSummary?.run_id
    || runSummary.value.run_id
    || runDetail.value?.runId
    || null;
}

async function approveRun() {
  const runId = currentRunId();
  if (!runId) return;
  await request(`/orchestrator/runs/${runId}/approve`, {
    method: 'POST',
    body: JSON.stringify({
      approvalStatus: 'approved',
      approver: 'vue-console',
      note: 'approved from vue console'
    })
  });
  message.success('审批已通过');
  await refreshAll();
}

async function pauseRun() {
  const runId = currentRunId();
  if (!runId) return;
  await request(`/orchestrator/runs/${runId}/pause`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  message.success('已暂停');
  await refreshAll();
}

async function resumeRun() {
  const runId = currentRunId();
  if (!runId) return;
  await request(`/orchestrator/runs/${runId}/resume`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  message.success('已恢复');
  await refreshAll();
}

async function rollbackRun() {
  const runId = currentRunId();
  if (!runId) return;
  await request(`/orchestrator/runs/${runId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  message.success('已触发回退');
  await refreshAll();
}

function onPreviewTagChange(value) {
  const item = (overview.value?.writableParameters || []).find((entry) => entry.tag === value);
  if (item) previewTarget.value = item.current;
}

async function previewSetpoints() {
  previewResult.value = await request('/simulator/preview-setpoints', {
    method: 'POST',
    body: JSON.stringify({
      experimentId: `UI-${Date.now()}`,
      sourcePlan: 'vue_console_preview',
      changes: [{ tag: previewTag.value, target: Number(previewTarget.value) }]
    })
  });
  message.success('已完成预览');
}

async function applySetpoints() {
  previewResult.value = await request('/simulator/apply-setpoints', {
    method: 'POST',
    body: JSON.stringify({
      experimentId: `UI-${Date.now()}`,
      sourcePlan: 'vue_console_apply',
      changes: [{ tag: previewTag.value, target: Number(previewTarget.value) }]
    })
  });
  message.success('参数已应用');
  await refreshAll();
}

onMounted(async () => {
  try {
    await loadProducts();
    await refreshAll();
    connectRealtimeStream();
    refreshTimer = setInterval(() => {
      if (streamStatus.value !== 'connected') {
        refreshAll().catch(() => {});
      }
    }, 6000);
  } catch (error) {
    message.error(error.message);
  }
});

onBeforeUnmount(() => {
  manuallyClosedRealtime = true;
  cleanupRealtimeSocket();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});
</script>
