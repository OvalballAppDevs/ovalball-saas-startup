import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { resolveIdentityDisplay } from "@/lib/app-context/identity-display"
import { listSwitchableContexts, resolveActiveContext } from "@/lib/app-context/active-context-rules"
import type { SessionContext } from "@/lib/app-context/session-context"

/**
 * UX-2 IDENTITY AND CONTEXT.
 *
 * One human, several legitimate perspectives. UX-0 found the shell blurring that in two ways: in a club
 * context the one line that answers "who am I?" answered "which club?", and the control for changing
 * perspective was an unexplained chevron that only existed once you already had somewhere to go.
 *
 * These assertions hold the model, not the markup: the block names a person, the list of contexts comes
 * from real relationships, and a context nobody holds cannot be selected by asking for it.
 */

const read = (p: string) => readFileSync(p, "utf8")

/** A session context built from relationships, the way the real one is. */
function session(over: Partial<SessionContext> = {}): SessionContext {
  return {
    firstName: "Morgan",
    isSiteAdmin: false,
    clubMemberships: [],
    teamPermissions: [],
    guardianRelationships: [],
    linkedPlayerTeams: [],
    ...over,
  } as unknown as SessionContext
}

const club = (id: string, name: string, role = "CLUB_ADMIN") => ({
  clubId: id, clubName: name, role, clubLogoUrl: null, clubSlug: `slug-${id}`,
}) as unknown as SessionContext["clubMemberships"][number]
const child = (playerId: string, first: string, teamId: string) => ({
  playerId, playerFirstName: first, playerSurname: "Everly", teamId,
  teamDisplayName: "Under 10 Mixed", clubId: "c-1", clubName: "UX2 Multi RUFC", avatarStoragePath: null,
  ageState: "ADULT",
}) as unknown as SessionContext["guardianRelationships"][number]

// ---------------------------------------------------------------- identity

test("1. a single-context person is named, not their scope", () => {
  const identity = resolveIdentityDisplay("club", {
    contextLabel: "Burnley RUFC",
    roleLabel: "Club Admin",
    personName: "Morgan Everly",
    subjectName: null,
  })
  assert.equal(identity.nameLabel, "Morgan Everly")
  assert.match(identity.subLabel, /Burnley RUFC/)
  assert.match(identity.subLabel, /Club Admin/)
})

test("1b. every context kind names a person in the identity block", () => {
  const kinds = ["club", "team", "player", "family", "site_admin"] as const
  for (const kind of kinds) {
    const identity = resolveIdentityDisplay(kind, {
      contextLabel: "Burnley RUFC",
      roleLabel: "Club Admin",
      personName: "Morgan Everly",
      subjectName: null,
    })
    assert.equal(identity.nameLabel, "Morgan Everly", `${kind} does not name the signed-in person`)
  }
})

test("6. a guardian's child context names the CHILD, and never borrows the adult's face", () => {
  const identity = resolveIdentityDisplay("parent", {
    contextLabel: "Under 10 Mixed",
    roleLabel: "Parent/Guardian",
    personName: "Morgan Everly",
    subjectName: "Rory Everly",
  })
  assert.equal(identity.nameLabel, "Rory Everly")
  assert.equal(identity.avatarUsesPersonPhoto, false)
})

