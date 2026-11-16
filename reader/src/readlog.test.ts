import { describe, expect, it } from 'vitest'
import { ReadingLog, myWeek, streak, type LogEntry } from './readlog'
import { Store, memoryKV } from './storage'

const e = (day: string, id: number, over: Partial<LogEntry> = {}): LogEntry => ({
  date: day, story_id: id, topic: 'Space', title: 't', active_seconds: 60, finished: true, ts: 0, day, ...over,
})

describe('the reading log', () => {
  it('counts a streak ending today or yesterday, and only finished stories', () => {
    const log = [e('2026-11-14', 1), e('2026-11-15', 2), e('2026-11-13', 3, { finished: false })]
    expect(streak(log, '2026-11-16')).toBe(2)
    expect(streak(log, '2026-11-15')).toBe(2)
    expect(streak(log, '2026-11-17')).toBe(0)
  })

  it('makes My week from this week only: days, stories, topics and words', () => {
    const log = [
      e('2026-11-15', 1), // last week (Sunday)
      e('2026-11-16', 2, { topic: 'Science', word: 'orbit', definition: 'a path round a planet' }),
      e('2026-11-16', 2, { topic: 'Science', word: 'orbit' }), // read again
      e('2026-11-17', 3, { word: 'Orbit' }),
      e('2026-11-17', 4, { finished: false, word: 'comet' }),
    ]
    const m = myWeek(log, '2026-11-17')
    expect(m.range).toBe('Monday 16 to Sunday 22 November')
    expect(m.days.map((d) => [d.letter, d.count, d.when])).toEqual([
      ['M', 1, 'past'], ['T', 1, 'today'], ['W', 0, 'future'], ['T', 0, 'future'], ['F', 0, 'future'], ['S', 0, 'future'], ['S', 0, 'future'],
    ])
    expect(m.total).toBe(2)
    expect(m.streak).toBe(3)
    expect(m.topics).toEqual([{ name: 'Science', n: 1 }, { name: 'Space', n: 1 }])
    expect(m.words).toEqual([{ word: 'orbit', definition: 'a path round a planet' }])
  })

  it('drops entries from before a reading reset, and older than a year', () => {
    const log = new ReadingLog(new Store(memoryKV(), 'root'))
    log.append(e('2025-11-01', 1))
    log.append(e('2026-11-10', 2))
    log.append(e('2026-11-14', 3))
    expect(log.prune('2026-11-16')).toBe(1)
    expect(log.dropBefore('2026-11-12')).toBe(1)
    expect(log.entries().map((x) => x.story_id)).toEqual([3])
  })
})
