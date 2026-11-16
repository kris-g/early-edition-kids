import { describe, expect, it } from 'vitest'
import { Library, paperOf, samePaper } from './library'
import { Store, memoryKV } from './storage'
import { issue } from './test/fixtures'

const lib = () => {
  const kv = memoryKV()
  return { kv, store: new Store(kv, 'root'), library: new Library(new Store(kv, 'root')) }
}

describe('the papers kept on the iPad', () => {
  it('tells papers apart as the Kindle does', () => {
    expect(paperOf({ profile: 'older', profile_root: true })).toEqual({ id: 'older', root: true })
    expect(paperOf({})).toBeNull()
    // The root data stays the same paper when its owner's id changes from "default".
    expect(samePaper({ id: 'default', root: true }, { id: 'older', root: true })).toBe(true)
    expect(samePaper({ id: 'older', root: true }, { id: 'older', root: false })).toBe(false)
    expect(samePaper({ id: 'older', root: false }, { id: 'younger', root: false })).toBe(false)
  })

  it('updates the same version, takes a newer one only when nothing was opened', () => {
    const { library } = lib()
    expect(library.putIssue(issue(), 1)).toBe('new')
    library.putBody('2026-11-16', 40, { paras: ['x'], word: null, think: '', source: 'S' })
    const hidden = issue({ stories: issue().stories.slice(1), hidden: [40] })
    expect(library.putIssue(hidden, 2)).toBe('updated')
    expect(library.cached('2026-11-16')!.issue.stories.length).toBe(3)
    expect(library.putIssue(issue({ version: 2 }), 3)).toBe('replaced')
    library.markOpened('2026-11-16', 40)
    expect(library.putIssue(issue({ version: 3 }), 4)).toBe('kept')
    expect(library.cached('2026-11-16')!.issue.version).toBe(2)
  })

  it('starts afresh when the server serves a different child here, keeping the settings', () => {
    const { library, store } = lib()
    library.setSettings({ profile: 'older', profile_root: true, title: 'Early Edition', mode: 'pages', age: 8 })
    library.putIssue(issue(), 1)
    library.markRead('2026-11-16', 40)
    store.set('log', [{ story_id: 40 }])
    store.set('queue', [{ client_event_id: 'a' }])
    expect(library.checkPaper(issue())).toBe(false)
    expect(library.checkPaper(issue({ profile: 'younger', profile_root: true }))).toBe(false) // root owner renamed
    expect(library.checkPaper(issue({ profile: 'younger', profile_root: false }))).toBe(true)
    expect(library.cached('2026-11-16')).toBeNull()
    expect(library.readIds('2026-11-16').size).toBe(0)
    expect(store.get('log', null)).toBeNull()
    expect(store.get('queue', null)).toBeNull()
    expect(library.settings()?.title).toBe('Early Edition')
    expect(library.paper()).toEqual({ id: 'younger', root: false })
  })

  it('records each download and front page once per version, and tidies old days', () => {
    const { library } = lib()
    expect(library.firstSeen('2026-11-16', 1)).toBe(true)
    expect(library.firstSeen('2026-11-16', 1)).toBe(false)
    expect(library.firstSeen('2026-11-16', 2)).toBe(true)
    expect(library.firstListed('2026-11-16', 1)).toBe(true)
    expect(library.firstListed('2026-11-16', 1)).toBe(false)
    library.putIssue(issue({ date: '2026-11-01' }), 1)
    library.putIssue(issue({ date: '2026-11-10' }), 1)
    library.markRead('2026-11-01', 40)
    library.setCurrent('2026-11-10')
    library.tidy('2026-11-16')
    expect(library.dates()).toEqual(['2026-11-10'])
    expect(library.readIds('2026-11-01').size).toBe(0)
  })
})
