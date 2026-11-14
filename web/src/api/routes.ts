// Route-level shapes, under the names the app uses.
import type { AiView, ModelOption } from './types'

export type { AddWhen, GenerateResponse as GenerateResult, ProviderId, Summary, TopicMode } from './types'

export type ProviderInfo = AiView['providers'][number]
export type ModelChoice = ModelOption
export type AiPage = AiView
