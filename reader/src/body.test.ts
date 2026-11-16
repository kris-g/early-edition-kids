import { describe, expect, it } from 'vitest'
import { esc, parseStoryHtml } from './body'
import { STORY_HTML } from './test/fixtures'

describe('a story page', () => {
  it('becomes paragraphs, the boxes and the source, keeping only text and bold', () => {
    const b = parseStoryHtml(STORY_HTML)
    expect(b.paras).toEqual([
      'Imagine catching something as tall as a tower block.',
      'The bottom part, called the <b>booster</b>, flies back down &amp; lands.',
      'alert(1)It is cheaper that way.',
    ])
    expect(b.paras.join('')).not.toMatch(/<(a|img|script)/)
    expect(b.word).toEqual({ word: 'Booster', definition: 'the part of a rocket that pushes it off the ground.' })
    expect(b.think).toBe('What would you send into space?')
    expect(b.source).toBe('BBC Newsround')
  })

  it('copes with a page without the boxes', () => {
    const b = parseStoryHtml('<body><p class="kicker">X</p><h1>T</h1><p>One.</p><p class="source">Source: S</p></body>')
    expect(b).toEqual({ paras: ['One.'], word: null, think: '', source: 'S' })
  })

  it('escapes text for HTML', () => {
    expect(esc(`<b a="1">'&'</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;')
  })
})
