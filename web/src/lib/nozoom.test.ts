import { afterEach, describe, expect, it } from 'vitest'
import { blockZoom } from './nozoom'

const touchMove = (fingers: number) => {
  const e = new Event('touchmove', { cancelable: true })
  Object.defineProperty(e, 'touches', { value: Array.from({ length: fingers }) })
  return e
}

describe('blockZoom', () => {
  let stop = () => {}
  afterEach(() => stop())

  it("cancels iPhone pinch gestures and two-finger moves, but not one-finger scrolling", () => {
    stop = blockZoom(document)
    const pinch = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)

    const two = touchMove(2)
    document.dispatchEvent(two)
    expect(two.defaultPrevented).toBe(true)

    const one = touchMove(1)
    document.dispatchEvent(one)
    expect(one.defaultPrevented).toBe(false)
  })

  it('can be undone', () => {
    blockZoom(document)()
    const two = touchMove(2)
    document.dispatchEvent(two)
    expect(two.defaultPrevented).toBe(false)
  })
})
