import fs from 'node:fs'
import path from 'node:path'

const escape = (value) => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsvLine(values) {
  return values.map(escape).join(',')
}

// When a log gains columns, rewrite it first. Otherwise new rows would no longer line
// up with the header. Old rows keep their values and get blanks in the new columns.
function upgradeHeader(file, columns) {
  const text = fs.readFileSync(file, 'utf8')
  const header = text.slice(0, text.indexOf('\n'))
  if (header === toCsvLine(columns)) return
  const rows = parseCsv(text)
  const known = new Set(columns)
  const extras = Object.keys(rows[0] ?? {}).filter((name) => !known.has(name))
  if (extras.length) throw new Error(`${file} has columns this version doesn't know: ${extras.join(', ')}`)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, [columns, ...rows.map((row) => columns.map((c) => row[c]))].map(toCsvLine).join('\n') + '\n')
  fs.renameSync(tmp, file)
}

export function appendCsvRow(file, columns, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const isNew = !fs.existsSync(file) || fs.statSync(file).size === 0
  if (!isNew) upgradeHeader(file, columns)
  const lines = (isNew ? toCsvLine(columns) + '\n' : '') + toCsvLine(columns.map((c) => row[c])) + '\n'
  fs.appendFileSync(file, lines)
}

export function writeCsv(file, columns, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = [columns, ...rows.map((row) => columns.map((c) => row[c]))].map(toCsvLine)
  fs.writeFileSync(file, lines.join('\n') + '\n')
}

export function parseCsv(text) {
  const records = []
  let record = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || record.length) {
    record.push(field)
    records.push(record)
  }
  const [header, ...rows] = records
  if (!header) return []
  return rows.map((r) => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ''])))
}

export function readCsv(file) {
  return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : []
}
