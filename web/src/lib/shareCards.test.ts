import { describe, expect, it } from 'vitest'
import { shareView } from '../test/fixtures'
import { buildCards, cleanName, mastheadDate, mastheadRange, possessive, type ShareCard } from './shareCards'

const byId = <K extends ShareCard['id']>(cards: ShareCard[], id: K) => cards.find((c) => c.id === id) as Extract<ShareCard, { id: K }>

describe('share card text', () => {
  it('formats masthead dates', () => {
    expect(mastheadDate('2026-11-14')).toBe('SAT 14 NOV 2026')
    expect(mastheadRange('2026-11-08', '2026-11-14')).toBe('8 – 14 NOV 2026')
    expect(mastheadRange('2026-10-28', '2026-11-03')).toBe('28 OCT – 3 NOV 2026')
  })

  it('tidies the name and makes possessives', () => {
    expect(cleanName('  Sam   B  ')).toBe('Sam B')
    expect(cleanName('x'.repeat(30))).toHaveLength(20)
    expect(possessive('Sam')).toBe('Sam’s')
    expect(possessive('James')).toBe('James’')
  })

  it('makes six cards in order, all ready with this data', () => {
    const cards = buildCards(shareView(), '')
    expect(cards.map((c) => c.id)).toEqual(['streak', 'today', 'week', 'milestone', 'words', 'ask'])
    expect(cards.every((c) => c.ready)).toBe(true)
    expect(cards.every((c) => c.filename === `early-edition-${c.id}-2026-11-14.png`)).toBe(true)
  })

  it('reads well with and without a name', () => {
    const plain = buildCards(shareView(), '')
    const named = buildCards(shareView(), 'H.')
    expect(byId(plain, 'streak').sentence).toBe('Reading the news every day since Wednesday 11 November.')
    expect(byId(named, 'streak').sentence).toBe('H. has read the news every day since Wednesday 11 November.')
    expect(byId(plain, 'today').headline).toBe('3 stories read today')
    expect(byId(named, 'today').headline).toBe('H. read 3 stories today')
    expect(byId(named, 'week').headline).toBe('H. read on 6 of 7 days')
    expect(byId(named, 'words').headline).toBe('2 new words in H.’s week')
    expect(byId(plain, 'ask').headline).toBe('Ask me about…')
    expect(byId(named, 'ask').headline).toBe('Ask H. about…')
    expect(byId(named, 'milestone')).toMatchObject({ headline: 'Half a century!', sentence: 'H. read story number 50 today:' })
  })

  it('marks the streak strip and the missed day', () => {
    const streak = byId(buildCards(shareView(), ''), 'streak')
    expect(streak.days).toHaveLength(14)
    expect(streak.days.slice(-4).every((d) => d.state === 'current')).toBe(true)
    expect(streak.days[9].state).toBe('missed')
    expect(streak.missedNote).toBe('Missed one: Tue 10')
    expect(streak.daysRead).toBe(13)
  })

  it('explains cards that are not ready yet', () => {
    const cards = buildCards(
      shareView({
        streak: { current: 1, current_since: '2026-11-14', longest: 3, longest_from: null, longest_to: null },
        today_read: { stories: [], minutes: 0, in_paper: 6 },
        milestone: null,
        total_read: 7,
        words: [],
        ask: { date: null, stories: [] },
      }),
      '',
    )
    expect(byId(cards, 'streak')).toMatchObject({ ready: false, empty: expect.stringContaining('second day') })
    expect(byId(cards, 'today').ready).toBe(false)
    expect(byId(cards, 'milestone')).toMatchObject({ ready: false, empty: 'Milestones start at 10 stories. 7 stories read so far.' })
    expect(byId(cards, 'words').ready).toBe(false)
    expect(byId(cards, 'ask').ready).toBe(false)
    expect(byId(cards, 'week').ready).toBe(true)
  })
})
