/**
 * CPS の Crank Revolution Data からケイデンス(rpm)を計算するクロージャを返す。
 *
 * cumulativeCrankRevolutions と lastCrankEventTime はどちらも uint16 でラップアラウンドする。
 *   - lastCrankEventTime 単位: 1/1024 秒、64秒で一周
 *   - cumulativeCrankRevolutions: 65535 回転で一周
 *
 * @param {{ staleTimeoutMs?: number }} options
 * @returns {(revolutions: number, eventTime: number) => number}
 */
export function createCadenceCalculator({ staleTimeoutMs = 2000 } = {}) {
  let prevRevolutions = null
  let prevEventTime = null
  let lastCadenceRpm = 0
  let lastEventWallMs = 0

  return function update(cumulativeCrankRevolutions, lastCrankEventTime) {
    if (prevRevolutions === null) {
      prevRevolutions = cumulativeCrankRevolutions
      prevEventTime = lastCrankEventTime
      lastEventWallMs = Date.now()
      return 0
    }

    const deltaRevolutions = (cumulativeCrankRevolutions - prevRevolutions + 0x10000) & 0xFFFF
    const deltaEventTime   = (lastCrankEventTime - prevEventTime + 0x10000) & 0xFFFF

    if (deltaEventTime === 0) {
      // 新規クランクイベントなし: stale タイムアウトを超えたら 0 を返す
      return (Date.now() - lastEventWallMs) >= staleTimeoutMs ? 0 : lastCadenceRpm
    }

    prevRevolutions = cumulativeCrankRevolutions
    prevEventTime = lastCrankEventTime
    lastEventWallMs = Date.now()

    // deltaEventTime 単位: 1/1024 秒
    lastCadenceRpm = (deltaRevolutions * 60 * 1024) / deltaEventTime
    return lastCadenceRpm
  }
}
