import fs from 'node:fs';
import path from 'node:path';

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function bestRecipeMemoryPath(runDir) {
  return path.join(runDir, '07_coordination', 'best_recipe_memory.json');
}

export function initializeBestRecipeMemory(runDir, baseline) {
  const filePath = bestRecipeMemoryPath(runDir);
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, {
      active_baseline_recipe_id: baseline.recipe_id,
      active_baseline_source: 'campaign_reset',
      best_observed_recipe: baseline,
      best_history: [baseline],
      updated_at: new Date().toISOString()
    });
  }
  return filePath;
}

export function readBestRecipeMemory(runDir) {
  return readJson(bestRecipeMemoryPath(runDir));
}

export function updateBestRecipeMemory(runDir, updater) {
  const current = readBestRecipeMemory(runDir);
  const next = updater(current);
  next.updated_at = new Date().toISOString();
  writeJson(bestRecipeMemoryPath(runDir), next);
  return next;
}
