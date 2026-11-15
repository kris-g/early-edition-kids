import { useState, type FormEvent } from 'react'
import { messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { AiPage, ModelChoice, ProviderInfo } from '../api/routes'
import type { Effort, StageCost } from '../api/types'
import { CostBars, Meter, StackedBar, type StackPart } from '../components/charts/Bars'
import { CheckCircleIcon, AlertIcon } from '../components/Icons'
import { Badge, BigNumber, Button, Card, ErrorNote, Eyebrow, Loading, PageHeader, Segment, SectionTitle } from '../components/ui'
import { changedFields, DAYS_PER_MONTH, estimateDay, providerName, validateLimit, type Draft } from '../lib/ai'
import { cx } from '../lib/cx'
import {
  clockTime,
  dayMonthLong,
  londonToday,
  money,
  moneyShort,
  plural,
  prettyModel,
  thousands,
  timeOf,
} from '../lib/format'
import { stageTip } from '../lib/tips'
import { useApi } from '../lib/useApi'

const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', openrouter: 'OpenRouter' }

function providerOf(m: ModelChoice): string {
  return m.provider
}

function groups(models: ModelChoice[]): { provider: string; models: ModelChoice[] }[] {
  const out: { provider: string; models: ModelChoice[] }[] = []
  for (const m of models) {
    const p = providerOf(m)
    const g = out.find((x) => x.provider === p)
    if (g) g.models.push(m)
    else out.push({ provider: p, models: [m] })
  }
  return out
}

function shortName(name: string): string {
  return name.replace(/^Claude /, '').replace(/ via OpenRouter$/, '')
}

export function Ai() {
  const ai = useApi('ai', (s) => api.ai(s))
  const data = ai.data
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI" subtitle="Who writes and checks the paper, and what it costs" />
      {ai.error && <ErrorNote onRetry={ai.reload}>{ai.error.message}</ErrorNote>}
      {!data && !ai.error && <Loading />}
      {data && <AiBody data={data} onSaved={(v) => ai.mutate(() => v)} />}
    </div>
  )
}

function AiBody({ data, onSaved }: { data: AiPage; onSaved: (v: AiPage) => void }) {
  const today = londonToday()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 desk:grid-cols-2 desk:items-start">
      <div className="flex flex-col gap-4">
        <RunBanner data={data} today={today} />
        <ModelChooser data={data} onSaved={onSaved} />
      </div>
      <div className="flex flex-col gap-4">
        <MonthCost data={data} today={today} onSaved={onSaved} />
        {data.last_run && <MoneyGoes run={data.last_run} />}
        <Quality data={data} />
        <Providers data={data} />
      </div>
    </div>
  )
}

