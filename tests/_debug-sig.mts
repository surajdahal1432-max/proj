import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
const signature: any = await import('../src/lib/signature')
const dir = join(process.cwd(), '.tmp-fixtures')
const bytes = new Uint8Array(readFileSync(join(dir, 'simple.pdf')))
const png = new Uint8Array(readFileSync(join(dir, 'stamp.png')))
const page = { width: 595.28, height: 841.89 }
const signed: any = await signature.signPdfWithPlacement(new File([bytes], 'simple.pdf'), { page: 0, x: 0.25, y: 0.5, width: 0.3 }, png, page, 1.5)
const data = new Uint8Array(await signed.arrayBuffer())
const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
const p = await doc.getPage(1)
const ops = await p.getOperatorList()
const names = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v as number, k]))
ops.fnArray.forEach((fn: number, i: number) => {
  const name = names[fn] ?? String(fn)
  if (/transform|paintImage|paintInline|save|restore/i.test(name)) {
    console.log(name, JSON.stringify(ops.argsArray[i]))
  }
})
await (doc.destroy ? doc.destroy() : doc.cleanup())
