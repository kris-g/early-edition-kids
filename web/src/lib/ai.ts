// The AI page's arithmetic: the cost estimate, what changed, and limit input.
import type { AiSettings, AiSettingsPatch, Effort, ModelOption } from '../api/types'

/**
 * Checker effort scales its cost roughly with thinking tokens. The server's
 * estimates are measured at the current effort, so a different effort is
 * scaled by the ratio of these factors. An approximation, labelled "about".
 */
export const EFFORT_FACTOR: Record<Effort, number> = { low: 0.6, medium: 0.8, high: 1 }

export type Draft = Pick<AiSettings, 'writer_model' | 'check_model' | 'check_effort'>

/** Dollars a day for these choices, or null when the server has no estimate yet. */
export function estimateDay(models: ModelOption[], draft: Draft, current: Pick<AiSettings, 'check_effort'>): number | null {
  const writer = models.find((m) => m.id === draft.writer_model)
  const checker = models.find((m) => m.id === draft.check_model)
  if (!writer || !checker) return null
  if (writer.est_day_writer_usd === null || checker.est_day_checker_usd === null) return null
  const scale = EFFORT_FACTOR[draft.check_effort] / EFFORT_FACTOR[current.check_effort]
  return writer.est_day_writer_usd + checker.est_day_checker_usd * scale
}

export const DAYS_PER_MONTH = 30

/** Only the fields that differ from what the server has. */
export function changedFields(current: AiSettings, draft: Draft): AiSettingsPatch {
  const patch: AiSettingsPatch = {}
  if (draft.writer_model !== current.writer_model) patch.writer_model = draft.writer_model
  if (draft.check_model !== current.check_model) patch.check_model = draft.check_model
  if (draft.check_effort !== current.check_effort) patch.check_effort = draft.check_effort
  return patch
}

export type LimitResult = { ok: true; value: number } | { ok: false; error: string }

/** A monthly limit typed by the parent: dollars, 0 or more, at most two decimals. */
export function validateLimit(text: string): LimitResult {
  const t = text.trim().replace(/^\$/, '')
  if (t === '') return { ok: false, error: 'Enter an amount in dollars, or remove the limit.' }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'Enter an amount like 25 or 12.50.' }
  const value = Number(t)
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'The limit cannot be negative.' }
  if (value > 10000) return { ok: false, error: 'That limit looks too high. Enter $10,000 or less.' }
  return { ok: true, value }
}

export function providerName(provider: AiSettings['provider']): string {
  if (provider === 'anthropic') return 'Anthropic API'
  if (provider === 'openrouter') return 'OpenRouter'
  if (provider === 'openai') return 'OpenAI-compatible API'
  return 'Stub (no AI calls)'
}
