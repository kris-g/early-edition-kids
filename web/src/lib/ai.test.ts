import { describe, expect, it } from 'vitest'
import { aiPage } from '../test/fixtures'
import { DAYS_PER_MONTH, EFFORT_FACTOR, changedFields, estimateDay, validateLimit } from './ai'

const { models, settings } = aiPage()

describe('estimate', () => {
  it('adds the writer and checker day estimates', () => {
    const day = estimateDay(models, { writer_model: models[0].id, check_model: models[0].id, check_effort: 'high' }, settings)
    expect(day).toBeCloseTo(0.34 + 0.12, 10)
    expect(day! * DAYS_PER_MONTH).toBeCloseTo(13.8, 10)
  })

  it('mixes models', () => {
    const day = estimateDay(models, { writer_model: models[1].id, check_model: models[2].id, check_effort: 'high' }, settings)
    expect(day).toBeCloseTo(0.17 + 0.003, 10)
  })

  it('scales the checker by effort relative to the effort now in use', () => {
    const low = estimateDay(models, { writer_model: models[0].id, check_model: models[0].id, check_effort: 'low' }, settings)
    expect(low).toBeCloseTo(0.34 + 0.12 * (EFFORT_FACTOR.low / EFFORT_FACTOR.high), 10)
    const fromMedium = estimateDay(
      models,
      { writer_model: models[0].id, check_model: models[0].id, check_effort: 'high' },
      { check_effort: 'medium' },
    )
    expect(fromMedium).toBeCloseTo(0.34 + 0.12 * (EFFORT_FACTOR.high / EFFORT_FACTOR.medium), 10)
  })

  it('is null without data or for an unknown model', () => {
    const noData = models.map((m) => ({ ...m, est_day_checker_usd: null }))
    expect(estimateDay(noData, { writer_model: models[0].id, check_model: models[0].id, check_effort: 'high' }, settings)).toBeNull()
    expect(estimateDay(models, { writer_model: 'x', check_model: models[0].id, check_effort: 'high' }, settings)).toBeNull()
  })
})

describe('changedFields', () => {
  it('is empty when nothing changed', () => {
    expect(changedFields(settings, { writer_model: settings.writer_model, check_model: settings.check_model, check_effort: settings.check_effort })).toEqual({})
  })

  it('includes only what changed', () => {
    expect(
      changedFields(settings, { writer_model: models[1].id, check_model: settings.check_model, check_effort: 'medium' }),
    ).toEqual({ writer_model: models[1].id, check_effort: 'medium' })
  })
})

describe('validateLimit', () => {
  it.each([
    ['25', 25],
    ['$12.50', 12.5],
    [' 0 ', 0],
    ['7.5', 7.5],
  ])('accepts %s', (text, value) => {
    expect(validateLimit(text)).toEqual({ ok: true, value })
  })

  it.each([[''], ['-5'], ['abc'], ['1.234'], ['1e3'], ['20000']])('rejects "%s"', (text) => {
    const r = validateLimit(text)
    expect(r.ok).toBe(false)
  })
})
