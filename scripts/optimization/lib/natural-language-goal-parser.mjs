const METRIC_PATTERNS = [
  { metric: 'birefringence_cv', phrases: ['双折射波动', '双折射cv', '双折射CV', 'birefringence cv', 'birefringence_cv'], mode: 'max' },
  { metric: 'thickness_cv', phrases: ['厚度波动', '厚度cv', '厚度CV', 'thickness cv', 'thickness_cv'], mode: 'max' },
  { metric: 'birefringence_mean', phrases: ['双折射均值', '双折射平均', 'birefringence mean', 'birefringence_mean'], mode: 'target' },
  { metric: 'thickness_mean', phrases: ['厚度均值', '厚度平均', '膜厚均值', '膜厚平均', 'thickness mean', 'thickness_mean'], mode: 'target' }
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMetricName(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function parseGoalText(goalText = '') {
  const text = String(goalText || '').trim();
  const directives = [];
  const unsupportedSignals = [];

  for (const config of METRIC_PATTERNS) {
    const phrasePattern = config.phrases.map((item) => escapeRegex(item)).join('|');
    const relativePattern = new RegExp(`(${phrasePattern}).{0,12}?(下降|降低|减少|提升|增加).{0,6}?(\\d+(?:\\.\\d+)?)%`, 'gi');
    const absolutePattern = new RegExp(`(${phrasePattern}).{0,12}?(到|降到|提高到|增加到|不高于|低于|高于|不低于).{0,4}?(\\d+(?:\\.\\d+)?)`, 'gi');

    let match;
    while ((match = relativePattern.exec(text)) !== null) {
      const [, phrase, action, percentText] = match;
      directives.push({
        metric: config.metric,
        metric_mode: config.mode,
        source_text: match[0],
        phrase,
        directive_type: 'relative_percent',
        action,
        percent: Number(percentText),
        direction: /提升|增加/i.test(action) ? 'increase' : 'decrease'
      });
    }

    while ((match = absolutePattern.exec(text)) !== null) {
      const [, phrase, action, absoluteText] = match;
      directives.push({
        metric: config.metric,
        metric_mode: config.mode,
        source_text: match[0],
        phrase,
        directive_type: 'absolute_threshold',
        action,
        absolute_value: Number(absoluteText),
        direction: /提高|增加|高于|不低于/i.test(action) ? 'increase' : 'decrease'
      });
    }
  }

  if (/收缩率|热收缩|雾度|拉伸强度|冲击强度|透光率/.test(text)) {
    unsupportedSignals.push('contains_offline_or_not_modeled_quality_goal');
  }
  if (directives.length === 0 && text) {
    unsupportedSignals.push('no_supported_inline_metric_directive_detected');
  }

  return {
    original_text: text,
    directives,
    unsupported_signals: unsupportedSignals,
    run_mode: 'continuous_goal_seek',
    stop_criteria: {
      run_until_goal: true,
      require_recipe_output: true,
      hard_iteration_cap: 36
    }
  };
}

export function materializeTargetsFromDirectives({
  goalRequest,
  baselineMetrics,
  targetTemplate
}) {
  const parsedGoal = goalRequest.parsed_goal || parseGoalText(goalRequest.goal_text || goalRequest.user_objective?.performance_goal || '');
  const targets = JSON.parse(JSON.stringify(goalRequest.targets || targetTemplate.targets || {}));
  const interpretation = [];

  for (const directive of parsedGoal.directives || []) {
    const metricName = normalizeMetricName(directive.metric);
    const baselineValue = baselineMetrics?.[metricName];
    if (!Number.isFinite(baselineValue) || !targets[metricName]) continue;

    if (directive.metric_mode === 'max') {
      const derivedMax = directive.directive_type === 'relative_percent'
        ? baselineValue * (directive.direction === 'decrease' ? (1 - directive.percent / 100) : (1 + directive.percent / 100))
        : directive.absolute_value;
      targets[metricName].max = Number(derivedMax.toFixed(6));
      interpretation.push({
        metric: metricName,
        applied_as: 'max',
        baseline_value: baselineValue,
        derived_value: targets[metricName].max,
        source_text: directive.source_text
      });
    } else if (directive.metric_mode === 'target') {
      const derivedTarget = directive.directive_type === 'relative_percent'
        ? baselineValue * (directive.direction === 'decrease' ? (1 - directive.percent / 100) : (1 + directive.percent / 100))
        : directive.absolute_value;
      targets[metricName].target = Number(derivedTarget.toFixed(6));
      interpretation.push({
        metric: metricName,
        applied_as: 'target',
        baseline_value: baselineValue,
        derived_value: targets[metricName].target,
        source_text: directive.source_text
      });
    }
  }

  return {
    parsed_goal: parsedGoal,
    targets,
    interpretation
  };
}
