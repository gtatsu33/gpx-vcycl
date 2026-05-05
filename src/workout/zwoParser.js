/**
 * ZWOファイル（Zwift Workout XML）をパースしてセグメント配列を返す。
 *
 * 返す各セグメント:
 * {
 *   type:        'steady' | 'ramp' | 'intervals' | 'free',
 *   durationS:   number,          // 全体の秒数
 *   powerLowFtp: number,          // 開始FTP比率 (0.0–x.xx)
 *   powerHighFtp: number,         // 終了FTP比率（steadyは同値）
 *   cadenceRpm:  number | null,   // 指定がなければnull
 *   // intervals のみ:
 *   onDurationS:  number | undefined,
 *   offDurationS: number | undefined,
 *   onPowerFtp:   number | undefined,
 *   offPowerFtp:  number | undefined,
 *   repeatCount:  number | undefined,
 * }
 */

function attr(el, ...names) {
  for (const n of names) {
    const v = el.getAttribute(n) ?? el.getAttribute(n.toLowerCase())
    if (v !== null) return parseFloat(v)
  }
  return null
}

function cadence(el) {
  return attr(el, 'Cadence', 'cadence') ?? null
}

function parseSteady(el) {
  const dur  = attr(el, 'Duration', 'duration') ?? 0
  const pow  = attr(el, 'Power', 'power') ?? 1.0
  return {
    type: 'steady',
    durationS: dur,
    powerLowFtp: pow,
    powerHighFtp: pow,
    cadenceRpm: cadence(el),
  }
}

function parseRamp(el, invert = false) {
  const dur   = attr(el, 'Duration', 'duration') ?? 0
  let lo      = attr(el, 'PowerLow', 'powerLow') ?? 0.5
  let hi      = attr(el, 'PowerHigh', 'powerHigh') ?? 1.0
  if (invert) [lo, hi] = [hi, lo]
  return {
    type: 'ramp',
    durationS: dur,
    powerLowFtp: lo,
    powerHighFtp: hi,
    cadenceRpm: cadence(el),
  }
}

function parseIntervals(el) {
  const repeat = attr(el, 'Repeat', 'repeat') ?? 1
  const onD    = attr(el, 'OnDuration', 'onDuration') ?? 30
  const offD   = attr(el, 'OffDuration', 'offDuration') ?? 30
  const onP    = attr(el, 'OnPower', 'onPower') ?? 1.0
  const offP   = attr(el, 'OffPower', 'offPower') ?? 0.5
  return {
    type: 'intervals',
    durationS: (onD + offD) * repeat,
    powerLowFtp: offP,
    powerHighFtp: onP,
    cadenceRpm: cadence(el),
    repeatCount: repeat,
    onDurationS: onD,
    offDurationS: offD,
    onPowerFtp: onP,
    offPowerFtp: offP,
  }
}

function parseFreeRide(el) {
  const dur = attr(el, 'Duration', 'duration') ?? 0
  return {
    type: 'free',
    durationS: dur,
    powerLowFtp: 0,
    powerHighFtp: 0,
    cadenceRpm: cadence(el),
  }
}

/**
 * @param {string} xmlText
 * @returns {{ name: string, segments: Array }}
 */
export function parseZwo(xmlText) {
  const parser = new DOMParser()
  const doc    = parser.parseFromString(xmlText, 'application/xml')
  const err    = doc.querySelector('parsererror')
  if (err) throw new Error(`ZWO parse error: ${err.textContent}`)

  const nameEl = doc.querySelector('name')
  const name   = nameEl?.textContent?.trim() || 'ワークアウト'

  const workoutEl = doc.querySelector('workout')
  if (!workoutEl) throw new Error('ZWO: <workout> element not found')

  const segments = []
  for (const child of workoutEl.children) {
    const tag = child.tagName
    if (tag === 'SteadyState') {
      segments.push(parseSteady(child))
    } else if (tag === 'Warmup') {
      segments.push(parseRamp(child, false))
    } else if (tag === 'Cooldown') {
      segments.push(parseRamp(child, true))
    } else if (tag === 'IntervalsT') {
      segments.push(parseIntervals(child))
    } else if (tag === 'FreeRide') {
      segments.push(parseFreeRide(child))
    }
    // TextEvent など未対応タグは無視
  }

  return { name, segments }
}

/** ZWOセグメント配列から総時間（秒）を返す */
export function totalDurationS(segments) {
  return segments.reduce((s, seg) => s + seg.durationS, 0)
}

/**
 * 指定したFTP比率に対応する表示色を返す。
 * @param {number} ftp   FTP比率 (0.0–x.xx)
 */
export function ftpColor(ftp) {
  if (ftp < 0.60) return '#888888'
  if (ftp < 0.75) return '#4488ff'
  if (ftp < 0.90) return '#44cc44'
  if (ftp < 1.05) return '#cccc00'
  if (ftp < 1.18) return '#ff8800'
  return '#ff3333'
}
