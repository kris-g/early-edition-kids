// A story's text comes from the same story page the Kindle downloads (server/templates/story.njk):
// a kicker, the headline, the paragraphs, the Word to know and Think about it boxes, and the source.
// Only text and bold survive; nothing from the page is ever inserted as markup.

import type { StoryBody } from './types'

export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Inline content as safe HTML: text, with <b>/<strong> kept as <b> and <i>/<em> as <i>. */
export function inlineHtml(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += esc(child.textContent ?? '')
    } else if (child.nodeType === 1) {
      const tag = (child as Element).tagName.toLowerCase()
      const inner = inlineHtml(child)
      if (tag === 'b' || tag === 'strong') out += `<b>${inner}</b>`
      else if (tag === 'i' || tag === 'em') out += `<i>${inner}</i>`
      else if (tag === 'br') out += ' '
      else out += inner
    }
  })
  return out.replace(/\s+/g, ' ').trim()
}

export function parseStoryHtml(html: string): StoryBody {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body: StoryBody = { paras: [], word: null, think: '', source: '' }
  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase()
    const cls = el.classList
    if (tag === 'h1' || cls.contains('kicker')) continue
    if (cls.contains('source')) {
      body.source = collapse(el.textContent ?? '').replace(/^Source:\s*/i, '')
    } else if (cls.contains('box')) {
      const label = collapse(el.querySelector('.label')?.textContent ?? '').toUpperCase()
      const text = Array.from(el.querySelectorAll('p')).filter((p) => !p.classList.contains('label'))[0]
      if (!text) continue
      if (label.startsWith('WORD')) {
        const word = collapse(text.querySelector('b')?.textContent ?? '')
        const all = collapse(text.textContent ?? '')
        const definition = word && all.startsWith(word) ? all.slice(word.length).replace(/^\s*:\s*/, '') : all
        if (word) body.word = { word, definition }
      } else if (label.startsWith('THINK')) {
        body.think = collapse(text.textContent ?? '')
      }
    } else if (tag === 'p') {
      const p = inlineHtml(el)
      if (p) body.paras.push(p)
    }
  }
  return body
}
