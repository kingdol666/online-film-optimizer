import fs from 'node:fs';
import path from 'node:path';
import { rdEngineer } from './role-engines.mjs';

function parseArgs(argv) {
  const args = { history: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--diagnosis') args.diagnosis = argv[++i];
    else if (arg === '--snapshot') args.snapshot = argv[++i];
    else if (arg === '--quality') args.quality = argv[++i];
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--history') args.history = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readHistory(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  if (filePath.endsWith('.jsonl')) {
    return raw
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === 'iteration_complete')
      .map((entry) => ({
        iteration: entry.iteration,
        plan: entry.plan,
        proposal: entry.proposal,
        gate: entry.gate,
        experiment_result: entry.experiment_result
      }));
  }
  return readJson(filePath);
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
for (const required of ['diagnosis', 'snapshot', 'quality', 'target']) {
  if (!args[required]) {
    console.error(`Missing --${required}`);
    process.exit(1);
  }
}

const plan = rdEngineer({
  diagnosis: readJson(args.diagnosis),
  snapshot: readJson(args.snapshot),
  quality: readJson(args.quality),
  target: readJson(args.target),
  history: readHistory(args.history)
});

writeJson(args.output, plan);
