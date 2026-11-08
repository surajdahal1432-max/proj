import JSZip from 'jszip'

export type CellValue = string | number | null | undefined

export function columnName(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

export interface SheetSpec {
  name: string
  rows: CellValue[][]
}

/** Build a valid .xlsx workbook (SpreadsheetML) with inline strings. */
export async function buildXlsx(sheets: SheetSpec[]): Promise<Blob> {
  const zip = new JSZip()

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_sheet, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name.slice(0, 31) || `Sheet${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('\n')}
</sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_sheet, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`

  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, colIndex) => {
            if (value === null || value === undefined || value === '') return ''
            const ref = `${columnName(colIndex)}${rowIndex + 1}`
            const isHeader = rowIndex === 0
            const styleAttr = isHeader ? ' s="1"' : ''
            if (typeof value === 'number' && Number.isFinite(value)) {
              return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`
            }
            return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
          })
          .join('')
        return `<row r="${rowIndex + 1}">${cells}</row>`
      })
      .join('\n')

    const maxCols = sheet.rows.reduce((max, row) => Math.max(max, row.length), 1)
    const dimension = `A1:${columnName(maxCols - 1)}${Math.max(1, sheet.rows.length)}`

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<sheetData>
${rows}
</sheetData>
</worksheet>`

    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, sheetXml)
  })

  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', rels)
  zip.file('xl/workbook.xml', workbook)
  zip.file('xl/_rels/workbook.xml.rels', workbookRels)
  zip.file('xl/styles.xml', styles)

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return new Blob([blob], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function textOf(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Read the first worksheet of an .xlsx file into a row matrix. */
export async function readXlsx(file: File | Blob): Promise<CellValue[][]> {
  const zip = await JSZip.loadAsync(file)
  const sheetFile = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0]
  if (!sheetFile) throw new Error('No worksheet found in this workbook.')

  const sheetXml = await zip.file(sheetFile)!.async('string')
  const sharedXml = zip.file('xl/sharedStrings.xml')
  const shared: string[] = []
  if (sharedXml) {
    const sharedContent = await sharedXml.async('string')
    for (const match of sharedContent.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(textOf(match[1]))
    }
  }

  const rows: CellValue[][] = []
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1]
    const cells: CellValue[] = []
    for (const cellMatch of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]
      const body = cellMatch[2]
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs)
      const colIndex = refMatch ? lettersToIndex(refMatch[1]) : cells.length
      const typeMatch = /t="([^"]+)"/.exec(attrs)
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(body)
      const isMatch = /<is>([\s\S]*?)<\/is>/.exec(body)
      let value: CellValue = null
      if (typeMatch?.[1] === 's' && valueMatch) {
        value = shared[parseInt(valueMatch[1], 10)] ?? ''
      } else if (typeMatch?.[1] === 'inlineStr' && isMatch) {
        value = textOf(isMatch[1])
      } else if (valueMatch) {
        const numeric = Number(valueMatch[1])
        value = Number.isFinite(numeric) ? numeric : textOf(valueMatch[1])
      }
      while (cells.length < colIndex) cells.push(null)
      cells[colIndex] = value
    }
    rows.push(cells)
  }

  return rows.filter((row) => row.some((cell) => cell !== null && cell !== ''))
}

function lettersToIndex(letters: string): number {
  let index = 0
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

/** Convert a matrix into CSV text with RFC-4180 quoting. */
export function rowsToCsv(rows: CellValue[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell)
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(','),
    )
    .join('\r\n')
}

/** Parse CSV text into a matrix (handles quoted fields and embedded newlines). */
export function csvToRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char === '\r') {
      // skip
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}
