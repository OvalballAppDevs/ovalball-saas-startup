import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyClubhouseFilter,
  deriveClubNetworkActions,
  matchesClubhouseQuery,
  type ClubMapMarker,
} from "../../../packages/contracts/src/clubhouse"

/**
 * CLUBHOUSE V1 -- pure client-side logic pinned directly (owner directive Section 69). The
 * SERVER-side authority (`club_partnerships` RLS, `respond_to_club_partnership`,
 * `create_partner_invitation`, `my_capabilities`) is unchanged by Clubhouse and already covered by
 * `supabase/tests/partner_clubs_and_messaging.sql` and `supabase/tests/js/perimeter_manifest.test.mts`
 * -- these assertions cover the NEW arithmetic Clubhouse itself adds: the search/filter functions both
 * clients call, and `deriveClubNetworkActions`, the one function deciding what the club sheet may
 * offer. Every safeguarding-relevant case the directive calls out by name is asserted here.
 */

function marker(overrides: Partial<ClubMapMarker> = {}): ClubMapMarker {
  return {
    directoryId: "dir-1",
    clubId: "club-1",
    name: "Preston Grasshoppers",
    rugbyCode: "union",
    town: "Preston",
    county: "Lancashire",
    postcode: "PR2 1AB",
    latitude: 53.77,
    longitude: -2.7,
    hasLocation: true,
    logoUrl: null,
    slug: "preston-grasshoppers",
    isOwnClub: false,
    networkState: "on_ovalball",
    partnershipStatus: "none",
    partnershipId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------------------------
// deriveClubNetworkActions -- Section 44/55/64: the one function deciding what the sheet offers.
// ---------------------------------------------------------------------------------------------

test("a parent/player account (no capability at any club) gets every network action false, even for a partner club", () => {
  const m = marker({ partnershipStatus: "active" })
  const actions = deriveClubNetworkActions(m, "viewer-club", new Set())
  assert.deepEqual(actions, {
    canPartner: false,
    canCancelOutgoingPartnerRequest: false,
    canRespondPartnerRequest: false,
    canRevokePartnership: false,
    canFindFixture: false,
    canCompareCalendar: false,
    canInviteToOvalball: false,
  })
})

test("an unclaimed directory club never offers Find a Fixture, Compare Calendars or any partner action, whatever capabilities the viewer holds", () => {
  const m = marker({ clubId: null, networkState: "not_on_ovalball", partnershipStatus: "none" })
  const caps = new Set(["club.partners.manage", "fixture.request.create", "fixture.request.respond"])
  const actions = deriveClubNetworkActions(m, "viewer-club", caps)
  assert.equal(actions.canFindFixture, false)
  assert.equal(actions.canCompareCalendar, false)
  assert.equal(actions.canPartner, false)
  assert.equal(actions.canRevokePartnership, false)
  // The one action an unclaimed club DOES offer, and only this one.
  assert.equal(actions.canInviteToOvalball, true)
})

test("Compare Calendars requires an ACTIVE partnership even when the viewer holds full fixture authority -- matches get_partner_team_availability's own server-side refusal", () => {
  const caps = new Set(["fixture.request.create", "fixture.request.respond"])
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "none" }), "viewer-club", caps).canCompareCalendar, false)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "pending_outgoing" }), "viewer-club", caps).canCompareCalendar, false)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "active" }), "viewer-club", caps).canCompareCalendar, true)
})

test("Find a Fixture never requires partnership -- fixture authority alone is enough (the audit's own finding: partnership grants calendar/messaging, nothing else)", () => {
  const caps = new Set(["fixture.request.create"])
  const actions = deriveClubNetworkActions(marker({ partnershipStatus: "none" }), "viewer-club", caps)
  assert.equal(actions.canFindFixture, true)
})

test("a club cannot partner with itself -- isOtherClub is false when the marker's own clubId equals the viewer's", () => {
  const m = marker({ clubId: "viewer-club", isOwnClub: true, partnershipStatus: "none" })
  const caps = new Set(["club.partners.manage", "fixture.request.create"])
  const actions = deriveClubNetworkActions(m, "viewer-club", caps)
  assert.equal(actions.canPartner, false)
  assert.equal(actions.canFindFixture, false)
})

test("partnership status maps to exactly one available transition at a time", () => {
  const caps = new Set(["club.partners.manage"])
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "none" }), "v", caps).canPartner, true)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "pending_outgoing" }), "v", caps).canCancelOutgoingPartnerRequest, true)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "pending_incoming" }), "v", caps).canRespondPartnerRequest, true)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "active" }), "v", caps).canRevokePartnership, true)
  // Never two transitions offered for one status.
  const pending = deriveClubNetworkActions(marker({ partnershipStatus: "pending_incoming" }), "v", caps)
  assert.equal(pending.canPartner, false)
  assert.equal(pending.canRevokePartnership, false)
})

// ---------------------------------------------------------------------------------------------
// matchesClubhouseQuery / applyClubhouseFilter
// ---------------------------------------------------------------------------------------------

test("matchesClubhouseQuery matches name, town and postcode (whitespace-insensitive), and a query under 2 characters matches everything", () => {
  const m = marker()
  assert.equal(matchesClubhouseQuery(m, "preston"), true)
  assert.equal(matchesClubhouseQuery(m, "PRESTON"), true)
  assert.equal(matchesClubhouseQuery(m, "pr2 1ab"), true)
  assert.equal(matchesClubhouseQuery(m, "pr21ab"), true)
  assert.equal(matchesClubhouseQuery(m, "burnley"), false)
  assert.equal(matchesClubhouseQuery(m, "p"), true)
})

test("applyClubhouseFilter: 'compatible' never silently falls back to 'all' when no compatible set is known -- an unknown compatibility answer must show nothing, not everything", () => {
  const markers = [marker({ directoryId: "a" }), marker({ directoryId: "b" })]
  assert.deepEqual(applyClubhouseFilter(markers, "compatible", null), [])
})

test("applyClubhouseFilter: 'partners' only ever returns an ACTIVE partnership, never pending", () => {
  const markers = [
    marker({ directoryId: "a", partnershipStatus: "active" }),
    marker({ directoryId: "b", partnershipStatus: "pending_incoming" }),
    marker({ directoryId: "c", partnershipStatus: "pending_outgoing" }),
  ]
  const result = applyClubhouseFilter(markers, "partners", null)
  assert.deepEqual(result.map((m) => m.directoryId), ["a"])
})

test("applyClubhouseFilter: 'on_ovalball' excludes directory-only clubs", () => {
  const markers = [marker({ directoryId: "a", networkState: "on_ovalball" }), marker({ directoryId: "b", networkState: "not_on_ovalball" })]
  const result = applyClubhouseFilter(markers, "on_ovalball", null)
  assert.deepEqual(result.map((m) => m.directoryId), ["a"])
})
