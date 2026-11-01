// Vygeneruje ikony aplikace z public/icon-fullbleed.svg (spouští se ručně: node scripts/generate-icons.mjs)
//  - maskable a apple-touch: vyplněné do krajů, tvar (kruh, squircle, zaoblení) ořízne systém
//  - ostatní („any“, favicon): zaoblený čtverec s průhlednými rohy

import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const full = readFileSync('public/icon-fullbleed.svg', 'utf8')
// Zaoblená varianta: stejný obsah oříznutý maskou se zaoblením 22 % (jako ikony aplikací)
const rounded = full
  .replace('<defs>', '<defs><clipPath id="r"><rect width="512" height="512" rx="112"/></clipPath>')
  .replace(/(<\/defs>)([\s\S]*)(<\/svg>)/, '$1<g clip-path="url(#r)">$2</g>$3')
writeFileSync('public/favicon.svg', rounded)

const png = (svg, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

const out = {
  'public/pwa-64x64.png': [rounded, 64],
  'public/pwa-192x192.png': [rounded, 192],
  'public/pwa-512x512.png': [rounded, 512],
  'public/maskable-icon-512x512.png': [full, 512],
  'public/apple-touch-icon-180x180.png': [full, 180],
}
for (const [file, [svg, size]] of Object.entries(out)) {
  writeFileSync(file, await png(svg, size))
  console.log(file, size)
}

// favicon.ico s jedním 48px PNG uvnitř
const ico48 = await png(rounded, 48)
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header[6] = 48
header[7] = 48
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(ico48.length, 14)
header.writeUInt32LE(22, 18)
writeFileSync('public/favicon.ico', Buffer.concat([header, ico48]))
console.log('public/favicon.ico 48')
