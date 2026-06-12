import { spawn } from 'node:child_process';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    goalText: null,
    target: 'examples/targets/bopet_new_grade_a.json',
    maxIters: 12,
    seed: 20260610,
    productGrade: null
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--goal-text') args.goalText = argv[++i];
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--max-iters') args.maxIters = Number(argv[++i]);
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--product-grade') args.productGrade = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.goalText) {
    console.error('Missing --goal-text. Example: --goal-text "请完成对产线的优化：使得双折射波动下降10%，并输出最终recipe"');
    process.exit(1);
  }

  const script = path.resolve('scripts/optimization/run-sim-campaign.mjs');
  const childArgs = [
    script,
    '--target', args.target,
    '--goal-text', args.goalText,
    '--max-iters', String(args.maxIters),
    '--seed', String(args.seed)
  ];
  if (args.productGrade) childArgs.push('--product-grade', args.productGrade);
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  child.on('close', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
