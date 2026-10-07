import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { CANONICAL_ROLE_LABEL, COMMON_TEAM_ROLES, CUSTOM_ROLE_BASE, ROLE_CATALOGUE, TEAM_ROLE_OPTIONS, roleDisplayLabel, teamTitleLabel } from "../../../packages/contracts/src/role-labels"
import { PEOPLE_FILTERS, MEMBERSHIP_STATE_LABEL, invitationSummary, personSummary, type ClubPerson } from "../../../packages/contracts/src/club/people"
import { emailShareUrl, shareMessage, smsShareUrl, whatsappShareUrl } from "../../../packages/contracts/src/invitations/share"

/**
 * ONE WAY TO BRING PEOPLE IN (People & Invitations, 2026-10-05) -- the structural rules that keep the estate one
 * system. The server's own behaviour is `supabase/tests/people_one_way_in.sql`; this file pins what the clients
 * may and may not do, so a future screen cannot quietly grow a second invitation path, a second role list, a
 * second share mechanism or a second referral store.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..")
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const MOBILE = path.join(ROOT, "apps/mobile")
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function rows(sql: string): string[][] {
  const out = execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "\t", "-c", sql], { encoding: "utf8" })
  return out.split("\n").filter(Boolean).map((l) => l.split("\t"))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}
const CLIENT_FILES = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "components")), ...walk(path.join(MOBILE, "app")), ...walk(path.join(MOBILE, "src")), ...walk(path.join(ROOT, "packages/contracts/src"))]

// ---------------------------------------------------------------------------------------------------- the catalogue

test("the TypeScript role catalogue is the database's: every key, and every label verbatim", () => {
  const db = new Map(rows("select role_key, label from public.role_definitions").map(([k, l]) => [k, l]))
  assert.deepEqual([...Object.keys(CANONICAL_ROLE_LABEL)].sort(), [...db.keys()].sort(), "one list of roles, on both sides")
  for (const [key, label] of db) assert.equal(CANONICAL_ROLE_LABEL[key as keyof typeof CANONICAL_ROLE_LABEL], label, `${key} is called the same thing everywhere`)
  assert.deepEqual(ROLE_CATALOGUE.map((r) => r.key).sort(), [...db.keys()].sort(), "every role is described once")
})

test("access and roles are told apart: three levels of club access, team roles that give access to one team", () => {
  assert.deepEqual(ROLE_CATALOGUE.filter((r) => r.kind === "CLUB_ACCESS").map((r) => r.key), ["CLUB_ADMIN", "FIXTURES_SECRETARY", "MEMBER"])
  assert.deepEqual(ROLE_CATALOGUE.filter((r) => r.kind === "TEAM_ROLE").map((r) => r.key), ["COACH", "TEAM_MANAGER", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD"])
  assert.equal(ROLE_CATALOGUE.find((r) => r.key === "SAFEGUARDING_OFFICER")?.kind, "APPOINTED", "the Safeguarding Officer is appointed, never given here")
  for (const r of ROLE_CATALOGUE) assert.ok(r.description.length > 0 && !/[A-Z]{3,}_/.test(r.description), `${r.key} is described in words`)
})

test("a custom role is a title on a Volunteer: it describes and carries Volunteer's access, never more", () => {
  assert.equal(CUSTOM_ROLE_BASE, "VOLUNTEER")
  const [[bundle]] = rows("select bundle_key from public.role_definitions where role_key = 'VOLUNTEER'")
  assert.equal(bundle, "VO")
  const [[extra]] = rows("select count(*) from public.bundle_capabilities v where v.bundle_key = 'VO' and not exists (select 1 from public.bundle_capabilities m where m.bundle_key = 'MB' and m.capability_key = v.capability_key and m.scope_type = v.scope_type)")
  assert.equal(Number(extra), 1, "Volunteer adds exactly one view (pitch allocations) over plain membership")
  assert.ok(COMMON_TEAM_ROLES.filter((r) => r.title && r.roleKey !== "COACH").every((r) => r.roleKey === "VOLUNTEER"), "Physio and Kit Manager are Volunteers with a title")
  assert.equal(roleDisplayLabel("VOLUNTEER", "Kit Manager"), "Kit Manager")
  assert.equal(roleDisplayLabel("COACH", "HEAD_COACH"), "Head Coach")
  assert.equal(teamTitleLabel("ASSISTANT_COACH"), "Assistant Coach")
  assert.deepEqual(TEAM_ROLE_OPTIONS.map((o) => o.value), ["COACH", "TEAM_MANAGER", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD", "VOLUNTEER", "TEAM_ADMINISTRATION"])
})

test("no People, team or staff surface keeps its own role list", () => {
  const surfaces = CLIENT_FILES.filter((f) => /apps\/mobile\/src\/(people|team)\/|apps\/mobile\/app\/\(tabs\)\/(admin\/people|team)\/|app\/\(app\)\/(people|teams)\//.test(f))
  assert.ok(surfaces.length > 10)
  for (const f of surfaces) {
    const src = readFileSync(f, "utf8")
    assert.doesNotMatch(src, /GRANTABLE_ROLES|const ROLE_LABEL\b|TEAM_STAFF_PERMISSION_OPTIONS/, `${path.relative(ROOT, f)} keeps a role list of its own`)
  }
})

// ---------------------------------------------------------------------------------------------------- one engine

test("every client door that invites somebody new to be staff issues the one CLUB_STAFF invitation through the contract", () => {
  const issuers = CLIENT_FILES.filter((f) => /p_kind:\s*"CLUB_STAFF"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).sort()
  assert.deepEqual(issuers, ["app/(app)/people/actions.ts", "packages/contracts/src/club/invitations.ts"], "the website's server action and the shared contract are the only two issuers")
  const flow = code("apps/mobile/src/people/invite-flow.tsx")
  assert.match(flow, /inviteClubStaff\(supabase/)
  for (const route of ["apps/mobile/app/(tabs)/admin/people/invite.tsx", "apps/mobile/app/(tabs)/team/invite.tsx"]) assert.match(code(route), /<InviteFlow /, `${route} is the same flow`)
})

test("a player's link is the team's own joining kind, from one contract function", () => {
  const callers = CLIENT_FILES.filter((f) => /p_kind:\s*"TEAM_JOIN_CODE"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).sort()
  assert.deepEqual(callers, ["app/(app)/teams/[teamId]/join-code-actions.ts", "packages/contracts/src/team/requests.ts"])
  assert.match(code("apps/mobile/src/people/add-players.tsx"), /issueTeamJoinCode\(supabase, teamId/)
})

test("no client writes a membership or a role directly, and none reaches for the seat switch", () => {
  for (const f of CLIENT_FILES) {
    const src = code(path.relative(ROOT, f))
    assert.doesNotMatch(src, /from\("(club_memberships|role_assignments|access_invitations)"\)\s*\.(insert|update|upsert|delete)/, `${path.relative(ROOT, f)} writes a membership, role or invitation table`)
    assert.doesNotMatch(src, /rpc\("(set_team_access|remove_team_access)"/, `${path.relative(ROOT, f)} uses the seat switch that replaced a person's other team roles`)
  }
})

test("the People register's filters keep access, roles and lifecycle apart", () => {
  assert.deepEqual(PEOPLE_FILTERS.map((f) => f.label), ["All", "Players", "Staff", "Admins", "Pending"])
  assert.equal(MEMBERSHIP_STATE_LABEL.SUSPENDED, "Deactivated")
  const base: ClubPerson = { kind: "member", membershipId: "m", userId: "u", playerId: null, firstName: "Priya", surname: "Nair", email: null, avatarStoragePath: null, role: "BASIC_USER", access: "MEMBER", state: "ACTIVE", suspendedLevel: null, since: null, clubTitle: null, teamRoles: [], additionalRoles: [], playerTeams: [], invitationId: null, invitationKind: null, invitationEmail: null, invitationRole: null, invitationName: null, invitationOffer: null, invitedByName: null, invitationSentAt: null, invitationExpiresAt: null, isSelf: false }
  assert.equal(personSummary({ ...base, teamRoles: [{ id: "a", teamId: "t", teamDisplayName: "Women's 1st Team", roleKey: "COACH", label: "Coach", title: "ASSISTANT_COACH", state: "ACTIVE", permission: "coach" }] }), "Assistant Coach · Women's 1st Team", "what they do comes first")
  assert.equal(personSummary({ ...base, access: "CLUB_ADMIN" }), "Club Admin")
  assert.equal(invitationSummary({ invitationKind: "CLUB_STAFF", invitationRole: null, invitationOffer: { clubRoles: ["MEMBER"], teams: [{ id: "t", teamDisplayName: "Under 12 Boys", roles: ["FIRST_AIDER"], titles: { FIRST_AIDER: "Physio" } }], audience: null } }), "Physio · Under 12 Boys")
})

// ---------------------------------------------------------------------------------------------------- one share layer

test("WhatsApp, Messages, Email, Copy and the QR all carry the one link, in one message", () => {
  const url = "https://ovalball.co.uk/join?t=abc"
  const message = shareMessage({ kind: "INVITATION", clubName: "Ovalball UAT RUFC", roleLine: "Coach", placeName: "Women's 1st Team" }, url)
  assert.equal(message, "Ovalball UAT RUFC has invited you to join Women's 1st Team on Ovalball as Coach. Use this link to accept your invitation: https://ovalball.co.uk/join?t=abc")
  assert.equal(decodeURIComponent(whatsappShareUrl(message).split("text=")[1]), message)
  assert.ok(decodeURIComponent(smsShareUrl(message)).includes(url))
  assert.ok(decodeURIComponent(emailShareUrl(message, "Your invitation", "a@b.test")).includes(url))
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(message), "no internal id in a message")
  const view = code("apps/mobile/src/sharing/share-view.tsx")
  assert.match(view, /<QrCode value=\{share\.url\}/), assert.match(view, /<ShareActions url=\{share\.url\}/)
  const poster = code("apps/mobile/src/sharing/poster.tsx")
  assert.match(poster, /qrModules\(share\.url\)/, "the poster's QR is the same link")
  // ONE ENCODER, ONE SHARE LAYER: nothing else draws a QR or builds a WhatsApp link.
  for (const f of CLIENT_FILES.filter((f) => f.startsWith(MOBILE))) {
    const src = readFileSync(f, "utf8")
    if (!f.endsWith(path.join("sharing", "qr.tsx"))) assert.doesNotMatch(src, /qrcode\/lib\/core/, `${path.relative(ROOT, f)} has its own QR encoder`)
    if (!f.endsWith(path.join("sharing", "share-actions.tsx"))) assert.doesNotMatch(src, /wa\.me|whatsapp:\/\//, `${path.relative(ROOT, f)} builds its own WhatsApp link`)
  }
})

// ---------------------------------------------------------------------------------------------------- referrals

test("referrals stay on the existing referral system and never invent a figure", () => {
  const flow = code("apps/mobile/src/clubhouse/refer-flow.tsx")
  assert.match(flow, /inviteClubToOvalball\(supabase, webUrl, clubId, target\.directoryId/, "one way to create a referral: create_partner_invitation")
  const creators = CLIENT_FILES.filter((f) => /rpc\("create_partner_invitation"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)).sort()
  // The website's server action (which also sends the email) and the shared contract the phone uses: two thin
  // callers of the one referral RPC -- one backend, one record per club referred.
  assert.deepEqual(creators, ["app/(app)/clubhouse/actions.ts", "packages/contracts/src/clubhouse/actions.ts"])
  const hub = code("apps/mobile/app/(tabs)/clubhouse/refer.tsx")
  assert.match(hub, /readClubReferrals\(supabase, clubId\)/, "counts come from the club's own referral records")
  assert.doesNotMatch(hub, /click|scan|opened|views|creditPence|club_credit_balance/i, "no clicks, scans, opens or a net balance presented as earned")
  assert.match(hub, /REFERRAL_OFFER_SUMMARY/, "the offer is the existing terms' own words")
  const directory = code("apps/mobile/app/(tabs)/clubhouse/club/[directoryId].tsx")
  assert.doesNotMatch(directory, /inviteClubToOvalball|Invitation sent/, "a club's page uses the one referral flow and never claims an email was sent")
  assert.ok(existsSync(path.join(MOBILE, "app/(tabs)/clubhouse/refer-club.tsx")))
})
