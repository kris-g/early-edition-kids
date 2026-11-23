// One function per route in CONTRACT.md's dashboard tables.
import { API_ROOT, get, post, request } from './client'
import type { AddWhen, AiPage, GenerateResult, Summary, TopicMode } from './routes'
import type {
  AboutView,
  AiSettingsPatch,
  ArticleHit,
  CalendarView,
  DayView,
  IssueSummary,
  IssueView,
  Job,
  ProfilesView,
  ReadingView,
  RunView,
  ShareView,
  ReadingSettings,
  SportSettings,
  SportSettingsView,
  SportUsageView,
  StoryCard,
  StoryDetail,
  TopicView,
} from './types'

const enc = encodeURIComponent

export const api = {
  /** Every child, whichever is shown; always at the root. */
  profiles: (signal?: AbortSignal) => request<ProfilesView>('GET', `${API_ROOT}/profiles`, { signal, absolute: true }),
  /** The server itself (version, where it runs, uptime); always at the root, the same for every child. */
  about: (signal?: AbortSignal) => request<AboutView>('GET', `${API_ROOT}/about`, { signal, absolute: true }),

  summary: (signal?: AbortSignal) => get<Summary>('/summary', signal),
  issues: (limit = 30, signal?: AbortSignal) => get<IssueSummary[]>(`/issues?limit=${limit}`, signal),
  issue: (date: string, signal?: AbortSignal) => get<IssueView>(`/issues/${enc(date)}`, signal),
  day: (date: string, signal?: AbortSignal) => get<DayView>(`/day/${enc(date)}`, signal),
  story: (id: number, signal?: AbortSignal) => get<StoryDetail>(`/stories/${id}`, signal),
  hide: (id: number) => post<StoryCard>(`/stories/${id}/hide`),
  unhide: (id: number) => post<StoryCard>(`/stories/${id}/unhide`),
  regenerate: (confirm: boolean) =>
    post<GenerateResult>('/regenerate', confirm ? { confirm: true } : {}),

  topics: (signal?: AbortSignal) => get<TopicView[]>('/topics', signal),
  setTopicMode: (name: string, mode: TopicMode) => post<TopicView>(`/topics/${enc(name)}`, { mode }),

  search: (q: string, signal?: AbortSignal) =>
    get<ArticleHit[]>(`/articles/search?q=${enc(q)}`, signal),
  addArticle: (url: string, when: AddWhen) => post<Job>('/articles/add', { url, when }),
  job: (id: string, signal?: AbortSignal) => get<Job>(`/jobs/${enc(id)}`, signal),

  runs: (limit = 10, signal?: AbortSignal) => get<RunView[]>(`/runs?limit=${limit}`, signal),

  reading: (days: number, signal?: AbortSignal) => get<ReadingView>(`/reading?days=${days}`, signal),
  calendar: (month: string, signal?: AbortSignal) =>
    get<CalendarView>(`/calendar?month=${enc(month)}`, signal),
  share: (signal?: AbortSignal) => get<ShareView>('/share', signal),
  ai: (signal?: AbortSignal) => get<AiPage>('/ai', signal),
  putAi: (patch: AiSettingsPatch) => request<AiPage>('PUT', '/ai', { body: patch }),

  readingSettings: (signal?: AbortSignal) => get<ReadingSettings>('/reading/settings', signal),
  putReadingSettings: (patch: Partial<ReadingSettings>) => request<ReadingSettings>('PUT', '/reading/settings', { body: patch }),
  sportSettings: (signal?: AbortSignal) => get<SportSettingsView>('/sport/settings', signal),
  putSportSettings: (patch: Partial<SportSettings>) => request<SportSettingsView>('PUT', '/sport/settings', { body: patch }),
  sportUsage: (days: number, signal?: AbortSignal) => get<SportUsageView>(`/sport?days=${days}`, signal),
}
