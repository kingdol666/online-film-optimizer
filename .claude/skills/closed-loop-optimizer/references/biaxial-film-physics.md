# Biaxial Film Physics — Mechanism Reference for the DOE Team

> **Purpose:** the mechanism knowledge a real 双向拉伸薄膜 (biaxially-oriented film) process scientist uses to *pick the right factors* and *sanity-check every active effect*. This is **prior knowledge** — it sharpens Phase-0 factor selection and the Phase-2 mechanism cross-check. It never replaces the experiment; the experiment decides what the result *is*, this explains *why*.
>
> Read this before designing Phase 0 (R&D) and before signing off any "active factor" (Quality + R&D). Every active term must have a physical story here — a statistical effect with no mechanism is a suspected alias.

---

## 1. The five process zones and what each does to microstructure

A biaxial line stretches an amorphous cast web in two perpendicular directions and heat-sets the oriented structure. Each zone has a specific microstructural job:

| Zone | What happens | Microstructure consequence |
|---|---|---|
| **Extrusion / casting** (`melt_temp`, `casting_roll_temp`, `extruder_speed`) | melt extruded onto chill roll → quench to amorphous thick web | sets base thickness, surface quality, residual quench stress; casting_roll_temp controls crystallization-onset & web flatness |
| **MD stretch** (`md_draw_ratio`, `md_zone_temp`) | machine-direction orientation on heated rolls/clips | polymer chains align along MD; raises MD birefringence & MD tensile; tightens the cast gauge if uniform |
| **TD stretch** (`td_draw_ratio`, `td_zone_1_temp`, `td_zone_2_temp`) | tenter clips stretch transversely — **the dominant in-plane orientation step** | chains align along TD; raises TD birefringence & TD tensile; **shapes the TD thickness profile** (edge/center pattern) |
| **Heat-set** (`heatset_temp`) | hold above Tg in the tenter → crystallization | **locks in orientation** (crystals pin chains), sets crystallinity, **decides heat-shrinkage** (more crystallinity ⇒ less shrink) |
| **Cool / relax / wind** (`relaxation_ratio`, `line_speed`, `winder_tension`) | controlled cooldown + transverse relaxation + winding | relaxes residual stress (reduces birefringence mean & shrinkage); winder_tension controls web flatness & thickness CV at the gauge |

## 2. Birefringence as an orientation probe

Birefringence `Δn` is the difference in refractive index along two axes — a direct, quantitative readout of chain orientation:

```
Δn = Δn_max · f       (f = orientation function, 0 = isotropic, 1 = fully oriented)
```

- **In-plane anisotropy** is set by the **TD/MD draw balance**. The three principal refractive indices `(n_MD, n_TD, n_ND)` form an ellipsoid; MD stretch elongates it along MD, TD stretch along TD. `birefringence_mean` ∝ the net in-plane orientation level; the TD/MD ratio controls *which axis dominates*.
- **`birefringence_cv`** is **orientation uniformity across the web** — it is driven by TD-profile uniformity (zone temps, clip dynamics) and gauge geometry, not by the mean orientation level itself. A flat TD profile ⇒ low CV.
- **Heat-set locks it.** Once crystallized above Tg, the orientation is pinned; raising `heatset_temp` increases crystallinity (locks more) but also allows some stress relaxation before the crystals form — the net effect on `birefringence_mean` is a **balance**, often mildly non-monotone (a quadratic signature) — exactly the kind of curvature center points detect.

**DOE implication:** `td_draw_ratio`, `td_zone_*_temp`, and `heatset_temp` are the primary birefringence levers; `md_draw_ratio` secondary; `winder_tension`/`relaxation_ratio` affect the *relaxation* (mean-lowering) and CV. A screening that finds none of these active on a birefringence response is suspicious — check measurement, not physics.

## 3. Heat-set, crystallinity, and dimensional stability (heat-shrinkage)

Crystallization in the heatset zone is what makes a biaxial film dimensionally stable:

