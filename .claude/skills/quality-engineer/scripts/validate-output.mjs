import fs from 'node:fs';

const REQUIRED = [
  'quality_state',
  'primary_quality_gap',
  'metric_evaluations',
  'process_risk_summary',
  'history_signal_summary',
  'decision_context',
  'strategy_recommendation'
];

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) fail('missing_file_path');
if (!fs.existsSync(filePath)) fail(`file_not_found:${filePath}`);

const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const missing = REQUIRED.filter((key) => parsed[key] === undefined);
if (missing.length > 0) fail(`missing_fields:${missing.join(',')}`);

console.log(JSON.stringify({ ok: true, role: 'quality-engineer', file: filePath }, null, 2));
