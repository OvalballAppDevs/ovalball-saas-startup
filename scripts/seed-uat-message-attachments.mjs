#!/usr/bin/env node
/**
 * THE REVIEW WORLD, WITH SOMETHING ACTUALLY ATTACHED TO IT.
 *
 * Messages could be reviewed on a phone but attachments could not, because the seeded world had none:
 * no picture on anybody's profile, no image in a conversation, no document shared into one, and an empty
 * club library to share from. So "no attachment workflow" and "there is no attachment workflow visible"
 * were indistinguishable on the device, which is the worst position to review from.
 *
 * WHY THIS IS A SCRIPT AND NOT A SEED. An attachment is a storage OBJECT plus a row. SQL can write the
 * row; it cannot put the bytes in the bucket, and a row pointing at bytes that are not there produces a
 * signed URL that 404s -- which looks exactly like the defect being reviewed. This uploads real files and
 * then creates the messages, in that order, which is also the order the product itself uses.
 *
 * IT RUNS AS REAL AUTHENTICATED UAT IDENTITIES, NOT AS THE SERVICE ROLE. A short-lived HS256 token is
 * minted with the LOCAL development JWT secret -- the published `super-secret-jwt-token...` one, which is
 * the same on every Supabase local stack and is not a credential -- and every upload, insert and RPC call
 * then goes through PostgREST and Storage with RLS switched on, as that person. Two reasons: seeding with
 * the service role would prove nothing about whether the product's own paths work, and a seeder that
 * needs the service key is a seeder that has the service key lying around. When this script succeeds, the
 * policies allowed it.
 *
 * IT IS IDEMPOTENT. Re-running finds what it already made and leaves it alone. It creates no identities
 * and deletes nothing: the persistent review personas are enriched, never recreated.
 *
 * LOCAL ONLY, and it refuses to be anything else.
 */

import { createHmac } from "node:crypto"
import { deflateSync } from "node:zlib"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long"

if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("This seeder is local-only. SUPABASE_URL must point at the local stack.")
  process.exit(1)
}

// The fixture the review world already has: Under 12 Boys, Ovalball UAT RUFC, this Saturday.
const FIXTURE_ID = "b3db774a-b363-4c3b-850b-98483a98cc06"

// ---------------------------------------------------------------- tokens

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * A token GoTrue would have issued. Local secret, ten minutes, nothing stored.
 *
 * DELIBERATELY WITHOUT `session_id`, and the platform asks for exactly that. `internal.session_live`
 * is rule 0 of the capability engine: a token carrying a `session_id` is only live if that session
 * exists in `auth.sessions` and has not expired, and its own comment says "Only a token minted outside
 * GoTrue (the service key holder, tests) lacks a session id" -- which is what this is. A made-up session
 * id is refused, correctly and fail-closed, so every capability resolves to NO and the seed looks like a
 * permissions bug. Manufacturing an `auth.sessions` row to get around it would be forging auth state.
 */
function mintToken(userId) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      aud: "authenticated",
      role: "authenticated",
      iss: `${SUPABASE_URL}/auth/v1`,
      iat: now,
      exp: now + 600,
    })
  )
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `${header}.${payload}.${signature}`
}

