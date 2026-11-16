import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK, SIZES, applyLook, readLook } from './look'

describe('the look', () => {
  it('falls back to the default for anything it does not know', () => {
    expect(readLook(null)).toEqual(DEFAULT_LOOK)
    expect(readLook({ theme: 'neon', size: 99 })).toEqual(DEFAULT_LOOK)
    expect(readLook({ theme: 'night', size: 1.5 })).toEqual({ theme: 'night', size: DEFAULT_LOOK.size })
    expect(readLook({ theme: 'sepia', size: 0 })).toEqual({ theme: 'sepia', size: 0 })
  })

  it('leaves the age band’s own size in the middle', () => {
    expect(SIZES[DEFAULT_LOOK.size]).toBe(1)
  })

  it('puts the theme on <html> and colours the status bar to match', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#fafaf7">'
    applyLook({ theme: 'night', size: 4 })
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(document.documentElement.style.getPropertyValue('--fs')).toBe(String(SIZES[4]))
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#1c1b19')
  })
})
