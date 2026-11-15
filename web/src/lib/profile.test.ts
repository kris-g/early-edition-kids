import { afterEach, describe, expect, it } from 'vitest'
import {
  SINGLE,
  apiRootFor,
  basenameFor,
  pathForSwitch,
  profileKey,
  resolveLocation,
  setCurrentProfile,
  splitPath,
} from './profile'

const TWO = [
  { id: 'older', title: 'Early Edition' },
  { id: 'younger', title: 'Little Edition' },
]
const ONE = [{ id: 'default', title: 'Early Edition' }]

afterEach(() => setCurrentProfile(SINGLE))

describe('profile paths', () => {
  it('keeps one child exactly as before', () => {
    expect(resolveLocation(ONE, 'default', '/dashboard/reading', null)).toEqual({
      mode: { id: 'default', prefixed: false },
      redirect: null,
    })
    expect(apiRootFor({ id: 'default', prefixed: false })).toBe('/api/dashboard')
    expect(basenameFor({ id: 'default', prefixed: false })).toBe('/dashboard')
    // A bookmark with /p/ from when there were two children.
    expect(resolveLocation(ONE, 'default', '/dashboard/p/younger/ai', null).redirect).toBe('/dashboard/ai')
    // An older server, or offline with nothing cached.
    expect(resolveLocation([], null, '/dashboard/', null)).toEqual({ mode: SINGLE, redirect: null })
  })

  it('sends /dashboard/ to the last child used, or the first', () => {
    expect(resolveLocation(TWO, 'older', '/dashboard/', null)).toEqual({
      mode: { id: 'older', prefixed: true },
      redirect: '/dashboard/p/older/',
    })
    expect(resolveLocation(TWO, 'older', '/dashboard/', 'younger').redirect).toBe('/dashboard/p/younger/')
    expect(resolveLocation(TWO, 'older', '/dashboard/calendar', 'gone').redirect).toBe('/dashboard/p/older/calendar')
  })

  it('takes the child from the address, and sends an unknown one to a front page', () => {
    expect(resolveLocation(TWO, 'older', '/dashboard/p/younger/day/2026-11-14', 'older')).toEqual({
      mode: { id: 'younger', prefixed: true },
      redirect: null,
    })
    expect(resolveLocation(TWO, 'older', '/dashboard/p/nobody/story/4', null).redirect).toBe('/dashboard/p/older/')
    expect(apiRootFor({ id: 'younger', prefixed: true })).toBe('/api/dashboard/p/younger')
    expect(basenameFor({ id: 'younger', prefixed: true })).toBe('/dashboard/p/younger')
  })

  it('prefixes even one child when the root data has no owner', () => {
    expect(resolveLocation([{ id: 'younger', title: 'x' }], null, '/dashboard/', null)).toEqual({
      mode: { id: 'younger', prefixed: true },
      redirect: '/dashboard/p/younger/',
    })
  })

  it('keeps the section when switching, but not a story or a day', () => {
    expect(pathForSwitch('younger', '/dashboard/p/older/reading')).toBe('/dashboard/p/younger/reading')
    expect(pathForSwitch('younger', '/dashboard/p/older/story/41')).toBe('/dashboard/p/younger/')
    expect(pathForSwitch('older', '/dashboard/p/younger/day/2026-11-14')).toBe('/dashboard/p/older/')
    expect(splitPath('/dashboard/p/younger')).toEqual({ id: 'younger', rest: '/' })
  })

  it('keeps per-child storage apart only when there are several children', () => {
    expect(profileKey('early-edition.share-name')).toBe('early-edition.share-name')
    setCurrentProfile({ id: 'younger', prefixed: true })
    expect(profileKey('early-edition.share-name')).toBe('early-edition.share-name.younger')
  })
})
