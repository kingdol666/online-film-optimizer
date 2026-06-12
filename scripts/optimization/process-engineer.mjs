import fs from 'node:fs';
import path from 'node:path';
import { deterministicSafetyGate } from '../../simulator/industrial-film-line/line-simulator.mjs';
import { processEngineer } from './role-engines.mjs';

function parseArgs(argv) {
  const args = { safetyOutput: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan') args.plan = argv[++i];
    else if (arg === '--snapshot') args.snapshot = argv[++i];
    else if (arg === '--campaign-id') args.campaignId = argv[++i];
    else if (arg === '--iteration') args.iteration = Number(argv[++i]);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--safety-output') args.safetyOutput = argv[++i];
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  if (!filePath) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

const args = parseArgs(process.argv);
for (const required of ['plan', 'snapshot', 'campaignId', 'iteration']) {
  if (args[required] === undefined || args[required] === null || args[required] === '') {
    const flag = required.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    console.error(`Missing --${flag}`);
    process.exit(1);
  }
}

const snapshot = readJson(args.snapshot);
const proposal = processEngineer({
  campaignId: args.campaignId,
  iteration: args.iteration,
  plan: readJson(args.plan),
  snapshot
});

writeJson(args.output, proposal);

if (args.safetyOutput) {
  const gate = deterministicSafetyGate({
    proposal,
    snapshot,
    rollbackRecipe: proposal.rollback_recipe
  });
  writeJson(args.safetyOutput, gate);
}
