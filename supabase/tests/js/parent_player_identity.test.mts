import { test } from "node:test"
import assert from "node:assert/strict"

import { listSwitchableContexts } from "@/lib/app-context/active-context-rules"
import { resolveIdentityDisplay } from "@/lib/app-context/identity-display"
import type { SessionContext } from "@/lib/app-context/session-context"

/**
 * Phase 2B: a child is a PLAYER, and the child a guardian selected is who the
 * app must then be about.
 *
 * Two live defects were reported and both were presentation, not data:
 *
 *   "Pippa appears as a Parent/Guardian rather than a Player"
 *     -- the switcher printed the VIEWER's roleLabel under the CHILD's name.
 *
 *   "Clicking into Pippa still shows Callum Krzysik"
 *     -- resolveIdentityDisplay returned the signed-in adult's name for a
 *        parent context, so selecting a child left the identity block naming
 *        the parent and the child vanished.
 *
 * Both are pinned here, together with the thing that made them survive review:
 * the underlying player_id was correct the whole time, so nothing in the data
 * looked wrong.
 */

/** A guardian of two children on two different teams -- the reported shape. */
function guardianOfTwo(): SessionContext {
  return {
    userId: "user-parent",
    firstName: "Callum",
    surname: "Testparent",
    isSiteAdmin: false,
    siteAdminRole: null,
    clubMemberships: [],
    teamPermissions: [],
    guardianRelationships: [
      {
        playerId: "player-pippa",
        playerFirstName: "Pippa",
        playerSurname: "Testfamily",
        ageState: "under16",
        teamId: "team-u9",
        teamDisplayName: "U9",
        clubId: "club-1",
        clubName: "Burnley RUFC",
      },
      {
        playerId: "player-jaxon",
        playerFirstName: "Jaxon",
        playerSurname: "Testfamily",
        ageState: "under16",
        teamId: "team-u12",
        teamDisplayName: "U12",
        clubId: "club-1",
        clubName: "Burnley RUFC",
      },
    ],
    linkedPlayerTeams: [],
  } as unknown as SessionContext
}

test("each child is its own switchable context, keyed by its own player_id", () => {
  const contexts = listSwitchableContexts(guardianOfTwo()).filter((c) => c.kind === "parent")
  assert.equal(contexts.length, 2, "two children must produce two contexts")
  const ids = contexts.map((c) => c.playerId)
  assert.deepEqual([...ids].sort(), ["player-jaxon", "player-pippa"])
  assert.equal(new Set(contexts.map((c) => c.key)).size, 2, "context keys collided")
})

test("a child row names the CHILD, not the team and not the parent", () => {
  const contexts = listSwitchableContexts(guardianOfTwo())
  const pippa = contexts.find((c) => c.playerId === "player-pippa")!
  assert.match(pippa.switcherLabel, /Pippa/, "the switcher row does not name the child")
  assert.ok(!/Callum/.test(pippa.switcherLabel), "the parent's name leaked into the child's row")
  assert.equal(pippa.subjectName, "Pippa Testfamily")
  assert.equal(pippa.subjectClubName, "Burnley RUFC")
})

test("a child is never captioned with the viewer's Parent/Guardian role", () => {
  // The caption a child row renders is club + team. roleLabel still exists --
  // it is the VIEWER's role and other contexts use it -- but the child's row
  // must not present it as a description of the child.
  const pippa = listSwitchableContexts(guardianOfTwo()).find((c) => c.playerId === "player-pippa")!
  const caption = [pippa.subjectClubName, pippa.label].filter(Boolean).join(" · ")
  assert.equal(caption, "Burnley RUFC · U9")
  assert.ok(!/Parent|Guardian/i.test(caption), "the child is described as a guardian")
})

