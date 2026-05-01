/**
 * Crank torque from power and cadence.
 *   T [N·m] = P [W] × 60 / (2π × cadence [rpm])
 *
 * @param {number} powerW
 * @param {number} cadenceRpm
 * @returns {number|null}  null when cadence or power is too low to compute
 */
export function calcTorque(powerW, cadenceRpm) {
  if (cadenceRpm < 20 || powerW <= 0) return null
  return (powerW * 60) / (2 * Math.PI * cadenceRpm)
}
