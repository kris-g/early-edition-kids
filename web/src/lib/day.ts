export type DayMode = 'read' | 'paper'

/** Link to a day: what he read (the default) or that day's paper. */
export function dayPath(date: string, mode: DayMode = 'read'): string {
  return mode === 'paper' ? `/day/${date}?view=paper` : `/day/${date}`
}
