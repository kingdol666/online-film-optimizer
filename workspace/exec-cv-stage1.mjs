#!/usr/bin/env node
/**
 * Execute Stage 1 of RDP-CV-001: heatset_temp 222 -> 221.25
 * This script replicates what the MCP server would do:
 *   1. preview the setpoint change
 *   2. apply it
 *   3. run until stable
 *   4. report quality
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndustrialFilmLineSimulator } from '../simulator/industrial-film-line/line-simulator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Point to the shared state file
const stateFile = path.resolve(__dirname, '../simulator/industrial-film-line/workspace/runtime/simulator-state.json');

const sim = new IndustrialFilmLineSimulator({
  stateFile,
  seed: 20260610
});

console.log('=== Phase 3: Preview ===');
// Build the proposal and preview it
const previewResult = sim.previewSetpoints({
  changes: [{ tag: 'heatset_temp', target: 221.25 }],
  campaignId: 'CMP-1781279928594',
  experimentId: 'EXP-CV-001',
  sourcePlan: 'RDP-CV-001',
  expectedLagMinutes: 8
});
console.log('Preview result:', JSON.stringify(previewResult, null, 2));

if (!previewResult.safety_gate_result.allowed) {
  console.error('SAFETY GATE REJECTED:', previewResult.safety_gate_result.violations);
  process.exit(1);
}

console.log('\n=== Phase 4: Apply ===');
// Get the before quality
const beforeQuality = sim.getOnlineQuality();
console.log('Before quality:', JSON.stringify(beforeQuality, null, 2));

// Apply the setpoint change (this will transition the line)
const applyResult = sim.applySetpoints({
  changes: [{ tag: 'heatset_temp', target: 221.25 }],
  campaignId: 'CMP-1781279928594',
  experimentId: 'EXP-CV-001',
  sourcePlan: 'RDP-CV-001',
  expectedLagMinutes: 8
});
console.log('Apply result:', JSON.stringify(applyResult, null, 2));

console.log('\n=== Phase 5: Run until stable ===');
const stableResult = sim.runUntilStable({ minStableTicks: 6, maxTicks: 40 });
console.log('Stable result:', JSON.stringify(stableResult, null, 2));

// Get the after quality
const afterQuality = sim.getOnlineQuality();
console.log('After quality:', JSON.stringify(afterQuality, null, 2));

console.log('\n=== Summary ===');
console.log('birefringence_cv before:', beforeQuality.metrics.birefringence_cv);
console.log('birefringence_cv after:', afterQuality.metrics.birefringence_cv);
console.log('delta:', afterQuality.metrics.birefringence_cv - beforeQuality.metrics.birefringence_cv);
console.log('birefringence_mean before:', beforeQuality.metrics.birefringence_mean);
console.log('birefringence_mean after:', afterQuality.metrics.birefringence_mean);
console.log('thickness_cv before:', beforeQuality.metrics.thickness_cv);
console.log('thickness_cv after:', afterQuality.metrics.thickness_cv);
console.log('thickness_mean before:', beforeQuality.metrics.thickness_mean);
console.log('thickness_mean after:', afterQuality.metrics.thickness_mean);
console.log('stable:', stableResult.stable);
console.log('ticks consumed:', stableResult.snapshot.tick - 152);

// Save candidate recipe
const saveResult = sim.saveCandidateRecipe({
  recipeId: 'RCP-CV-STAGE1',
  metadata: {
    stage: 1,
    step: 1,
    plan: 'RDP-CV-001',
    before_birefringence_cv: beforeQuality.metrics.birefringence_cv,
    after_birefringence_cv: afterQuality.metrics.birefringence_cv,
    change: 'heatset_temp 222 -> 221.25'
  }
});
console.log('\nSaved recipe:', saveResult.recipe_id);

// Get full state at end
const finalState = sim.getState();
console.log('\nFinal state tick:', finalState.tick);
console.log('Final setpoints:', JSON.stringify(finalState.setpoints, null, 2));
