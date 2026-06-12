import fs from 'node:fs';

const REQUIRED = [
  'objective',
  'hypothesis',
  'control_mode',
  'candidate_parameters',
  'success_criteria',
  'stop_rules',
  'review_focus',
  'strategy_guidance'
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

console.log(JSON.stringify({ ok: true, role: 'rd-engineer', file: filePath }, null, 2));
