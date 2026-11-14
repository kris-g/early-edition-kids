// Generates the app icons from one source design.
//   npm run icons
// Writes public/favicon.svg (rounded, vector) and rasterised PNGs:
// pwa-192, pwa-512, maskable-512 and apple-touch-icon (180). The PNGs are
// full-bleed squares so launchers can crop them to any shape without
// transparent corners. No Python: SVG in, sharp out.
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = (f) => resolve(root, 'public', f)

// Keep in step with BRAND in src/config.ts (the light --accent token).
const BRAND = '#0b6b53'
const INK = '#ffffff'

// A bold "E" built from rectangles, so it does not depend on any font being
// installed. Drawn on a 512 canvas around the centre. `scale` shrinks it for the
// maskable icon, whose safe zone is the central 80%.
const letter = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-261 -256)" fill="${INK}">
    <rect x="150" y="126" width="80" height="260"/>
    <rect x="150" y="126" width="222" height="72"/>
    <rect x="150" y="221" width="198" height="70"/>
    <rect x="150" y="314" width="222" height="72"/>
  </g>
`

const svg = ({ radius, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="${radius}" fill="${BRAND}"/>
  ${letter(scale)}
</svg>`

writeFileSync(pub('favicon.svg'), svg({ radius: 112, scale: 1 }).trim() + '\n')
console.log('wrote favicon.svg')

const targets = [
  ['pwa-192.png', 192, 1],
  ['pwa-512.png', 512, 1],
  ['apple-touch-icon.png', 180, 1],
  ['maskable-512.png', 512, 0.8],
]
for (const [file, size, scale] of targets) {
  await sharp(Buffer.from(svg({ radius: 0, scale })), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(pub(file))
  console.log('wrote', file, `${size}x${size}`)
}
