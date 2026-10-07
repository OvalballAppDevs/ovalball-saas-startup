import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { notificationHref } from "../../../packages/contracts/src/notifications/destinations"
import { agendaIntent, routeForAgendaItem, routeForHref, routeForIntent } from "../../../apps/mobile/src/links/destinations"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"
import { STACK_ALIASES, withinStack } from "../../../apps/mobile/src/links/stack-routes"
import { redirectSystemPath } from "../../../apps/mobile/app/+native-intent"
import type { AgendaItem } from "../../../packages/contracts/src/agenda/load"

/**
 * ONE CONNECTED SYSTEM -- the navigation half (integration audit).
 *
 * A Calendar card, a Fixtures row, a notification and a link from an email must all reach the SAME canonical
 * object, and Back must return the way the person came. These pin the connections rather than any one screen:
 * a route that moves, an alias that grows its own copy, a link kind that stops being delivered or a
 * notification that opens a retired screen fails here before anybody taps it.
 */

const MOBILE = join(process.cwd(), "apps/mobile")
const routeFile = (pathname: string) => {
  // "/calendar/match/[fixtureId]" -> app/(tabs)/calendar/match/[fixtureId].tsx (or .../index.tsx)
  const base = join(MOBILE, "app/(tabs)", pathname.replace(/^\//, ""))
  return existsSync(`${base}.tsx`) ? `${base}.tsx` : join(base, "index.tsx")
}
const source = (file: string) => readFileSync(file, "utf8")

function item(kind: AgendaItem["kind"], extra: Partial<AgendaItem> = {}): AgendaItem {
  return { kind, key: `${kind}:1`, eventId: "11111111-1111-4111-8111-111111111111", date: "2026-10-17", ...extra } as AgendaItem
}

test("a Calendar match opens the one Match Centre, at its Calendar address", () => {
  const route = routeForAgendaItem(item("fixture"))!
  assert.equal(route.pathname, "/fixtures/[fixtureId]", "the canonical address of a match")
  const inCalendar = withinStack(route, "calendar")
  assert.equal(inCalendar.pathname, "/calendar/match/[fixtureId]")
  assert.deepEqual(inCalendar.params, route.params, "the alias carries exactly the canonical parameters")
})

test("a Calendar tournament opens the one Tournament Centre, and one game opens the one shared result screen", () => {
  assert.equal(routeForAgendaItem(item("tournament"))!.pathname, "/tournaments/[tournamentId]")
  assert.equal(withinStack(routeForAgendaItem(item("tournament"))!, "calendar").pathname, "/calendar/tournament/[tournamentId]")
  const game = item("tournament", { tournamentGame: { id: "22222222-2222-4222-8222-222222222222", stageLabel: "Pool A", tournamentName: "Festival" } } as Partial<AgendaItem>)
  // The game, and the tournament it belongs to -- where the result screen sends a family it cannot show the game to.
  assert.deepEqual(agendaIntent(game), { kind: "TOURNAMENT_RESULT", gameId: "22222222-2222-4222-8222-222222222222", tournamentId: item("tournament").eventId })
  assert.equal(withinStack(routeForAgendaItem(game)!, "calendar").pathname, "/calendar/tournament/result/[gameId]")
  assert.deepEqual(routeForAgendaItem(game)!.params, { gameId: "22222222-2222-4222-8222-222222222222", tournamentId: item("tournament").eventId })
})

test("a family that taps its child's tournament game lands on that tournament's Agenda, never a dead end -- and the result read is not widened", () => {
  const screen = source(join(MOBILE, "app/(tabs)/tournaments/result/[gameId].tsx"))
  // A null read with the tournament known replaces the screen with the tournament's Agenda, in the same stack.
  assert.match(screen, /if \(!loaded\) \{[\s\S]{0,600}if \(tournamentId\) \{\s*router\.replace\(withinStack\(\{ pathname: "\/tournaments\/\[tournamentId\]", params: \{ tournamentId: String\(tournamentId\), tab: "Agenda" \} \}, stack\)/)
  // ...and the Tournament Centre opens on the section a link names.
  assert.match(source(join(MOBILE, "app/(tabs)/tournaments/[tournamentId].tsx")), /PARTICIPANT_TOURNAMENT_TABS as readonly string\[\]\)\.includes\(String\(tabParam/)
  // The game's own read is still the sides' and the organiser's (tournament_results.sql 36-37 hold that).
  assert.match(screen, /readTournamentGameResult\(supabase, id\)/)
})

test("training stays in the Calendar it was opened from without needing an alias", () => {
  assert.equal(routeForAgendaItem(item("training"))!.pathname, "/calendar/training/[sessionId]")
  assert.equal(withinStack(routeForAgendaItem(item("training"))!, "calendar").pathname, "/calendar/training/[sessionId]")
})

test("Arena opens a fixture's Match Centre and a session's Training Centre inside the Admin stack, so Back returns to Arena", () => {
  const fixture = routeForIntent({ kind: "FIXTURE", fixtureId: "22222222-2222-4222-8222-222222222222" })!
  const training = routeForIntent({ kind: "TRAINING", sessionId: "33333333-3333-4333-8333-333333333333" })!
  assert.equal(withinStack(fixture, "admin").pathname, "/admin/match/[fixtureId]")
  assert.deepEqual(withinStack(fixture, "admin").params, fixture.params)
  assert.equal(withinStack(training, "admin").pathname, "/admin/training/[sessionId]")
  assert.match(source(join(MOBILE, "src/arena/navigation.ts")), /withinStack\(route as never, "admin"\)/)
})

test("a stack with no alias keeps the canonical route", () => {
  const route = routeForAgendaItem(item("fixture"))!
  assert.deepEqual(withinStack(route, "fixtures"), route)
  assert.deepEqual(withinStack(route, null), route)
})

test("every stack alias exists and is the ONE implementation re-exported -- never a copy", () => {
  const canonicalImplementation: Record<string, RegExp> = {
    "/fixtures/[fixtureId]": /import \{ MatchCentre \} from "[./]+src\/fixtures\/match-centre"\s+[\s\S]*export default MatchCentre/,
    "/fixtures/team/[teamId]": /import \{ PublicTeamPage \} from "[./]+src\/clubhouse\/public-team-page"/,
    "/fixtures/club/[directoryId]": /import ClubProfile from "[./]+clubhouse\/club\/\[directoryId\]"[\s\S]*export default ClubProfile/,
    "/tournaments/[tournamentId]": /import TournamentCentre from "[./]+tournaments\/\[tournamentId\]"[\s\S]*export default TournamentCentre/,
    "/tournaments/result/[gameId]": /import TournamentGameResultScreen from "[./]+tournaments\/result\/\[gameId\]"[\s\S]*export default TournamentGameResultScreen/,
    "/admin/tournaments/[tournamentId]": /import TournamentDetailScreen from "[./]+admin\/tournaments\/\[tournamentId\]"[\s\S]*export default TournamentDetailScreen/,
    "/calendar/training/[sessionId]": /import TrainingCentre from "[./]+calendar\/training\/\[sessionId\]"[\s\S]*export default TrainingCentre/,
  }
  for (const [stack, aliases] of Object.entries(STACK_ALIASES)) {
    for (const [canonical, alias] of Object.entries(aliases)) {
      const file = routeFile(alias)
      assert.ok(existsSync(file), `${stack}: the alias ${alias} has no route file`)
      const src = source(file)
      assert.match(src, canonicalImplementation[canonical], `${alias} is not a re-export of ${canonical}'s one implementation`)
      assert.ok(src.split("\n").length < 25, `${alias} has grown into a page of its own (${src.split("\n").length} lines)`)
    }
  }
})

test("every Event Centre address renders the one Event Centre", () => {
  for (const alias of ["/calendar/event/[eventId]", "/fixtures/event/[eventId]", "/admin/event/[eventId]", "/team/event/[eventId]"]) {
    const src = source(routeFile(alias))
    assert.match(src, /import \{ EventCentreScreen \} from "[./]+src\/events\/event-centre"/, `${alias} does not render the shared Event Centre`)
    assert.match(src, /export default EventCentreScreen/, `${alias} is not a re-export`)
  }
  // ...and each list opens it inside its own stack, so Back returns to that list.
  assert.match(source(join(MOBILE, "app/(tabs)/fixtures/index.tsx")), /pathname: "\/fixtures\/event\/\[eventId\]"/)
  assert.match(source(join(MOBILE, "app/(tabs)/admin/events.tsx")), /openPath="\/admin\/event\/\[eventId\]"/)
  assert.match(source(join(MOBILE, "app/(tabs)/team/settings/events.tsx")), /openPath="\/team\/event\/\[eventId\]"/)
  assert.match(source(join(MOBILE, "app/(tabs)/calendar/index.tsx")), /pathname: "\/calendar\/event\/\[eventId\]"/)
})

test("every event notification opens the Event Centre, on the section it is about", () => {
  const id = "33333333-3333-4333-8333-333333333333"
  const expected: Record<string, string | undefined> = {
    event_invitation: "attendance",
    event_reminder: "attendance",
    event_waitlist_promoted: "attendance",
    event_announcement: "messages",
    event_updated: undefined,
    event_postponed: undefined,
    event_cancelled: undefined,
  }
  for (const [type, tab] of Object.entries(expected)) {
    const route = routeForHref(notificationHref(type, { event_id: id }))
    assert.ok(route, `${type} has no destination`)
    assert.equal(route!.pathname, "/calendar/event/[eventId]", `${type} opens somewhere other than the Event Centre`)
    assert.equal(route!.params?.eventId, id)
    assert.equal(route!.params?.tab, tab, `${type} opens the wrong section`)
  }
})

test("a link from outside is followed once, by the app's one handler, for every kind the route table understands", () => {
  // The router stands aside for anything routable...
  for (const url of [
    "ovalball://events/33333333-3333-4333-8333-333333333333?tab=catering",
    "ovalball://fixtures/44444444-4444-4444-8444-444444444444",
    "ovalball://tournaments/55555555-5555-4555-8555-555555555555",
    "ovalball-dev://events/33333333-3333-4333-8333-333333333333",
  ]) {
    assert.ok(routeForIntent(resolveIntent(url)), `${url} is not routable`)
    assert.equal(redirectSystemPath({ path: url, initial: false }), null, `the router would ALSO open ${url} -- the double push`)
    assert.equal(redirectSystemPath({ path: url, initial: true }), null)
  }
  // ...and keeps its own path for recovery, invitations and anything nobody understands.
  for (const url of ["ovalball://join?t=abc", "ovalball://nowhere/at/all"]) {
    assert.equal(redirectSystemPath({ path: url, initial: false }), url)
  }
  const layout = source(join(MOBILE, "app/_layout.tsx"))
  assert.match(layout, /if \(routeForIntent\(intent\)\) \{/, "incoming links are not delivered through the route table")
})

test("an event link from an email resolves to the Event Centre section it names", () => {
  const route = routeForIntent(resolveIntent("ovalball://events/33333333-3333-4333-8333-333333333333?tab=catering"))
  assert.deepEqual(route, { pathname: "/calendar/event/[eventId]", params: { eventId: "33333333-3333-4333-8333-333333333333", tab: "catering" } })
})

test("the old fixture addresses are redirects into the one Match Centre, never screens of their own", () => {
  for (const legacy of ["match-centre", "result", "add-result", "edit"]) {
    const src = source(join(MOBILE, `app/(tabs)/fixtures/[fixtureId]/${legacy}.tsx`))
    assert.match(src, /<Redirect href=\{routeForIntent\(/, `/fixtures/<id>/${legacy} is no longer a redirect`)
    assert.doesNotMatch(src, /src\/fixtures\/match-centre\/(?!sections)/, `/fixtures/<id>/${legacy} renders Match Centre parts itself`)
  }
})

test("a retired screen cannot come back", () => {
  // One preferences surface (Overview + Detail); the single long screen it replaced is gone.
  assert.ok(!existsSync(join(MOBILE, "app/(tabs)/notifications/preferences.tsx")), "the retired single-screen notification preferences is back")
  // The Event Centre is the one event screen: no route renders the old calendar event card as a page.
  assert.doesNotMatch(source(join(MOBILE, "app/(tabs)/calendar/index.tsx")), /ClubEventCard/, "the retired calendar event card is back")
})

test("a fixture email names the ground the Match Centre names, for both clubs", () => {
  // The email goes to both sides but is composed as whoever acted, and a visiting coach cannot read the host's
  // venue rows. Both readers ask the server's one ground rule, in the same order, so the two never disagree.
  for (const file of ["lib/email/context/resolve-fixture-email-context.ts", "lib/app-context/match-centre-data.ts"]) {
    const src = source(join(process.cwd(), file))
    assert.match(src, /rpc\("get_match_centre_viewer"/, `${file} no longer asks the server for the ground`)
    assert.match(src, /loadScheduleGrounds\(supabase, \{ fixtureIds: \[/, `${file} no longer asks for the allocated pitch`)
    assert.match(src, /serverGround\?\.name/, `${file} no longer falls back to the server's ground`)
  }
})

test("a tournament this club attends opens the Tournament Centre; only its organiser gets the organiser's screen", () => {
  // Admin › Tournaments lists the tournaments a club runs AND the ones it is attending. The organiser's
  // screen (Edit on every card, the host's Requests and Planning) is for the host; everybody else goes to the
  // one Tournament Centre, in the Admin stack, as the Tournament Centre already sends a manager the other way.
  const list = source(join(MOBILE, "app/(tabs)/admin/tournaments/index.tsx"))
  assert.match(list, /t\.hostedByThisClub \? `\/admin\/tournaments\/\$\{t\.id\}` : `\/admin\/tournament\/\$\{t\.id\}`/)
  assert.equal(withinStack({ pathname: "/tournaments/[tournamentId]", params: { tournamentId: "t1" } }, "admin").pathname, "/admin/tournament/[tournamentId]")
  const organiser = source(join(MOBILE, "app/(tabs)/admin/tournaments/[tournamentId].tsx"))
  assert.match(organiser, /if \(c\.answered && !c\.manage\) \{\s*router\.replace\(withinStack\(\{ pathname: "\/tournaments\/\[tournamentId\]"/, "a non-organiser stays on the organiser's screen")
  // ...and the Tournament Centre hands an organiser over WITHIN the stack it was opened from, so Back returns
  // to the Calendar day rather than to whatever the Admin stack last showed.
  const centre = source(join(MOBILE, "app/(tabs)/tournaments/[tournamentId].tsx"))
  assert.match(centre, /router\.replace\(withinStack\(\{ pathname: "\/admin\/tournaments\/\[tournamentId\]"/)
  for (const [stack, alias] of [["calendar", "/calendar/tournament/manage/[tournamentId]"], ["tournaments", "/tournaments/manage/[tournamentId]"], ["admin", "/admin/tournaments/[tournamentId]"]]) {
    assert.equal(withinStack({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: "t1" } }, stack).pathname, alias, `the organiser's screen from ${stack}`)
  }
  // ...and never on silence: a capability read that failed is not "not allowed".
  assert.match(source(join(process.cwd(), "packages/contracts/src/club/tournaments.ts")), /if \(error\) return \{ view: false, manage: false, answered: false \}/)
})

test("a club job offered from More and from the Admin Centre has one name and one picture", () => {
  // CLAUDE.md: a control that IS a named destination is simply that destination's name. The Admin Centre and More
  // both offer the club's jobs; the venues screen was "Venues" in one, "Grounds & Pitches" in the other and
  // "Venues & Pitches" on its own header, and every Admin Centre row wore the same building.
  const more = source(join(MOBILE, "app/(tabs)/more.tsx"))
  const centre = source(join(MOBILE, "app/(tabs)/admin/index.tsx"))
  const contracts = source(join(process.cwd(), "packages/contracts/src/club/admin-centre.ts"))
  const sections = new Map([...contracts.matchAll(/\{ key: "([a-z-]+)", label: "([^"]+)"/g)].map((m) => [m[1], m[2]]))
  const icons = new Map([...contracts.matchAll(/\{ key: "([a-z-]+)", label: "[^"]+", caption: "[^"]+", icon: "(\w+)"/g)].map((m) => [m[1], m[2]]))
  assert.equal(icons.size, sections.size, "every section names its picture")
  for (const name of new Set(icons.values())) assert.match(centre, new RegExp(`^\\s+${name},$`, "m"), `the landing cannot draw ${name}`)
  // Two rows still differ on purpose and are recorded for a product decision rather than guessed at: More splits
  // reading the news (News & Announcements) from writing it (Publish), and offers an officer's own safeguarding
  // work under the shorter "Safeguarding".
  const RECORDED = new Set(["news", "safeguarding"])
  let compared = 0
  for (const m of more.matchAll(/<Row icon=\{<(\w+) [^>]*\/>\} label="([^"]+)"[^\n]*?router\.push\("\/admin\/([a-z-]+)"/g)) {
    const [, icon, label, key] = m
    if (!sections.has(key) || RECORDED.has(key)) continue
    compared++
    assert.equal(label, sections.get(key), `More calls /admin/${key} "${label}"; the Admin Centre calls it "${sections.get(key)}"`)
    assert.equal(icons.get(key), icon, `More draws /admin/${key} with ${icon}; the Admin Centre with ${icons.get(key)}`)
  }
  assert.ok(compared >= 6, `only ${compared} shared destinations compared -- the pattern no longer reads More's rows`)
  // Each destination's own header says the same name.
  assert.match(source(join(MOBILE, "app/(tabs)/admin/venues/index.tsx")), new RegExp(`AdminScreen section="${sections.get("venues")}"`))
})

test("a venue, pitch or changing-room form shows every field's name, not only the screen reader", () => {
  // `TextField` names itself for VoiceOver only; `Field` is the visible label ("A LABEL IS ALWAYS VISIBLE",
  // components/form.tsx). These forms used TextField alone, so a filled-in venue read as five unnamed boxes.
  for (const file of [
    "app/(tabs)/admin/venues/new/index.tsx",
    "app/(tabs)/admin/venues/[venueId]/edit.tsx",
    "app/(tabs)/admin/venues/[venueId]/pitches/[pitchId].tsx",
    "app/(tabs)/admin/venues/[venueId]/changing-rooms/[roomId].tsx",
    "src/venue/pitch-editor-sheet.tsx",
    "src/venue/changing-room-editor-sheet.tsx",
  ]) {
    const src = source(join(MOBILE, file))
    const fields = [...src.matchAll(/<TextField label="([^"]+)"/g)].map((m) => m[1])
    assert.ok(fields.length > 0, `${file} has no fields to check`)
    for (const label of fields) {
      assert.match(src, new RegExp(`<Field label="${label.replace(/[()]/g, "\\$&")}">\\s*<TextField label="${label.replace(/[()]/g, "\\$&")}"`), `${file}: "${label}" has no visible label`)
    }
    assert.doesNotMatch(src, /\((M)\)/, `${file}: a metre is "m"`)
  }
})

test("who a conversation is between comes from the server, in the app's one role vocabulary", () => {
  // The People list and every message's role were read from both clubs' membership rows -- rows a person may
  // read only at their own club -- so a coach saw herself alone and the other side was "Member" of "Ovalball".
  const parties = source(join(process.cwd(), "packages/contracts/src/conversation-parties.ts"))
  const identities = source(join(process.cwd(), "packages/contracts/src/resolve-identities.ts"))
  assert.match(parties, /rpc\(\s*"conversation_people"/, "the People list asks the server")
  // (The legacy team-role view is Slice 10's to count: verify-slice10-retirement fails if any code reads it again.)
  assert.doesNotMatch(parties, /\.from\("(club_memberships|role_assignments)"\)/, "the People list reads membership or role rows it cannot see")
  assert.match(identities, /rpc\(\s*"conversation_people"/, "a message's role is the server's answer where there is a conversation")
  for (const [file, src] of [["conversation-parties.ts", parties], ["resolve-identities.ts", identities]] as const) {
    assert.doesNotMatch(src, /const [A-Z_]*ROLE[A-Z_]*LABEL\b|const TEAM_[A-Z_]*LABEL\b/, `${file} keeps a role vocabulary of its own ("Fixtures Admin", "Parent/Player")`)
    assert.match(src, /from "\.\/role-labels"/, `${file} does not use the one role vocabulary`)
  }
  for (const file of ["packages/contracts/src/messenger-thread.ts", "app/(app)/messages/[kind]/[id]/page.tsx"]) {
    assert.match(source(join(process.cwd(), file)), /resolveParticipantIdentities\([\s\S]*?\{ (fixtureRequestId|conversationId)[\s\S]*?\)/, `${file} does not tell the resolver which conversation`)
  }
  // Remove is offered only where the server allows it: your own club's side ("You can only manage
  // participants from your own club's side of this fixture").
  assert.match(source(join(MOBILE, "app/(tabs)/messages/participants.tsx")), /view\.canManage && view\.removableIds\.includes\(person\.userId\)/)
})

test("signing out leaves nothing of the last person, and a link opened while signed out survives signing in", () => {
  const layout = source(join(MOBILE, "app/_layout.tsx"))
  // The whole navigation tree is reset, not one route replaced: every tab kept its stack, so the next person
  // to sign in on the phone could step Back into the screens the last one had open.
  assert.match(layout, /status === "signed-out" && !onEntrance\) \{\s*if \(navigation\.isReady\(\)\) navigation\.reset\(\{ index: 0, routes: \[\{ name: "welcome" \}\] \}\)/)
  // A held link is delivered once the person is INSIDE the app: delivered on "signed-in" alone it was pushed
  // from the sign-in route in the same moment the gate replaced that route, and was lost.
  assert.match(layout, /if \(status !== "signed-in" \|\| !inApp \|\| !pending\.current\) return/)
})

test("an event is answered with the one answer control, and the same moment plays once the server accepts it", async () => {
  // The Event Centre drew its own three pills -- 44pt, no icons, every answer the same forest fill -- beside the
  // 72pt tiles Match Centre, the Calendar, the Agenda and the Training Centre share, and played no Attendance
  // Moment. It now draws the one control and plays the one moment.
  const attendance = source(join(MOBILE, "src/events/attendance.tsx"))
  assert.match(attendance, /<AvailabilityChoice\b/, "the Event Centre does not use the one answer control")
  assert.doesNotMatch(attendance, /accessibilityRole="radio"/, "the Event Centre draws answer buttons of its own again")
  assert.match(attendance, /<AttendanceMoment\b/, "the Event Centre plays no Attendance Moment")
  // Only after the server accepted the answer, only when the answer changed, and never for a waiting-list place.
  assert.match(attendance, /const result = await respondToEvent\([\s\S]*?if \(status !== \(r\?\.status \?\? null\) && !result\.waitlisted\) \{\s*setMoment\(/)
  const { attendanceMomentCopy } = await import("../../../packages/contracts/src/match-centre/attendance")
  assert.deepEqual(attendanceMomentCopy({ status: "ATTENDING", firstName: "Ava", opponent: null, occasion: { name: "Christmas Party", date: "2026-12-12" } }), {
    title: "Ava is attending!",
    body: "Christmas Party on Saturday 12 December.",
  })
  assert.equal(attendanceMomentCopy({ status: "CANNOT_ATTEND", firstName: null, opponent: null, occasion: { name: "Bonfire Night", date: "2026-11-05" } }).title, "You can't make it")
  // A match keeps the owner's words exactly.
  assert.equal(attendanceMomentCopy({ status: "ATTENDING", firstName: "Ava", opponent: "Preston Grasshoppers RFC" }).body, "Ava is attending against Preston Grasshoppers RFC.")
})
