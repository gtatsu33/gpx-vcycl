import { describe, it, expect } from 'vitest'
import { parseControlPointResponse } from '../../src/ble/ftms.js'
import { FTMS_OPCODE, FTMS_RESULT } from '../../src/ble/constants.js'

function dv(...bytes) {
  return new DataView(new Uint8Array(bytes).buffer)
}

describe('parseControlPointResponse', () => {
  it('SUCCESS response for requestControl (0x00)', () => {
    const result = parseControlPointResponse(dv(0x80, 0x00, 0x01))
    expect(result).toEqual({ requestOpcode: 0x00, resultCode: 0x01 })
  })

  it('SUCCESS response for setSimulationParameters (0x11)', () => {
    const result = parseControlPointResponse(dv(0x80, 0x11, 0x01))
    expect(result).toEqual({ requestOpcode: 0x11, resultCode: 0x01 })
  })

  it('INVALID_PARAMETER error for setSimulationParameters', () => {
    const result = parseControlPointResponse(dv(0x80, 0x11, FTMS_RESULT.INVALID_PARAMETER))
    expect(result).toEqual({ requestOpcode: 0x11, resultCode: 0x03 })
  })

  it('OP_CODE_NOT_SUPPORTED error', () => {
    const result = parseControlPointResponse(dv(0x80, 0x05, FTMS_RESULT.OP_CODE_NOT_SUPPORTED))
    expect(result).toEqual({ requestOpcode: 0x05, resultCode: 0x02 })
  })

  it('returns null for non-response byte (not 0x80)', () => {
    expect(parseControlPointResponse(dv(0x00, 0x00, 0x01))).toBeNull()
  })

  it('returns null for packet shorter than 3 bytes', () => {
    expect(parseControlPointResponse(dv(0x80, 0x00))).toBeNull()
  })

  it('returns null for empty packet', () => {
    expect(parseControlPointResponse(dv())).toBeNull()
  })

  it('extra bytes beyond 3 are ignored', () => {
    const result = parseControlPointResponse(dv(0x80, 0x00, 0x01, 0xFF, 0xAB))
    expect(result).toEqual({ requestOpcode: 0x00, resultCode: 0x01 })
  })
})
