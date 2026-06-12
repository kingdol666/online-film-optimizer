const PRODUCT_ALIASES = Object.freeze({
  BOPET_NEW_GRADE_A: 'PET_FILM_GRADE_A',
  PET: 'PET_FILM_GRADE_A',
  PPAT: 'PPAT_FILM_GRADE_A',
  PMMA: 'PMMA_FILM_GRADE_A',
  PVA: 'PVA_FILM_GRADE_A'
});

const PRODUCT_PROFILES = Object.freeze({
  PET_FILM_GRADE_A: {
    product_grade: 'PET_FILM_GRADE_A',
    legacy_product_grade: 'BOPET_NEW_GRADE_A',
    display_name: 'PET 双向拉伸光学膜 A 级',
    material_family: 'PET',
    process_notes: [
      '取向与热定型窗口较宽，双折射波动通常由 TD 热区与热定型耦合主导。',
      '厚度均值优先通过挤出量/线速度平衡控制，厚度 CV 优先关注 TD 拉伸与收卷张力。'
    ],
    baseline_setpoints: {
      extruder_speed: 100.0,
      melt_temp: 278.0,
      casting_roll_temp: 34.0,
      md_draw_ratio: 3.18,
      md_zone_temp: 92.0,
      td_draw_ratio: 3.62,
      td_zone_1_temp: 108.0,
      td_zone_2_temp: 112.0,
      heatset_temp: 218.0,
      relaxation_ratio: 4.2,
      line_speed: 42.0,
      winder_tension: 118.0
    },
    safety_limits: {
      extruder_speed: { min: 88, max: 112, maxDelta: 2.5, ramp: 1.0 },
      melt_temp: { min: 268, max: 286, maxDelta: 2.0, ramp: 0.8 },
      casting_roll_temp: { min: 28, max: 42, maxDelta: 1.5, ramp: 0.6 },
      md_draw_ratio: { min: 3.0, max: 3.36, maxDelta: 0.04, ramp: 0.02 },
      md_zone_temp: { min: 86, max: 100, maxDelta: 1.5, ramp: 0.6 },
      td_draw_ratio: { min: 3.42, max: 3.82, maxDelta: 0.04, ramp: 0.02 },
      td_zone_1_temp: { min: 102, max: 116, maxDelta: 1.5, ramp: 0.6 },
      td_zone_2_temp: { min: 106, max: 120, maxDelta: 1.5, ramp: 0.6 },
      heatset_temp: { min: 210, max: 226, maxDelta: 1.5, ramp: 0.6 },
      relaxation_ratio: { min: 2.8, max: 5.6, maxDelta: 0.3, ramp: 0.12 },
      line_speed: { min: 38, max: 46, maxDelta: 0.8, ramp: 0.3 },
      winder_tension: { min: 105, max: 132, maxDelta: 3.0, ramp: 1.2 }
    },
    model: {
      optimum: { td_zone_2_temp: 114.2, heatset_temp: 219.5, md_draw_ratio: 3.24, td_draw_ratio: 3.69, winder_tension: 119.0 },
      target_thickness_mean: 12.0,
      target_birefringence_mean: 0.078,
      base_thickness_cv: 1.18,
      base_birefringence_cv: 3.55,
      noise_scale: 1.0,
      orientation_gain: 1.0,
      heat_balance_reference: 188.0
    },
    target_template: {
      thickness_mean: { target: 12.0, tolerance: 0.22 },
      thickness_cv: { max: 1.55 },
      birefringence_mean: { target: 0.078, tolerance: 0.003 },
      birefringence_cv: { max: 3.7 }
    },
    historical_recipes: [
      { recipe_id: 'PET-HIST-001', quality_state: 'PASS', setpoints: { td_zone_2_temp: 114.0, heatset_temp: 219.2, td_draw_ratio: 3.68 }, metrics: { thickness_cv: 1.38, birefringence_cv: 3.61 } },
      { recipe_id: 'PET-HIST-002', quality_state: 'WARNING', setpoints: { td_zone_2_temp: 111.6, heatset_temp: 217.8, td_draw_ratio: 3.62 }, metrics: { thickness_cv: 1.54, birefringence_cv: 3.96 } }
    ]
  },
  PPAT_FILM_GRADE_A: {
    product_grade: 'PPAT_FILM_GRADE_A',
    display_name: 'PPAT 可降解柔性膜 A 级',
    material_family: 'PPAT',
    process_notes: [
      '热窗口窄且对停留时间敏感，优先小步调整熔体温度、冷却辊和 TD 热区。',
      '过高拉伸倍率更容易触发厚度轮廓放大，recover 阶段应优先回退拉伸倍率。'
    ],
    baseline_setpoints: {
      extruder_speed: 70.0,
      melt_temp: 166.0,
      casting_roll_temp: 24.0,
      md_draw_ratio: 2.28,
      md_zone_temp: 64.0,
      td_draw_ratio: 2.54,
      td_zone_1_temp: 72.0,
      td_zone_2_temp: 78.0,
      heatset_temp: 94.0,
      relaxation_ratio: 6.0,
      line_speed: 28.0,
      winder_tension: 72.0
    },
    safety_limits: {
      extruder_speed: { min: 58, max: 82, maxDelta: 2.0, ramp: 0.8 },
      melt_temp: { min: 154, max: 178, maxDelta: 1.5, ramp: 0.6 },
      casting_roll_temp: { min: 18, max: 32, maxDelta: 1.2, ramp: 0.5 },
      md_draw_ratio: { min: 2.08, max: 2.52, maxDelta: 0.035, ramp: 0.016 },
      md_zone_temp: { min: 58, max: 72, maxDelta: 1.2, ramp: 0.5 },
      td_draw_ratio: { min: 2.34, max: 2.78, maxDelta: 0.035, ramp: 0.016 },
      td_zone_1_temp: { min: 66, max: 82, maxDelta: 1.2, ramp: 0.5 },
      td_zone_2_temp: { min: 70, max: 88, maxDelta: 1.2, ramp: 0.5 },
      heatset_temp: { min: 86, max: 104, maxDelta: 1.2, ramp: 0.5 },
      relaxation_ratio: { min: 4.2, max: 8.2, maxDelta: 0.35, ramp: 0.12 },
      line_speed: { min: 23, max: 33, maxDelta: 0.7, ramp: 0.25 },
      winder_tension: { min: 58, max: 88, maxDelta: 2.5, ramp: 1.0 }
    },
    model: {
      optimum: { td_zone_2_temp: 80.8, heatset_temp: 96.0, md_draw_ratio: 2.36, td_draw_ratio: 2.62, winder_tension: 70.0 },
      target_thickness_mean: 18.0,
      target_birefringence_mean: 0.046,
      base_thickness_cv: 1.55,
      base_birefringence_cv: 4.2,
      noise_scale: 1.18,
      orientation_gain: 0.72,
      heat_balance_reference: 78.0
    },
    target_template: {
      thickness_mean: { target: 18.0, tolerance: 0.45 },
      thickness_cv: { max: 2.15 },
      birefringence_mean: { target: 0.046, tolerance: 0.004 },
      birefringence_cv: { max: 4.55 }
    },
    historical_recipes: [
      { recipe_id: 'PPAT-HIST-001', quality_state: 'PASS', setpoints: { melt_temp: 166.8, td_zone_2_temp: 80.2, heatset_temp: 95.5 }, metrics: { thickness_cv: 1.92, birefringence_cv: 4.38 } },
      { recipe_id: 'PPAT-HIST-002', quality_state: 'WARNING', setpoints: { td_draw_ratio: 2.68, heatset_temp: 98.0 }, metrics: { thickness_cv: 2.38, birefringence_cv: 4.74 } }
    ]
  },
  PMMA_FILM_GRADE_A: {
    product_grade: 'PMMA_FILM_GRADE_A',
    display_name: 'PMMA 高透光硬质膜 A 级',
    material_family: 'PMMA',
    process_notes: [
      'PMMA 对残余应力和双折射均值更敏感，热松弛与收卷张力是关键质量杠杆。',
      '过高 TD 拉伸会快速放大边中差，R&D 策略应偏向热区与张力协同。'
    ],
    baseline_setpoints: {
      extruder_speed: 62.0,
      melt_temp: 238.0,
      casting_roll_temp: 58.0,
      md_draw_ratio: 1.86,
      md_zone_temp: 112.0,
      td_draw_ratio: 2.06,
      td_zone_1_temp: 118.0,
      td_zone_2_temp: 123.0,
      heatset_temp: 126.0,
      relaxation_ratio: 7.2,
      line_speed: 20.0,
      winder_tension: 92.0
    },
    safety_limits: {
      extruder_speed: { min: 52, max: 74, maxDelta: 1.8, ramp: 0.7 },
      melt_temp: { min: 224, max: 252, maxDelta: 1.8, ramp: 0.7 },
      casting_roll_temp: { min: 50, max: 68, maxDelta: 1.2, ramp: 0.5 },
      md_draw_ratio: { min: 1.66, max: 2.12, maxDelta: 0.03, ramp: 0.014 },
      md_zone_temp: { min: 104, max: 122, maxDelta: 1.2, ramp: 0.5 },
      td_draw_ratio: { min: 1.84, max: 2.32, maxDelta: 0.03, ramp: 0.014 },
      td_zone_1_temp: { min: 110, max: 128, maxDelta: 1.2, ramp: 0.5 },
      td_zone_2_temp: { min: 114, max: 134, maxDelta: 1.2, ramp: 0.5 },
      heatset_temp: { min: 116, max: 138, maxDelta: 1.2, ramp: 0.5 },
      relaxation_ratio: { min: 5.4, max: 9.4, maxDelta: 0.3, ramp: 0.12 },
      line_speed: { min: 16, max: 25, maxDelta: 0.6, ramp: 0.22 },
      winder_tension: { min: 76, max: 108, maxDelta: 2.4, ramp: 0.9 }
    },
    model: {
      optimum: { td_zone_2_temp: 126.5, heatset_temp: 129.0, md_draw_ratio: 1.94, td_draw_ratio: 2.12, winder_tension: 88.0 },
      target_thickness_mean: 25.0,
      target_birefringence_mean: 0.032,
      base_thickness_cv: 1.32,
      base_birefringence_cv: 2.85,
      noise_scale: 0.92,
      orientation_gain: 0.55,
      heat_balance_reference: 122.0
    },
    target_template: {
      thickness_mean: { target: 25.0, tolerance: 0.35 },
      thickness_cv: { max: 1.8 },
      birefringence_mean: { target: 0.032, tolerance: 0.002 },
      birefringence_cv: { max: 3.05 }
    },
    historical_recipes: [
      { recipe_id: 'PMMA-HIST-001', quality_state: 'PASS', setpoints: { td_zone_2_temp: 126.0, heatset_temp: 128.5, winder_tension: 88.5 }, metrics: { thickness_cv: 1.62, birefringence_cv: 2.94 } },
      { recipe_id: 'PMMA-HIST-002', quality_state: 'WARNING', setpoints: { td_draw_ratio: 2.22, winder_tension: 96.0 }, metrics: { thickness_cv: 1.95, birefringence_cv: 3.42 } }
    ]
  },
  PVA_FILM_GRADE_A: {
    product_grade: 'PVA_FILM_GRADE_A',
    display_name: 'PVA 水溶/阻隔膜 A 级',
    material_family: 'PVA',
    process_notes: [
      'PVA 对含水与热历史敏感，模拟器用冷却辊、热区和松弛比近似水分/应力窗口。',
      '质量控制优先压低厚度波动和边中差，避免用大幅拉伸修正单一指标。'
    ],
    baseline_setpoints: {
      extruder_speed: 55.0,
      melt_temp: 188.0,
      casting_roll_temp: 31.0,
      md_draw_ratio: 2.42,
      md_zone_temp: 72.0,
      td_draw_ratio: 2.78,
      td_zone_1_temp: 82.0,
      td_zone_2_temp: 88.0,
      heatset_temp: 98.0,
      relaxation_ratio: 7.8,
      line_speed: 18.0,
      winder_tension: 54.0
    },
    safety_limits: {
      extruder_speed: { min: 46, max: 66, maxDelta: 1.6, ramp: 0.65 },
      melt_temp: { min: 178, max: 202, maxDelta: 1.5, ramp: 0.6 },
      casting_roll_temp: { min: 24, max: 40, maxDelta: 1.2, ramp: 0.5 },
      md_draw_ratio: { min: 2.18, max: 2.72, maxDelta: 0.03, ramp: 0.014 },
      md_zone_temp: { min: 64, max: 82, maxDelta: 1.2, ramp: 0.5 },
      td_draw_ratio: { min: 2.5, max: 3.08, maxDelta: 0.03, ramp: 0.014 },
      td_zone_1_temp: { min: 74, max: 92, maxDelta: 1.2, ramp: 0.5 },
      td_zone_2_temp: { min: 80, max: 98, maxDelta: 1.2, ramp: 0.5 },
      heatset_temp: { min: 88, max: 108, maxDelta: 1.2, ramp: 0.5 },
      relaxation_ratio: { min: 5.8, max: 10.0, maxDelta: 0.3, ramp: 0.12 },
      line_speed: { min: 14, max: 23, maxDelta: 0.55, ramp: 0.2 },
      winder_tension: { min: 42, max: 70, maxDelta: 2.0, ramp: 0.8 }
    },
    model: {
      optimum: { td_zone_2_temp: 90.2, heatset_temp: 99.5, md_draw_ratio: 2.5, td_draw_ratio: 2.86, winder_tension: 51.0 },
      target_thickness_mean: 30.0,
      target_birefringence_mean: 0.055,
      base_thickness_cv: 1.72,
      base_birefringence_cv: 3.95,
      noise_scale: 1.25,
      orientation_gain: 0.82,
      heat_balance_reference: 86.0
    },
    target_template: {
      thickness_mean: { target: 30.0, tolerance: 0.6 },
      thickness_cv: { max: 2.35 },
      birefringence_mean: { target: 0.055, tolerance: 0.004 },
      birefringence_cv: { max: 4.25 }
    },
    historical_recipes: [
      { recipe_id: 'PVA-HIST-001', quality_state: 'PASS', setpoints: { td_zone_2_temp: 90.0, heatset_temp: 99.2, winder_tension: 51.5 }, metrics: { thickness_cv: 2.12, birefringence_cv: 4.12 } },
      { recipe_id: 'PVA-HIST-002', quality_state: 'WARNING', setpoints: { casting_roll_temp: 35.0, td_draw_ratio: 2.98 }, metrics: { thickness_cv: 2.72, birefringence_cv: 4.46 } }
    ]
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeProductGrade(productGrade = 'PET_FILM_GRADE_A') {
  const key = String(productGrade || 'PET_FILM_GRADE_A').trim().toUpperCase();
  return PRODUCT_ALIASES[key] || key;
}

export function getProductProfile(productGrade = 'PET_FILM_GRADE_A') {
  const normalized = normalizeProductGrade(productGrade);
  const profile = PRODUCT_PROFILES[normalized];
  if (!profile) {
    const supported = Object.keys(PRODUCT_PROFILES).join(', ');
    throw new Error(`unknown_product_grade:${productGrade}; supported=${supported}`);
  }
  return clone(profile);
}

export function listProductProfiles() {
  return Object.values(PRODUCT_PROFILES).map((profile) => ({
    product_grade: profile.product_grade,
    legacy_product_grade: profile.legacy_product_grade || null,
    display_name: profile.display_name,
    material_family: profile.material_family,
    process_notes: [...profile.process_notes],
    target_template: clone(profile.target_template)
  }));
}

export function getProductSetpoints(productGrade) {
  return clone(getProductProfile(productGrade).baseline_setpoints);
}

export function getProductSafetyLimits(productGrade) {
  return clone(getProductProfile(productGrade).safety_limits);
}

export function getProductHistory(productGrade) {
  return clone(getProductProfile(productGrade).historical_recipes);
}

export function buildProductTargetTemplate(productGrade = 'PET_FILM_GRADE_A', overrides = {}) {
  const profile = getProductProfile(productGrade);
  const requestId = overrides.request_id || `REQ-${profile.product_grade}`;
  return {
    request_id: requestId,
    campaign_id: overrides.campaign_id || `CMP-SIM-${profile.product_grade}`,
    product_grade: profile.product_grade,
    product_context: {
      display_name: profile.display_name,
      material_family: profile.material_family,
      process_notes: profile.process_notes,
      historical_recipes: profile.historical_recipes
    },
    user_objective: {
      performance_goal: overrides.performance_goal || `${profile.display_name} 达到产品质量窗口并输出可回退 recipe`,
      priority_order: overrides.priority_order || ['birefringence_cv', 'thickness_cv', 'birefringence_mean', 'thickness_mean'],
      business_context: overrides.business_context || 'multi-product recipe development with online closed-loop optimization',
      release_expectation: overrides.release_expectation || 'online candidate with offline validation required'
    },
    targets: clone(profile.target_template),
    constraints: {
      max_iterations: overrides.max_iterations || 12,
      max_waste_meter: overrides.max_waste_meter || 450,
      manual_approval_required: overrides.manual_approval_required ?? false,
      safety_limits: clone(profile.safety_limits)
    },
    execution: {
      manual_approval_required: overrides.manual_approval_required ?? false,
      auto_resume_on_approval: true,
      provider: overrides.provider || null
    },
    product_database_ref: {
      provider: 'simulated_product_catalog',
      product_grade: profile.product_grade,
      history_record_count: profile.historical_recipes.length
    }
  };
}

export const PRODUCT_GRADES = Object.freeze(Object.keys(PRODUCT_PROFILES));
