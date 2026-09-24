import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { collapseFamilyEvents, eventNeedsAnswer, groupFamilyEventsByDay } from "../../../packages/contracts/src/family/events"
import { ageLabelFor, describeFamily, familyClubs } from "../../../packages/contracts/src/family/relationships"
import { permissionAgeBand } from "../../../packages/contracts/src/family/permissions"
import { PLAYER_UPCOMING_LIMIT, projectPlayerHome } from "../../../packages/contracts/src/player/home"
import { formatMinor } from "../../../packages/contracts/src/subscriptions/family-detail"
import type { AgendaItem } from "../../../packages/contracts/src/agenda/load"

/**
 * CA-M9 -- FAMILY & PLAYER OPERATIONS: the shared projections, and the promises the phone keeps.
 */
const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const F1 = "22222222-2222-2222-2222-222222222222"
const S1 = "66666666-6666-6666-6666-666666666666"
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const T = "11111111-1111-1111-1111-111111111111"
const TODAY = "2026-09-24"

const item = (over: Partial<AgendaItem> = {}): AgendaItem =>
  ({
    key: `fixture:${F1}:${A}`,
    kind: "fixture",
    eventId: F1,
    date: "2026-09-26",
    time: "10:30",
    meetTime: "09:45",
    us: { clubName: "Home", teamName: "Under 12 Boys", rugbyCode: "union", crestUrl: null, kit: null },
    them: { clubName: "Preston", teamName: "Under 12 Boys", rugbyCode: "union", crestUrl: null, kit: null },
    homeAway: "Home",
    venue: "Ground",
    pitch: null,
    status: "Booked",
    gameType: "League Fixture",
    result: null,
    playerId: A,
    childFirstName: "Ava",
    teamId: T,
    attendance: null,
    ...over,
  }) as unknown as AgendaItem

// ------------------------------------------------------------------ one event, every child

test("two children in one match collapse to one event with two associations, in date order, and answer per child", () => {
  const rows = [
    item(),
    item({ key: `fixture:${F1}:${B}`, playerId: B, childFirstName: "Ben", attendance: "ATTENDING" }),
    item({ key: `training:${S1}:${A}`, kind: "training", eventId: S1, date: "2026-09-25", them: null, gameType: null }),
  ]
  const events = collapseFamilyEvents(rows)
  assert.equal(events.length, 2)
  const match = events.find((e) => e.eventId === F1)!
  assert.equal(match.key, `fixture:${F1}`)
  assert.deepEqual(match.children.map((c) => [c.firstName, c.attendance]), [["Ava", null], ["Ben", "ATTENDING"]])
  assert.equal(eventNeedsAnswer(match, TODAY), true, "Ava still owes an answer")
  assert.equal(eventNeedsAnswer({ ...match, children: [match.children[1]] }, TODAY), false)
  assert.deepEqual(groupFamilyEventsByDay(collapseFamilyEvents([rows[2], rows[0], rows[1]])).map((d) => [d.date, d.events.length]), [["2026-09-25", 1], ["2026-09-26", 1]])
  assert.equal(collapseFamilyEvents([item({ playerId: null, childFirstName: null })])[0].children.length, 0, "a staff row is the event itself")
})

// ------------------------------------------------------------------ the family in words

test("the family is described from the session's proved relationships, one row per person, no date of birth", () => {
  const ctx = {
    firstName: "Sam",
    guardianRelationships: [
      { playerId: A, playerFirstName: "Ava", playerSurname: "Whitaker", ageState: "minor" as const, avatarStoragePath: null, teamId: T, teamDisplayName: "Under 12 Boys", clubId: "c1", clubName: "Ovalball UAT RUFC" },
      { playerId: A, playerFirstName: "Ava", playerSurname: "Whitaker", ageState: "minor" as const, avatarStoragePath: null, teamId: "t2", teamDisplayName: "Girls U12", clubId: "c2", clubName: "Preston" },
      { playerId: B, playerFirstName: "Ben", playerSurname: "Whitaker", ageState: "unknown_youth_protected" as const, avatarStoragePath: "b/x.png", teamId: "t3", teamDisplayName: "Under 8 Mixed", clubId: "c1", clubName: "Ovalball UAT RUFC" },
    ],
    linkedPlayerTeams: [{ playerId: "me", teamId: "t9", teamDisplayName: "Men's 1st Team", clubId: "c1", clubName: "Ovalball UAT RUFC", ageState: "adult" as const, avatarStoragePath: null }],
  }
  const rows = describeFamily(ctx)
  assert.deepEqual(rows.map((r) => [r.fullName, r.relationshipLabel, r.ageLabel, r.teams.length]), [
    ["Ava Whitaker", "Parent / Guardian of", "Under 18", 2],
    ["Ben Whitaker", "Parent / Guardian of", "Under 18", 1],
    ["Sam", "You", "Adult", 1],
  ])
  assert.deepEqual(familyClubs(rows).map((c) => c.clubName), ["Ovalball UAT RUFC", "Preston"], "a family may span clubs, and each is named")
  for (const row of rows) assert.ok(!("dateOfBirth" in row) && !("relationshipId" in row) && !("source" in row))
  assert.equal(ageLabelFor("unknown"), "Age not recorded", "unknown age is unknown, never adult")
  assert.equal(permissionAgeBand({ minAge: 16, maxAge: 17 }), "Ages 16 to 17")
  assert.equal(permissionAgeBand({ minAge: null, maxAge: null }), null)
})