function clientFor(userId) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mintToken(userId)}` } },
  })
}

// ---------------------------------------------------------------- files, made here

/**
 * A PNG, written by hand.
 *
 * No image library and no macOS-only tool, so this script runs wherever the stack does. The letters come
 * from a 5x7 bitmap font below, which is enough to make a team sheet that a person can actually READ on a
 * phone -- and reading it is the whole point, because an abstract coloured rectangle in a conversation
 * looks like a broken image rather than like an attachment that works.
 */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10011", "01111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "'": ["01100", "01100", "00100", "00000", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
}

function teamSheetPng() {
  const width = 900
  const height = 620
  const forest = [18, 61, 44]
  const chalk = [248, 250, 247]
  const pitch = [50, 166, 101]

  const pixels = new Uint8Array(width * height * 3)
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 3
    pixels[i] = r
    pixels[i + 1] = g
    pixels[i + 2] = b
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, y < 96 ? forest : chalk)
  for (let x = 0; x < width; x += 1) for (let y = 96; y < 100; y += 1) set(x, y, pitch)

  const write = (text, x, y, scale, colour) => {
    let cursor = x
    for (const raw of text.toUpperCase()) {
      const glyph = GLYPHS[raw] ?? GLYPHS[" "]
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          if (glyph[row][col] !== "1") continue
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) set(cursor + col * scale + dx, y + row * scale + dy, colour)
          }
        }
      }
      cursor += 6 * scale
    }
  }

  write("UNDER 12 BOYS - TEAM SHEET", 40, 34, 4, chalk)
  write("OVALBALL UAT RUFC V OVALBALL UAT OPPOSITION RFC", 40, 130, 3, forest)
  write("SATURDAY, KICK-OFF 10:30 - MEET 09:45", 40, 170, 3, [97, 101, 98])
  const squad = [
    "1  LEO BELL",
    "2  ADA WHITAKER",
    "3  SAM OKAFOR",
    "4  NOAH GRANT",
    "5  ISLA MURRAY",
    "6  THEO LINDQVIST",
    "7  MAYA OSEI",
    "8  FINN DOHERTY",
  ]
  squad.forEach((line, index) => write(line, 60, 240 + index * 44, 4, forest))

  // Scanline filter 0 on every row, which is what makes the deflate stream a valid PNG image.
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0
    Buffer.from(pixels.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1)
  }
  return encodePng(width, height, raw)
}

function encodePng(width, height, raw) {
  const chunk = (kind, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const typed = Buffer.concat([Buffer.from(kind, "ascii"), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([length, typed, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

let CRC_TABLE = null
function crc32(buffer) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

/** A minimal, genuinely valid PDF -- one page of Helvetica, so a native preview has something to render. */
function visitorGuidePdf() {
  const lines = [
    ["Ovalball UAT RUFC", 24],
    ["Visitor Guide", 18],
    ["", 12],
    ["Ground: Ovalball UAT RUFC, Preston", 12],
    ["Parking: main car park off the lane; overflow on the top field.", 12],
    ["Arrival: please arrive 45 minutes before kick-off.", 12],
    ["Changing: away teams use changing rooms 3 and 4.", 12],
    ["Clubhouse: open from 09:00. Hot food from 11:00.", 12],
    ["First aid: pitchside at all Mini and Junior fixtures.", 12],
    ["", 12],
    ["Contact the fixture secretary through Ovalball Messages.", 11],
  ]
  let y = 760
  let text = "BT\n"
  for (const [line, size] of lines) {
    if (line) text += `/F1 ${size} Tf\n1 0 0 1 60 ${y} Tm\n(${line.replace(/([()\\])/g, "\\$1")}) Tj\n`
    y -= size + 12
  }
  text += "ET\n"

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  let pdf = "%PDF-1.4\n"
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const startxref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Buffer.from(pdf, "latin1")
}

/** A portrait, so a conversation header has a real picture in it rather than initials. */
function portraitPng(initials, background) {
  const size = 512
  const pixels = new Uint8Array(size * size * 3)
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 3
    pixels[i] = r
    pixels[i + 1] = g
    pixels[i + 2] = b
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // A soft vertical wash, so it reads as a photograph's backdrop rather than as a flat swatch.
      const t = y / size
      set(x, y, background.map((channel, index) => Math.round(channel + (index === 1 ? 40 : 24) * t)))
    }
  }
  let cursor = Math.round(size / 2 - (initials.length * 6 * 22) / 2)
  for (const raw of initials.toUpperCase()) {
    const glyph = GLYPHS[raw] ?? GLYPHS[" "]
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== "1") continue
        for (let dy = 0; dy < 22; dy += 1) {
          for (let dx = 0; dx < 22; dx += 1) set(cursor + col * 22 + dx, 180 + row * 22 + dy, [248, 250, 247])
        }
      }
    }
    cursor += 6 * 22
  }
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0
    Buffer.from(pixels.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1)
  }
  return encodePng(size, size, raw)
}

// ---------------------------------------------------------------- the work

async function userId(email) {
  const { execSync } = await import("node:child_process")
  const out = execSync(
    `docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -Atc "select id from auth.users where email='${email}'"`,
    { encoding: "utf8" }
  ).trim()
  if (!out) throw new Error(`${email} is not in the local database`)
  return out
}

/**
 * A NAME, WHERE THE REVIEW NEEDS ONE.
 *
 * The team manager sends both review attachments, and had no first name or surname -- so every received
 * bubble was attributed to "Ovalball user", the canonical reader's honest fallback for a profile with no
 * name. On a screen being reviewed for whether messaging looks finished, that reads as the defect.
 *
 * WRITTEN AS THE PERSON, THROUGH THE NORMALISER. `internal.normalise_person_name` runs on the trigger, so
 * this supplies input and the database decides the stored form -- exactly as it would if they had typed it
 * into their own account page. Nothing is formatted here.
 */
async function seedName(email, firstName, surname, label) {
  const id = await userId(email)
  const supabase = clientFor(id)
  const { data: profile } = await supabase.from("profiles").select("first_name, surname").eq("id", id).maybeSingle()
  if (profile?.first_name || profile?.surname) {
    console.log(`  ${label}: already named, left alone`)
    return
  }
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ first_name: firstName, surname })
    .eq("id", id)
    .select("first_name, surname")
  if (error || !updated?.length) throw new Error(`${label} name refused: ${error?.message ?? "no row updated"}`)
  console.log(`  ${label}: named ${updated[0].first_name} ${updated[0].surname} (as the database stored it)`)
}

async function seedAvatar(email, initials, background, label) {
  const id = await userId(email)
  const supabase = clientFor(id)
  const { data: profile } = await supabase.from("profiles").select("avatar_storage_path").eq("id", id).maybeSingle()
  if (profile?.avatar_storage_path) {
    console.log(`  ${label}: already has a picture, left alone`)
    return
  }
  // The canonical path convention, from app/(app)/account/actions.ts: `${user.id}/avatar-<stamp>.<ext>`.
  const path = `${id}/avatar-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, portraitPng(initials, background), { contentType: "image/png", upsert: false })
  if (uploadError) throw new Error(`${label} avatar upload refused: ${uploadError.message}`)
  // A REFUSED UPDATE IS NOT AN ERROR IN POSTGREST, IT IS ZERO ROWS -- so `select()` is asked for and
  // counted. The first version of this trusted a null error, and RLS silently declining the update left
  // an uploaded picture attached to nobody while the script reported success. That is precisely the shape
  // of failure worth being loud about.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ avatar_storage_path: path })
    .eq("id", id)
    .select("id")
  if (error || !updated?.length) {
    await supabase.storage.from("avatars").remove([path])
    throw new Error(`${label} avatar row refused: ${error?.message ?? "no row updated"}`)
  }
  console.log(`  ${label}: picture uploaded`)
}

