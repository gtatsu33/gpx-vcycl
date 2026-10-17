import { saveRide, finalizeDraftRide, deleteRide, markUploaded, markUploadFailed } from '../storage/rides.js'
import { generateRideName, prepareUpload } from '../strava/rideUpload.js'
import { uploadToStrava }                           from '../strava/upload.js'
import { getConnectionInfo }                        from '../strava/auth.js'

export class RideEndModal {
  #summary      = null
  #existingId   = null
  #onClose      = null
  #overlay      = document.getElementById('ride-end-overlay')
  #nameInput    = document.getElementById('ride-end-name')
  #summaryEl    = document.getElementById('ride-end-summary')
  #uploadBtn    = document.getElementById('ride-end-upload-btn')
  #saveBtn      = document.getElementById('ride-end-save-btn')
  #discardBtn   = document.getElementById('ride-end-discard-btn')
  #statusEl     = document.getElementById('ride-end-status')

  constructor({ onClose } = {}) {
    this.#onClose = onClose
    this.#uploadBtn.addEventListener('click',  () => this.#handleUpload())
    this.#saveBtn.addEventListener('click',    () => this.#handleSaveOnly())
    this.#discardBtn.addEventListener('click', () => this.#handleDiscard())
  }

  /**
   * @param {object} summary
   * @param {{ existingId?: number|null }} [opts]
   *   existingId: 走行中の自動保存で作成済みの下書きレコードID。指定時は
   *   新規追加ではなくそのレコードを確定記録に更新する（6-2-1節参照）。
   */
  async show(summary, { existingId = null } = {}) {
    this.#summary    = summary
    this.#existingId = existingId
    this.#nameInput.value = generateRideName(summary.routeName)
    this.#renderSummary(summary)
    this.#setStatus('')

    // Strava 接続状態によってボタン表示を切り替え
    const info = await getConnectionInfo()
    this.#uploadBtn.textContent = info
      ? `Stravaにアップロード（${info.athleteName}）`
      : 'Stravaにアップロード（未接続）'
    this.#uploadBtn.disabled = !info

    this.#overlay.classList.add('open')
  }

  #renderSummary(summary) {
    const distKm   = ((summary.samples.at(-1)?.sessionDistanceM ?? summary.samples.at(-1)?.distanceM ?? 0) / 1000).toFixed(2)
    const elapsedS = Math.round((summary.endedAt - summary.startedAt) / 1000)
    const h = Math.floor(elapsedS / 3600)
    const m = Math.floor((elapsedS % 3600) / 60)
    const s = elapsedS % 60
    const timeStr = h > 0
      ? `${h}:${pad(m)}:${pad(s)}`
      : `${m}:${pad(s)}`

    const avgPower = Math.round(avgOf(summary.samples, s => s.powerW))
    const hrSamples = summary.samples.filter(s => s.heartRateBpm > 0)
    const avgHR = hrSamples.length ? Math.round(avgOf(hrSamples, s => s.heartRateBpm)) : '--'

    this.#summaryEl.innerHTML = `
      <div class="summary-row"><span>距離</span><span>${distKm} km</span></div>
      <div class="summary-row"><span>時間</span><span>${timeStr}</span></div>
      <div class="summary-row"><span>平均パワー</span><span>${avgPower} W</span></div>
      <div class="summary-row"><span>平均心拍</span><span>${avgHR} bpm</span></div>
    `
  }

  async #handleUpload() {
    const name = this.#nameInput.value.trim() || this.#nameInput.placeholder
    this.#setLoading(true)
    this.#setStatus('保存中...')

    let rideId
    try {
      rideId = await this.#persist()
    } catch (err) {
      this.#setStatus(`保存失敗: ${err.message}`, true)
      this.#setLoading(false)
      return
    }

    this.#setStatus('FIT生成中...')
    let upload
    try {
      upload = prepareUpload(this.#summary, { name })
    } catch (err) {
      await markUploadFailed(rideId, err.message)
      this.#setStatus(`FIT生成失敗: ${err.message}`, true)
      this.#setLoading(false)
      return
    }

    this.#setStatus('Stravaにアップロード中...')
    try {
      const activityId = await uploadToStrava(upload.fitData, upload.meta)
      await markUploaded(rideId, activityId)
      this.#setStatus('アップロード成功！')
      setTimeout(() => this.#close(), 2000)
    } catch (err) {
      await markUploadFailed(rideId, err.message)
      this.#setStatus(`アップロード失敗（ローカルに保存済み）: ${err.message}`, true)
      this.#setLoading(false)
    }
  }

  async #handleSaveOnly() {
    this.#setLoading(true)
    try {
      await this.#persist()
      this.#close()
    } catch (err) {
      this.#setStatus(`保存失敗: ${err.message}`, true)
      this.#setLoading(false)
    }
  }

  #persist() {
    return this.#existingId != null
      ? finalizeDraftRide(this.#existingId, this.#summary)
      : saveRide(this.#summary)
  }

  async #handleDiscard() {
    if (this.#existingId != null) {
      try { await deleteRide(this.#existingId) }
      catch (err) { console.error('下書き削除失敗:', err) }
    }
    this.#close()
  }

  #setLoading(on) {
    this.#uploadBtn.disabled  = on
    this.#saveBtn.disabled    = on
    this.#discardBtn.disabled = on
  }

  #setStatus(msg, isError = false) {
    this.#statusEl.textContent  = msg
    this.#statusEl.className    = `ride-end-status${isError ? ' error' : ''}`
  }

  #close() {
    this.#overlay.classList.remove('open')
    this.#summary    = null
    this.#existingId = null
    this.#setLoading(false)
    this.#onClose?.()
  }
}

function avgOf(arr, fn) {
  return arr.length ? arr.reduce((s, x) => s + fn(x), 0) / arr.length : 0
}

function pad(n) { return String(n).padStart(2, '0') }
