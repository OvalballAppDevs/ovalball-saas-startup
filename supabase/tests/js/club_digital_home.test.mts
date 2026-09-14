import { test } from "node:test"
import assert from "node:assert/strict"

import { articlePlainText, parseArticleBody, parseInline, readingMinutes, safeHref, summarise, type Inline } from "@/lib/club-content/markup"
import {
  competitionResultForClub,
  fixtureResult,
  mergeResults,
  outcomeOf,
  OUTCOME_WORD,
  selectUpcoming,
  type CompetitionParticipantRow,
  type CompetitionRef,
} from "@/lib/club-public/matches"
import { articleCategoryLabel, articlePath, priorityLabel } from "@/lib/club-content/vocabulary"

/**
 * CLUB DIGITAL HOME: THE PARTS THAT ARE NOT SQL.
 *
 * The article markup is the only thing standing between what a volunteer
 * types and what a stranger's browser renders, so its link rules are tested
 * as an attack surface. The fixture and result selection rules decide what a
 * club's page says about its matches, so they are tested as data rules.
 */

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function links(nodes: Inline[]): { href: string; external: boolean }[] {
  return nodes.flatMap((n) => (n.type === "link" ? [{ href: n.href, external: n.external }] : n.type === "strong" || n.type === "em" ? links(n.children) : []))
}

test("the markup covers what the editor toolbar inserts", () => {
  const blocks = parseArticleBody(
    ["## Match day", "", "A **great** morning and an *early* start.", "", "- Kit at nine", "- Boots cleaned", "", "1. Warm up", "2. Play", "", "### After", "See [the calendar](/calendar)."].join("\n")
  )
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "paragraph", "list", "list", "heading", "paragraph"]
  )
  assert.equal(blocks[0].type === "heading" && blocks[0].level, 2)
  assert.equal(blocks[4].type === "heading" && blocks[4].level, 3)
  assert.equal(blocks[2].type === "list" && blocks[2].ordered, false)
  assert.equal(blocks[3].type === "list" && blocks[3].ordered, true)
  const para = blocks[1].type === "paragraph" ? blocks[1].children : []
  assert.ok(para.some((n) => n.type === "strong"))
  assert.ok(para.some((n) => n.type === "em"))
})

test("single line breaks are kept inside a paragraph", () => {
  const [p] = parseArticleBody("Line one\nLine two")
  assert.ok(p.type === "paragraph" && p.children.some((n) => n.type === "break"))
})

test("only https, http, mailto and same-site paths become links", () => {
  assert.deepEqual(safeHref("https://club.example/tickets"), { href: "https://club.example/tickets", external: true })
  assert.deepEqual(safeHref("/rugby-hub"), { href: "/rugby-hub", external: false })
  assert.deepEqual(safeHref("mailto:secretary@club.example"), { href: "mailto:secretary@club.example", external: true })
  for (const hostile of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.example", "vbscript:msgbox", "ftp://files", " javascript:alert(1)"]) {
    assert.equal(safeHref(hostile), null, hostile)
  }
})

test("a hostile link keeps its words and loses its address", () => {
  const nodes = parseInline("Click [here](javascript:alert(document.cookie)) now")
  assert.equal(links(nodes).length, 0)
  assert.match(nodes.map((n) => (n.type === "text" ? n.text : "")).join(""), /here/)
})