// ------------------------------------------------------------------ a player's own week

test("Player Home answers a player's questions in order: next, then the rest of the week, then what I still owe, then last time out", () => {
  const rows = [
    item({ key: "1", eventId: "e1", date: "2026-09-20", result: { ourScore: 24, theirScore: 12 } }),
    item({ key: "2", eventId: "e2", date: "2026-09-25", attendance: "ATTENDING" }),
    item({ key: "3", eventId: "e3", date: "2026-09-27", status: "Cancelled" }),
    item({ key: "4", eventId: "e4", date: "2026-09-30" }),
    item({ key: "5", eventId: "e5", date: "2026-10-03" }),
    item({ key: "6", eventId: "e6", date: "2026-10-20" }),
    item({ key: "7", eventId: "e7", date: "2026-11-01" }),
    item({ key: "8", eventId: "e8", date: "2026-11-08" }),
  ]
  const home = projectPlayerHome(rows, TODAY)
  assert.equal(home.next?.eventId, "e2", "the next thing that is on, never a cancelled one")
  assert.equal(home.upcoming.length, PLAYER_UPCOMING_LIMIT)
  assert.deepEqual(home.upcoming.map((i) => i.eventId), ["e4", "e5", "e6", "e7"])
  assert.deepEqual(home.availability.map((r) => [r.item.eventId, r.outstanding, r.urgent]), [["e2", false, true], ["e4", true, false], ["e5", true, false]], "the fortnight, by the one rule")
  assert.equal(home.outstandingCount, 2)
  assert.equal(home.lastResult?.eventId, "e1")
  assert.equal(formatMinor(1550), "£15.50")
})

// ------------------------------------------------------------------ structural promises

