import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition
} from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  ConfigProvider,
  Descriptions,
  Divider,
  Empty,
  InputNumber,
  Layout,
  List,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message
} from 'https://esm.sh/antd@5.27.6';
import {
  ApartmentOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ControlOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FieldTimeOutlined,
  FireOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined
} from 'https://esm.sh/@ant-design/icons@5.6.1';
import {
  Bubble,
  Conversations,
  Sender,
  ThoughtChain,
  Welcome,
  XProvider
} from 'https://esm.sh/@ant-design/x@2.8.0';

const html = htm.bind(React.createElement);

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const apiBase = 'http://127.0.0.1:4317/api';

const launchModeOptions = [
  { value: 'claude_sdk', label: 'Claude SDK Team' },
  { value: 'team_deterministic', label: 'Deterministic Team' },
  { value: 'team_claude_cli', label: 'Claude CLI Team' },
  { value: 'single_campaign', label: 'Single Campaign' }
];

const roleLabelMap = {
  'team-lead': '总编排',
  'quality-engineer': '质量 Agent',
  'rd-engineer': '研发 Agent',
  'process-engineer': '工艺 Agent'
};

const statusColorMap = {
  PASS: 'success',
  PASS_BEST_OBSERVED: 'processing',
  WARNING: 'warning',
  ERROR: 'error'
};

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data.data;
}

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function roleToBubbleRole(role) {
  if (role === 'team-lead') return 'system';
  if (role === 'process-engineer') return 'user';
  return 'ai';
}

function buildMetricRows(metrics = {}) {
  return Object.entries(metrics).map(([key, value]) => ({
    key,
    metric: key,
    value: typeof value === 'number' ? value.toFixed(4) : String(value)
  }));
}

function buildSetpointRows(setpoints = {}) {
  return Object.entries(setpoints).map(([key, value]) => ({
    key,
    tag: key,
    value: typeof value === 'number' ? value : String(value)
  }));
}

function buildThoughtChain(task, orchestrator) {
  const summary = task?.latestCampaign?.runSummary || task?.taskSummary?.run_summary || {};
  const runtime = task?.runtime || task?.taskSummary?.runtime || {};
  const strategy = task?.latestCampaign?.strategyState || orchestrator?.latestRun?.latestStrategyState || {};
  const approval = task?.latestCampaign?.approvalPacket || orchestrator?.latestRun?.latestApprovalPacket || {};
  const stage = strategy.stage || summary.final_strategy_stage || 'explore';
  const goalReached = Boolean(summary.goal_reached);

  return [
    {
      key: 'goal',
      title: '目标解释',
      description: summary.goal_text || runtime.goal_text || '暂无目标',
      content: goalReached
        ? '当前任务已经达到目标窗口，并冻结最佳 recipe。'
        : '系统仍在围绕当前研发目标进行阶段性收敛。',
      status: goalReached ? 'success' : 'loading',
      collapsible: true
    },
    {
      key: 'strategy',
      title: '阶段策略',
      description: `阶段：${stage}`,
      content: `主导杠杆：${strategy.dominant_lever || '待识别'}，切换原因：${strategy.transition_reason || summary.stopped_reason || '持续优化中'}`,
      status: summary.final_quality_state === 'WARNING' ? 'error' : 'success',
      collapsible: true
    },
    {
      key: 'execution',
      title: '执行治理',
      description: `审批状态：${approval.approval_status || 'n/a'}`,
      content: approval.proposal?.setpoint_changes?.length
        ? prettyJson(approval.proposal.setpoint_changes)
        : '当前没有待执行参数包。',
      status: approval.approval_status === 'approved' ? 'success' : 'loading',
      collapsible: true
    },
    {
      key: 'release',
      title: '发布准备',
      description: `release：${task?.finalRecipe?.release_status || task?.bestRecipe?.release_status || 'candidate'}`,
      content: (task?.finalRecipe?.validation_required_before_release || task?.bestRecipe?.required_before_release || [])
        .join(' / ') || '等待真实产线 shadow validation',
      status: goalReached ? 'success' : 'loading',
      collapsible: true
    }
  ];
}