test("markup-looking HTML is just text", () => {
  const blocks = parseArticleBody('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
  const text = blocks.map((b) => (b.type === "paragraph" ? b.children.map((n) => (n.type === "text" ? n.text : "")).join("") : "")).join("|")
  assert.ok(text.includes("<script>"), "the angle brackets survive as characters for React to escape")
  assert.ok(blocks.every((b) => b.type === "paragraph"))
})

test("plain text, summaries and reading time", () => {
  const body = "## Heading\n\nA **bold** claim with a [link](/teams).\n\n- one\n- two"
  assert.equal(articlePlainText(body), "Heading A bold claim with a link. one. two")
  assert.equal(summarise("word ".repeat(100), 40).endsWith("…"), true)
  assert.ok(summarise("word ".repeat(100), 40).length <= 40)
  assert.equal(summarise("Short.", 40), "Short.")
  assert.equal(readingMinutes(""), 1)
  assert.equal(readingMinutes("word ".repeat(1100)), 5)
})

test("labels and public paths", () => {
  assert.equal(articleCategoryLabel("MATCH_REPORT"), "Match Report")
  assert.equal(articleCategoryLabel("WELCOME"), "Welcome")
  assert.equal(articleCategoryLabel("SOMETHING_NEW"), "News")
  assert.equal(priorityLabel("URGENT"), "Urgent")
  assert.equal(articlePath("ovalball-uat-rufc", "welcome-to-ovalball"), "/club/ovalball-uat-rufc/news/welcome-to-ovalball")
})

// ---------------------------------------------------------------------------
// Fixtures and results
// ---------------------------------------------------------------------------

test("upcoming fixtures: today onward, soonest first, kick-off order within a day, bounded", () => {
  const rows = [
    { id: "past", date: "2026-09-13", time: "10:00" },
    { id: "late", date: "2026-09-20", time: "14:30" },
    { id: "early", date: "2026-09-20", time: "10:30" },
    { id: "tbc", date: "2026-09-20", time: null },
    { id: "today", date: "2026-09-14", time: "19:00" },
    { id: "far", date: "2026-10-01", time: "11:00" },
  ]
  assert.deepEqual(
    selectUpcoming(rows, "2026-09-14", 4).map((r) => r.id),
    ["today", "early", "late", "tbc"]
  )
})

test("a result is always a word as well as a score", () => {
  assert.equal(outcomeOf(24, 12), "WON")
  assert.equal(outcomeOf(5, 31), "LOST")
  assert.equal(outcomeOf(17, 17), "DRAWN")
  assert.deepEqual(OUTCOME_WORD, { WON: "Won", LOST: "Lost", DRAWN: "Drawn" })
})

const CLUB = "club-a"
const participants = new Map<string, CompetitionParticipantRow>([
  ["p-ours", { id: "p-ours", editionId: "ed-1", clubId: CLUB, teamId: "team-u16", label: "Under 16 Boys" }],
  ["p-theirs", { id: "p-theirs", editionId: "ed-1", clubId: "club-b", teamId: "team-b", label: "Bravo RUFC Under 16 Boys" }],
  ["p-external", { id: "p-external", editionId: "ed-1", clubId: null, teamId: null, label: "Old Boys RFC" }],
])
const competitions = new Map<string, CompetitionRef>([["ed-1", { name: "County Cup", slug: "county-cup" }]])

test("a competition result is read from this club's side, whichever end it was at", () => {
  const home = competitionResultForClub(
    { id: "m1", editionId: "ed-1", homeParticipantId: "p-ours", awayParticipantId: "p-theirs", date: "2026-09-06", status: "completed", homeScore: 20, awayScore: 10 },
    CLUB,
    participants,
    competitions
  )
  const away = competitionResultForClub(
    { id: "m2", editionId: "ed-1", homeParticipantId: "p-external", awayParticipantId: "p-ours", date: "2026-09-13", status: "completed", homeScore: 20, awayScore: 10 },
    CLUB,
    participants,
    competitions
  )
  assert.equal(home?.clubScore, 20)
  assert.equal(home?.outcome, "WON")
  assert.equal(home?.venueRole, "Home")
  assert.equal(away?.clubScore, 10)
  assert.equal(away?.oppositionScore, 20)
  assert.equal(away?.outcome, "LOST")
  assert.equal(away?.venueRole, "Away")
  assert.equal(away?.opposition, "Old Boys RFC")
  assert.equal(away?.href, "/competitions/county-cup?view=results")
})

test("only finished matches this club played are results", () => {
  const base = { id: "m", editionId: "ed-1", homeParticipantId: "p-ours", awayParticipantId: "p-theirs", date: "2026-09-06", homeScore: 1, awayScore: 0 }
  for (const status of ["scheduled", "issued", "confirmed", "cancelled", "postponed", "draft"]) {
    assert.equal(competitionResultForClub({ ...base, status }, CLUB, participants, competitions), null, status)
  }
  assert.equal(competitionResultForClub({ ...base, status: "completed", homeScore: null, awayScore: null }, CLUB, participants, competitions), null)
  assert.equal(
    competitionResultForClub({ ...base, status: "completed", homeParticipantId: "p-theirs", awayParticipantId: "p-external" }, CLUB, participants, competitions),
    null,
    "a match between two other clubs is not this club's result"
  )
})

test("fixture results use the owning team's score, and one game appears once", () => {
  const competition = competitionResultForClub(
    { id: "m1", editionId: "ed-1", homeParticipantId: "p-ours", awayParticipantId: "p-theirs", date: "2026-09-06", status: "completed", homeScore: 20, awayScore: 10 },
    CLUB,
    participants,
    competitions
  )!
  const sameGame = fixtureResult({
    id: "fx-1",
    date: "2026-09-06",
    homeAway: "Home",
    opposition: "Bravo RUFC",
    teamId: "team-u16",
    teamLabel: "Under 16 Boys",
    owningScore: 20,
    opponentScore: 10,
    editionId: "ed-1",
    competition: null,
  })
  const friendly = fixtureResult({
    id: "fx-2",
    date: "2026-08-30",
    homeAway: "Away",
    opposition: "Charlie RFC",
    teamId: "team-u16",
    teamLabel: "Under 16 Boys",
    owningScore: 7,
    opponentScore: 12,
    editionId: null,
    competition: null,
  })
  assert.equal(friendly.outcome, "LOST")
  assert.equal(friendly.venueRole, "Away")
  const merged = mergeResults([competition], [sameGame, friendly], 6)
  assert.equal(merged.length, 2, "the competition match and its club fixture are one result")
  assert.equal(merged[0].href, "/fixtures/fx-1", "the viewer who can open the fixture gets Match Centre")
  assert.equal(merged[0].competition?.name, "County Cup", "and keeps the competition's name")
  assert.deepEqual(merged.map((r) => r.date), ["2026-09-06", "2026-08-30"])
  assert.equal(mergeResults([competition], [sameGame, friendly], 1).length, 1)
})

// ---------------------------------------------------------------------------
// The club desk (the club home inside the dashboard)
// ---------------------------------------------------------------------------

import { deskManageHref, distinctClubIds, splitDeskNotices } from "@/lib/club-public/desk"
import type { ClubAnnouncement } from "@/lib/club-public/announcements"

const notice = (id: string, priority: ClubAnnouncement["priority"]): ClubAnnouncement => ({
  id, title: id, body: null, priority, priorityLabel: priority, teamName: null, expiresAt: null, link: null, membersOnly: false,
})

test("desk: urgent notices are pinned above the viewer's work, and every notice appears exactly once", () => {
  const all = [notice("a", "URGENT"), notice("b", "IMPORTANT"), notice("c", "NORMAL"), notice("d", "URGENT")]
  const { pinned, rail } = splitDeskNotices(all)
  assert.deepEqual(pinned.map((n) => n.id), ["a", "d"])
  assert.deepEqual(rail.map((n) => n.id), ["b", "c"])
  assert.equal(pinned.length + rail.length, all.length)
})

test("desk: a family view lists each of its clubs once, in the order children appear", () => {
  assert.deepEqual(distinctClubIds([{ clubId: "x" }, { clubId: "y" }, { clubId: "x" }, { clubId: null }, { clubId: "" }]), ["x", "y"])
})

test("desk: Manage News goes to the club console for club authority, the team console for team authority, and nowhere otherwise", () => {
  assert.equal(deskManageHref({ club: true, team: true }, "t1"), "/club/settings/news")
  assert.equal(deskManageHref({ club: false, team: true }, "t1"), "/teams/t1/news")
  assert.equal(deskManageHref({ club: false, team: true }, null), null)
  assert.equal(deskManageHref({ club: false, team: false }, "t1"), null)
})
