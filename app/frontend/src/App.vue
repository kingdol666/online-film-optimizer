<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://127.0.0.1:4317').replace(/\/$/, '');
const MAX_HISTORY = 60;

const overview = ref(null);
const products = ref([]);
const productGrade = ref('PET_FILM_GRADE_A');
const draftTargets = ref({});
const previewResult = ref(null);
const actionMessage = ref('');
const errorMessage = ref('');
const streamStatus = ref('connecting');
const lastUpdatedAt = ref('');
const metricsHistory = ref([]);
const wsClient = ref(null);

const touchedTargets = new Set();

const selectedProduct = computed(() =>
  products.value.find((item) => item.product_grade === productGrade.value) || null
);

const writableParameters = computed(() => overview.value?.writableParameters || []);
const state = computed(() => overview.value?.state || {});
const snapshot = computed(() => overview.value?.snapshot || {});
const quality = computed(() => overview.value?.quality || {});
const metrics = computed(() => quality.value?.metrics || {});
const profiles = computed(() => quality.value?.profiles || {});
const ledger = computed(() => (overview.value?.ledger || []).slice(-8).reverse());
const processValues = computed(() => snapshot.value?.process_values || {});
const hasChanges = computed(() => buildChanges().length > 0);

function labelize(tag) {
  return tag.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatValue(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '--';
}

function formatTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function chartPoints(values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-9);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / span) * 100;
      return `${round(x, 2)},${round(y, 2)}`;
    })
    .join(' ');
}

function profilePoints(values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  return chartPoints(values);
}

function updateHistory(data) {
  const nextPoint = {
    tick: data.state?.tick ?? metricsHistory.value.length,
    thicknessCv: data.quality?.metrics?.thickness_cv ?? null,
    birefringenceCv: data.quality?.metrics?.birefringence_cv ?? null,
    wasteMeter: data.state?.waste_meter ?? null
  };

  const previous = metricsHistory.value[metricsHistory.value.length - 1];
  if (previous && previous.tick === nextPoint.tick) {
    metricsHistory.value = [...metricsHistory.value.slice(0, -1), nextPoint];
    return;
  }

  metricsHistory.value = [...metricsHistory.value, nextPoint].slice(-MAX_HISTORY);
}

function syncDraftTargets(force = false) {
  const next = { ...draftTargets.value };
  for (const item of writableParameters.value) {
    if (force || !(item.tag in next) || !touchedTargets.has(item.tag)) {
      next[item.tag] = item.current;
    }
  }
  draftTargets.value = next;
}

function applyOverview(data) {
  overview.value = data;
  if (data?.state?.product_grade) {
    productGrade.value = data.state.product_grade;
  }
  syncDraftTargets(false);
  updateHistory(data);
  lastUpdatedAt.value = data.snapshot?.timestamp || new Date().toISOString();
}

async function api(path, options = {}) {
  const request = {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  };

  if (options.body === undefined) {
    delete request.headers['content-type'];
  }

  const response = await fetch(`${API_BASE}${path}`, request);
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
  }
  return payload.data;
}

async function loadProducts() {
  products.value = await api('/api/simulator/products');
}

async function loadOverview() {
  const data = await api('/api/simulator/overview');
  applyOverview(data);
}

function buildChanges() {
  return writableParameters.value
    .map((item) => {
      const target = Number(draftTargets.value[item.tag]);
      if (!Number.isFinite(target)) return null;
      if (Math.abs(target - item.current) < 1e-9) return null;
      return {
        tag: item.tag,
        target: round(target, 5)
      };
    })
    .filter(Boolean);
}

function changeCountText() {
  const count = buildChanges().length;
  return count === 0 ? '无待应用改动' : `${count} 项改动待提交`;
}

function inputStep(item) {
  const raw = item.max_delta_per_action / 10;
  if (raw >= 1) return 0.1;
  if (raw >= 0.1) return 0.01;
  return 0.001;
}