- **Higher `heatset_temp` ⇒ higher crystallinity ⇒ lower heat-shrinkage** (MD and TD). This is why `heatset_temp` is the dominant lever for dimensional-stability responses (documented-not-modeled in this pilot — but the physics is why it stays in the recipe definition).
- The same step **locks birefringence** — so there is a genuine **coupling/trade-off** between low shrinkage (want high heatset) and low/controlled birefringence-mean (heatset's quadratic penalty). The multi-response desirability (framework §6) exists precisely to reconcile this.

## 4. Thickness formation

`thickness_mean` and `thickness_cv` come from a chain, not one knob:

- **`thickness_mean`** ≈ extrusion throughput ÷ line speed, trimmed by the total draw. Primary levers: `extruder_speed`, `line_speed`; the draw ratios scale the result. → on-target control.
- **`thickness_cv`** is dominated by **TD geometry + gauge uniformity**: `td_draw_ratio` (over-stretch ⇒ edge-thick/center-thin U-shape), TD zone balance (slope), and `winder_tension` (M/W shape from non-uniform take-up). The **profile shape** (framework quality skill §First Principle) tells you which lever:

```
U-shape (edges thick, center thin)   → TD over-stretch signature (lower td_draw_ratio or warm td_zone)
Inverted-U (edges thin, center thick)→ MD/casting imbalance
Slope (one edge thick, one thin)     → TD zone-1 vs zone-2 gradient
M / W shape                          → heatset / relaxation / winder non-uniformity
Flat (in tolerance)                  → good process control
```

The `td_draw_ratio ↔ thickness_cv` relationship is a classic **U-curve** (a real quadratic) — too little draw leaves cast non-uniformity, too much draw amplifies edge effects. The RSM phase should capture this curvature explicitly.

## 5. Product-specific physics (never apply one product's priors to another)

| Product | Family state | Signature physics | Implication for factor selection |
|---|---|---|---|
| **PET_FILM_GRADE_A** | semicrystalline, wide window | TD stretch + heatset dominate orientation/birefringence; TD ratio drives TD thickness pattern | screen td_draw_ratio, td_zone_2_temp, heatset_temp, md_draw_ratio, winder_tension first |
| **PMMA_FILM_GRADE_A** | amorphous | residual-stress & birefringence-mean sensitive (no crystallinity to lock) | heatset + relaxation + winder_tension are key; orientation relaxes easily |
| **PPAT_FILM_GRADE_A** | narrow thermal window, residence-time sensitive | small steps on melt/casting/TD temps; recover by relaxing draw ratios first | tiny HTC steps; avoid large draw corrections |
| **PVA_FILM_GRADE_A** | heat-history & uniformity sensitive | TD zones + heatset dominate; large draw corrections amplify profile | screen TD zones + heatset; gentle draw moves |

## 6. Mechanism → factor mapping table (Phase-0 selection aid)

Use this to justify the candidate factor set and the held-factor values. "Pri." = primary driver, "Sec." = secondary, "Relax" = acts by stress relaxation.

| Factor | thickness_mean | thickness_cv | birefringence_mean | birefringence_cv | (heat-shrinkage) | Changeability |
|---|---|---|---|---|---|---|
| `extruder_speed` | **Pri.** | Sec. | — | — | — | ETC-fast |
| `line_speed` | **Pri.** | Sec. | Sec. | Sec. | — | ETC-fast |
| `melt_temp` | Sec. | Sec. | Sec. | Sec. | Sec. | **HTC** |
| `casting_roll_temp` | Sec. | Sec. | Sec. | Sec. | Sec. | **HTC** |
| `md_draw_ratio` | Sec. | Sec. | **Pri.** (MD axis) | Sec. | Sec. | ETC |
| `md_zone_temp` | — | — | Sec. | Sec. | Sec. | **HTC** |
| `td_draw_ratio` | Sec. | **Pri.** (U-curve) | **Pri.** (TD axis) | **Pri.** (profile) | Sec. | ETC |
| `td_zone_1_temp` | — | Sec. (slope) | Sec. | Sec. | Sec. | **HTC** |
| `td_zone_2_temp` | — | Sec. | **Pri.** | Sec. | Sec. | **HTC** |
| `heatset_temp` | — | — | **Pri.** (quadratic) | Sec. | **Pri.** | **HTC** |
| `relaxation_ratio` | — | Sec. | Relax (Pri.) | Sec. | Relax | ETC |
| `winder_tension` | — | Sec. (M/W) | Relax | Sec. | — | ETC-fast |

**Reading the table:** the HTC column shows *why* split-plot is unavoidable — the primary birefringence and shrinkage levers (`heatset_temp`, `td_zone_2_temp`, `melt_temp`) are nearly all HTC. A sound screening keeps these as whole-plot factors and randomizes the ETC draw/tension factors inside.

## 7. The cross-check rule (Quality + R&D)

Before any factor is declared "active" and allowed to drive the optimum, R&D states its mechanism (a row above) and Quality confirms the effect sign is consistent with it. Mismatch ⇒ suspected alias, drift, or measurement artifact — investigate before advancing. This is what stops a plausible-but-wrong effect from corrupting the response surface.
