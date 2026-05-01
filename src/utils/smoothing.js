/**
 * Time-weighted moving average that discards samples older than windowSec.
 * Accepts an explicit timestamp so it can be tested without real clock.
 */
export class MovingAverage {
  #windowMs
  #samples = []  // { value: number, t: number }[]

  /** @param {number} windowSec */
  constructor(windowSec) {
    this.#windowMs = windowSec * 1000
  }

  get windowSec() { return this.#windowMs / 1000 }

  /**
   * @param {number} value
   * @param {number} [timestampMs]  defaults to Date.now()
   */
  push(value, timestampMs = Date.now()) {
    this.#samples.push({ value, t: timestampMs })
    const cutoff = timestampMs - this.#windowMs
    while (this.#samples.length > 0 && this.#samples[0].t < cutoff) {
      this.#samples.shift()
    }
  }

  /** Mean of all samples currently in the window. Returns 0 if empty. */
  get average() {
    if (this.#samples.length === 0) return 0
    return this.#samples.reduce((s, p) => s + p.value, 0) / this.#samples.length
  }

  get count() { return this.#samples.length }
}
