export const G_MS2    = 9.81    // m/s²
export const RHO_KGM3 = 1.225   // kg/m³, standard atmosphere

// Aerobic power penalty above 1500m: ~1% per 100m (matches VO2max altitude research)
export function altitudeFactor(elevM) {
  return Math.max(0, 1 - Math.max(0, elevM - 1500) * 0.0001)
}

export const DEFAULT_PHYSICS = {
  massKg: 80,   // rider (70 kg) + bike (10 kg)
  cdA:    0.32, // m²
  crr:    0.005,
}

/**
 * Euler step: solves dv/dt = (P - P_rolling - P_air - P_gravity) / (m · v)
 *
 * P_rolling = Crr · m · g · cos(θ) · v
 * P_air     = 0.5 · ρ · CdA · v³
 * P_gravity = m · g · sin(θ) · v
 * θ         = atan(gradientPercent / 100)
 *
 * @param {number} powerW            input power [W]
 * @param {number} gradientPercent   road gradient [%]  (positive = uphill)
 * @param {number} currentVelocityMs current speed [m/s]
 * @param {number} dtSec             time step [s]
 * @param {{ massKg: number, cdA: number, crr: number }} params
 * @returns {number} new speed [m/s]  (always ≥ 0)
 */
export function stepVelocity(powerW, gradientPercent, currentVelocityMs, dtSec, { massKg, cdA, crr }) {
  const theta = Math.atan(gradientPercent / 100)
  // Use a minimum effective velocity to avoid ÷0 at standstill.
  // 0.5 m/s ≈ 1.8 km/h gives physically reasonable startup acceleration.
  const vEff  = Math.max(currentVelocityMs, 0.5)

  const pRolling = crr * massKg * G_MS2 * Math.cos(theta) * vEff
  const pAir     = 0.5 * RHO_KGM3 * cdA * vEff ** 3
  const pGravity = massKg * G_MS2 * Math.sin(theta) * vEff

  const accel = (powerW - pRolling - pAir - pGravity) / (massKg * vEff)
  return Math.max(0, currentVelocityMs + accel * dtSec)
}
