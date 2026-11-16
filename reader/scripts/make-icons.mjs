// Draws the reader's home-screen icons: the sunrise mark (the Kindle plugin's
// icons/sunrise.svg, with the sun in sunrise yellow) on the paper ground.
//   npm run icons
// Writes public/apple-touch-icon.png (180), icon-192.png, icon-512.png and
// favicon.svg. Pure JS: shapes are measured per pixel and the PNG is written
// with node:zlib, so there is no image library and nothing native.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pub = (f) => resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', f)

const PAPER = [0xfa, 0xfa, 0xf7]
const INK = [0x12, 0x12, 0x12]
const SUN = [0xff, 0xd2, 0x1f]

// The mark, in the 220 x 92 units of sunrise.svg. Strokes are a little heavier
// than the Kindle's so the mark holds up at home-screen size.
const STROKE = 6
const CX = 110
const BASE = 80
const RAYS = [
  [110, 6, 110, 20],
  [56, 26, 66, 36],
  [164, 26, 154, 36],
  [28, 56, 42, 60],
  [192, 56, 178, 60],
  [10, 80, 210, 80],
]

function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** The colour at a point of the mark, painted in SVG order. */
function colourAt(x, y) {
  const d = Math.hypot(x - CX, y - BASE)
  const above = y <= BASE
  let c = PAPER
  if (above && d <= 32) c = SUN
  const half = STROKE / 2
  if (above && Math.abs(d - 32) <= half) c = INK
  if (above && Math.abs(d - 50) <= half) c = INK
  for (const r of RAYS) if (segDist(x, y, r) <= half) c = INK
  return c
}

function crcTable() {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
}
const CRC = crcTable()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A full-bleed square: the mark 78% of the width across, centred top to bottom. */
function render(size) {
  const scale = (size * 0.78) / 220
  const ox = (size - 220 * scale) / 2
  const oy = size / 2 - 43 * scale
  const SS = 4
  const rgb = Buffer.alloc(size * size * 3)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colourAt((px + (sx + 0.5) / SS - ox) / scale, (py + (sy + 0.5) / SS - oy) / scale)
          acc[0] += c[0]
          acc[1] += c[1]
          acc[2] += c[2]
        }
      }
      const i = (py * size + px) * 3
      for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(acc[k] / (SS * SS))
    }
  }
  return png(size, rgb)
}

for (const [file, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  writeFileSync(pub(file), render(size))
  console.log('wrote', file, `${size}x${size}`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fafaf7"/><g transform="translate(4 7) scale(0.2545)" stroke="#121212" stroke-width="${STROKE}" stroke-linecap="round"><path d="M78 80 A32 32 0 0 1 142 80" fill="#ffd21f"/><path d="M60 80 A50 50 0 0 1 160 80" fill="none"/><path d="M10 80h200M110 6v14M56 26l10 10M164 26l-10 10M28 56l14 4M192 56l-14 4" fill="none"/></g></svg>\n`
writeFileSync(pub('favicon.svg'), svg)
console.log('wrote favicon.svg')