function buildBubbleItems(task) {
  const messages = task?.teamMessagesTail || [];
  return messages.map((messageItem, index) => {
    const role = messageItem.role || messageItem.actor || 'team-lead';
    const stage = messageItem.stage || messageItem.payload?.stage || 'team';
    const summary = messageItem.summary || messageItem.payload?.summary || messageItem.kind || '-';
    const inputs = messageItem.inputs || messageItem.payload?.inputs || [];
    const outputs = messageItem.outputs || messageItem.payload?.outputs || [];

    return {
      key: messageItem.message_id || `${role}-${index}`,
      role: roleToBubbleRole(role),
      content: html`
        <div className="bubble-content">
          <div className="bubble-title-row">
            <span className="bubble-role">${roleLabelMap[role] || role}</span>
            <span className="bubble-stage">${stage}</span>
          </div>
          <div className="bubble-summary">${typeof summary === 'string' ? summary : prettyJson(summary)}</div>
          ${(inputs.length || outputs.length) && html`
            <div className="bubble-io">
              ${inputs.length ? html`<div><strong>输入</strong> ${inputs.slice(0, 3).join(' / ')}</div>` : null}
              ${outputs.length ? html`<div><strong>输出</strong> ${outputs.slice(0, 3).join(' / ')}</div>` : null}
            </div>
          `}
        </div>
      `,
      placement: role === 'process-engineer' ? 'end' : 'start'
    };
  });
}

function buildConversationItems(task) {
  const latestMessages = task?.teamMessagesTail || [];
  const latestByRole = new Map();
  latestMessages.forEach((item) => {
    const role = item.role || item.actor || 'team-lead';
    latestByRole.set(role, item);
  });
  return Array.from(latestByRole.entries()).map(([role, item]) => ({
    key: role,
    group: role === 'team-lead' ? '指挥层' : '部门层',
    label: html`
      <div className="conversation-item">
        <div className="conversation-title">${roleLabelMap[role] || role}</div>
        <div className="conversation-subtitle">${item.summary || item.kind || '待更新'}</div>
      </div>
    `,
    icon: role === 'team-lead'
      ? html`<${ApartmentOutlined} />`
      : role === 'quality-engineer'
        ? html`<${SafetyCertificateOutlined} />`
        : role === 'rd-engineer'
          ? html`<${ExperimentOutlined} />`
          : html`<${ControlOutlined} />`
  }));
}

function JsonPanel({ title, data, extra = null }) {
  return html`
    <${Card} className="glass-card compact-card" title=${title} extra=${extra}>
      <pre className="json-block">${prettyJson(data)}</pre>
    </${Card}>
  `;
}

