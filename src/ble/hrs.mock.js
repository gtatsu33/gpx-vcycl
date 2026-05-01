export class MockHrsClient {
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
        heartRateBpm: Math.round(140 + 15 * Math.sin(this.#t * 0.2)),
      })
    }, 1000)
    this.#onStateCallback?.('connected')
  }

  async disconnect() {
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId)
      this.#intervalId = null
    }
    this.#onStateCallback?.('disconnected')
  }

  onHeartRateData(callback)         { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }

  get isConnected() { return this.#intervalId !== null }
}
