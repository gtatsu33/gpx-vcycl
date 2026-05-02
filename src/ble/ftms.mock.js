export class MockFtmsClient {
  #intervalId = null
  #onDataCallback = null
  #onStateCallback = null
  #t = 0

  async connect() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    this.#t = 0
    console.log('[MockFTMS] requestControl → SUCCESS')
    this.#intervalId = setInterval(() => {
      this.#t += 0.1
      this.#onDataCallback?.({
        speedKmh:   25 + 5  * Math.sin(this.#t * 0.5),
        cadenceRpm: 80 + 10 * Math.sin(this.#t * 0.3),
        powerW:     200 + 50 * Math.sin(this.#t),
      })
    }, 100)
    this.#onStateCallback?.('connected')
  }

  async disconnect() {
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId)
      this.#intervalId = null
    }
    this.#onStateCallback?.('disconnected')
  }

  onIndoorBikeData(callback)        { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }
  onControlLog(callback)            { /* mock: logs go to console only */ }

  get isConnected()    { return this.#intervalId !== null }
  get isControllable() { return this.isConnected }

  async requestControl() {
    console.log('[MockFTMS] requestControl → SUCCESS')
  }

  async setSimulationParameters({ windSpeedMs = 0, gradientPercent, crr, windResistanceCoef }) {
    console.log(`[MockFTMS] setSimulationParameters grad=${gradientPercent.toFixed(1)}% wind=${windSpeedMs} crr=${crr} cwa=${windResistanceCoef}`)
  }

  async reset() {
    console.log('[MockFTMS] reset → SUCCESS')
  }
}
