export const RANGES = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 84, label: '12 weeks' },
] as const

export type RangeDays = (typeof RANGES)[number]['days']
