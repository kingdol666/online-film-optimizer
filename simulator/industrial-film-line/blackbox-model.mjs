import {
  getProductProfile,
  getProductSafetyLimits,
  getProductSetpoints
} from './product-catalog.mjs';

const TWO_PI = Math.PI * 2;

export const DEFAULT_SETPOINTS = Object.freeze(getProductSetpoints('PET_FILM_GRADE_A'));
export const SAFETY_LIMITS = Object.freeze(getProductSafetyLimits('PET_FILM_GRADE_A'));

export function createRng(seed = 20260610) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function gaussian(rng) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sq(value) {
  return value * value;
}

function hiddenOptimumForGrade(productGrade = 'PET_FILM_GRADE_A') {
  return getProductProfile(productGrade).model.optimum;
}

function spanFor(limits, tag, fallback) {
  const limit = limits[tag];
  if (!limit) return fallback;
  return Math.max((limit.max - limit.min) / 5, fallback);
}

export function evaluateBlackbox({ setpoints, tick, rng, productGrade, drift = 0 }) {
  const profile = getProductProfile(productGrade);
  const ref = profile.baseline_setpoints;
  const limits = profile.safety_limits;
  const model = profile.model;
  const opt = hiddenOptimumForGrade(productGrade);
  const noise = (scale) => gaussian(rng) * scale * model.noise_scale;

  const throughputRatio = setpoints.extruder_speed / Math.max(setpoints.line_speed, 1);
  const refThroughputRatio = ref.extruder_speed / Math.max(ref.line_speed, 1);
  const stretchProduct = setpoints.md_draw_ratio * setpoints.td_draw_ratio;
  const refStretchProduct = opt.md_draw_ratio * opt.td_draw_ratio;
  const heatBalance = 0.55 * setpoints.heatset_temp + 0.25 * setpoints.td_zone_2_temp + 0.2 * setpoints.md_zone_temp;
  const drawSpan = spanFor(limits, 'td_draw_ratio', 0.08);
  const heatsetSpan = spanFor(limits, 'heatset_temp', 4);
  const tdTempSpan = spanFor(limits, 'td_zone_2_temp', 3.2);
  const lineSpan = spanFor(limits, 'line_speed', 2.5);
  const tensionSpan = spanFor(limits, 'winder_tension', 8);
  const castSpan = spanFor(limits, 'casting_roll_temp', 4);

  const thicknessMean =
    model.target_thickness_mean
    + 0.22 * (throughputRatio - refThroughputRatio)
    - 0.14 * (stretchProduct - refStretchProduct)
    + 0.012 * (setpoints.casting_roll_temp - ref.casting_roll_temp)
    + 0.025 * Math.sin(tick / 13)
    + drift * 0.05
    + noise(0.018);

  const thicknessCv =
    model.base_thickness_cv
    + 0.42 * sq(setpoints.td_draw_ratio - opt.td_draw_ratio) / sq(drawSpan)
    + 0.22 * sq(setpoints.line_speed - ref.line_speed) / sq(lineSpan)
    + 0.18 * sq(setpoints.winder_tension - opt.winder_tension) / sq(tensionSpan)
    + 0.12 * Math.abs(setpoints.casting_roll_temp - ref.casting_roll_temp) / castSpan
    + 0.08 * Math.sin(tick / 7)
    + noise(0.035);

  const orientationDrive =
    model.orientation_gain * (
      0.020 * (setpoints.md_draw_ratio - ref.md_draw_ratio)
      + 0.016 * (setpoints.td_draw_ratio - ref.td_draw_ratio)
      - 0.00072 * (heatBalance - model.heat_balance_reference)
      + 0.00035 * (setpoints.td_zone_2_temp - ref.td_zone_2_temp)
      - 0.00042 * (setpoints.relaxation_ratio - ref.relaxation_ratio)
    );

  const birefringenceMean =
    model.target_birefringence_mean
    + orientationDrive
    - 0.0008 * sq(setpoints.heatset_temp - opt.heatset_temp) / sq(heatsetSpan)
    + 0.00025 * Math.sin(tick / 9)
    - drift * 0.00035
    + noise(0.00033);

  const birefringenceCv =
    model.base_birefringence_cv
    + 0.42 * sq(setpoints.td_zone_2_temp - opt.td_zone_2_temp) / sq(tdTempSpan)
    + 0.28 * sq(setpoints.heatset_temp - opt.heatset_temp) / sq(heatsetSpan)
    + 0.22 * Math.abs(setpoints.relaxation_ratio - ref.relaxation_ratio) / Math.max(spanFor(limits, 'relaxation_ratio', 2), 1e-9)
    - 0.24 * Math.min(Math.max(setpoints.td_draw_ratio - ref.td_draw_ratio, 0), drawSpan) / drawSpan
    + 0.08 * Math.sin(tick / 6)
    + noise(0.055);

  const thicknessEdgeCenterDelta =
    0.10
    + 0.05 * (setpoints.td_draw_ratio - ref.td_draw_ratio) / drawSpan
    + 0.025 * (setpoints.winder_tension - ref.winder_tension) / tensionSpan
    + noise(0.012);

  const birefringenceEdgeCenterDelta =
    -0.004
    - 0.0012 * (setpoints.td_zone_2_temp - opt.td_zone_2_temp) / tdTempSpan
    + 0.001 * (setpoints.heatset_temp - opt.heatset_temp) / heatsetSpan
    + noise(0.00045);

  const alarmRisk =
    Math.abs(setpoints.td_draw_ratio - ref.td_draw_ratio) > drawSpan * 2.2
    || Math.abs(setpoints.md_draw_ratio - ref.md_draw_ratio) > spanFor(limits, 'md_draw_ratio', 0.08) * 2.2
    || setpoints.heatset_temp > limits.heatset_temp.max
    || setpoints.melt_temp > limits.melt_temp.max
    || thicknessCv > profile.target_template.thickness_cv.max * 1.75
    || birefringenceCv > profile.target_template.birefringence_cv.max * 1.55;

  return {
    metrics: {
      thickness_mean: round(thicknessMean, 4),
      thickness_cv: round(clamp(thicknessCv, 0.65, 8), 4),
      thickness_edge_center_delta: round(thicknessEdgeCenterDelta, 4),
      birefringence_mean: round(birefringenceMean, 6),
      birefringence_cv: round(clamp(birefringenceCv, 0.8, 8), 4),
      birefringence_edge_center_delta: round(birefringenceEdgeCenterDelta, 6)
    },
    profiles: makeProfiles({
      thicknessMean,
      thicknessCv,
      thicknessEdgeCenterDelta,
      birefringenceMean,
      birefringenceCv,
      birefringenceEdgeCenterDelta,
      rng,
      tick
    }),
    alarmRisk
  };
}

function makeProfiles(values) {
  const positions = Array.from({ length: 17 }, (_, i) => round(i / 16, 4));
  const centered = positions.map((p) => p - 0.5);
  const thickness = centered.map((p, i) => {
    const edgeShape = values.thicknessEdgeCenterDelta * (Math.abs(p) * 2 - 0.45);
    const wave = 0.025 * Math.sin(i * 0.9 + values.tick / 4);
    return round(values.thicknessMean + edgeShape + wave + gaussian(values.rng) * 0.01, 4);
  });
  const birefringence = centered.map((p, i) => {
    const edgeShape = values.birefringenceEdgeCenterDelta * (Math.abs(p) * 2 - 0.45);
    const wave = 0.00045 * Math.cos(i * 0.8 + values.tick / 5);
    return round(values.birefringenceMean + edgeShape + wave + gaussian(values.rng) * 0.00018, 6);
  });
  return {
    position_norm: positions,
    thickness,
    birefringence
  };
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
