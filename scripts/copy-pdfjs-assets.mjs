import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const src = resolve('node_modules/pdfjs-dist')
const dest = resolve('public/pdfjs')

if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed — run npm install first.')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  if (existsSync(resolve(src, dir))) cpSync(resolve(src, dir), resolve(dest, dir), { recursive: true })
}

console.log('PDF.js assets copied to public/pdfjs')