test("7. a player context is the signed-in person, so it is their own name and photo", () => {
  const identity = resolveIdentityDisplay("player", {
    contextLabel: "Men's 1st Team", roleLabel: "Player", personName: "Morgan Everly", subjectName: null,
  })
  assert.equal(identity.nameLabel, "Morgan Everly")
  assert.equal(identity.avatarUsesPersonPhoto, true)
  assert.match(identity.subLabel, /Men's 1st Team/)
})

test("8. a team context keeps the person first and the team beside the role", () => {
  const identity = resolveIdentityDisplay("team", {
    contextLabel: "Under 14 Boys", roleLabel: "Coach", personName: "Morgan Everly", subjectName: null,
  })
  assert.equal(identity.nameLabel, "Morgan Everly")
  assert.match(identity.subLabel, /Under 14 Boys/)
})

test("9. a missing display name falls back safely, and never to an email address", () => {
  const identity = resolveIdentityDisplay("club", {
    contextLabel: "Burnley RUFC", roleLabel: "Club Admin", personName: "", subjectName: null,
  })
  assert.ok(identity.nameLabel.length > 0, "the block rendered nothing at all")
  assert.ok(!identity.nameLabel.includes("@"), "an email address was used as a display name")
  assert.equal(identity.nameLabel, "Ovalball User")
})

// ---------------------------------------------------------------- contexts

test("2. one identity can hold several legitimate contexts at once", () => {
  const ctx = session({
    isSiteAdmin: true,
    clubMemberships: [club("c-1", "UX2 Multi RUFC")],
    teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 14 Boys", permission: "coach", clubId: "c-1", clubName: "UX2 Multi RUFC" } as unknown as SessionContext["teamPermissions"][number]],
    guardianRelationships: [child("p-1", "Rory", "t-3"), child("p-2", "Nell", "t-3")],
    linkedPlayerTeams: [{ teamId: "t-2", teamDisplayName: "Men's 1st Team", playerId: "p-0", clubId: "c-1", clubName: "UX2 Multi RUFC", avatarStoragePath: null, ageState: "ADULT" } as unknown as SessionContext["linkedPlayerTeams"][number]],
  })
  const kinds = new Set(listSwitchableContexts(ctx).map((c) => c.kind))
  for (const expected of ["site_admin", "club", "team", "player", "parent", "family"]) {
    assert.ok(kinds.has(expected as never), `the worked example lost its "${expected}" context`)
  }
})

test("3. switching selects a different context and leaves the identity alone", () => {
  const ctx = session({
    isSiteAdmin: true,
    clubMemberships: [club("c-1", "UX2 Multi RUFC")],
  })
  const contexts = listSwitchableContexts(ctx)
  const asClub = resolveActiveContext(ctx, "club:c-1")
  const asSite = resolveActiveContext(ctx, "site_admin")
  assert.notEqual(asClub.key, asSite.key)
  // The person is not part of a context at all -- which is the whole point. Switching cannot change who
  // is signed in, because the signed-in identity is not something a context carries.
  assert.ok(
    contexts.every((c) => !("userId" in c) && !("user" in c)),
    "a context carries an identity, so switching could change one",
  )
})

test("4. a context the identity does not hold cannot be selected", () => {
  const ctx = session({ clubMemberships: [club("c-1", "UX2 Multi RUFC")] })
  const forged = resolveActiveContext(ctx, "club:00000000-0000-4000-8000-00000000dead")
  assert.notEqual(forged.key, "club:00000000-0000-4000-8000-00000000dead")
  assert.ok(
    listSwitchableContexts(ctx).some((c) => c.key === forged.key),
    "a forged cookie resolved to something outside the session's own contexts",
  )
})

test("4b. a forged Site Admin context does not make a session a Site Admin", () => {
  const ctx = session({ clubMemberships: [club("c-1", "UX2 Multi RUFC")] })
  const forged = resolveActiveContext(ctx, "site_admin")
  assert.notEqual(forged.kind, "site_admin")
})

test("5. Site Admin and club authority coexist, and selecting one does not disturb the other", () => {
  const ctx = session({ isSiteAdmin: true, clubMemberships: [club("c-1", "UX2 Multi RUFC")] })
  const before = JSON.stringify(ctx)
  const asSite = resolveActiveContext(ctx, "site_admin")
  const asClub = resolveActiveContext(ctx, "club:c-1")
  assert.equal(asSite.kind, "site_admin")
  assert.equal(asClub.kind, "club")
  // Site Admin is platform authority and is not scoped to a club; a club context must not inherit it.
  assert.equal(asSite.clubId, null)
  assert.equal(asClub.clubId, "c-1")
  assert.equal(JSON.stringify(ctx), before, "resolving a context mutated the session")
})

test("5b. a plain member is not offered a club context to operate as", () => {
  const ctx = session({ clubMemberships: [club("c-1", "UX2 Multi RUFC", "BASIC_USER")] })
  assert.equal(listSwitchableContexts(ctx).length, 0)
})

// ---------------------------------------------------------------- the controls

test("10. the context control is reachable on a phone without opening the drawer", () => {
  const mobile = read("app/(app)/app-mobile-nav.tsx")
  assert.match(mobile, /MobileContextBar/, "the mobile shell has no context control of its own")
  // It must be a sibling of the top bar, not something inside the Sheet -- the defect UX-0 recorded was
  // precisely that changing context required opening the drawer first.
  const sheetStart = mobile.indexOf("<Sheet ")
  const sheetEnd = mobile.lastIndexOf("</Sheet>")
  const barAt = mobile.indexOf("<MobileContextBar")
  assert.ok(barAt > 0 && (barAt < sheetStart || barAt > sheetEnd), "the context bar is inside the drawer")
})

test("10b. both context controls announce what they do and what they are set to", () => {
  for (const file of ["app/(app)/context-switcher.tsx", "app/(app)/app-mobile-nav.tsx"]) {
    const src = read(file)
    assert.match(
      src,
      /aria-label=\{`Switch context\. Currently \$\{subLabel\}`\}/,
      `${file} leaves the control without an explicit accessible name`,
    )
  }
})

test("10c. a single-context person gets no menu, but is still told which context they are in", () => {
  for (const file of ["app/(app)/context-switcher.tsx", "app/(app)/app-mobile-nav.tsx"]) {
    const src = read(file)
    assert.match(src, /contexts\.length <= 1/, `${file} offers a menu regardless of how many contexts exist`)
    assert.match(src, /sr-only">Acting in: /, `${file} leaves the active context unannounced for a single-context person`)
  }
})

test("the shell never decides for itself which contexts exist", () => {
  // Two resolvers would drift, and the second one would be the one nobody tested.
  for (const file of ["app/(app)/context-switcher.tsx", "app/(app)/app-mobile-nav.tsx"]) {
    const src = read(file)
    assert.ok(!/clubMemberships|teamPermissions|guardianRelationships|isSiteAdmin/.test(src),
      `${file} derives contexts from raw relationships instead of taking the resolved list`)
  }
})
