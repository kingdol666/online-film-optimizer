import fs from 'node:fs';
import path from 'node:path';
import { parseGoalText } from './natural-language-goal-parser.mjs';
import { uniqueNowId } from './ids.mjs';
import {
  buildProductTargetTemplate,
  normalizeProductGrade
} from '../../../simulator/industrial-film-line/product-catalog.mjs';

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function inferProductGradeFromText(text = '') {
  const value = String(text || '').toUpperCase();
  if (/\bPMMA\b|亚克力|有机玻璃/.test(value)) return 'PMMA_FILM_GRADE_A';
  if (/\bPPAT\b/.test(value)) return 'PPAT_FILM_GRADE_A';
  if (/\bPVA\b|水溶/.test(value)) return 'PVA_FILM_GRADE_A';
  if (/\bPET\b|\bBOPET\b|聚酯/.test(value)) return 'PET_FILM_GRADE_A';
  return null;
}

export function normalizeGoalRequest({
  goalRequest,
  targetFile,
  projectRoot = process.cwd()
} = {}) {
  const defaultTargetPath = path.resolve(projectRoot, targetFile || 'examples/targets/bopet_new_grade_a.json');
  const fileTemplate = readJson(defaultTargetPath);
  const raw = typeof goalRequest === 'string'
    ? {
        request_id: `REQ-${uniqueNowId()}`,
        user_objective: {
          performance_goal: goalRequest,
          priority_order: [],
          business_context: '',
          release_expectation: 'online candidate with offline validation required'
        }
      }
    : (goalRequest || {});
  const goalTextForInference = raw.goal_text || raw.user_objective?.performance_goal || '';
  const requestedProductGrade = normalizeProductGrade(
    raw.product_grade ||
    raw.productGrade ||
    inferProductGradeFromText(goalTextForInference) ||
    fileTemplate.product_grade ||
    'PET_FILM_GRADE_A'
  );
  const productTemplate = buildProductTargetTemplate(requestedProductGrade);
  const template = deepMerge(fileTemplate, productTemplate);

  const merged = deepMerge(template, raw);
  const requestId = merged.request_id || merged.campaign_id || `REQ-${uniqueNowId()}`;
  const performanceGoal = raw.goal_text || merged.user_objective?.performance_goal || template.user_objective?.performance_goal;
  const parsedGoal = parseGoalText(raw.goal_text || performanceGoal || '');

  return {
    request_id: requestId,
    campaign_id: merged.campaign_id || `${String(requestId).replace(/^REQ-/, 'CMP-')}`,
    product_grade: normalizeProductGrade(merged.product_grade || template.product_grade),
    product_context: merged.product_context || template.product_context || null,
    product_database_ref: merged.product_database_ref || template.product_database_ref || null,
    goal_text: raw.goal_text || performanceGoal,
    user_objective: {
      performance_goal: performanceGoal,
      priority_order: merged.user_objective?.priority_order || template.user_objective?.priority_order || [],
      business_context: merged.user_objective?.business_context || '',
      release_expectation: merged.user_objective?.release_expectation || 'online candidate with offline validation required'
    },
    parsed_goal: parsedGoal,
    targets: merged.targets,
    constraints: {
      ...template.constraints,
      ...(merged.constraints || {})
    },
    execution: {
      manual_approval_required: merged.execution?.manual_approval_required
        ?? merged.constraints?.manual_approval_required
        ?? template.constraints?.manual_approval_required
        ?? false,
      auto_resume_on_approval: merged.execution?.auto_resume_on_approval ?? true,
      provider: merged.execution?.provider || null,
      reasoning_mode: merged.execution?.reasoning_mode || raw.reasoning_mode || null
    },
    stop_criteria: {
      ...parsedGoal.stop_criteria,
      ...(merged.stop_criteria || {})
    },
    target_template: path.relative(projectRoot, defaultTargetPath)
  };
}

export function goalRequestToProductTarget(goalRequest) {
  return {
    campaign_id: goalRequest.campaign_id,
    product_grade: goalRequest.product_grade,
    product_context: goalRequest.product_context || null,
    product_database_ref: goalRequest.product_database_ref || null,
    user_objective: goalRequest.user_objective,
    targets: goalRequest.targets,
    constraints: {
      ...goalRequest.constraints,
      manual_approval_required: Boolean(goalRequest.execution?.manual_approval_required)
    }
  };
}