function RunBanner({ data, today }: { data: AiPage; today: string }) {
  const run = data.last_run
  if (!run) {
    return (
      <section aria-label="Last run" className="rounded-2xl bg-chip px-[18px] py-4 text-sm">
        No runs yet. The first paper is made at 05:30.
      </section>
    )
  }
  const bad = /fail|error|limit/i.test(run.status)
  const isToday = run.date === today
  const title = bad
    ? `${isToday ? 'This morning’s' : 'The last'} run had a problem`
    : isToday
      ? 'This morning’s paper went out fine'
      : `No run yet today. The last one, on ${dayMonthLong(run.date)}, went fine`
  const bits = [
    clockTime(run.started_at),
    run.seconds !== null ? `${Math.round(run.seconds)} seconds` : null,
    plural(run.calls, 'call'),
    money(run.cost_usd),
  ].filter(Boolean)
  return (
    <section
      aria-label="Last run"
      className={cx('flex items-center gap-3.5 rounded-2xl px-[18px] py-4', bad ? 'bg-warm-soft' : 'bg-accent-soft')}
    >
      {bad ? (
        <AlertIcon className="size-7 shrink-0 text-warm" />
      ) : (
        <CheckCircleIcon className="size-7 shrink-0 text-accent" tickColor="var(--accent-soft)" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-bold">{title}</span>
        <span className="text-[13px] text-ink">
          {bits.join(' · ')}
          {bad ? ` · ${run.status}` : ''}
        </span>
      </div>
    </section>
  )
}

function ModelChooser({ data, onSaved }: { data: AiPage; onSaved: (v: AiPage) => void }) {
  const s = data.settings
  const fromServer: Draft = { writer_model: s.writer_model, check_model: s.check_model, check_effort: s.check_effort }
  const [draft, setDraft] = useState<Draft>(fromServer)
  const [base, setBase] = useState(fromServer)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The server's settings changed (saved here or elsewhere): start again from them.
  if (base.writer_model !== fromServer.writer_model || base.check_model !== fromServer.check_model || base.check_effort !== fromServer.check_effort) {
    setBase(fromServer)
    setDraft(fromServer)
  }

  if (data.models.length === 0) {
    return (
      <Card label="Models" className="flex flex-col gap-2">
        <SectionTitle>Who writes and checks</SectionTitle>
        <p className="m-0 text-sm">
          Writer: <strong>{prettyModel(s.writer_model)}</strong>. Checker: <strong>{prettyModel(s.check_model)}</strong>
          , thinking effort {s.check_effort}.
        </p>
        <p className="m-0 text-[13px] text-muted">
          {providerName(s.provider)}: models for this provider are set on the server, not here.
        </p>
      </Card>
    )
  }

  const patch = changedFields(s, draft)
  const dirty = Object.keys(patch).length > 0
  const est = estimateDay(data.models, draft, s)
  const byGroup = groups(data.models)
  const showGroups = byGroup.length > 1
  const groupName = (p: string) => PROVIDER_NAMES[p] ?? data.providers.find((x) => x.id === p)?.name ?? p
  const usable = (m: ModelChoice) => {
    const prov = data.providers.find((x) => x.id === providerOf(m))
    return prov ? prov.configured : true
  }

  const pick = (change: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...change }))
    setSaved(false)
    setError(null)
  }

  async function save() {
    if (!dirty) return
    setSaving(true)
    setError(null)
    try {
      const v = await api.putAi(patch)
      setSaved(true)
      onSaved(v)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card label="Writer model" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <SectionTitle>Who writes the stories</SectionTitle>
          <span className="text-[13px] text-muted">Chooses the six stories and rewrites each one</span>
        </div>
        <div role="radiogroup" aria-label="Writer model" className="flex flex-col gap-3">
          {byGroup.map((g) => (
            <div key={g.provider} className="flex flex-col gap-2">
              {showGroups && <Eyebrow>{groupName(g.provider)}</Eyebrow>}
              {g.models.map((m) => {
                const on = draft.writer_model === m.id
                const ok = usable(m)
                return (
                  <label
                    key={m.id}
                    className={cx(
                      'box-border flex min-h-16 items-center gap-3 rounded-xl border-2 px-3.5 py-2.5',
                      on ? 'border-accent bg-accent-soft' : 'border-line',
                      ok ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      name="writer"
                      value={m.id}
                      checked={on}
                      disabled={!ok}
                      onChange={() => pick({ writer_model: m.id })}
                      className="m-0 size-5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold">
                        {m.name}
                        {m.id === s.writer_model && <Badge tone="green">In use now</Badge>}
                      </span>
                      <span className="text-xs text-muted">{ok ? m.note : 'Not set up: add the key on the server.'}</span>
                    </span>
                    <span className="text-right text-[13px] font-bold whitespace-nowrap">
                      {m.est_day_writer_usd !== null ? (
                        <>
                          {m.est_day_writer_usd < 0.01 ? 'under $0.01' : `about ${money(m.est_day_writer_usd)}`}
                          <span className="block text-xs font-medium text-muted">a day</span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-muted">
                          ${m.input_per_mtok} / ${m.output_per_mtok}
                          <span className="block">per M tokens</span>
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card label="Checker model" className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <SectionTitle>Who checks them</SectionTitle>
          <span className="text-[13px] text-muted">Reads each story against its source for facts and safety</span>
        </div>
        {data.models.length <= 3 ? (
          <div role="group" aria-label="Checker model" className="grid grid-cols-3 gap-1.5">
            {data.models.map((m) => (
              <Segment
                key={m.id}
                pressed={draft.check_model === m.id}
                disabled={!usable(m)}
                onClick={() => pick({ check_model: m.id })}
              >
                {shortName(m.name)}
              </Segment>
            ))}
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Checker model</span>
            <select
              value={draft.check_model}
              onChange={(e) => pick({ check_model: e.target.value })}
              className="min-h-[46px] w-full rounded-[10px] border border-line bg-card px-3 text-base font-semibold text-ink"
            >
              {byGroup.map((g) => (
                <optgroup key={g.provider} label={groupName(g.provider)}>
                  {g.models.map((m) => (
                    <option key={m.id} value={m.id} disabled={!usable(m)}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold" id="effort-label">
            How hard the checker thinks
          </span>
          <div role="group" aria-labelledby="effort-label" className="grid grid-cols-3 gap-1.5">
            {EFFORTS.map((e) => (
              <Segment key={e.id} pressed={draft.check_effort === e.id} onClick={() => pick({ check_effort: e.id })}>
                {e.label}
              </Segment>
            ))}
          </div>
          <span className="text-xs text-muted">
            High is slower and costs a little more, and it is the safest for a child’s paper.
          </span>
        </div>
      </Card>

      <section aria-label="Estimate" className="flex flex-col gap-3 rounded-2xl border-2 border-ink bg-card px-[18px] py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1" aria-live="polite">
          <span className="text-[13px] font-semibold">With these choices</span>
          {est !== null ? (
            <span className="flex items-baseline gap-1.5">
              <BigNumber className="text-[32px]">{money(est)}</BigNumber>
              <span className="text-[13px] text-muted">a day · {money(est * DAYS_PER_MONTH)} a month</span>
            </span>
          ) : (
            <span className="text-[13px] text-muted">No estimate yet: it needs a few days of runs.</span>
          )}
        </div>
        <Button variant="primary" className="min-h-12 text-[15px]" busy={saving} disabled={!dirty} onClick={() => void save()}>
          Use from tomorrow’s paper
        </Button>
        {!dirty && !saved && <span className="text-xs text-muted">These are the models in use now.</span>}
        {saved && !dirty && (
          <span role="status" className="text-[13px] font-semibold text-accent">
            Saved. The next paper (or added article) uses these.
          </span>
        )}
        {error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}
      </section>
    </>
  )
}

function MonthCost({ data, today, onSaved }: { data: AiPage; today: string; onSaved: (v: AiPage) => void }) {
  const m = data.month
  const limit = m.limit_usd
  const first = m.days[0]?.date
  const last = m.days[m.days.length - 1]?.date
  return (
    <Card label="Cost this month" className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>Cost this month</SectionTitle>
        {first && last && (
          <span className="text-[13px] text-muted">
            {Number(first.slice(8))} to {dayMonthLong(last)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <BigNumber className="text-[44px]">{money(m.cost_usd)}</BigNumber>
        <span className="text-sm text-muted">
          {limit !== null ? `of your ${moneyShort(limit)} limit` : 'no monthly limit'}
        </span>
      </div>
      {limit !== null && limit > 0 && (
        <Meter
          fraction={m.cost_usd / limit}
          tone={m.cost_usd >= limit ? 'danger' : 'warm'}
          label={`${Math.round((m.cost_usd / limit) * 100)} percent of the monthly limit used`}
        />
      )}
      <span className="text-[13px] text-muted">
        On track for about {money(m.projected_usd)} by the end of the month.
        {limit !== null && m.cost_usd >= limit && ' The limit is reached, so new papers are catch-up issues until next month.'}
      </span>
      <LimitEditor limit={limit} onSaved={onSaved} />
      <div className="mt-1">
        <CostBars days={m.days} today={today} />
      </div>
    </Card>
  )
}

function LimitEditor({ limit, onSaved }: { limit: number | null; onSaved: (v: AiPage) => void }) {
  const [text, setText] = useState(limit !== null ? String(limit) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function send(value: number | null, which: 'save' | 'remove') {
    setBusy(which)
    setError(null)
    setNote(null)
    try {
      const v = await api.putAi({ monthly_limit_usd: value })
      onSaved(v)
      setNote(value === null ? 'Limit removed.' : `Limit set to ${moneyShort(value)} a month.`)
      if (value === null) setText('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(null)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const r = validateLimit(text)
    if (!r.ok) {
      setError(r.error)
      setNote(null)
      return
    }
    void send(r.value, 'save')
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-3.5" noValidate>
      <label htmlFor="limit" className="text-[13px] font-semibold">
        Monthly limit
      </label>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-[1_1_120px]">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
          <input
            id="limit"
            inputMode="decimal"
            autoComplete="off"
            placeholder="25"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby="limit-help"
            className="box-border min-h-11 w-full rounded-xl border border-line bg-card pr-3 pl-7 text-base text-ink outline-none focus:border-accent"
          />
        </div>
        <Button type="submit" variant="primary" busy={busy === 'save'}>
          Save
        </Button>
        {limit !== null && (
          <Button onClick={() => void send(null, 'remove')} busy={busy === 'remove'}>
            Remove limit
          </Button>
        )}
      </div>
      <span id="limit-help" className="text-xs text-muted">
        When the month reaches it, the paper is made from unread stories instead of calling the AI.
      </span>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="m-0 text-[13px] font-semibold text-accent">
          {note}
        </p>
      )}
    </form>
  )
}

const STAGE: Record<StageCost['stage'], { label: string; color: string }> = {
  select: { label: 'Choosing the stories', color: 'var(--muted)' },
  rewrite: { label: 'Writing', color: 'var(--accent)' },
  check: { label: 'Checking', color: 'var(--warm)' },
  add: { label: 'Articles you added', color: 'var(--ink)' },
}

function MoneyGoes({ run }: { run: NonNullable<AiPage['last_run']> }) {
  const order: StageCost['stage'][] = ['select', 'rewrite', 'check', 'add']
  const stages = order
    .map((k) => run.stages.find((s) => s.stage === k))
    .filter((s): s is StageCost => Boolean(s && (s.calls > 0 || s.cost_usd > 0)))
  const total = stages.reduce((a, s) => a + s.cost_usd, 0)
  const parts: StackPart[] = stages.map((s) => ({
    key: s.stage,
    label: STAGE[s.stage].label,
    value: s.cost_usd,
    color: STAGE[s.stage].color,
    tip: stageTip(STAGE[s.stage].label, s.calls, s.cost_usd, total),
  }))
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0)
  return (
    <Card label="Where the money goes" className="flex flex-col gap-3.5">
      <SectionTitle>Where a day’s {money(run.cost_usd)} goes</SectionTitle>
      <StackedBar
        parts={parts}
        label={parts.map((p) => `${p.label} ${pct(p.value)} percent`).join(', ') || 'No costs recorded'}
      />
      <div className="flex flex-col gap-2 text-sm">
        {stages.map((s) => (
          <div key={s.stage} className="flex items-center gap-2.5">
            <span className="size-3 shrink-0 rounded-[3px]" style={{ background: STAGE[s.stage].color }} />
            <span className="flex-1">
              {STAGE[s.stage].label} · {plural(s.calls, 'call')}
            </span>
            <span className="font-bold">{money(s.cost_usd)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5 border-t border-line pt-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Eyebrow>Read by the AI</Eyebrow>
          <span className="text-lg font-bold break-words desk:text-xl">{thousands(run.input_tokens)} tokens</span>
          <span className="text-xs text-muted">the news articles</span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <Eyebrow>Written by the AI</Eyebrow>
          <span className="text-lg font-bold break-words desk:text-xl">{thousands(run.output_tokens)} tokens</span>
          <span className="text-xs text-muted">stories and thinking</span>
        </div>
      </div>
    </Card>
  )
}

function Quality({ data }: { data: AiPage }) {
  const q = data.quality
  const tiles: [string, string][] = [
    [String(q.sent_back), 'stories sent back by the checker this month'],
    [String(q.refused), 'stories the AI declined to write'],
    [`${q.on_time} of ${q.issues}`, 'papers ready before 7 am'],
    [q.avg_seconds !== null ? `${Math.round(q.avg_seconds)} s` : '–', 'average time to make a paper'],
  ]
  return (
    <section aria-label="Quality" className="grid grid-cols-2 gap-2.5">
      {tiles.map(([v, l]) => (
        <div key={l} className="flex flex-col gap-0.5 rounded-[14px] border border-line bg-card p-3.5">
          <BigNumber className="text-[30px] leading-[1.1]">{v}</BigNumber>
          <span className="text-xs text-muted">{l}</span>
        </div>
      ))}
    </section>
  )
}

function Providers({ data }: { data: AiPage }) {
  const rows: ProviderInfo[] =
    data.providers.length > 0
      ? data.providers
      : [
          {
            id: 'anthropic',
            name: providerName(data.settings.provider),
            configured: data.settings.provider !== 'stub',
            last_used: data.provider_last_used,
          },
        ]
  return (
    <Card label="Providers" className="flex flex-col gap-0 p-0!">
      {rows.map((p, i) => (
        <div
          key={p.id}
          className={cx('flex items-center justify-between gap-3 px-[18px] py-4', i > 0 && 'border-t border-line')}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-bold">{p.name}</span>
            <span className="text-xs text-muted">
              {p.configured
                ? `Connected${p.last_used ? ` · last used ${timeOf(p.last_used)}` : ''}`
                : 'Not set up: add the key on the server'}
            </span>
          </div>
        </div>
      ))}
      <p className="m-0 border-t border-line px-[18px] py-3 text-xs text-muted">
        API keys live on the server and are not shown or changed here.
      </p>
    </Card>
  )
}
