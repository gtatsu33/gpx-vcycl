// FIT Protocol: 1989-12-31 00:00:00 UTC をエポックとする
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31)

// Global message numbers
const GMSG = { FILE_ID: 0, ACTIVITY: 34, SESSION: 18, LAP: 19, RECORD: 20 }

// Base types (field_def_num = index into BLE-style type table)
const B = { ENUM: 0x00, UINT8: 0x02, UINT16: 0x84, SINT32: 0x85, UINT32: 0x86 }

// Local message type assignments
const LOCAL = { FILE_ID: 0, ACTIVITY: 1, SESSION: 2, LAP: 3, RECORD: 4 }

// ─── Low-level byte writer ────────────────────────────────────────────────────

class ByteWriter {
  #b = []
  u8(v)  { this.#b.push(v & 0xFF) }
  u16(v) { this.#b.push(v & 0xFF, (v >> 8) & 0xFF) }
  u32(v) { this.#b.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF) }
  s32(v) { this.u32(v >>> 0) }                             // JS >> sign-extends; >>> 0 reinterprets bits
  get bytes() { return new Uint8Array(this.#b) }
  get length() { return this.#b.length }
}

// ─── FIT CRC ─────────────────────────────────────────────────────────────────

function fitCrc(bytes) {
  const T = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,
             0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400]
  let crc = 0
  for (const b of bytes) {
    let t = T[crc & 0xF]; crc = (crc >> 4) & 0xFFF; crc ^= t ^ T[b & 0xF]
    t = T[crc & 0xF];     crc = (crc >> 4) & 0xFFF; crc ^= t ^ T[(b >> 4) & 0xF]
  }
  return crc
}

// ─── Message helpers ──────────────────────────────────────────────────────────

// fields = [[fieldDefNum, sizeBytes, baseType], ...]
function writeDef(w, localType, globalNum, fields) {
  w.u8(0x40 | localType)
  w.u8(0); w.u8(0)          // reserved, little-endian
  w.u16(globalNum)
  w.u8(fields.length)
  for (const [num, size, base] of fields) { w.u8(num); w.u8(size); w.u8(base) }
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function fitTs(ms) { return Math.round((ms - FIT_EPOCH_MS) / 1000) }
function semicircles(deg) { return Math.round(deg * (2 ** 31 / 180)) }

function altRaw(m)  { return m != null ? Math.min(0xFFFE, Math.max(0, Math.round((m + 500) * 5))) : 0xFFFF }
function avg(arr, fn) {
  const valid = arr.filter(x => fn(x) > 0)
  return valid.length ? valid.reduce((s, x) => s + fn(x), 0) / valid.length : 0
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * RideSummaryからFITバイナリを生成する。
 *
 * @param {{
 *   routeName: string,
 *   startedAt: Date,
 *   endedAt:   Date,
 *   samples:   Array<{
 *     timestampMs: number,
 *     lat: number, lon: number, elevationM: number|null,
 *     distanceM: number, velocityMs: number,
 *     powerW: number, cadenceRpm: number, heartRateBpm: number,
 *   }>
 * }} summary
 * @returns {Uint8Array}
 */
export function buildFit(summary) {
  const { startedAt, endedAt, samples } = summary
  const w = new ByteWriter()

  const startTs       = fitTs(startedAt.getTime())
  const endTs         = fitTs(endedAt.getTime())
  const elapsedMs     = endedAt.getTime() - startedAt.getTime()
  const totalDistM    = samples.length > 0 ? samples.at(-1).distanceM : 0
  const avgSpeedMs    = elapsedMs > 0 ? (totalDistM / elapsedMs) * 1000 : 0
  const avgPowerW     = Math.round(avg(samples, s => s.powerW))
  const avgHR         = Math.round(avg(samples, s => s.heartRateBpm))
  const avgCadence    = Math.round(avg(samples, s => s.cadenceRpm))
  const totalAscentM  = calcAscent(samples)

  // ── FileId ────────────────────────────────────────────────────────────────
  // fields: [fieldNum, bytes, baseType]
  writeDef(w, LOCAL.FILE_ID, GMSG.FILE_ID, [
    [0, 1, B.ENUM],   // type
    [1, 2, B.UINT16], // manufacturer
    [2, 2, B.UINT16], // product
    [4, 4, B.UINT32], // time_created
  ])
  w.u8(LOCAL.FILE_ID)
  w.u8(4)                // type: activity
  w.u16(255)             // manufacturer: development
  w.u16(0)               // product
  w.u32(startTs)         // time_created

  // ── Records ───────────────────────────────────────────────────────────────
  if (samples.length > 0) {
    writeDef(w, LOCAL.RECORD, GMSG.RECORD, [
      [253, 4, B.UINT32], // timestamp
      [0,   4, B.SINT32], // position_lat  (semicircles)
      [1,   4, B.SINT32], // position_long (semicircles)
      [2,   2, B.UINT16], // altitude      ((m+500)*5)
      [5,   4, B.UINT32], // distance      (m*100)
      [6,   2, B.UINT16], // speed         (m/s*1000)
      [7,   2, B.UINT16], // power         (W)
      [3,   1, B.UINT8],  // heart_rate    (bpm)
      [4,   1, B.UINT8],  // cadence       (rpm)
    ])

    for (const s of samples) {
      w.u8(LOCAL.RECORD)
      w.u32(fitTs(s.timestampMs))
      w.s32(semicircles(s.lat))
      w.s32(semicircles(s.lon))
      w.u16(altRaw(s.elevationM))
      w.u32(Math.round(s.distanceM * 100))
      w.u16(Math.round(s.velocityMs * 1000))
      w.u16(Math.max(0, Math.round(s.powerW)))
      w.u8(Math.max(0, Math.round(s.heartRateBpm)))
      w.u8(Math.max(0, Math.round(s.cadenceRpm)))
    }
  }

  // ── Lap ───────────────────────────────────────────────────────────────────
  writeDef(w, LOCAL.LAP, GMSG.LAP, [
    [253, 4, B.UINT32], // timestamp
    [0,   1, B.ENUM],   // event
    [1,   1, B.ENUM],   // event_type
    [2,   4, B.UINT32], // start_time
    [7,   4, B.UINT32], // total_elapsed_time (scale 1000)
    [9,   4, B.UINT32], // total_distance (scale 100)
    [25,  2, B.UINT16], // message_index
  ])
  w.u8(LOCAL.LAP)
  w.u32(endTs)
  w.u8(9)                              // event: lap
  w.u8(1)                              // event_type: stop
  w.u32(startTs)
  w.u32(Math.round(elapsedMs))
  w.u32(Math.round(totalDistM * 100))
  w.u16(0)

  // ── Session ───────────────────────────────────────────────────────────────
  writeDef(w, LOCAL.SESSION, GMSG.SESSION, [
    [253, 4, B.UINT32], // timestamp
    [0,   1, B.ENUM],   // event
    [1,   1, B.ENUM],   // event_type
    [2,   4, B.UINT32], // start_time
    [5,   1, B.ENUM],   // sport
    [6,   1, B.ENUM],   // sub_sport
    [7,   4, B.UINT32], // total_elapsed_time (scale 1000)
    [9,   4, B.UINT32], // total_distance (scale 100)
    [14,  2, B.UINT16], // avg_speed (scale 1000)
    [17,  1, B.UINT8],  // avg_heart_rate
    [19,  1, B.UINT8],  // avg_cadence
    [20,  2, B.UINT16], // avg_power
    [22,  2, B.UINT16], // total_ascent
  ])
  w.u8(LOCAL.SESSION)
  w.u32(endTs)
  w.u8(9)                              // event: session
  w.u8(1)                              // event_type: stop
  w.u32(startTs)
  w.u8(2)                              // sport: cycling
  w.u8(58)                             // sub_sport: virtual_activity
  w.u32(Math.round(elapsedMs))
  w.u32(Math.round(totalDistM * 100))
  w.u16(Math.round(avgSpeedMs * 1000))
  w.u8(avgHR)
  w.u8(avgCadence)
  w.u16(avgPowerW)
  w.u16(Math.round(totalAscentM))

  // ── Activity ──────────────────────────────────────────────────────────────
  writeDef(w, LOCAL.ACTIVITY, GMSG.ACTIVITY, [
    [253, 4, B.UINT32], // timestamp
    [0,   4, B.UINT32], // total_timer_time (scale 1000)
    [1,   2, B.UINT16], // num_sessions
    [2,   1, B.ENUM],   // type
    [3,   1, B.ENUM],   // event
    [4,   1, B.ENUM],   // event_type
  ])
  w.u8(LOCAL.ACTIVITY)
  w.u32(endTs)
  w.u32(Math.round(elapsedMs))   // milliseconds
  w.u16(1)                       // 1 session
  w.u8(0)                        // type: manual
  w.u8(26)                       // event: activity
  w.u8(1)                        // event_type: stop

  // ── Assemble with header + CRC ────────────────────────────────────────────
  const data    = w.bytes
  const header  = buildHeader(data.length)
  const dataCrc = fitCrc(data)

  const result = new Uint8Array(header.length + data.length + 2)
  result.set(header)
  result.set(data, header.length)
  result[header.length + data.length]     = dataCrc & 0xFF
  result[header.length + data.length + 1] = (dataCrc >> 8) & 0xFF
  return result
}

/**
 * ワークアウト（GPS無し）のFITバイナリを生成する。Stravaにtrainer=1でアップロードする用。
 *
 * @param {{
 *   workoutName: string,
 *   startedAt: Date,
 *   endedAt:   Date,
 *   samples:   Array<{
 *     timestampMs: number,
 *     powerW: number, cadenceRpm: number, heartRateBpm: number,
 *   }>
 * }} summary
 * @returns {Uint8Array}
 */
export function buildWorkoutFit(summary) {
  const { startedAt, endedAt, samples } = summary
  const w = new ByteWriter()

  const startTs    = fitTs(startedAt.getTime())
  const endTs      = fitTs(endedAt.getTime())
  const elapsedMs  = endedAt.getTime() - startedAt.getTime()
  const avgPowerW  = Math.round(avg(samples, s => s.powerW))
  const avgHR      = Math.round(avg(samples, s => s.heartRateBpm))
  const avgCadence = Math.round(avg(samples, s => s.cadenceRpm))

  writeDef(w, LOCAL.FILE_ID, GMSG.FILE_ID, [
    [0, 1, B.ENUM],   // type
    [1, 2, B.UINT16], // manufacturer
    [2, 2, B.UINT16], // product
    [4, 4, B.UINT32], // time_created
  ])
  w.u8(LOCAL.FILE_ID)
  w.u8(4); w.u16(255); w.u16(0); w.u32(startTs)

  if (samples.length > 0) {
    writeDef(w, LOCAL.RECORD, GMSG.RECORD, [
      [253, 4, B.UINT32], // timestamp
      [7,   2, B.UINT16], // power (W)
      [3,   1, B.UINT8],  // heart_rate (bpm)
      [4,   1, B.UINT8],  // cadence (rpm)
    ])
    for (const s of samples) {
      w.u8(LOCAL.RECORD)
      w.u32(fitTs(s.timestampMs))
      w.u16(Math.max(0, Math.round(s.powerW)))
      w.u8(Math.max(0, Math.round(s.heartRateBpm)))
      w.u8(Math.max(0, Math.round(s.cadenceRpm)))
    }
  }

  writeDef(w, LOCAL.LAP, GMSG.LAP, [
    [253, 4, B.UINT32], // timestamp
    [0,   1, B.ENUM],   // event
    [1,   1, B.ENUM],   // event_type
    [2,   4, B.UINT32], // start_time
    [7,   4, B.UINT32], // total_elapsed_time
    [25,  2, B.UINT16], // message_index
  ])
  w.u8(LOCAL.LAP)
  w.u32(endTs); w.u8(9); w.u8(1); w.u32(startTs)
  w.u32(Math.round(elapsedMs)); w.u16(0)

  writeDef(w, LOCAL.SESSION, GMSG.SESSION, [
    [253, 4, B.UINT32], // timestamp
    [0,   1, B.ENUM],   // event
    [1,   1, B.ENUM],   // event_type
    [2,   4, B.UINT32], // start_time
    [5,   1, B.ENUM],   // sport
    [6,   1, B.ENUM],   // sub_sport
    [7,   4, B.UINT32], // total_elapsed_time
    [17,  1, B.UINT8],  // avg_heart_rate
    [19,  1, B.UINT8],  // avg_cadence
    [20,  2, B.UINT16], // avg_power
  ])
  w.u8(LOCAL.SESSION)
  w.u32(endTs); w.u8(9); w.u8(1); w.u32(startTs)
  w.u8(2)   // sport: cycling
  w.u8(6)   // sub_sport: indoor_cycling
  w.u32(Math.round(elapsedMs))
  w.u8(avgHR); w.u8(avgCadence); w.u16(avgPowerW)

  writeDef(w, LOCAL.ACTIVITY, GMSG.ACTIVITY, [
    [253, 4, B.UINT32], // timestamp
    [0,   4, B.UINT32], // total_timer_time
    [1,   2, B.UINT16], // num_sessions
    [2,   1, B.ENUM],   // type
    [3,   1, B.ENUM],   // event
    [4,   1, B.ENUM],   // event_type
  ])
  w.u8(LOCAL.ACTIVITY)
  w.u32(endTs); w.u32(Math.round(elapsedMs))
  w.u16(1); w.u8(0); w.u8(26); w.u8(1)

  const data    = w.bytes
  const header  = buildHeader(data.length)
  const dataCrc = fitCrc(data)
  const result  = new Uint8Array(header.length + data.length + 2)
  result.set(header)
  result.set(data, header.length)
  result[header.length + data.length]     = dataCrc & 0xFF
  result[header.length + data.length + 1] = (dataCrc >> 8) & 0xFF
  return result
}

function buildHeader(dataSize) {
  const h  = new Uint8Array(14)
  const dv = new DataView(h.buffer)
  h[0] = 14                             // header size
  h[1] = 0x20                           // protocol version 2.0
  dv.setUint16(2, 2132, true)           // profile version 21.32
  dv.setUint32(4, dataSize, true)       // data size
  h[8] = 0x2E; h[9] = 0x46; h[10] = 0x49; h[11] = 0x54  // ".FIT"
  dv.setUint16(12, fitCrc(h.subarray(0, 12)), true)
  return h
}

function calcAscent(samples) {
  let gain = 0
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].elevationM
    const curr = samples[i].elevationM
    if (prev != null && curr != null && curr > prev) gain += curr - prev
  }
  return gain
}
