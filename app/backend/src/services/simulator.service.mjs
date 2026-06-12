import { getJson, postJson } from '../lib/http-json.mjs';

const SIM_BASE_URL = process.env.SIM_BASE_URL || 'http://127.0.0.1:8877';

export async function getSimulatorOverview() {
  const [state, snapshot, quality, writableParameters, ledger] = await Promise.all([
    getJson(`${SIM_BASE_URL}/sim/state`),
    getJson(`${SIM_BASE_URL}/sim/snapshot`),
    getJson(`${SIM_BASE_URL}/sim/online-quality`),
    getJson(`${SIM_BASE_URL}/sim/writable-parameters`),
    getJson(`${SIM_BASE_URL}/sim/ledger`)
  ]);
  return { state, snapshot, quality, writableParameters, ledger };
}

export async function listSimulatorProducts() {
  return getJson(`${SIM_BASE_URL}/sim/products`);
}

export async function resetSimulator(payload) {
  return postJson(`${SIM_BASE_URL}/sim/reset`, payload);
}

export async function runUntilStable(payload) {
  return postJson(`${SIM_BASE_URL}/sim/run-until-stable`, payload);
}

export async function previewSetpoints(payload) {
  return postJson(`${SIM_BASE_URL}/sim/setpoints/preview`, payload);
}

export async function applySetpoints(payload) {
  return postJson(`${SIM_BASE_URL}/sim/setpoints/apply`, payload);
}