test("the family screens use canonical operations and never show a date of birth, a relationship id or a bank detail", () => {
  const family = code(join(MOBILE, "app/(tabs)/family/index.tsx")) + code(join(MOBILE, "app/(tabs)/family/[playerId].tsx")) + code(join(MOBILE, "src/family/data.ts"))
  assert.doesNotMatch(family, /date_of_birth|dateOfBirth|relationship_id|source_invitation|verification_state/, "no date of birth or relationship internals")
  assert.match(family, /describeFamily\(/, "the family is described by the shared contract")
  assert.match(family, /my_guardian_link_requests/, "pending requests are the canonical read")
  assert.match(family, /setChildPermission\(supabase/, "permissions through the canonical operation")
  assert.match(family, /invitePlayerAccount\(supabase/, "the invitation is the canonical one")
  assert.match(family, /replaceChildAvatar\(supabase/, "the child's picture through set_player_avatar")
  assert.doesNotMatch(family, /add_child_for_guardian|request_child_link|request_additional_guardian|set_player_playing_pathway/, "adding, linking, another guardian and gender stay on the website")
  const perms = code("packages/contracts/src/family/permissions.ts")
  assert.match(perms, /rpc\("issue_invitation", \{ p_kind: "PLAYER_ACCOUNT"/, "one invitation architecture")
  const subs = code("packages/contracts/src/subscriptions/family-detail.ts") + code(join(MOBILE, "src/family/subscriptions.tsx"))
  assert.doesNotMatch(subs, /gc_mandate_id|gc_subscription_id|gc_payment_id|gc_billing_request_id|authorisation_url|access_token|sort_code|account_number/, "no provider identifier or bank detail")
  assert.match(subs, /Linking\.openURL\(`\$\{webUrl\}\$\{row\.webPath\}`\)/, "the Direct Debit is set up on the website, deliberately")
})

test("Home draws a family's rugby and a player's own rugby from the shared projections, never a staff control", () => {
  const home = code(join(MOBILE, "app/(tabs)/index.tsx"))
  assert.match(home, /<PlayerHome \/>/, "a player has their own Home")
  assert.match(home, /<FamilyIdentityBlock /, "whose rugby is shown is named")
  assert.match(home, /<ChildSelector /, "the child selector")
  assert.match(home, /<HomeAttention \/>/, "Needs Attention is the CA-M8 projection")
  const player = code(join(MOBILE, "src/player/home.tsx"))
  assert.match(player, /projectPlayerHome\(/, "the player's week is the shared projection")
  assert.match(player, /<HomeAttention \/>/)
  assert.match(player, /routeForAgendaItem\(/, "events open through the one route table")
  assert.doesNotMatch(player, /fixture-console|createFixture|cancelFixture|updateFixture|loadRegister|AvailabilityRegister/, "no staff control from membership")
  const selector = code(join(MOBILE, "src/family/child-selector.tsx"))
  assert.doesNotMatch(selector, /date_of_birth|dateOfBirth|\{child\.playerId\}<|\{m\.playerId\}</, "no date of birth and no raw id drawn in the selector")
  assert.match(selector, /select\(playerId\)/, "selecting a child is presentation state")
})

test("a family's lists collapse siblings onto one event and the Match Centre says when a score is provisional", () => {
  const fixtures = code(join(MOBILE, "app/(tabs)/fixtures/index.tsx"))
  assert.match(fixtures, /collapseFamilyEvents\(/)
  assert.match(fixtures, /selectedPlayerId === null/, "only when reading all children")
  const calendar = code(join(MOBILE, "app/(tabs)/calendar/index.tsx"))
  assert.match(calendar, /siblingsFor\(item, day\.items\)/)
  const mc = code(join(MOBILE, "src/fixtures/match-centre.tsx"))
  assert.match(mc, /resultQualifier\(view\.resultStatus\)/, "the canonical result_status decides the wording")
  assert.match(mc, /attendanceConfirmation\(\{/, "a fixture answer is confirmed in the same words as a training one")
  assert.match(mc, /if \(loaded\.canManageFixture\) \{[\s\S]*loadOppositionContacts/, "opposition contacts are asked for only by the fixture's manager")
  const load = code(join(MOBILE, "src/match-centre/load.ts"))
  assert.match(load, /resultStatus: f\.result_status \?\? null/)
})

test("More offers a family and a player their own destinations and no club or staff control from those contexts", () => {
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  assert.match(more, /label="Children & Family"/)
  assert.match(more, /router\.push\("\/family" as never\)/)
  assert.match(more, /label="Subscriptions & Payments"/)
  assert.match(more, /router\.push\("\/profile" as never\)/, "Profile is native")
  assert.match(more, /\{isGuardian && \(\s*<Row/, "Children & Family is a guardian's row, never a player's")
  const profile = code(join(MOBILE, "app/(tabs)/profile/index.tsx"))
  assert.match(profile, /updateMyName\(supabase|updateMyPhone\(supabase/, "profile writes go through the shared contract")
  assert.doesNotMatch(profile, /date_of_birth|dateOfBirth|club_memberships|team_permissions|role_assignments/, "no date of birth, no membership or role change from Profile")
  // CA-M11: Security is native; the email/address change stays the website's (confirmed by email).
  assert.match(profile, /router\.push\("\/security" as never\)/, "Security is native")
  assert.match(profile, /\$\{webUrl\}\/account`/, "email and postal address stay the website's")
})

test("the phone has no second family, player, attendance or payment store", () => {
  const files = [...walk(join(MOBILE, "src")), ...walk(join(MOBILE, "app"))].filter((f) => /\.tsx?$/.test(f))
  for (const f of files) {
    const src = code(f)
    assert.doesNotMatch(src, /mobile_(children|family|players|attendance|payments|subscriptions)|AsyncStorage[^\n]*(attendance|payment|guardian)/, `${f} keeps family state on the device`)
    assert.doesNotMatch(src, /from\("player_fixture_attendance"\)\s*\.\s*(insert|update|upsert|delete)/, `${f} writes attendance directly`)
    assert.doesNotMatch(src, /from\("guardians"\)\s*\.\s*(insert|update|delete)/, `${f} writes a relationship directly`)
    assert.doesNotMatch(src, /from\("(gocardless_\w+|membership_obligations|player_subscription_payers)"\)\s*\.\s*(insert|update|delete)/, `${f} writes payment state`)
  }
})
