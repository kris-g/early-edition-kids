import { describe, expect, it } from 'vitest'
import { checks } from '../test/fixtures'
import { checksSummary, interactiveHtml, noteFor } from './checks'

const word = { word: 'ceremony', definition: 'a special event held to celebrate something.' }

describe('interactiveHtml', () => {
  it('makes each mark a button named after its phrase, and leaves the rest alone', () => {
    const html =
      '<p>About <mark data-check="number" data-value="1300">1,300</mark> pupils &amp; a ' +
      '<mark data-check="word"><b>ceremony</b></mark>. <mark>plain</mark> <b>bold</b></p>'
    expect(interactiveHtml(html)).toBe(
      '<p>About <mark data-check="number" data-value="1300" role="button" tabindex="0" aria-expanded="false" aria-label="1,300, number check">1,300</mark> pupils &amp; a ' +
        '<mark data-check="word" role="button" tabindex="0" aria-expanded="false" aria-label="ceremony, word to know"><b>ceremony</b></mark>. <mark>plain</mark> <b>bold</b></p>',
    )
    expect(interactiveHtml('<p>No marks here.</p>')).toBe('<p>No marks here.</p>')
  })
})

describe('noteFor', () => {
  const story = { checks: checks({ numbers: [{ value: '1300', in_source: true }, { value: '7', in_source: false }] }), word_to_know: word }

  it('says whether a number matches the source', () => {
    expect(noteFor(story, { check: 'number', value: '1300', text: '1,300' })).toMatchObject({
      kind: 'Number check',
      message: '1,300 matches the source article.',
    })
    expect(noteFor(story, { check: 'number', value: '7', text: '7' })?.message).toBe('7 was not found in the source article.')
  })

  it('gives the word to know its definition', () => {
    expect(noteFor(story, { check: 'word', value: undefined, text: 'ceremony' })).toMatchObject({
      kind: 'Word to know',
      message: 'Ceremony: a special event held to celebrate something.',
    })
  })

  it('has nothing to say about a number that was not checked, or without checks', () => {
    expect(noteFor(story, { check: 'number', value: '99', text: '99' })).toBeNull()
    expect(noteFor({ checks: null, word_to_know: null }, { check: 'number', value: '1300', text: '1,300' })).toBeNull()
    expect(noteFor({ checks: null, word_to_know: null }, { check: 'word', value: undefined, text: 'x' })).toBeNull()
    expect(noteFor(story, { check: 'other', value: undefined, text: 'x' })).toBeNull()
  })
})

describe('checksSummary', () => {
  const now = new Date('2026-11-13T09:00:00Z')
  const created_at = '2026-11-13T05:31:07+00:00'

  it('gives the time, the model and the verdict', () => {
    expect(checksSummary({ checks: checks(), created_at }, now)).toEqual({
      written: '05:31',
      writer: 'Claude Opus 5.5',
      passed: true,
      checker: null,
      reasons: [],
    })
  })

  it('names the checker when it is another model, and passes on its reasons', () => {
    const c = checks({ checker_model: 'anthropic:claude-sonnet-5-5', verdict: { safe: true, supported: true, reasons: ['All good.'] } })
    expect(checksSummary({ checks: c, created_at }, now)).toMatchObject({ checker: 'Claude Sonnet 5.5', reasons: ['All good.'] })
  })

  it('only has the time for a story with no checks, with the day when it is not today', () => {
    expect(checksSummary({ checks: null, created_at: '2026-11-12T05:31:07+00:00' }, now)).toEqual({
      written: 'Thu 12 Nov, 05:31',
      writer: null,
      passed: false,
      checker: null,
      reasons: [],
    })
  })
})
