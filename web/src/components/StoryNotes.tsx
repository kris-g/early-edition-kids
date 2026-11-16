import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { StoryDetail } from '../api/types'
import { checksSummary, interactiveHtml, noteFor, type CheckNote } from '../lib/checks'
import { cx } from '../lib/cx'
import { KindlePage } from './KindlePage'

/** "Written 05:31 by Claude Opus 5.5 · Checked against its source", with the checker's reasons if it gave any. */
export function ChecksLine({ story }: { story: StoryDetail }) {
  const c = checksSummary(story)
  return (
    <p className="m-0 mb-3 text-[13px] leading-relaxed text-muted">
      Written {c.written}
      {c.writer && ` by ${c.writer}`}
      {c.passed && (
        <>
          {' · '}
          <span className="font-semibold text-accent">Checked against its source</span>
          {c.checker && ` by ${c.checker}`}
        </>
      )}
      {c.reasons.length > 0 && ` · The checker said: ${c.reasons.join(' ')}`}
    </p>
  )
}

const NOTE_WIDTH = 300
const MARKS = 'mark[data-check]'

type Open = { index: number; note: CheckNote; top: number; left: number }

/**
 * The story as he sees it, with the dashboard's marks made pressable: a click, a
 * tap, or Enter or Space on a mark shows its note just under it. Pressing it
 * again, Escape, or a press anywhere else puts the note away. A story without
 * checks has no marks, so this is then only the page.
 */
export function CheckedStory({ story }: { story: StoryDetail }) {
  const box = useRef<HTMLDivElement>(null)
  const noteId = useId()
  const [open, setOpen] = useState<Open | null>(null)
  // The same string between renders, so React leaves the story's DOM (and the focused mark) alone.
  const html = useMemo(() => interactiveHtml(story.body_html), [story.body_html])
  const shown = useMemo(() => ({ ...story, body_html: html }), [story, html])
  const isOpen = open !== null

  useEffect(() => {
    box.current?.querySelectorAll(MARKS).forEach((m, i) => {
      const on = i === open?.index
      m.setAttribute('aria-expanded', String(on))
      if (on) m.setAttribute('aria-controls', noteId)
      else m.removeAttribute('aria-controls')
    })
  }, [open, html, noteId])

  useEffect(() => {
    if (!isOpen) return
    const close = () => setOpen(null)
    const onDown = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest(`${MARKS}, [data-story-note]`)) close()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // The note sits where the mark was; a new width moves the mark.
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [isOpen])

  const toggle = (mark: HTMLElement) => {
    const el = box.current
    if (!el) return
    const index = Array.from(el.querySelectorAll(MARKS)).indexOf(mark)
    if (open?.index === index) return setOpen(null)
    const note = noteFor(story, { check: mark.dataset.check, value: mark.dataset.value, text: mark.textContent ?? '' })
    if (!note) return
    const m = mark.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    const width = Math.min(NOTE_WIDTH, b.width)
    setOpen({ index, note, top: m.bottom - b.top + 8, left: Math.max(0, Math.min(m.left - b.left, b.width - width)) })
  }
  const markOf = (target: EventTarget) => (target instanceof Element ? target.closest<HTMLElement>(MARKS) : null)
  const onClick = (e: MouseEvent) => {
    const mark = markOf(e.target)
    if (mark) toggle(mark)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const mark = markOf(e.target)
    if (!mark) return
    e.preventDefault() // Space would scroll the page
    toggle(mark)
  }

  return (
    // The marks inside are the buttons; this only listens for them.
    <div ref={box} className="relative" onClick={onClick} onKeyDown={onKeyDown}>
      <KindlePage story={shown} />
      <div aria-live="polite">
        {open && (
          <aside
            id={noteId}
            data-story-note
            aria-label={open.note.kind}
            style={{ top: open.top, left: open.left, width: `min(${NOTE_WIDTH}px, 100%)` }}
            className="absolute z-10 rounded-xl border border-line bg-card p-3.5 text-ink shadow-[0_10px_28px_rgb(0_0_0/0.16)]"
          >
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
              <span aria-hidden="true" className={cx('size-2 rounded-full', open.note.tone === 'word' ? 'bg-warm' : 'bg-accent')} />
              {open.note.kind}
            </div>
            <p className="m-0 mt-1.5 text-sm leading-snug">{open.note.message}</p>
            <p className="m-0 mt-1.5 text-xs leading-snug text-muted">{open.note.where}</p>
          </aside>
        )}
      </div>
    </div>
  )
}
