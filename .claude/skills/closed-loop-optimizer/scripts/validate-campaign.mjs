import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REQUIRED_FILES = [
  '00_objective/orchestrator_goal_request.json',
  '00_objective/goal_interpretation.json',
  '00_objective/product_target.json',
  '06_recipe/recipe_release_recommendation.json',
  'campaign_ledger.jsonl',
  'run_summary.json',
  'report.md'
];

const REPRESENTATIVE_SCHEMAS = [
  ['schemas/optimization/orchestrator_goal_request_schema.json', '00_objective/orchestrator_goal_request.json'],
  ['schemas/optimization/quality_diagnosis_schema.json', '02_quality/quality_diagnosis_001.json'],
  ['schemas/optimization/rd_optimization_plan_schema.json', '03_rd_plan/rd_optimization_plan_001.json'],
  ['schemas/optimization/parameter_delta_proposal_schema.json', '04_execution/parameter_delta_proposal_001.json'],
  ['schemas/optimization/safety_gate_result_schema.json', '04_execution/safety_gate_result_001.json'],
  ['schemas/optimization/strategy_state_schema.json', '07_coordination/strategy_state_001.json'],
  ['schemas/optimization/approval_packet_schema.json', '07_coordination/approval_packet_001.json'],
  ['schemas/optimization/coordination_index_schema.json', '07_coordination/coordination_index.json'],
  ['schemas/optimization/recipe_release_recommendation_schema.json', '06_recipe/recipe_release_recommendation.json']
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--run-dir') args.runDir = argv[++i];
  }
  return args;
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function validateSchema(schema, dataPath) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['.claude/skills/industrial-deep-diagnostic/scripts/validate.mjs', schema, dataPath],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.runDir) {
    console.error('Missing --run-dir');
    process.exit(1);
  }

  const runDir = path.resolve(args.runDir);
  const failures = [];
  const warnings = [];

  for (const relativePath of REQUIRED_FILES) {
    if (!exists(path.join(runDir, relativePath))) failures.push(`missing:${relativePath}`);
  }

  const validationJobs = REPRESENTATIVE_SCHEMAS
    .map(([schema, relativeData]) => ({ schema, relativeData, dataPath: path.join(runDir, relativeData) }))
    .filter((job) => {
      if (!exists(job.dataPath)) {
        warnings.push(`skip_schema_missing_data:${job.relativeData}`);
        return false;
      }
      return true;
    });

  const validationResults = await Promise.all(
    validationJobs.map(async (job) => ({ ...job, result: await validateSchema(job.schema, job.dataPath) }))
  );

  for (const job of validationResults) {
    if (job.result.status !== 0) {
      failures.push(`schema_invalid:${job.relativeData}`);
      if (job.result.stdout) warnings.push(job.result.stdout);
      if (job.result.stderr) warnings.push(job.result.stderr);
    }
  }

  let summary = null;
  const summaryPath = path.join(runDir, 'run_summary.json');
  if (exists(summaryPath)) summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

  const report = {
    run_dir: runDir,
    valid: failures.length === 0,
    final_quality_state: summary?.final_quality_state ?? null,
    final_loss: summary?.final_loss ?? null,
    candidate_recipe_id: summary?.recommendation?.candidate_recipe_id ?? null,
    checked_schema_count: validationResults.length,
    evidence_root_present: exists(path.join(runDir, '08_trial_evidence')),
    failures,
    warnings
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