async function seedVisitorGuide() {
  const coach = await userId("uat.coach@ovalball.test")
  const supabase = clientFor(coach)
  const { data: existing } = await supabase.from("club_documents").select("id").eq("title", "Visitor Guide").maybeSingle()
  if (existing) {
    console.log("  Visitor Guide: already in the library, left alone")
    return
  }
  const { execSync } = await import("node:child_process")
  const clubId = execSync(
    `docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -Atc "select club_id from public.teams where id='5f868069-b6ca-4bcd-8306-f73d234031d9'"`,
    { encoding: "utf8" }
  ).trim()

  const bytes = visitorGuidePdf()
  const path = `${clubId}/${crypto.randomUUID()}.pdf`
  const { error: uploadError } = await supabase.storage
    .from("club-documents")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false })
  if (uploadError) throw new Error(`Visitor Guide upload refused: ${uploadError.message}`)
  const { error } = await supabase.from("club_documents").insert({
    club_id: clubId,
    title: "Visitor Guide",
    description: "Directions, parking, changing rooms and clubhouse times for visiting teams.",
    category: "other",
    original_filename: "ovalball-uat-visitor-guide.pdf",
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    uploaded_by: coach,
  })
  if (error) {
    await supabase.storage.from("club-documents").remove([path])
    throw new Error(`Visitor Guide row refused: ${error.message}`)
  }
  console.log("  Visitor Guide: uploaded to the club library")
}

