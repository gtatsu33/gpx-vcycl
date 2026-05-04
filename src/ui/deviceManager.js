import { FtmsClient }     from '../ble/ftms.js'
import { MockFtmsClient } from '../ble/ftms.mock.js'
import { CpsClient }      from '../ble/cps.js'
import { MockCpsClient }  from '../ble/cps.mock.js'
import { HrsClient }      from '../ble/hrs.js'
import { MockHrsClient }  from '../ble/hrs.mock.js'
import { getDb }          from '../storage/db.js'

/**
 * @returns {Promise<{ getLiveData: () => { powerW: number, cadenceRpm: number, heartRateBpm: number } }>}
 */
export async function initDeviceManager() {
  const isMock = new URLSearchParams(location.search).has('mock')

  const ftms = isMock ? new MockFtmsClient() : new FtmsClient()
  const cps  = isMock ? new MockCpsClient()  : new CpsClient()
  const hrs  = isMock ? new MockHrsClient()  : new HrsClient()

  const db = getDb()
  let powerSource = (await db.get('settings', 'powerSource')) ?? 'trainer'

  const latestPowerW   = { trainer: null, powerMeter: null }
  const logEl          = document.getElementById('ble-log')
  const activePowerEl  = document.getElementById('active-power-value')
  const activeSrcEl    = document.getElementById('active-power-source')

  // Live data read by RideController
  const live = { powerW: 0, cadenceRpm: 0, heartRateBpm: 0 }

  function appendLog(msg) {
    const time = new Date().toLocaleTimeString('ja-JP')
    logEl.textContent = `[${time}] ${msg}\n` + logEl.textContent
  }

  function updateActivePower() {
    const key = powerSource === 'trainer' ? 'trainer' : 'powerMeter'
    const w = latestPowerW[key]
    activePowerEl.textContent = w != null ? Math.round(w).toString() : '--'
    activeSrcEl.textContent   = powerSource === 'trainer' ? 'Trainer' : 'Power Meter'
  }

  // Power source radio buttons
  document.querySelectorAll('input[name="power-source"]').forEach((radio) => {
    radio.checked = radio.value === powerSource
    radio.addEventListener('change', async (e) => {
      powerSource = e.target.value
      live.powerW    = 0
      live.cadenceRpm = 0
      await db.put('settings', powerSource, 'powerSource')
      updateActivePower()
    })
  })

  function wireCard(client, cardId, deviceName, dbKey) {
    const card          = document.getElementById(cardId)
    const statusEl      = card.querySelector('.status-badge')
    const connectBtn    = card.querySelector('.connect-btn')
    const disconnectBtn = card.querySelector('.disconnect-btn')

    function setStatus(state) {
      statusEl.textContent   = { disconnected: '未接続', connecting: '接続中...', connected: '接続済' }[state]
      statusEl.className     = `status-badge ${state}`
      connectBtn.disabled    = state !== 'disconnected'
      disconnectBtn.disabled = state !== 'connected'
    }

    client.onConnectionStateChange((state) => {
      setStatus(state)
      if (state === 'connected' && client.device?.name) {
        db.put('settings', client.device.name, dbKey).catch(() => {})
        connectBtn.title = client.device.name
      }
      if (state === 'disconnected') {
        card.querySelectorAll('.metric-value').forEach((el) => { el.textContent = '--' })
      }
      appendLog(`${deviceName}: ${state === 'connected' ? '接続しました' : '切断されました'}`)
    })

    connectBtn.addEventListener('click', async () => {
      setStatus('connecting')
      const savedName = await db.get('settings', dbKey)
      if (savedName) appendLog(`${deviceName}: 前回のデバイス「${savedName}」に接続中...`)
      else           appendLog(`${deviceName}: 接続を試みています...`)
      try {
        await client.connect(savedName ?? null)
      } catch (err) {
        setStatus('disconnected')
        appendLog(`${deviceName}: エラー: ${err.message}`)
      }
    })

    disconnectBtn.addEventListener('click', () => client.disconnect())

    // 保存済みデバイス名をボタンのツールチップに反映
    db.get('settings', dbKey).then((name) => {
      if (name) connectBtn.title = `前回: ${name}`
    })
  }

  // --- Trainer (FTMS) ---
  ftms.onControlLog((msg) => appendLog(`Trainer制御: ${msg}`))
  wireCard(ftms, 'trainer-card', 'Trainer', 'lastFtmsDeviceId')
  ftms.onIndoorBikeData(({ speedKmh, cadenceRpm, powerW }) => {
    if (speedKmh   != null) setText('trainer-speed',   speedKmh.toFixed(1))
    if (cadenceRpm != null) setText('trainer-cadence', Math.round(cadenceRpm))
    if (powerW     != null) {
      setText('trainer-power', Math.round(powerW))
      latestPowerW.trainer = powerW
      updateActivePower()
    }
    if (powerSource === 'trainer') {
      if (powerW     != null) live.powerW    = powerW
      if (cadenceRpm != null) live.cadenceRpm = cadenceRpm
    }
  })

  // --- Power Meter (CPS) ---
  wireCard(cps, 'power-meter-card', 'Power Meter', 'lastCpsDeviceId')
  cps.onPowerData(({ powerW, cadenceRpm }) => {
    if (powerW     != null) {
      setText('cps-power', Math.round(powerW))
      latestPowerW.powerMeter = powerW
      updateActivePower()
    }
    if (cadenceRpm != null) setText('cps-cadence', Math.round(cadenceRpm))
    if (powerSource === 'powerMeter') {
      if (powerW     != null) live.powerW    = powerW
      if (cadenceRpm != null) live.cadenceRpm = cadenceRpm
    }
  })

  // --- Heart Rate (HRS) ---
  wireCard(hrs, 'heart-rate-card', 'Heart Rate', 'lastHrsDeviceId')
  hrs.onHeartRateData(({ heartRateBpm }) => {
    if (heartRateBpm != null) {
      setText('hr-bpm', heartRateBpm)
      live.heartRateBpm = heartRateBpm
    }
  })

  if (isMock) {
    appendLog('モックモードで動作中（?mock=1）— デバイス自動接続中...')
    setTimeout(async () => {
      try { await ftms.connect() } catch (e) { console.error('mock ftms:', e) }
      try { await cps.connect()  } catch (e) { console.error('mock cps:',  e) }
      try { await hrs.connect()  } catch (e) { console.error('mock hrs:',  e) }
    }, 100)
  }
  updateActivePower()

  return { getLiveData: () => ({ ...live }), ftmsClient: ftms }
}

function setText(id, value) {
  document.getElementById(id).textContent = value.toString()
}