test("selecting a child makes the CHILD the identity subject", () => {
  const pippa = listSwitchableContexts(guardianOfTwo()).find((c) => c.playerId === "player-pippa")!
  const identity = resolveIdentityDisplay("parent", {
    contextLabel: pippa.label,
    roleLabel: pippa.roleLabel,
    personName: "Callum Testparent",
    subjectName: pippa.subjectName,
  })
  assert.equal(identity.nameLabel, "Pippa Testfamily", "the identity block still names the parent")
  assert.ok(!/Callum/.test(identity.nameLabel), "the parent's name is the headline for a child context")
  // The adult still needs to know they are acting as a guardian.
  assert.match(identity.subLabel, /Parent\/Guardian/)
  assert.match(identity.subLabel, /U9/)
})

test("switching child switches the whole subject, with no bleed between siblings", () => {
  const contexts = listSwitchableContexts(guardianOfTwo())
  for (const [playerId, name, team] of [
    ["player-pippa", "Pippa Testfamily", "U9"],
    ["player-jaxon", "Jaxon Testfamily", "U12"],
  ] as const) {
    const c = contexts.find((x) => x.playerId === playerId)!
    const identity = resolveIdentityDisplay("parent", {
      contextLabel: c.label,
      roleLabel: c.roleLabel,
      personName: "Callum Testparent",
      subjectName: c.subjectName,
    })
    assert.equal(identity.nameLabel, name, `${playerId} resolved to the wrong person`)
    assert.match(identity.subLabel, new RegExp(team), `${playerId} resolved to the wrong team`)
    // The decisive one: no sibling's identity may appear in the other's.
    const sibling = name.startsWith("Pippa") ? "Jaxon" : "Pippa"
    assert.ok(!identity.nameLabel.includes(sibling), "a sibling's name bled across contexts")
    assert.ok(!identity.subLabel.includes(sibling), "a sibling's identity bled across contexts")
  }
})

test("a child context never borrows the parent's avatar", () => {
  // Found in live UAT of the fix above: the headline correctly read "Ben
  // Whitaker" while the avatar beside it still read "DW" -- Dana Whitaker,
  // his mother. Initials gave it away; with a real uploaded photo it would
  // have been an adult's face captioned with a child's name.
  const pippa = listSwitchableContexts(guardianOfTwo()).find((c) => c.playerId === "player-pippa")!
  const identity = resolveIdentityDisplay("parent", {
    contextLabel: pippa.label,
    roleLabel: pippa.roleLabel,
    personName: "Callum Testparent",
    subjectName: pippa.subjectName,
  })
  assert.equal(identity.avatarUsesPersonPhoto, false, "a child context would render the parent's photo")

  // The signed-in person's own contexts still use their own photo.
  for (const kind of ["team", "player"] as const) {
    const own = resolveIdentityDisplay(kind, {
      contextLabel: "U16",
      roleLabel: "Player",
      personName: "Rowan Testplayer",
    })
    assert.equal(own.avatarUsesPersonPhoto, true, `${kind} lost the viewer's own photo`)
  }
})

test("a legacy view-only parent row with no child keeps the old shape", () => {
  // Not every "parent" context has a child behind it: a view_only team
  // permission with no guardian relationship produces one. That case must
  // keep naming the signed-in person, or it would render a blank headline.
  const identity = resolveIdentityDisplay("parent", {
    contextLabel: "U9",
    roleLabel: "View Only",
    personName: "Callum Testparent",
    subjectName: null,
  })
  assert.equal(identity.nameLabel, "Callum Testparent")
  assert.equal(identity.subLabel, "View Only")
})

test("a player context still names the signed-in person -- they ARE the player", () => {
  const identity = resolveIdentityDisplay("player", {
    contextLabel: "U16",
    roleLabel: "Player",
    personName: "Rowan Testplayer",
  })
  assert.equal(identity.nameLabel, "Rowan Testplayer")
  assert.match(identity.subLabel, /U16 Player/)
})

test("a club context is unaffected by the child-subject change", () => {
  const identity = resolveIdentityDisplay("club", {
    contextLabel: "Burnley RUFC",
    roleLabel: "Club Admin",
    personName: "Callum Testparent",
    subjectName: null,
  })
  assert.equal(identity.avatarKind, "club")
  assert.equal(identity.nameLabel, "Burnley RUFC")
  assert.equal(identity.subLabel, "Club Admin")
})
