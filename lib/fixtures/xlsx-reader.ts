/**
 * READS THE FIRST SHEET OF AN EXCEL WORKBOOK -- AND NOTHING ELSE.
 *
 * A fixture secretary's season lives in Excel far more often than in a CSV,
 * and "save it as CSV first" is exactly the step that loses dates (Excel
 * rewrites 14/08/2027 as 8/14/27 on a US-locale machine). So the import
 * reads .xlsx directly: cell text, shared strings, and dates and times turned
 * back into what the person saw in the cell.
 *
 * Deliberately small. An .xlsx file is a zip of XML parts; this unzips with
 * the platform's own DecompressionStream (browser and Node), reads the first
 * worksheet and its shared strings and number formats, and returns rows of
 * text. No formulas are evaluated (the cached value is read), no styling,
 * no second sheet. Anything it cannot read, it refuses with a sentence.
 */

type Bytes = Uint8Array

const utf8 = new TextDecoder("utf-8")

function u16(b: Bytes, o: number) {
  return b[o] | (b[o + 1] << 8)
}
function u32(b: Bytes, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

async function inflateRaw(data: Bytes): Promise<Bytes> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The zip's entries by name, read lazily. */
function zipEntries(b: Bytes): Map<string, () => Promise<Bytes>> {
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("That file is not an Excel workbook (.xlsx).")
  const count = u16(b, eocd + 10)
  let p = u32(b, eocd + 16)
  const out = new Map<string, () => Promise<Bytes>>()
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("That workbook is damaged and could not be read.")
    const method = u16(b, p + 10)
    const compressed = u32(b, p + 20)
    const nameLen = u16(b, p + 28)
    const extraLen = u16(b, p + 30)
    const commentLen = u16(b, p + 32)
    const local = u32(b, p + 42)
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLen))
    out.set(name, async () => {
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
      const raw = b.subarray(start, start + compressed)
      if (method === 0) return raw
      if (method === 8) return inflateRaw(raw)
      throw new Error("That workbook uses a compression Ovalball cannot read. Save it again from Excel, or as CSV.")
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
}

function textRuns(xml: string): string {
  let out = ""
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? "")
  return out
}

export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A"
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

type Kind = "date" | "time" | "datetime" | "plain"

const BUILTIN_KIND: Record<number, Kind> = {
  14: "date", 15: "date", 16: "date", 17: "date", 22: "datetime",
  18: "time", 19: "time", 20: "time", 21: "time", 45: "time", 46: "time", 47: "time",
}

export function formatKind(code: string): Kind {
  // Literal text and colours are not part of the pattern.
  const pattern = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").toLowerCase()
  const hasDate = /[dy]/.test(pattern) || /(^|[^h:])m{3,}/.test(pattern)
  const hasTime = /h|s/.test(pattern)
  if (hasDate && hasTime) return "datetime"
  if (hasDate) return "date"
  if (hasTime) return "time"
  return "plain"
}

const pad = (n: number) => String(n).padStart(2, "0")

/** An Excel serial as the UK date or 24-hour time a person saw in the cell. */
export function excelSerialText(serial: number, kind: Kind): string {
  // 1900 date system; Excel's phantom 29 February 1900 is why the epoch is 30 December 1899.
  const ms = Math.round(serial * 86400000)
  const d = new Date(Date.UTC(1899, 11, 30) + ms)
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  if (kind === "date") return date
  if (kind === "time") return time
  return `${date} ${time}`
}

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const entries = zipEntries(bytes)
  const read = async (name: string) => {
    const get = entries.get(name)
    return get ? utf8.decode(await get()) : null
  }

  // The FIRST sheet as the workbook orders them, not whichever part is called sheet1.
  let sheetPath: string | null = null
  const workbook = await read("xl/workbook.xml")
  const rels = await read("xl/_rels/workbook.xml.rels")
  if (workbook && rels) {
    const firstId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1]
    const target = firstId ? new RegExp(`<Relationship\\b[^>]*\\bId="${firstId}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1] ??
      new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstId}"`).exec(rels)?.[1] : undefined
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`
  }
  if (!sheetPath || !entries.has(sheetPath)) {
    sheetPath = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ?? null
  }
  const sheet = sheetPath ? await read(sheetPath) : null
  if (!sheet) throw new Error("That workbook has no sheet Ovalball can read.")

  const shared: string[] = []
  const sst = await read("xl/sharedStrings.xml")
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]))

  // Which cell styles are dates or times.
  const styleKind: Kind[] = []
  const styles = await read("xl/styles.xml")
  if (styles) {
    const custom = new Map<number, string>()
    for (const m of styles.matchAll(/<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeXml(m[2]))
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ""
    for (const m of xfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
      const id = Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0)
      styleKind.push(custom.has(id) ? formatKind(custom.get(id)!) : (BUILTIN_KIND[id] ?? "plain"))
    }
  }

  const rows: string[][] = []
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rm[1] ?? rm[3] ?? ""
    const rowNumber = Number(/\br="(\d+)"/.exec(attrs)?.[1] ?? rows.length + 1)
    const cells: string[] = []
    let nextCol = 0
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]
      const ref = /\br="([A-Z]+\d+)"/.exec(a)?.[1]
      const col = ref ? columnIndex(ref) : nextCol
      nextCol = col + 1
      const type = /\bt="([^"]+)"/.exec(a)?.[1] ?? "n"
      const style = Number(/\bs="(\d+)"/.exec(a)?.[1] ?? 0)
      const inner = cm[2] ?? ""
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let text = ""
      if (type === "s") text = shared[Number(v)] ?? ""
      else if (type === "inlineStr") text = textRuns(inner)
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE"
      else if (type === "str" || type === "e") text = decodeXml(v ?? "")
      else if (v !== undefined) {
        const kind = styleKind[style] ?? "plain"
        const num = Number(v)
        text = kind !== "plain" && Number.isFinite(num) ? excelSerialText(num, kind) : v
      }
      cells[col] = text
    }
    while (rows.length < rowNumber - 1) rows.push([])
    rows[rowNumber - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? "")
  }
  // Trailing empty rows are formatting, not fixtures.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => !c.trim())) rows.pop()
  return rows
}
