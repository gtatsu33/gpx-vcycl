export class MockCpsClient {
  #intervalId = null
  #onDataCallback = null
  #onStateCallback = null
  #t = 0

  async connect() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    this.#t = 0
    this.#intervalId = setInterval(() => {
      this.#t += 0.1
      this.#onDataCallback?.({
        powerW:     Math.round(200 + 30 * Math.sin(this.#t * 0.7) + (Math.random() - 0.5) * 10),
        cadenceRpm: 85 + 10 * Math.sin(this.#t * 0.4),
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

  onPowerData(callback)             { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }

  get isConnected() { return this.#intervalId !== null }
}
