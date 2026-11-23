// The Kindle's own icons (plugin/earlyeditionkids.koplugin/icons), redrawn with currentColor, and
// one flat colour per topic. Topics are free text in the config: the nine starting ones have their
// own icon and colour, anything else gets the plain one.

import { esc } from './body'

export type TopicKey = 'team' | 'england' | 'football' | 'science' | 'space' | 'animals' | 'games' | 'weather' | 'weird' | 'generic'

const TOPICS: Record<string, TopicKey> = {
  'Liverpool FC': 'team',
  England: 'england',
  Football: 'football',
  Science: 'science',
  Space: 'space',
  'Animals and nature': 'animals',
  'Games and tech': 'games',
  Weather: 'weather',
  'Weird but true': 'weird',
}

export const topicKey = (topic: string): TopicKey => TOPICS[topic] ?? 'generic'

const RING = '<circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.5"/>'
const S = 'stroke="currentColor" stroke-width="2.5"'

const ICONS: Record<string, [string, string]> = {
  team: ['0 0 48 48', RING + `<rect x="12" y="12.5" width="24" height="7" rx="3.5" fill="none" ${S}/><path d="M15 19.5V34h6V19.5" fill="none" ${S} stroke-linejoin="round"/><rect x="15" y="24" width="6" height="4" fill="currentColor"/><path d="M27 19.5l4 12.6 5.6-1.7-3.8-11" fill="none" ${S} stroke-linejoin="round"/><path d="M28.7 24.3l5.4-1.6 1.1 3.7-5.4 1.6z" fill="currentColor"/><path d="M16.5 34v3.5M19.5 34v3.5M32.2 32.6l1 3.2M35 31.8l1 3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`],
  england: ['0 0 48 48', RING + `<path d="M14 13v24" ${S} stroke-linecap="round"/><rect x="14" y="13" width="21" height="14" rx="1" fill="none" ${S}/><path d="M24.5 13v14M14 20h21" stroke="currentColor" stroke-width="3.5"/>`],
  football: ['0 0 48 48', RING + `<path d="M24 15l7 5-3 8h-8l-3-8z" fill="currentColor"/><path d="M24 15V6M31 20l8-4M28 28l5 8M20 28l-5 8M17 20l-8-4" ${S} fill="none"/>`],
  science: ['0 0 48 48', RING + `<path d="M20 12h8M21 12v9l-7 13a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3l-7-13v-9" fill="none" ${S} stroke-linejoin="round"/><path d="M17 30h14" ${S}/>`],
  space: ['0 0 48 48', RING + `<path d="M24 9c5 4 7 10 6 18h-12c-1-8 1-14 6-18z" fill="none" ${S} stroke-linejoin="round"/><circle cx="24" cy="19" r="2.5" fill="currentColor"/><path d="M18 24l-4 5v4l5-3M30 24l4 5v4l-5-3M22 31l2 6 2-6" fill="none" ${S} stroke-linejoin="round"/>`],
  animals: ['0 0 48 48', RING + '<ellipse cx="24" cy="29" rx="7" ry="6" fill="currentColor"/><circle cx="15" cy="21" r="3" fill="currentColor"/><circle cx="20" cy="15" r="3" fill="currentColor"/><circle cx="28" cy="15" r="3" fill="currentColor"/><circle cx="33" cy="21" r="3" fill="currentColor"/>'],
  games: ['0 0 48 48', RING + `<rect x="11" y="18" width="26" height="14" rx="7" fill="none" ${S}/><path d="M17 22v6M14 25h6" ${S}/><circle cx="30" cy="23" r="1.8" fill="currentColor"/><circle cx="33" cy="27" r="1.8" fill="currentColor"/>`],
  weather: ['0 0 48 48', RING + `<path d="M15 25a5 5 0 0 1 1-9.9 7 7 0 0 1 13.4-1.6A5.5 5.5 0 1 1 32 25z" fill="none" ${S} stroke-linejoin="round"/><path d="M24 28v10M19.7 30.5l8.6 5M19.7 35.5l8.6-5" ${S} stroke-linecap="round"/>`],
  weird: ['0 0 48 48', RING + `<path d="M19 31c0-3-4-5-4-11a9 9 0 0 1 18 0c0 6-4 8-4 11z" fill="none" ${S} stroke-linejoin="round"/><path d="M20 34.5h8M21.5 38h5" ${S} stroke-linecap="round"/><path d="M24 31v-6l-2.5-3M24 25l2.5-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`],
  generic: ['0 0 48 48', RING + `<rect x="14" y="13" width="20" height="23" fill="none" ${S}/><path d="M18 19h12M18 24h12M18 29h8" ${S}/>`],
  tick: ['0 0 48 48', '<circle cx="24" cy="24" r="21" fill="#121212" stroke="#fafaf7" stroke-width="3"/><path d="M14 25l7 7 13-14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'],
  // A story read to the end too quickly: outlined, so it doesn't read as the tick.
  'too-fast': ['0 0 48 48', '<circle cx="24" cy="24" r="21" fill="#fafaf7" stroke="#121212" stroke-width="3"/><path d="M12 15.5l11 8.5-11 8.5z M24.5 15.5l11 8.5-11 8.5z" fill="#121212" stroke="#121212" stroke-width="1.5" stroke-linejoin="round"/>'],
  arrow: ['0 0 24 24', '<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'],
  back: ['0 0 24 24', '<path d="M19 12H6M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'],
  refresh: ['0 0 24 24', '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'],
  sun: ['0 0 220 92', '<path d="M78 80 A32 32 0 0 1 142 80" fill="#ffd21f" stroke="currentColor" stroke-width="4"/><path d="M60 80 A50 50 0 0 1 160 80" fill="none" stroke="currentColor" stroke-width="4"/><path d="M10 80h200M110 6v14M56 26l10 10M164 26l-10 10M28 56l14 4M192 56l-14 4" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'],
}

export function icon(name: string, cls = ''): string {
  const [box, body] = ICONS[name] ?? ICONS.generic
  return `<svg class="${esc(cls)}" viewBox="${box}" aria-hidden="true" focusable="false">${body}</svg>`
}

/** The round Read stamp, with the paper's date ("13 NOV"). */
export function stamp(dateLabel: string): string {
  return `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><g transform="rotate(-8 60 60)"><circle cx="60" cy="60" r="56" fill="none" stroke="#121212" stroke-width="4"/><circle cx="60" cy="60" r="47" fill="none" stroke="#121212" stroke-width="1.5" stroke-dasharray="3 4"/><path d="M60 16l5.500 11.200 12.300 1.800-8.900 8.700 2.100 12.300L60 44.200 49 50l2.100-12.300-8.900-8.700 12.300-1.800z" fill="#121212"/><path d="M34 76V61h10v7.500H34M37.750 68.500L44 76M58 61H48v15h10M48 68.500h7.500M62 76l5-15 5 15M63.750 71h6.500M76 61h6.250L86 64.750v7.500L82.250 76H76V61" fill="none" stroke="#121212" stroke-width="3" stroke-linecap="square"/><text x="60" y="95" text-anchor="middle" font-family="Noto Sans, sans-serif" font-weight="700" font-size="11.500" letter-spacing="1.500" fill="#121212">${esc(dateLabel)}</text></g></svg>`
}
