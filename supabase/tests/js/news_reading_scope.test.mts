import { test } from "node:test"
import assert from "node:assert/strict"

import { mergeFeed, readingScopeFor, type AnnouncementCard, type ArticleCard } from "../../../packages/contracts/src/club/content"
import type { SwitchableContext } from "../../../packages/contracts/src/active-context-rules"
import type { SessionContext } from "../../../packages/contracts/src/session-context"

/**
 * WHERE A READER ASKS, AND HOW THE ANSWERS ARE JOINED (CA-M5).
 *
 * The client decides which clubs to ask; the server decides, row by row, what may be seen -- that half is
 * proved in supabase/tests/club_news_announcements_ca5.sql (drafts, windows, sibling teams, other clubs,
 * opposition, the anonymous public). This file pins the client half: the scope each context kind
 * resolves to, and that joining several clubs' answers never duplicates a publication or invents order.
 */
const ctx = (guardians: { playerId: string; teamId: string; clubId: string; clubName: string }[], own: { teamId: string; clubId: string; clubName: string }[] = []) =>
  ({ guardianRelationships: guardians.map((g) => ({ ...g, playerFirstName: "C", playerSurname: "X", ageState: "youth", avatarStoragePath: null, teamDisplayName: "T" })), linkedPlayerTeams: own.map((t) => ({ ...t, playerId: "p", teamDisplayName: "T", playerFirstName: "", playerSurname: "", avatarStoragePath: null, ageState: "youth" })) }) as unknown as SessionContext
const active = (kind: SwitchableContext["kind"], extra: Partial<SwitchableContext> = {}) => ({ key: "k", kind, id: "id", label: "L", clubId: null, ...extra }) as SwitchableContext

test("each context kind asks its own clubs: club, team, parent and player narrow to their club; a family asks every club its children play at", () => {
  assert.deepEqual(readingScopeFor(active("club", { clubId: "A", subjectClubName: "Alpha" }), null), { kind: "club", clubs: [{ id: "A", name: "Alpha" }], teamId: null })
  assert.deepEqual(readingScopeFor(active("team", { id: "T1", clubId: "A", subjectClubName: "Alpha" }), null), { kind: "team", clubs: [{ id: "A", name: "Alpha" }], teamId: "T1" })
  assert.deepEqual(readingScopeFor(active("parent", { id: "T1", clubId: "A", subjectClubName: "Alpha" }), null), { kind: "parent", clubs: [{ id: "A", name: "Alpha" }], teamId: "T1" })
  assert.deepEqual(readingScopeFor(active("player", { id: "T2", clubId: "A", subjectClubName: "Alpha" }), null), { kind: "player", clubs: [{ id: "A", name: "Alpha" }], teamId: "T2" })
  // one child, one club
  assert.deepEqual(readingScopeFor(active("family"), ctx([{ playerId: "c1", teamId: "T1", clubId: "A", clubName: "Alpha" }])), { kind: "family", clubs: [{ id: "A", name: "Alpha" }], teamId: null })
  // two children, same club -> the club is asked once
  assert.deepEqual(readingScopeFor(active("family"), ctx([{ playerId: "c1", teamId: "T1", clubId: "A", clubName: "Alpha" }, { playerId: "c2", teamId: "T2", clubId: "A", clubName: "Alpha" }])).clubs, [{ id: "A", name: "Alpha" }])
  // two children, different clubs -> both are asked, in relationship order
  assert.deepEqual(readingScopeFor(active("family"), ctx([{ playerId: "c1", teamId: "T1", clubId: "A", clubName: "Alpha" }, { playerId: "c2", teamId: "T9", clubId: "B", clubName: "Bravo" }])).clubs, [{ id: "A", name: "Alpha" }, { id: "B", name: "Bravo" }])
  // the person's own player record counts as a family relationship too
  assert.deepEqual(readingScopeFor(active("family"), ctx([], [{ teamId: "T5", clubId: "C", clubName: "Charlie" }])).clubs, [{ id: "C", name: "Charlie" }])
  // an unrelated club is never asked: only relationships name clubs
  assert.ok(!readingScopeFor(active("family"), ctx([{ playerId: "c1", teamId: "T1", clubId: "A", clubName: "Alpha" }])).clubs.some((c) => c.id === "Z"))
})

test("site admin, governing and no context ask nothing: there is no all-content feed to invent", () => {
  assert.deepEqual(readingScopeFor(active("site_admin"), null).clubs, [])
  assert.deepEqual(readingScopeFor(active("governing"), null).clubs, [])
  assert.deepEqual(readingScopeFor(null, null), { kind: "none", clubs: [], teamId: null })
})

const ann = (id: string, priority: AnnouncementCard["priority"], startsAt: string, clubName = "Alpha"): AnnouncementCard =>
  ({ id, clubId: "A", clubName, clubSlug: null, clubCrestPath: null, title: id, body: null, priority, priorityLabel: priority, teamId: null, teamName: null, startsAt, expiresAt: null, publishedAt: startsAt, link: null, membersOnly: false })
const art = (id: string, publishedAt = "2026-09-22", featured = false): ArticleCard =>
  ({ id, slug: id, clubId: "A", clubName: "Alpha", clubSlug: null, clubCrestPath: null, title: id, excerpt: "", category: "NEWS", categoryLabel: "News", publishedAt, updatedAt: publishedAt, byline: "Alpha", teamId: null, teamName: null, heroUrl: null, heroAlt: null, membersOnly: false, featured, isSystem: false, readingMinutes: 1 })

test("joining several clubs' answers deduplicates by publication id and keeps the domain's own order", () => {
  const shared = ann("club-wide", "NORMAL", "2026-09-20T10:00:00Z")
  const feed = mergeFeed(
    [
      { announcements: { items: [shared, ann("urgent-old", "URGENT", "2026-09-01T10:00:00Z")], more: true }, news: { items: [art("new", "2026-09-22"), art("lead", "2026-09-10", true)], more: false } },
      { announcements: { items: [shared, ann("bravo", "NORMAL", "2026-09-21T10:00:00Z", "Bravo")], more: false }, news: { items: [art("new")], more: false } },
    ],
    false
  )
  assert.deepEqual(feed.announcements.map((a) => a.id), ["urgent-old", "bravo", "club-wide"], "priority first, then newest; the shared notice appears once")
  assert.deepEqual(feed.news.map((n) => n.id), ["lead", "new"], "the lead story leads; the story both clubs returned appears once")
  assert.equal(feed.moreAnnouncements, false, "paging is only offered when one club is read")
  assert.equal(mergeFeed([{ announcements: { items: [], more: true }, news: { items: [], more: false } }], true).moreAnnouncements, true)
})
