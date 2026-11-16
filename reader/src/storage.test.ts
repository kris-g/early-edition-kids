import { describe, expect, it } from 'vitest'
import { Store, deviceId, memoryKV, namespaceFor, uuid } from './storage'

describe('storage', () => {
  it('namespaces each profile mount', () => {
    expect(namespaceFor('/read/')).toBe('root')
    expect(namespaceFor('/')).toBe('root')
    expect(namespaceFor('/p/younger/read/')).toBe('p:younger')
    expect(namespaceFor('/p/older/read/index.html')).toBe('p:older')
  })

  it('keeps profiles apart and clears one without touching another or the device id', () => {
    const kv = memoryKV()
    const a = new Store(kv, 'root')
    const b = new Store(kv, 'p:younger')
    const id = deviceId(kv, () => 'device-1234')
    a.set('log', [1])
    b.set('log', [2])
    expect(a.get('log', [])).toEqual([1])
    expect(b.get('log', [])).toEqual([2])
    a.clear()
    expect(a.get('log', null)).toBeNull()
    expect(b.get('log', [])).toEqual([2])
    expect(deviceId(kv, () => 'other-9999')).toBe(id)
  })

  it('falls back when a value is not JSON', () => {
    const kv = memoryKV()
    kv.set('eek.root.x', '{nope')
    expect(new Store(kv, 'root').get('x', 5)).toBe(5)
  })

  it('makes version 4 UUIDs', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
