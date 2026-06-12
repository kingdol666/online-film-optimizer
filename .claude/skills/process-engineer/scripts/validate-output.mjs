import fs from 'node:fs';

const REQUIRED_PROPOSAL = [
  'execution_intent',
  'control_mode',
  'setpoint_changes',
  'rollback_recipe',
  'expected_response'
];

const REQUIRED_SAFETY = [
  'allowed',
  'violations',
  'approval_required',
  'rollback_recipe'
];

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

const proposalPath = process.argv[2];
const safetyPath = process.argv[3];
if (!proposalPath || !safetyPath) fail('missing_proposal_or_safety_path');
if (!fs.existsSync(proposalPath)) fail(`file_not_found:${proposalPath}`);
if (!fs.existsSync(safetyPath)) fail(`file_not_found:${safetyPath}`);

const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
const safety = JSON.parse(fs.readFileSync(safetyPath, 'utf8'));
const missingProposal = REQUIRED_PROPOSAL.filter((key) => proposal[key] === undefined);
const missingSafety = REQUIRED_SAFETY.filter((key) => safety[key] === undefined);

if (missingProposal.length > 0) fail(`missing_proposal_fields:${missingProposal.join(',')}`);
if (missingSafety.length > 0) fail(`missing_safety_fields:${missingSafety.join(',')}`);

console.log(JSON.stringify({
  ok: true,
  role: 'process-engineer',
  proposal: proposalPath,
  safety: safetyPath
}, null, 2));
