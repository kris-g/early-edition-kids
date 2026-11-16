// A story's checks as the story page shows them (CONTRACT.md "Story checks"): the
// server marks each checked number and the word to know in body_html, and this
// turns a mark into the note shown beside it.
import type { StoryDetail } from '../api/types'
import { prettyModel, timeOf } from './format'

export type CheckNote = {
  tone: 'number' | 'word'
  /** "Number check" or "Word to know". */
  kind: string
  message: string
  /** Where it comes from, in small print. */
  where: string
}

const MARK = /<mark data-check="(number|word)"([^>]*)>([\s\S]*?)<\/mark>/g

/** The text of a marked phrase, still HTML-escaped, safe inside a double-quoted attribute. */
const labelText = (inner: string) => inner.replace(/<[^>]*>/g, '').replace(/"/g, '&quot;').trim()

/**
 * body_html with each mark made into something you can tab to and press: a button
 * named after its phrase ("1,300, number check"). The story's own text is untouched.
 */
export function interactiveHtml(html: string): string {
  return html.replace(MARK, (_all, check: string, rest: string, inner: string) => {
    const label = `${labelText(inner)}, ${check === 'number' ? 'number check' : 'word to know'}`
    return `<mark data-check="${check}"${rest} role="button" tabindex="0" aria-expanded="false" aria-label="${label}">${inner}</mark>`
  })
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The note for one mark, or null when there is nothing to say about it. */
export function noteFor(
  story: Pick<StoryDetail, 'checks' | 'word_to_know'>,
  mark: { check: string | undefined; value: string | undefined; text: string },
): CheckNote | null {
  if (mark.check === 'word') {
    const w = story.word_to_know
    if (!w) return null
    return {
      tone: 'word',
      kind: 'Word to know',
      message: `${capital(w.word)}: ${w.definition}`,
      where: 'Shown in a box at the end of the story.',
    }
  }
  if (mark.check === 'number') {
    const n = story.checks?.numbers.find((x) => x.value === mark.value)
    if (!n) return null
    return {
      tone: 'number',
      kind: 'Number check',
      message: n.in_source ? `${mark.text} matches the source article.` : `${mark.text} was not found in the source article.`,
      where: 'Every number in a story is compared with its source before it is published.',
    }
  }
  return null
}

/** The line above the story: when it was written, by which model, and what the checker decided. */
export function checksSummary(story: Pick<StoryDetail, 'checks' | 'created_at'>, now: Date = new Date()) {
  const c = story.checks
  const passed = Boolean(c && c.verdict.safe && c.verdict.supported)
  return {
    written: timeOf(story.created_at, now),
    writer: c?.writer_model ? prettyModel(c.writer_model) : null,
    passed,
    /** Named only when it is not the writer's own model. */
    checker: passed && c?.checker_model && c.checker_model !== c.writer_model ? prettyModel(c.checker_model) : null,
    reasons: c?.verdict.reasons ?? [],
  }
}
