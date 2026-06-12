#!/usr/bin/env node
// MCP Read Verification Script
// Calls all 5 MCP read-only tools via direct Node.js import and writes results to a JSON file.

import { IndustrialFilmLineSimulator } from './simulator/industrial-film-line/line-simulator.mjs';
import { listProductProfiles } from './simulator/industrial-film-line/product-catalog.mjs';

const simulator = new IndustrialFilmLineSimulator({
  seed: 20260610,
  productGrade: 'PET_FILM_GRADE_A',
  campaignId: 'CMP-MCP-VERIFY',
  stateFile: 'workspace/runtime/simulator-state.json'
});

const results = {
  verified_at: new Date().toISOString(),
  product_grade: 'PET_FILM_GRADE_A',
  tools: {}
};

// 1. film_line_list_products
try {
  const products = listProductProfiles();
  results.tools.film_line_list_products = {
    available: true,
    result_summary: `Listed ${products.length} products: ${products.map(p => p.product_grade).join(', ')}`
  };
} catch (err) {
  results.tools.film_line_list_products = {
    available: false,
    result_summary: `Error: ${err.message}`
  };
}

// 2. film_line_get_state
try {
  const state = simulator.getState();
  results.tools.film_line_get_state = {
    available: true,
    result_summary: JSON.stringify(state)
  };
} catch (err) {
  results.tools.film_line_get_state = {
    available: false,
    result_summary: `Error: ${err.message}`
  };
}

// 3. film_line_get_snapshot
try {
  const snapshot = simulator.getSnapshot();
  results.tools.film_line_get_snapshot = {
    available: true,
    result_summary: JSON.stringify(snapshot)
  };
} catch (err) {
  results.tools.film_line_get_snapshot = {
    available: false,
    result_summary: `Error: ${err.message}`
  };
}

// 4. film_line_get_online_quality
try {
  const quality = simulator.getOnlineQuality();
  results.tools.film_line_get_online_quality = {
    available: true,
    result_summary: JSON.stringify(quality)
  };
} catch (err) {
  results.tools.film_line_get_online_quality = {
    available: false,
    result_summary: `Error: ${err.message}`
  };
}

// 5. film_line_list_writable_parameters
try {
  const writableParams = simulator.getWritableParameters();
  results.tools.film_line_list_writable_parameters = {
    available: true,
    result_summary: JSON.stringify(writableParams)
  };
} catch (err) {
  results.tools.film_line_list_writable_parameters = {
    available: false,
    result_summary: `Error: ${err.message}`
  };
}

// Determine overall status
const allOk = Object.values(results.tools).every(t => t.available === true);
results.all_read_tools_ok = allOk;

const outputPath = 'workspace/pet-birefringence-opt-20260612/01_verification/mcp_read_verification.json';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Verification results written to: ${outputPath}`);
console.log(JSON.stringify(results, null, 2));
