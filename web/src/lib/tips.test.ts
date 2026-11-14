import { describe, expect, it } from 'vitest'
import { costTip, dayTip, stageTip, topicTip } from './tips'

const today = '2026-11-13'

describe('tooltip text', () => {
  it('a read day: date, stories read of the paper, minutes', () => {
    expect(dayTip({ date: '2026-11-10', issue: true, stories: 6, read: 5, minutes: 9 }, today)).toBe(
      'Tue 10 Nov · 5 of 6 stories read · 9 min reading',
    )
  })

  it('a missed day', () => {
    expect(dayTip({ date: '2026-11-09', issue: true, stories: 6, read: 0, minutes: 0 }, today)).toBe('Mon 9 Nov · Not read')
  })

  it('a day without a paper', () => {
    expect(dayTip({ date: '2026-11-08', issue: false, stories: 0, read: 0, minutes: 0 }, today)).toBe('Sun 8 Nov · No paper')
    expect(dayTip({ date: '2026-11-08', issue: false, stories: 0, read: 2, minutes: 3 }, today)).toBe(
      'Sun 8 Nov · No paper · 2 stories read · 3 min reading',
    )
  })

  it('a future day', () => {
    expect(dayTip({ date: '2026-11-14', issue: false, stories: 0, read: 0, minutes: 0 }, today)).toBe('Sat 14 Nov · Not yet')
  })

  it('keeps one decimal like the chart labels', () => {
    expect(dayTip({ date: '2026-11-08', issue: true, stories: 6, read: 6, minutes: 11.9 }, today)).toBe(
      'Sun 8 Nov · 6 of 6 stories read · 11.9 min reading',
    )
  })

  it('a short read with no whole minute', () => {
    expect(dayTip({ date: '2026-11-13', issue: true, stories: 6, read: 1, minutes: 0.5 }, today)).toBe(
      'Fri 13 Nov · 1 of 6 stories read · 0.5 min reading',
    )
  })

  it('a cost bar, with calls only when known', () => {
    expect(costTip('2026-11-10', 0.36)).toBe('Tue 10 Nov · $0.36')
    expect(costTip('2026-11-10', 0.36, 15)).toBe('Tue 10 Nov · $0.36 · 15 calls')
  })

  it('stage and topic bars', () => {
    expect(stageTip('Writing', 7, 0.3, 0.46)).toBe('Writing · 7 calls · $0.30 (65%)')
    expect(topicTip('Football', 10, 13)).toBe('Football · 10 of 13 read (77%)')
    expect(topicTip('Weather', 0, 0)).toBe('Weather · none shown')
  })
})
