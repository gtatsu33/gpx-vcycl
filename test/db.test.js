import { describe, it, expect } from 'vitest'
import { initDb, getDb } from '../src/storage/db.js'

describe('db module', () => {
  it('exports initDb and getDb as functions', () => {
    expect(typeof initDb).toBe('function')
    expect(typeof getDb).toBe('function')
  })

  it('getDb throws before initDb is called', () => {
    // Node環境ではIndexedDBが使えないため initDb() は呼ばない
    // getDb() の事前条件チェックのみ検証する
    expect(() => getDb()).toThrow('DB not initialized')
  })
})
