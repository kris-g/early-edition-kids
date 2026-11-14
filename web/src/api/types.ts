// The dashboard API types (v1 and v2) come from the server's types-only file, so
// the two sides cannot drift. They match CONTRACT.md. Building the web app
// therefore needs ../server/src/dashboard/types.ts present.
export type * from '../../../server/src/dashboard/types'
export type { AiSettingsUpdate as AiSettingsPatch } from '../../../server/src/dashboard/types'