function gaugePercent(item) {
  const span = item.max - item.min;
  if (!span) return 0;
  return ((item.current - item.min) / span) * 100;
}

function deltaValue(item) {
  const target = Number(draftTargets.value[item.tag]);
  if (!Number.isFinite(target)) return 0;
  return round(target - item.current, 5);
}

async function runAction(handler) {
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    await handler();
  } catch (error) {
    errorMessage.value = error.message || '操作失败';
  }
}

async function resetSimulator() {
  await runAction(async () => {
    const data = await api('/api/simulator/reset', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: `CMP-${Date.now()}`,
        productGrade: productGrade.value
      })
    });
    touchedTargets.clear();
    previewResult.value = null;
    applyOverview({
      state: data,
      snapshot: overview.value?.snapshot || null,
      quality: overview.value?.quality || null,
      writableParameters: [],
      ledger: []
    });
    await loadOverview();
    syncDraftTargets(true);
    actionMessage.value = '模拟器已重置到新的产品基线。';
  });
}

async function stabilizeLine() {
  await runAction(async () => {
    await api('/api/simulator/stabilize', {
      method: 'POST',
      body: JSON.stringify({ minStableTicks: 6, maxTicks: 40 })
    });
    await loadOverview();
    actionMessage.value = '已推进到稳定窗口。';
  });
}

async function tickLine(count) {
  await runAction(async () => {
    await api('/api/simulator/tick', {
      method: 'POST',
      body: JSON.stringify({ count })
    });
    await loadOverview();
    actionMessage.value = `已推进 ${count} 个 tick。`;
  });
}

async function rollbackLine() {
  await runAction(async () => {
    await api('/api/simulator/rollback', {
      method: 'POST',
      body: JSON.stringify({ reason: 'dashboard rollback' })
    });
    await loadOverview();
    actionMessage.value = '已回退到最近的最佳配方基线。';
  });
}

async function saveCandidateRecipe() {
  await runAction(async () => {
    const recipeId = `RCP-CANDIDATE-${Date.now()}`;
    const result = await api('/api/simulator/recipe/save-candidate', {
      method: 'POST',
      body: JSON.stringify({
        recipeId,
        metadata: {
          source: 'frontend_dashboard',
          product_grade: state.value.product_grade || productGrade.value,
          note: 'saved from runtime console'
        }
      })
    });
    await loadOverview();
    actionMessage.value = `已保存候选 recipe：${result.recipe_id || recipeId}`;
  });
}

async function loadBaselineRecipe() {
  await runAction(async () => {
    const recipeId = state.value.recipe_id || `RCP-BASELINE-${Date.now()}`;
    const result = await api('/api/simulator/recipe/load-baseline', {
      method: 'POST',
      body: JSON.stringify({
        recipeId,
        setpoints: snapshot.value?.setpoints || {},
        reason: 'frontend dashboard load baseline'
      })
    });
    await loadOverview();
    actionMessage.value = result?.baseline_synced
      ? `已回灌基线 recipe：${recipeId}`
      : '基线回灌完成。';
  });
}

async function previewChanges() {
  await runAction(async () => {
    const changes = buildChanges();
    if (!changes.length) {
      previewResult.value = null;
      actionMessage.value = '当前没有任何参数改动。';
      return;
    }
    previewResult.value = await api('/api/simulator/preview-setpoints', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: `EXP-PREVIEW-${Date.now()}`,
        sourcePlan: 'frontend_dashboard_preview',
        changes
      })
    });
    actionMessage.value = '已完成安全预览。';
  });
}

