/**
 * Small, dependency-free RFC 4180-ish CSV parser -- handles quoted
 * fields, embedded commas/newlines within quotes, and doubled-quote
 * escaping ("" -> "). No external CSV library is installed in this
 * project; uploads are trusted-but-verified input (validated row by row
 * server-side afterward), not adversarial arbitrary CSV. Shared by both
 * the Site Admin and club-scoped fixture import flows -- one CSV parser,
 * matching the "one CSV contract" principle.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false
  let i = 0
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  while (i < normalized.length) {
    const char = normalized[i]
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ",") {
      row.push(field)
      field = ""
      i += 1
      continue
    }
    if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i += 1
      continue
    }
    field += char
    i += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // A leading `# schema_version=N` comment line (written by every export
  // since lib/fixtures/csv-schema.ts's v2 contract) is metadata, not a
  // header row -- strip any line starting with `#` before treating the
  // next non-empty row as headers, so both a versioned v2 export and a
  // plain older/hand-written v1 file (no comment line at all) parse
  // identically.
  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0].trim() === "") && !(r.length >= 1 && r[0].trim().startsWith("#")))
  if (nonEmptyRows.length === 0) return { headers: [], rows: [] }

  const headers = nonEmptyRows[0].map((h) => h.trim())
  const dataRows = nonEmptyRows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim()
    })
    return obj
  })
  return { headers, rows: dataRows }
}