async function seedReceivedAttachments() {
  const manager = await userId("uat.team.manager@ovalball.test")
  const supabase = clientFor(manager)

  // COUNTED ON THE ATTACHMENT TABLES THEMSELVES, and every error is raised rather than read as zero.
  // The first version asked PostgREST for embedded resources by a guessed relation name, got an error
  // back, ignored it, and concluded there was nothing there -- so a second run sent a second team sheet
  // and shared the Visitor Guide twice. An idempotency check that fails open is worse than none, because
  // it is the thing you stop looking at.
  const { count: imageCount, error: imageCountError } = await supabase
    .from("fixture_message_attachments")
    .select("id, fixture_messages!inner(fixture_id)", { count: "exact", head: true })
    .eq("fixture_messages.fixture_id", FIXTURE_ID)
  if (imageCountError) throw new Error(`Could not count attachments: ${imageCountError.message}`)

  const { count: shareCount, error: shareCountError } = await supabase
    .from("fixture_message_document_refs")
    .select("id, fixture_messages!inner(fixture_id)", { count: "exact", head: true })
    .eq("fixture_messages.fixture_id", FIXTURE_ID)
  if (shareCountError) throw new Error(`Could not count document shares: ${shareCountError.message}`)

  const hasImage = (imageCount ?? 0) > 0
  const hasShare = (shareCount ?? 0) > 0

  if (hasImage) {
    console.log("  Received image: already in the fixture conversation, left alone")
  } else {
    const bytes = teamSheetPng()
    const path = `f/${FIXTURE_ID}/${crypto.randomUUID()}.png`
    const { error: uploadError } = await supabase.storage
      .from("fixture-attachments")
      .upload(path, bytes, { contentType: "image/png", upsert: false })
    if (uploadError) throw new Error(`Team sheet upload refused: ${uploadError.message}`)
    // THE CANONICAL RPC, with the caption a real person would send. An image may legitimately carry no
    // caption; this one carries one because a received bubble with words AND a picture is the case worth
    // being able to look at.
    const { error } = await supabase.rpc("create_fixture_message_with_attachment", {
      p_fixture_id: FIXTURE_ID,
      p_fixture_request_id: null,
      p_body: "Team sheet for Saturday — shout if anyone is missing.",
      p_storage_path: path,
      p_original_filename: "under-12-boys-team-sheet.png",
      p_mime_type: "image/png",
      p_size_bytes: bytes.length,
    })
    if (error) {
      await supabase.storage.from("fixture-attachments").remove([path])
      throw new Error(`Team sheet message refused: ${error.message}`)
    }
    console.log("  Received image: team sheet sent into the fixture conversation")
  }

  if (hasShare) {
    console.log("  Received document: already shared into the fixture conversation, left alone")
    return
  }
  const { data: guide } = await supabase.from("club_documents").select("id").eq("title", "Visitor Guide").maybeSingle()
  if (!guide) {
    console.log("  Received document: no Visitor Guide visible to the team manager, skipped")
    return
  }
  const { error } = await supabase.rpc("share_fixture_document", {
    p_fixture_id: FIXTURE_ID,
    p_fixture_request_id: null,
    p_document_id: guide.id,
    p_note: "Visitor guide for the away side — parking is off the lane.",
  })
  if (error) throw new Error(`Visitor Guide share refused: ${error.message}`)
  console.log("  Received document: Visitor Guide shared into the fixture conversation")
}

async function main() {
  console.log("Review world — message attachments")
  await seedName("uat.team.manager@ovalball.test", "Jordan", "Hale", "Jordan Hale")
  await seedAvatar("uat.guardian.two@ovalball.test", "DW", [32, 86, 120], "Dana Whitaker")
  await seedAvatar("uat.coach@ovalball.test", "PN", [18, 61, 44], "Priya Nair")
  await seedAvatar("uat.team.manager@ovalball.test", "JH", [96, 66, 32], "Jordan Hale")
  await seedVisitorGuide()
  await seedReceivedAttachments()
  console.log("Done.")
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`)
  process.exit(1)
})
