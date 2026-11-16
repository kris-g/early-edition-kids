import { describe, expect, it } from 'vitest'
import { clipPolygon, cornerAt } from './pageturn'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('page curl geometry', () => {
  it('splits the page along the fold', () => {
    const n = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
    const d = 15 * Math.SQRT1_2 // the line x + y = 15
    const kept = clipPolygon(square, n, d, 'below')
    const lifted = clipPolygon(square, n, d, 'above')
    expect(lifted).toHaveLength(3) // just the corner triangle
    expect(kept).toHaveLength(5)
  })

  it('starts on the corner and ends mirrored across the spine', () => {
    expect(cornerAt(0, 400, 600, false)).toEqual({ x: 400, y: 600 })
    const end = cornerAt(1, 400, 600, false)
    expect(end.x).toBeCloseTo(-400)
    expect(end.y).toBeCloseTo(600)
  })

  it('never lets the corner stretch further from the spine than the page is wide', () => {
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const c = cornerAt(p, 400, 600, false)
      expect(Math.hypot(c.x, c.y - 600)).toBeLessThanOrEqual(400 + 1e-6)
    }
  })
})