function App() {
  const [overview, setOverview] = useState(null);
  const [orchestrator, setOrchestrator] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const [runDetail, setRunDetail] = useState(null);
  const [products, setProducts] = useState([]);
  const [goalText, setGoalText] = useState('请完成对 PMMA 产线的优化：使得双折射波动下降4%，并输出最终recipe');
  const [productGrade, setProductGrade] = useState('PMMA_FILM_GRADE_A');
  const [launchMode, setLaunchMode] = useState('claude_sdk');
  const [previewTag, setPreviewTag] = useState('');
  const [previewTarget, setPreviewTarget] = useState(0);
  const [previewResult, setPreviewResult] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState('team-lead');
  const [booting, setBooting] = useState(true);
  const [refreshing, startRefresh] = useTransition();

  const deferredTaskDetail = useDeferredValue(taskDetail);
  const selectedProduct = useMemo(
    () => products.find((item) => item.product_grade === productGrade) || null,
    [products, productGrade]
  );

  const writableParameters = overview?.writableParameters || [];
  const currentRuntime = deferredTaskDetail?.runtime || deferredTaskDetail?.taskSummary?.runtime || {};
  const currentSummary = deferredTaskDetail?.latestCampaign?.runSummary || deferredTaskDetail?.taskSummary?.run_summary || {};
  const currentRecipe = deferredTaskDetail?.finalRecipe || deferredTaskDetail?.bestRecipe || {};
  const currentMetrics = overview?.quality?.metrics || currentRecipe.metrics || currentSummary.best_observed?.metrics || {};
  const bubbleItems = useMemo(() => buildBubbleItems(deferredTaskDetail), [deferredTaskDetail]);
  const conversationItems = useMemo(() => buildConversationItems(deferredTaskDetail), [deferredTaskDetail]);
  const thoughtChainItems = useMemo(
    () => buildThoughtChain(deferredTaskDetail, orchestrator),
    [deferredTaskDetail, orchestrator]
  );

  useEffect(() => {
    if (!previewTag && writableParameters.length) {
      setPreviewTag(writableParameters[0].tag);
      setPreviewTarget(writableParameters[0].current);
    }
  }, [previewTag, writableParameters]);

  async function refreshAll() {
    startRefresh(async () => {
      const [overviewData, orchestratorData, latestTask] = await Promise.all([
        request('/simulator/overview'),
        request('/orchestrator/status'),
        request('/orchestrator/tasks/latest').catch(() => null)
      ]);

      setOverview(overviewData);
      setOrchestrator(orchestratorData);

      const resolvedTask = latestTask?.taskId
        ? await request(`/orchestrator/tasks/${encodeURIComponent(latestTask.taskId)}`).catch(() => latestTask)
        : latestTask;

      setTaskDetail(resolvedTask);

      const runId = resolvedTask?.latestCampaign?.runSummary?.run_id
        || orchestratorData?.latestRun?.runId
        || orchestratorData?.activeRun?.latestRun?.runId
        || null;

      if (runId) {
        const detail = await request(`/orchestrator/runs/${runId}`).catch(() => null);
        setRunDetail(detail);
      } else {
        setRunDetail(null);
      }
    });
  }

  useEffect(() => {
    let disposed = false;
    async function boot() {
      try {
        const productsData = await request('/simulator/products');
        if (!disposed) setProducts(productsData || []);
        await refreshAll();
      } catch (error) {
        message.error(error.message);
      } finally {
        if (!disposed) setBooting(false);
      }
    }
    boot();
    const timer = setInterval(() => {
      refreshAll().catch(() => {});
    }, 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  async function runGoal(messageText) {
    const payload = {
      goalText: messageText || goalText,
      productGrade,
      goalRequest: { product_grade: productGrade },
      launchMode,
      reasoningMode: launchMode === 'team_claude_cli' ? 'claude_cli' : 'deterministic',
      maxIters: 12,
      seed: 20260611
    };
    await request('/orchestrator/run', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    message.success('闭环任务已启动');
    await refreshAll();
  }

  async function handlePreview() {
    if (!previewTag) return;
    const result = await request('/simulator/preview-setpoints', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: `UI-${Date.now()}`,
        sourcePlan: 'antd_console_preview',
        changes: [{ tag: previewTag, target: Number(previewTarget) }]
      })
    });
    setPreviewResult(result);
    message.success('已完成 safety gate 预览');
  }

  async function handleApply() {
    if (!previewTag) return;
    const result = await request('/simulator/apply-setpoints', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: `UI-${Date.now()}`,
        sourcePlan: 'antd_console_apply',
        changes: [{ tag: previewTag, target: Number(previewTarget) }]
      })
    });
    setPreviewResult(result);
    message.success('参数已应用到模拟工况');
    await refreshAll();
  }

  async function callRunControl(action) {
    const runId = deferredTaskDetail?.latestCampaign?.runSummary?.run_id
      || currentSummary.run_id
      || runDetail?.runId;
    if (!runId) {
      message.warning('当前没有可控制的运行实例');
      return;
    }
    await request(`/orchestrator/runs/${runId}/${action}`, {
      method: 'POST',
      body: JSON.stringify(
        action === 'approve'
          ? { approvalStatus: 'approved', approver: 'antd-console', note: 'approved from ant design console' }
          : {}
      )
    });
    message.success(`已执行 ${action}`);
    await refreshAll();
  }

  async function callSimulator(action, payload = {}) {
    await request(`/simulator/${action}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    message.success(`已执行 ${action}`);
    await refreshAll();
  }

  const productNoteBlock = selectedProduct
    ? html`
        <div className="product-note-panel">
          <div className="product-note-head">
            <${Tag} color="cyan">${selectedProduct.material_family}</${Tag}>
            <span>${selectedProduct.display_name}</span>
          </div>
          <div className="product-note-copy">
            ${(selectedProduct.process_notes || []).slice(0, 3).map((note) => html`<p key=${note}>${note}</p>`)}
          </div>
        </div>
      `
    : null;

  if (booting && !overview) {
    return html`
      <div className="boot-screen">
        <${Spin} size="large" />
        <div>正在加载闭环优化控制台...</div>
      </div>
    `;
  }

  return html`
    <${ConfigProvider}
      theme=${{
        token: {
          colorPrimary: '#1677ff',
          colorBgBase: '#09111f',
          colorTextBase: '#e8eef8',
          borderRadius: 18,
          fontFamily: '"IBM Plex Sans", "PingFang SC", sans-serif'
        }
      }}
    >
      <${XProvider}>
        <${Layout} className="console-shell">
          <${Sider} width=${360} className="console-sider">
            <div className="brand-zone">
              <div className="brand-topline">Closed-Loop Optimization Command</div>
              <${Title} level=${2} className="brand-title">Online Optimizer</${Title}>
              <${Paragraph} className="brand-copy">
                用户只需要输入研发目标，平台自动编排质量、研发、工艺三类 Agent 协同闭环优化。
              </${Paragraph}>
            </div>

            <${Card} className="glass-card sidebar-card" bordered=${false}>
              <div className="section-kicker">任务入口</div>
              <${Space} direction="vertical" size=${14} style=${{ width: '100%' }}>
                <div>
                  <div className="field-label">加工产品 / 材料型号</div>
                  <${Select}
                    value=${productGrade}
                    onChange=${(value) => setProductGrade(value)}
                    options=${products.map((item) => ({ value: item.product_grade, label: item.display_name }))}
                    style=${{ width: '100%' }}
                    size="large"
                  />
                </div>
                ${productNoteBlock}
                <div>
                  <div className="field-label">启动模式</div>
                  <${Select}
                    value=${launchMode}
                    onChange=${(value) => setLaunchMode(value)}
                    options=${launchModeOptions}
                    style=${{ width: '100%' }}
                    size="large"
                  />
                </div>
                <div>
                  <div className="field-label">研发目标 / 目标性能</div>
                  <${Sender}
                    value=${goalText}
                    onChange=${(nextValue) => setGoalText(nextValue)}
                    onSubmit=${(submitted) => runGoal(submitted || goalText)}
                    loading=${Boolean(orchestrator?.activeRun?.status === 'running')}
                    placeholder="例如：请完成对 PMMA 产线的优化：使得双折射波动下降5%，并输出最终recipe"
                    autoSize=${{ minRows: 5, maxRows: 9 }}
                    submitType="enter"
                    header=${html`
                      <div className="sender-header-row">
                        <${Tag} icon=${html`<${RobotOutlined} />`} color="blue">AgentTeam</${Tag}>
                        <${Tag} icon=${html`<${ApiOutlined} />`} color="gold">MCP Ready</${Tag}>
                      </div>
                    `}
                  />
                </div>
                <${Space} wrap=${true}>
                  <${Button} type="primary" size="large" icon=${html`<${ThunderboltOutlined} />`} onClick=${() => runGoal(goalText)}>
                    启动 Orchestrator
                  </${Button}>
                  <${Button} size="large" icon=${html`<${ReloadOutlined} />`} onClick=${() => callSimulator('reset', { productGrade })}>
                    重置工况
                  </${Button}>
                  <${Button} size="large" onClick=${() => callSimulator('stabilize', { minStableTicks: 6, maxTicks: 40 })}>
                    推进到稳定窗口
                  </${Button}>
                </${Space}>
              </${Space}>
            </${Card}>

            <${Card} className="glass-card sidebar-card" bordered=${false}>
              <div className="section-kicker">执行控制</div>
              <${Space} wrap=${true}>
                <${Button} type="primary" onClick=${() => callRunControl('approve')}>批准</${Button}>
                <${Button} onClick=${() => callRunControl('pause')}>暂停</${Button}>
                <${Button} onClick=${() => callRunControl('resume')}>恢复</${Button}>
                <${Button} danger=${true} onClick=${() => callRunControl('rollback')}>回退</${Button}>
              </${Space}>
            </${Card}>

            <${Card} className="glass-card sidebar-card" bordered=${false}>
              <div className="section-kicker">任务会话</div>
              <${Conversations}
                items=${conversationItems}
                groupable=${true}
                activeKey=${selectedConversation}
                onActiveChange=${(value) => setSelectedConversation(value)}
              />
            </${Card}>
          </${Sider}>

          <${Layout}>
            <${Header} className="console-header">
              <div>
                <div className="header-topline">Enterprise Multi-Agent Control Room</div>
                <${Title} level=${3} className="header-title">真实产线迁移级协同优化工作台</${Title}>
              </div>
              <${Space} size=${14}>
                <${Badge} status=${orchestrator?.activeRun?.status === 'running' ? 'processing' : 'success'} text=${orchestrator?.activeRun?.status || 'idle'} />
                <${Tag} color="geekblue">${currentRuntime.launch_mode || launchMode}</${Tag}>
              </${Space}>
            </${Header}>

            <${Content} className="console-content">
              <${Welcome}
                className="hero-welcome"
                variant="filled"
                icon=${html`<${RadarChartOutlined} />`}
                title="研发目标到最优 Recipe 的全链路闭环控制"
                description="统一查看当前工况、Agent 部门交接、策略阶段、安全门、审批包与最终参数结果，为未来真实 DCS / PLC / MES 适配预留标准边界。"
                extra=${html`
                  <${Space} wrap=${true}>
                    <${Tag} color="processing">Product: ${productGrade}</${Tag}>
                    <${Tag} color="purple">Task: ${deferredTaskDetail?.taskId || 'pending'}</${Tag}>
                    <${Tag} color="gold">Run: ${currentSummary.run_id || 'pending'}</${Tag}>
                  </${Space}>
                `}
              />

              <${Row} gutter=${[18, 18]}>
                <${Col} span=${6}>
                  <${Card} className="stat-card glass-card" bordered=${false}>
                    <${Statistic} title="Line State" value=${overview?.state?.line_state || '-'} prefix=${html`<${DashboardOutlined} />`} />
                  </${Card}>
                </${Col}>
                <${Col} span=${6}>
                  <${Card} className="stat-card glass-card" bordered=${false}>
                    <${Statistic} title="Current Recipe" value=${overview?.state?.recipe_id || currentSummary.best_observed?.recipe_id || '-'} prefix=${html`<${FireOutlined} />`} />
                  </${Card}>
                </${Col}>
                <${Col} span=${6}>
                  <${Card} className="stat-card glass-card" bordered=${false}>
                    <${Statistic} title="Waste Meter" value=${overview?.state?.waste_meter || 0} prefix=${html`<${FieldTimeOutlined} />`} precision=${2} />
                  </${Card}>
                </${Col}>
                <${Col} span=${6}>
                  <${Card} className="stat-card glass-card" bordered=${false}>
                    <${Statistic} title="Strategy Stage" value=${currentSummary.final_strategy_stage || deferredTaskDetail?.latestCampaign?.strategyState?.stage || '-'} prefix=${html`<${ControlOutlined} />`} />
                  </${Card}>
                </${Col}>
              </${Row}>

              <${Row} gutter=${[18, 18]} className="dashboard-row">
                <${Col} span=${15}>
                  <${Card} className="glass-card" bordered=${false} title="Agent 协同消息流" extra=${html`<${Tag} color="cyan">${bubbleItems.length} 条消息</${Tag}>`}>
                    ${bubbleItems.length
                      ? html`
                          <${Bubble.List}
                            items=${bubbleItems}
                            autoScroll=${true}
                            role=${{
                              ai: { placement: 'start', variant: 'borderless' },
                              user: { placement: 'end', variant: 'shadow' },
                              system: { placement: 'start', shape: 'round', variant: 'filled' }
                            }}
                          />
                        `
                      : html`<${Empty} description="暂无团队消息" />`}
                  </${Card}>
                </${Col}>
                <${Col} span=${9}>
                  <${Card} className="glass-card" bordered=${false} title="闭环思维链">
                    <${ThoughtChain} items=${thoughtChainItems} defaultExpandedKeys=${['goal', 'strategy', 'execution']} />
                  </${Card}>
                </${Col}>
              </${Row}>

              <${Row} gutter=${[18, 18]} className="dashboard-row">
                <${Col} span=${10}>
                  <${Card} className="glass-card" bordered=${false} title="在线质量指标">
                    <${Table}
                      size="small"
                      pagination=${false}
                      dataSource=${buildMetricRows(currentMetrics)}
                      columns=${[
                        { title: 'Metric', dataIndex: 'metric', key: 'metric' },
                        { title: 'Value', dataIndex: 'value', key: 'value' }
                      ]}
                    />
                  </${Card}>
                </${Col}>
                <${Col} span=${14}>
                  <${Card} className="glass-card" bordered=${false} title="最终 Recipe">
                    ${currentRecipe?.candidate_recipe_id
                      ? html`
                          <div className="recipe-topline">
                            <div>
                              <div className="section-kicker">Candidate Recipe</div>
                              <${Title} level=${4} className="recipe-title">${currentRecipe.candidate_recipe_id}</${Title}>
                            </div>
                            <${Badge}
                              status=${statusColorMap[currentRecipe.final_quality_state || currentSummary.final_quality_state] || 'processing'}
                              text=${currentRecipe.release_status || 'candidate'}
                            />
                          </div>
                          <${Descriptions} size="small" column=${2} className="recipe-descriptions">
                            <${Descriptions.Item} label="Product">${currentRecipe.product_grade || productGrade}</${Descriptions.Item}>
                            <${Descriptions.Item} label="Goal Reached">${currentRecipe.goal_reached ? 'Yes' : 'No'}</${Descriptions.Item}>
                            <${Descriptions.Item} label="Final Loss">${currentRecipe.final_loss ?? currentSummary.final_loss}</${Descriptions.Item}>
                            <${Descriptions.Item} label="Policy">${currentRecipe.production_use_policy || '-'}</${Descriptions.Item}>
                          </${Descriptions}>
                          <${Divider} />
                          <${Row} gutter=${16}>
                            <${Col} span=${12}>
                              <div className="section-kicker">Setpoints</div>
                              <${Table}
                                size="small"
                                pagination=${false}
                                dataSource=${buildSetpointRows(currentRecipe.setpoints || {})}
                                columns=${[
                                  { title: 'Tag', dataIndex: 'tag', key: 'tag' },
                                  { title: 'Value', dataIndex: 'value', key: 'value' }
                                ]}
                              />
                            </${Col}>
                            <${Col} span=${12}>
                              <div className="section-kicker">Quality Snapshot</div>
                              <${Table}
                                size="small"
                                pagination=${false}
                                dataSource=${buildMetricRows(currentRecipe.metrics || {})}
                                columns=${[
                                  { title: 'Metric', dataIndex: 'metric', key: 'metric' },
                                  { title: 'Value', dataIndex: 'value', key: 'value' }
                                ]}
                              />
                            </${Col}>
                          </${Row}>
                        `
                      : html`<${Empty} description="暂无 Recipe 结果" />`}
                  </${Card}>
                </${Col}>
              </${Row}>

              <${Row} gutter=${[18, 18]} className="dashboard-row">
                <${Col} span=${12}>
                  <${Card} className="glass-card" bordered=${false} title="参数预览 / Safety Gate">
                    <${Space} direction="vertical" size=${14} style=${{ width: '100%' }}>
                      <${Row} gutter=${12}>
                        <${Col} span=${12}>
                          <div className="field-label">参数 Tag</div>
                          <${Select}
                            value=${previewTag}
                            onChange=${(value) => {
                              setPreviewTag(value);
                              const selected = writableParameters.find((item) => item.tag === value);
                              if (selected) setPreviewTarget(selected.current);
                            }}
                            options=${writableParameters.map((item) => ({
                              value: item.tag,
                              label: `${item.tag} [${item.min}, ${item.max}]`
                            }))}
                            style=${{ width: '100%' }}
                          />
                        </${Col}>
                        <${Col} span=${12}>
                          <div className="field-label">目标值</div>
                          <${InputNumber}
                            value=${previewTarget}
                            onChange=${(value) => setPreviewTarget(value ?? 0)}
                            style=${{ width: '100%' }}
                            step=${previewTag.includes('draw_ratio') ? 0.01 : 0.1}
                          />
                        </${Col}>
                      </${Row}>
                      <${Space}>
                        <${Button} onClick=${handlePreview}>预览 Safety Gate</${Button}>
                        <${Button} type="primary" onClick=${handleApply}>直接应用参数</${Button}>
                      </${Space}>
                      ${previewResult
                        ? html`<pre className="json-block">${prettyJson(previewResult)}</pre>`
                        : html`<${Alert} type="info" showIcon=${true} message="尚未预览参数包" />`}
                    </${Space}>
                  </${Card}>
                </${Col}>
                <${Col} span=${12}>
                  <${Card} className="glass-card" bordered=${false} title="任务状态与达成度">
                    <${Space} direction="vertical" size=${16} style=${{ width: '100%' }}>
                      <div className="progress-block">
                        <div className="progress-head">
                          <span>目标达成</span>
                          <strong>${currentSummary.goal_reached ? '100%' : '推进中'}</strong>
                        </div>
                        <${Progress}
                          percent=${currentSummary.goal_reached ? 100 : Math.max(20, Math.min(88, bubbleItems.length * 8))}
                          status=${currentSummary.goal_reached ? 'success' : 'active'}
                          strokeColor=${{ '0%': '#1677ff', '100%': '#8b5cf6' }}
                        />
                      </div>
                      <${Descriptions} size="small" column=${1}>
                        <${Descriptions.Item} label="Task Id">${deferredTaskDetail?.taskId || '-'}</${Descriptions.Item}>
                        <${Descriptions.Item} label="Launch Mode">${currentRuntime.launch_mode || launchMode}</${Descriptions.Item}>
                        <${Descriptions.Item} label="Reasoning">${currentRuntime.reasoning_mode || 'deterministic'}</${Descriptions.Item}>
                        <${Descriptions.Item} label="Stopped Reason">${currentSummary.stopped_reason || '-'}</${Descriptions.Item}>
                        <${Descriptions.Item} label="Evidence Root">${currentSummary.evidence_root || '08_trial_evidence'}</${Descriptions.Item}>
                      </${Descriptions}>
                    </${Space}>
                  </${Card}>
                </${Col}>
              </${Row}>

              <${Collapse}
                className="artifact-collapse"
                items=${[
                  {
                    key: 'summary',
                    label: '任务总览 / task_summary',
                    children: html`<pre className="json-block">${prettyJson(deferredTaskDetail?.taskSummary || {})}</pre>`
                  },
                  {
                    key: 'approval',
                    label: '待审批执行包 / approval packet',
                    children: html`<pre className="json-block">${prettyJson(deferredTaskDetail?.latestCampaign?.approvalPacket || orchestrator?.latestRun?.latestApprovalPacket || {})}</pre>`
                  },
                  {
                    key: 'coordination',
                    label: '标准交接索引 / coordination index',
                    children: html`<pre className="json-block">${prettyJson(deferredTaskDetail?.latestCampaign?.coordinationIndex || orchestrator?.latestRun?.latestCoordinationIndex || {})}</pre>`
                  },
                  {
                    key: 'snapshot',
                    label: '当前快照 / simulator snapshot',
                    children: html`<pre className="json-block">${prettyJson(overview?.snapshot || {})}</pre>`
                  },
                  {
                    key: 'ledger',
                    label: 'MCP / Simulator Ledger',
                    children: html`<pre className="json-block">${prettyJson((overview?.ledger || []).slice(-12))}</pre>`
                  },
                  {
                    key: 'run',
                    label: 'Run Detail',
                    children: html`<pre className="json-block">${prettyJson(runDetail || {})}</pre>`
                  }
                ]}
              />

              ${refreshing
                ? html`<div className="refresh-indicator"><${Spin} size="small" /> 数据刷新中...</div>`
                : null}
            </${Content}>
          </${Layout}>
        </${Layout}>
      </${XProvider}>
    </${ConfigProvider}>
  `;
}

createRoot(document.getElementById('app')).render(html`<${App} />`);
