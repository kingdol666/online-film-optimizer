import fs from 'node:fs';
import path from 'node:path';
import { qualityEngineer } from './role-engines.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--snapshot') args.snapshot = argv[++i];
    else if (arg === '--quality') args.quality = argv[++i];
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--previous-quality') args.previousQuality = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
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
for (const required of ['snapshot', 'quality', 'target']) {
  if (!args[required]) {
    console.error(`Missing --${required.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
    process.exit(1);
  }
}

const diagnosis = qualityEngineer({
  snapshot: readJson(args.snapshot),
  quality: readJson(args.quality),
  target: readJson(args.target),
  previousQuality: args.previousQuality ? readJson(args.previousQuality) : null
});

writeJson(args.output, diagnosis);
