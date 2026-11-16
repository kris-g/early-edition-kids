// Dashboard v2 AI view for the mock: models from two providers, settings that
// persist in memory, a month of costs and the last run's breakdown.
import type { Effort, RunCost } from '../src/api/types.ts'
import type { AiPage, ModelChoice, ProviderInfo } from '../src/api/routes.ts'
import { addDays, at, londonToday, rand } from './data.ts'

type Price = { id: string; provider: 'anthropic' | 'openrouter'; name: string; note: string; input: number; output: number }

// The same models, names, notes and prices as the server offers: ANTHROPIC_MODELS in
// server/src/providers.ts (prices from DEFAULT_LLM_PRICES) and DEFAULT_OPENROUTER_MODELS in server/src/config.ts.
const PRICES: Price[] = [
  { id: 'anthropic:claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', note: 'The most careful writer and checker. Costs the most.', input: 4, output: 20 },
  { id: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', name: 'Claude Sonnet 5.5', note: 'Nearly as good as Opus, at about half the cost.', input: 2, output: 10 },
  { id: 'anthropic:claude-haiku-5-5', provider: 'anthropic', name: 'Claude Haiku 5.5', note: 'The fastest and cheapest. Its writing is plainer.', input: 0.1, output: 0.5 },
  { id: 'openrouter:anthropic/claude-opus-5.5', provider: 'openrouter', name: 'Claude Opus 5.5 (OpenRouter)', note: 'The same careful Claude Opus, billed through OpenRouter.', input: 4, output: 20 },
  { id: 'openrouter:anthropic/claude-sonnet-5.5', provider: 'openrouter', name: 'Claude Sonnet 5.5 (OpenRouter)', note: 'Nearly as good as Opus at about half the cost, through OpenRouter.', input: 2, output: 10 },
  { id: 'openrouter:moonshotai/kimi-k3.1-pro', provider: 'openrouter', name: 'Kimi K3.1 Pro (OpenRouter)', note: 'A strong model from another company; worth trying as a second opinion.', input: 2, output: 10 },
  { id: 'openrouter:x-ai/grok-4.7', provider: 'openrouter', name: 'Grok 4.7 (OpenRouter)', note: 'Another company’s model; cheaper to write with, so check its stories closely.', input: 2, output: 6 },
  { id: 'openrouter:z-ai/glm-5.3', provider: 'openrouter', name: 'GLM 5.3 (OpenRouter)', note: 'Very low cost; untested for children’s writing', input: 0.08, output: 3.6 },
  { id: 'openrouter:deepseek/deepseek-v4-pro-0813', provider: 'openrouter', name: 'DeepSeek V4 Pro (OpenRouter)', note: 'Very low cost; untested for children’s writing', input: 0.11, output: 4.44 },
]

// Average tokens a day over the last 14 days (made up, but plausible).
const WRITER_TOKENS = { input: 38_000, output: 9_000 }
const CHECKER_TOKENS = { input: 12_500, output: 4_100 }
const EFFORTS: Effort[] = ['low', 'medium', 'high']

const cost = (p: Price, t: { input: number; output: number }) =>
  Math.round(((t.input * p.input + t.output * p.output) / 1_000_000) * 10_000) / 10_000

const settings = {
  provider: 'anthropic' as 'anthropic' | 'openai' | 'stub',
  writer_model: 'anthropic:claude-opus-5-5',
  check_model: 'anthropic:claude-opus-5-5',
  writer_effort: 'high' as Effort,
  check_effort: 'high' as Effort,
  monthly_limit_usd: 25 as number | null,
}

const providers: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', description: 'Claude models, with your Anthropic key', configured: true, last_used: null },
  { id: 'openrouter', name: 'OpenRouter', description: 'Many models with one key', configured: true, last_used: null },
]

const monthCosts = new Map<string, number>()

function costFor(date: string): number {
  let c = monthCosts.get(date)
  if (c === undefined) {
    c = Math.round((0.41 + rand() * 0.17) * 100) / 100
    monthCosts.set(date, c)
  }
  return c
}

function lastRun(): RunCost {
  const today = londonToday()
  return {
    run_id: 412,
    date: today,
    started_at: at(today, '05:31'),
    seconds: 61,
    status: 'ok',
    calls: 15,
    cost_usd: costFor(today),
    input_tokens: 50_500,
    output_tokens: 13_100,
    sent_back: 1,
    refused: 0,
    models: [settings.writer_model, settings.check_model],
    stages: [
      { stage: 'select', calls: 1, cost_usd: 0.04 },
      { stage: 'rewrite', calls: 7, cost_usd: Math.round((costFor(today) - 0.16) * 100) / 100 },
      { stage: 'check', calls: 7, cost_usd: 0.12 },
    ],
  }
}

export function aiView(): AiPage {
  const today = londonToday()
  const month = today.slice(0, 7)
  const days: { date: string; cost_usd: number }[] = []
  for (let d = `${month}-01`; d <= today; d = addDays(d, 1)) days.push({ date: d, cost_usd: costFor(d) })
  const spent = Math.round(days.reduce((a, d) => a + d.cost_usd, 0) * 100) / 100
  const [y, m] = month.split('-').map(Number)
  const monthLength = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const models: ModelChoice[] = PRICES.filter((p) => providers.find((x) => x.id === p.provider)?.configured).map((p) => ({
    id: p.id,
    provider: p.provider,
    name: p.name,
    note: p.note,
    input_per_mtok: p.input,
    output_per_mtok: p.output,
    est_day_writer_usd: cost(p, WRITER_TOKENS),
    est_day_checker_usd: cost(p, CHECKER_TOKENS),
  }))
  const used = at(today, '05:31')
  return {
    settings: { ...settings },
    models,
    providers: providers.map((p) => ({ ...p, last_used: p.id === 'anthropic' ? used : addDays(today, -3) + 'T19:12:00Z' })),
    last_run: lastRun(),
    month: {
      month,
      cost_usd: spent,
      limit_usd: settings.monthly_limit_usd,
      projected_usd: Math.round((spent / days.length) * monthLength * 100) / 100,
      days,
    },
    quality: { sent_back: 3, refused: 0, on_time: days.length, issues: days.length, avg_seconds: 58 },
    provider_last_used: used,
  }
}

export function lastRunCost(): RunCost {
  return lastRun()
}

/** PUT /ai: validates like the contract and persists in memory. Returns an error message or null. */
export function updateAi(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Expected a JSON object.'
  const b = body as Record<string, unknown>
  const ids = new Set(aiView().models.map((m) => m.id))
  for (const key of ['writer_model', 'check_model'] as const) {
    if (key in b && (typeof b[key] !== 'string' || !ids.has(b[key] as string))) {
      return `${key} must be one of the offered models.`
    }
  }
  for (const key of ['writer_effort', 'check_effort'] as const) {
    if (key in b && !EFFORTS.includes(b[key] as Effort)) return `${key} must be low, medium or high.`
  }
  if ('monthly_limit_usd' in b) {
    const v = b.monthly_limit_usd
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      return 'monthly_limit_usd must be a number of 0 or more, or null.'
    }
  }
  if (typeof b.writer_model === 'string') settings.writer_model = b.writer_model
  if (typeof b.check_model === 'string') settings.check_model = b.check_model
  if (typeof b.writer_effort === 'string') settings.writer_effort = b.writer_effort as Effort
  if (typeof b.check_effort === 'string') settings.check_effort = b.check_effort as Effort
  if ('monthly_limit_usd' in b) settings.monthly_limit_usd = b.monthly_limit_usd as number | null
  return null
}
