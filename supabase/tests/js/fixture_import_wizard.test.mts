import { test } from "node:test"
import assert from "node:assert/strict"
import { deflateRawSync } from "node:zlib"

import { guessMapping, looksLikeHeader, mappedRows, mappingProblems, tableFromText } from "@/lib/fixtures/import-mapping"
import { toRawRecord } from "@/lib/fixtures/planner-model"
import { excelSerialText, formatKind, readXlsx } from "@/lib/fixtures/xlsx-reader"

/**
 * IMPORT FIXTURES -- a file somebody else made, understood column by column
 * before a single row is checked, and read the way the person saw it.
 */

// A real zip, built here, so the reader is tested against the format rather than a fixture file.
function zip(files: Record<string, string>, deflate = true): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8")
    const body = deflate ? deflateRawSync(data) : data
    const nameBuf = Buffer.from(name, "utf8")
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, cd, end]))
}

const workbook = (sheetXml: string, deflate = true) =>
  zip(
    {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Fixtures" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId2" Target="worksheets/sheet1.xml"/><Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Date</t></si><si><t>KO</t></si><si><t>Opposition</t></si><si><r><t>Preston </t></r><r><t>Grasshoppers &amp; Co</t></r></si><si><t>Our Team</t></si><si><t>Under 12 Boys</t></si></sst>`,
      "xl/styles.xml": `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="20"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>the wrong sheet</t></is></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": sheetXml,
    },
    deflate,
  )

const SHEET = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>4</v></c></row>
<row r="2"><c r="A2" s="1"><v>46613</v></c><c r="B2" s="2"><v>0.4583333333</v></c><c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>5</v></c></row>
<row r="4"><c r="C4" t="inlineStr"><is><t>Fylde RFC</t></is></c></row>
<row r="5"/>
</sheetData></worksheet>`

test("reads the workbook's first sheet in its own order, with shared strings, rich text and entities", async () => {
  const rows = await readXlsx(workbook(SHEET))
  assert.deepEqual(rows[0], ["Date", "KO", "Opposition", "Our Team"])
  assert.equal(rows[1][2], "Preston Grasshoppers & Co")
  assert.equal(rows[1][3], "Under 12 Boys")
})

test("dates and times come back as the UK date and 24-hour time shown in the cell", async () => {
  const rows = await readXlsx(workbook(SHEET))
  assert.equal(rows[1][0], "14/08/2027")
  assert.equal(rows[1][1], "11:00")
  assert.equal(excelSerialText(46613.5, "datetime"), "14/08/2027 12:00")
  assert.equal(formatKind("[$-809]d mmmm yyyy"), "date")
  assert.equal(formatKind("h:mm AM/PM"), "time")
  assert.equal(formatKind("0.00"), "plain")
})

test("gaps keep columns in place; trailing empty rows are dropped; stored (uncompressed) parts read too", async () => {
  const rows = await readXlsx(workbook(SHEET, false))
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[2], [])
  assert.deepEqual(rows[3], ["", "", "Fylde RFC"])
})

test("a file that is not a workbook is refused with a sentence", async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode("date,team\n")), /not an Excel workbook/)
})

test("pasted Excel text and CSV both become the same table", () => {
  const tsv = tableFromText("Date\tKO\tOpposition\r\n14/08/2027\t11:00\tFylde RFC\r\n\r\n")
  const csv = tableFromText('﻿Date,KO,Opposition\n14/08/2027,11:00,"Fylde, RFC"\n')
  assert.deepEqual(tsv, [["Date", "KO", "Opposition"], ["14/08/2027", "11:00", "Fylde RFC"]])
  assert.deepEqual(csv[1], ["14/08/2027", "11:00", "Fylde, RFC"])
  assert.equal(csv[0][0], "Date")
})

test("headings are recognised by meaning, each field claimed once, and required fields named when missing", () => {
  const headers = ["Match Date", "KO", "Opponent", "Opposition Club", "Referee", "Type"]
  assert.equal(looksLikeHeader(headers), true)
  assert.equal(looksLikeHeader(["14/08/2027", "11:00", "Fylde RFC"]), false)
  const mapping = guessMapping(headers)
  assert.deepEqual(mapping, ["date", "kickoff", "oppositionClub", null, null, "fixtureType"])
  assert.deepEqual(mappingProblems(mapping).map((p) => p.message), ["Choose which column is Our Team."])
  assert.deepEqual(mappingProblems(["date", "ourTeam", "oppositionClub", "ourTeam"]).map((p) => p.kind), ["duplicate"])
})

test("mapped rows are the planner's own draft rows, so validation and staging are the planner's", () => {
  const rows = mappedRows(
    [
      ["14/08/2027", "Under 12 Boys", "Fylde RFC", "league", "ignored"],
      ["", "", "", "", ""],
    ],
    ["date", "ourTeam", "oppositionClub", "fixtureType", null],
  )
  assert.equal(rows.length, 1)
  const raw = toRawRecord(rows[0])
  assert.equal(raw.date, "2027-08-14")
  assert.equal(raw.home_team, "Under 12 Boys")
  assert.equal(raw.game_type, "League Fixture")
})