async function applyChanges() {
  await runAction(async () => {
    const changes = buildChanges();
    if (!changes.length) {
      actionMessage.value = '当前没有任何参数改动。';
      return;
    }
    const result = await api('/api/simulator/apply-setpoints', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: `EXP-UI-${Date.now()}`,
        sourcePlan: 'frontend_dashboard_apply',
        changes
      })
    });
    previewResult.value = result;
    touchedTargets.clear();
    await loadOverview();
    syncDraftTargets(true);
    actionMessage.value = result.receipt?.executed
      ? '参数已下发到模拟器。'
      : '参数未执行，请查看安全门结果。';
  });
}

function syncTargetsToCurrent() {
  touchedTargets.clear();
  syncDraftTargets(true);
  previewResult.value = null;
  actionMessage.value = '目标值已同步为当前设定。';
}

function onTargetInput(tag, value) {
  touchedTargets.add(tag);
  draftTargets.value = {
    ...draftTargets.value,
    [tag]: value
  };
}

function wsUrl() {
  if (API_BASE.startsWith('https://')) {
    return `${API_BASE.replace('https://', 'wss://')}/ws/simulator`;
  }
  return `${API_BASE.replace('http://', 'ws://')}/ws/simulator`;
}

function connectWebSocket() {
  const socket = new WebSocket(wsUrl());
  wsClient.value = socket;
  streamStatus.value = 'connecting';

  socket.addEventListener('open', () => {
    streamStatus.value = 'live';
    socket.send(JSON.stringify({ type: 'subscribe_simulator' }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'simulator_snapshot' && message.data) {
      applyOverview(message.data);
      streamStatus.value = 'live';
      return;
    }
    if (message.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', data: message.data || null }));
      return;
    }
    if (message.type === 'stream_error') {
      streamStatus.value = 'error';
      errorMessage.value = message.data?.error || '实时流异常';
    }
  });

  socket.addEventListener('close', () => {
    streamStatus.value = 'offline';
    window.setTimeout(() => {
      if (wsClient.value === socket) connectWebSocket();
    }, 1500);
  });

  socket.addEventListener('error', () => {
    streamStatus.value = 'error';
  });
}

const thicknessTrend = computed(() =>
  metricsHistory.value.map((item) => item.thicknessCv).filter(Number.isFinite)
);
const birefringenceTrend = computed(() =>
  metricsHistory.value.map((item) => item.birefringenceCv).filter(Number.isFinite)
);
const wasteTrend = computed(() =>
  metricsHistory.value.map((item) => item.wasteMeter).filter(Number.isFinite)
);

onMounted(async () => {
  try {
    await loadProducts();
    await loadOverview();
    syncDraftTargets(true);
    connectWebSocket();
  } catch (error) {
    errorMessage.value = error.message || '初始化失败';
  }
});

onBeforeUnmount(() => {
  if (wsClient.value) wsClient.value.close();
});
</script>

<template>
  <div class="page-shell">
    <header class="hero-panel">
      <div>
        <p class="eyebrow">Simulator + Frontend + Backend + MCP</p>
        <h1>Online Optimizer Runtime Console</h1>
        <p class="hero-copy">
          只保留模拟器控制与实时可视化，供前端查看状态，也供 Claude Code 通过 MCP 闭环调优。
        </p>
      </div>

      <div class="hero-status">
        <div class="status-pill" :data-state="streamStatus">
          <span class="status-dot"></span>
          <span>实时流 {{ streamStatus }}</span>
        </div>
        <div class="status-meta">最后更新 {{ formatTime(lastUpdatedAt) }}</div>
      </div>
    </header>

    <section class="top-grid">
      <article class="panel control-panel">
        <div class="panel-head">
          <h2>模拟器控制</h2>
          <span>{{ selectedProduct?.display_name || productGrade }}</span>
        </div>

        <div class="product-grid">
          <label class="field">
            <span>产品型号</span>
            <select v-model="productGrade">
              <option v-for="item in products" :key="item.product_grade" :value="item.product_grade">
                {{ item.display_name }}
              </option>
            </select>
          </label>

          <div class="button-row">
            <button class="primary" @click="resetSimulator">重置基线</button>
            <button @click="stabilizeLine">推进稳定</button>
            <button @click="tickLine(1)">+1 Tick</button>
            <button @click="tickLine(5)">+5 Tick</button>
            <button class="danger" @click="rollbackLine">回退</button>
            <button @click="saveCandidateRecipe">保存候选 Recipe</button>
            <button @click="loadBaselineRecipe">回灌 Baseline</button>
          </div>
        </div>

        <div class="notes-box" v-if="selectedProduct">
          <div class="notes-title">{{ selectedProduct.material_family }} 工艺说明</div>
          <p v-for="note in selectedProduct.process_notes || []" :key="note">{{ note }}</p>
        </div>

        <div class="message-box" v-if="actionMessage">{{ actionMessage }}</div>
        <div class="error-box" v-if="errorMessage">{{ errorMessage }}</div>
      </article>

      <article class="panel summary-panel">
        <div class="panel-head">
          <h2>实时概览</h2>
          <span>{{ state.recipe_id || '--' }}</span>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <span>Line State</span>
            <strong>{{ state.line_state || '--' }}</strong>
          </div>
          <div class="stat-card">
            <span>Tick</span>
            <strong>{{ state.tick ?? '--' }}</strong>
          </div>
          <div class="stat-card">
            <span>Alarm</span>
            <strong>{{ state.alarm_active ? 'ON' : 'OFF' }}</strong>
          </div>
          <div class="stat-card">
            <span>Waste Meter</span>
            <strong>{{ formatValue(state.waste_meter, 2) }}</strong>
          </div>
        </div>

        <div class="metrics-grid">
          <div class="metric-tile">
            <span>Thickness CV</span>
            <strong>{{ formatValue(metrics.thickness_cv, 4) }}</strong>
          </div>
          <div class="metric-tile">
            <span>Birefringence CV</span>
            <strong>{{ formatValue(metrics.birefringence_cv, 4) }}</strong>
          </div>
          <div class="metric-tile">
            <span>Thickness Mean</span>
            <strong>{{ formatValue(metrics.thickness_mean, 4) }}</strong>
          </div>
          <div class="metric-tile">
            <span>Birefringence Mean</span>
            <strong>{{ formatValue(metrics.birefringence_mean, 6) }}</strong>
          </div>
        </div>
      </article>
    </section>

    <section class="chart-grid">
      <article class="panel">
        <div class="panel-head">
          <h2>质量趋势</h2>
          <span>{{ metricsHistory.length }} 个采样点</span>
        </div>
        <div class="trend-stack">
          <div class="chart-card">
            <div class="chart-title">Thickness CV</div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline :points="chartPoints(thicknessTrend)" />
            </svg>
          </div>
          <div class="chart-card">
            <div class="chart-title">Birefringence CV</div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline :points="chartPoints(birefringenceTrend)" />
            </svg>
          </div>
          <div class="chart-card">
            <div class="chart-title">Waste Meter</div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline :points="chartPoints(wasteTrend)" />
            </svg>
          </div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-head">
          <h2>横向质量轮廓</h2>
          <span>{{ snapshot.timestamp ? formatTime(snapshot.timestamp) : '--' }}</span>
        </div>
        <div class="trend-stack">
          <div class="chart-card">
            <div class="chart-title">Thickness Profile</div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline :points="profilePoints(profiles.thickness || [])" />
            </svg>
          </div>
          <div class="chart-card">
            <div class="chart-title">Birefringence Profile</div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline :points="profilePoints(profiles.birefringence || [])" />
            </svg>
          </div>
        </div>
      </article>
    </section>

    <section class="bottom-grid">
      <article class="panel">
        <div class="panel-head">
          <h2>参数调节面板</h2>
          <span>{{ changeCountText() }}</span>
        </div>

        <div class="action-strip">
          <button @click="syncTargetsToCurrent">同步当前值</button>
          <button @click="previewChanges">安全预览</button>
          <button class="primary" :disabled="!hasChanges" @click="applyChanges">应用改动</button>
        </div>

        <div class="parameter-grid">
          <div v-for="item in writableParameters" :key="item.tag" class="parameter-card">
            <div class="parameter-head">
              <strong>{{ labelize(item.tag) }}</strong>
              <span>{{ formatValue(item.current, 3) }}</span>
            </div>

            <div class="parameter-gauge">
              <div class="parameter-gauge-fill" :style="{ width: `${gaugePercent(item)}%` }"></div>
            </div>

            <div class="parameter-meta">
              <span>{{ formatValue(item.min, 3) }}</span>
              <span>delta {{ formatValue(deltaValue(item), 3) }}</span>
              <span>{{ formatValue(item.max, 3) }}</span>
            </div>

            <input
              class="slider"
              type="range"
              :min="item.min"
              :max="item.max"
              :step="inputStep(item)"
              :value="draftTargets[item.tag]"
              @input="onTargetInput(item.tag, Number($event.target.value))"
            />

            <div class="parameter-inputs">
              <input
                type="number"
                :min="item.min"
                :max="item.max"
                :step="inputStep(item)"
                :value="draftTargets[item.tag]"
                @input="onTargetInput(item.tag, Number($event.target.value))"
              />
              <div class="limit-pill">单次最大改动 {{ item.max_delta_per_action }}</div>
            </div>
          </div>
        </div>
      </article>

      <article class="panel side-stack">
        <div>
          <div class="panel-head">
            <h2>安全预览</h2>
            <span>{{ previewResult?.safety_gate_result?.allowed ? 'ALLOWED' : 'PENDING' }}</span>
          </div>
          <div class="preview-card">
            <template v-if="previewResult">
              <div
                class="preview-badge"
                :data-allowed="previewResult.safety_gate_result?.allowed || previewResult.receipt?.safety_gate_result?.allowed"
              >
                {{
                  (previewResult.safety_gate_result?.allowed || previewResult.receipt?.safety_gate_result?.allowed)
                    ? '安全门通过'
                    : '需要处理安全限制'
                }}
              </div>
              <div class="preview-list" v-if="previewResult.proposal?.setpoint_changes?.length">
                <div v-for="change in previewResult.proposal.setpoint_changes" :key="change.tag" class="preview-row">
                  <span>{{ labelize(change.tag) }}</span>
                  <span>{{ formatValue(change.current, 3) }} → {{ formatValue(change.target, 3) }}</span>
                </div>
              </div>
              <div
                v-if="(previewResult.safety_gate_result?.violations || previewResult.receipt?.safety_gate_result?.violations || []).length"
                class="violation-list"
              >
                <div
                  v-for="violation in (previewResult.safety_gate_result?.violations || previewResult.receipt?.safety_gate_result?.violations || [])"
                  :key="violation"
                >
                  {{ violation }}
                </div>
              </div>
            </template>
            <p v-else>先在左侧调整参数，再进行安全预览。</p>
          </div>
        </div>

        <div>
          <div class="panel-head">
            <h2>过程值</h2>
            <span>{{ state.experiment_id || '--' }}</span>
          </div>
          <div class="process-grid">
            <div v-for="(value, key) in processValues" :key="key" class="process-card">
              <span>{{ labelize(key) }}</span>
              <strong>{{ formatValue(value, 3) }}</strong>
            </div>
          </div>
        </div>

        <div>
          <div class="panel-head">
            <h2>最近 Ledger</h2>
            <span>{{ ledger.length }} 条</span>
          </div>
          <div class="ledger-list">
            <div v-for="(entry, index) in ledger" :key="`${entry.type}-${index}`" class="ledger-item">
              <strong>{{ entry.type }}</strong>
              <span>{{ entry.receipt?.timestamp || entry.record?.saved_at || '--' }}</span>
            </div>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
