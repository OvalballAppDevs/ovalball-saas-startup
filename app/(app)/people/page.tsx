import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronRight, KeyRound, ShieldCheck, UserCheck, Users } from "lucide-react"
import { cookies } from "next/headers"

import { PageIdentity } from "@/components/shell/page-identity"
import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { workspaceLabel } from "@/lib/app-context/workspace-label"
import { getSessionContext } from "@/lib/app-context/session-context"
import { readClubPeople, readPeopleCapabilities } from "@ovalball/contracts/club/people"
import { createClient } from "@/lib/supabase/server"
import { describeIntendedOutcome, invitationExpiryLabel, outcomeLines } from "@/lib/invitations/share"
import { clubRoleLabel, teamPermissionLabel } from "@/lib/permissions/role-labels"

import { invitationStaffRoleOptions } from "./actions"
import { InviteForm } from "./invite-form"
import { JoinRequestRow } from "./join-request-row"
import { PendingInvitationRow } from "./pending-invitation-row"
import { PersonRow, type PersonRowData } from "./person-row"

export const metadata = { title: "Users & Permissions" }

/** The stored states, worded for a person. Derived states are handled beside them. */
const INVITATION_STATE_LABEL: Record<string, string> = {
  REDEEMED: "Accepted",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
}

/**
 * "Club Admin" is a strict superset of "Fixture Secretary" authority
 * everywhere it's checked (can_manage_club_fixtures's own definition ORs in
 * is_club_admin) -- club_memberships.role is deliberately a single value,
 * not a set, because there is no functional gap a person would need both
 * roles simultaneously to close. A club-wide role and any number of
 * team-scoped roles are the two independent axes this page models; two
 * *club-wide* roles at once was never a real distinction the schema drops.
 */
export default async function PeoplePage({
  searchParams,
}: {
  /**
   * `?request=<id>` is how a club-join-request notification says which request it was about. It marks
   * a row and nothing more: the rows themselves come from RLS and the decision is authorised inside
   * decideJoinRequest, so an id that names somebody else's request simply matches nothing here.
   */
  searchParams?: Promise<{ request?: string }>
}) {
  const highlightRequestId = (await searchParams)?.request ?? null
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // People management is Club Admin-only authority (people.manage isn't in
  // Fixtures Admin's capability set) -- resolve the active context's own
  // club only if the session actually holds CLUB_ADMIN there, so switching
  // to a team context or a club where this session is merely Fixture
  // Secretary never silently falls back to managing a DIFFERENT club's
  // people instead.
  // CA-M3 (owner decision 2): the page asks the CANONICAL capabilities, never a role. Seeing the
  // club's people is people.member.view at the active context's club; each control below asks its
  // own key, and the operations ask again on the server. The old gate was "holds CLUB_ADMIN here",
  // which hid the page from a person granted the capability and showed it to one denied it.
  const activeClubId = activeManageableClubId(ctx, activeContext)
  if (!activeClubId) redirect("/dashboard")
  const peopleCaps = await readPeopleCapabilities(supabase, activeClubId)
  if (!peopleCaps.view) redirect("/dashboard")
  const clubId = activeClubId
  const clubName = ctx.clubMemberships.find((m) => m.clubId === clubId)?.clubName ?? activeContext.label

  // PENDING INVITATIONS COME FROM THE TABLE INVITATIONS ARE ACTUALLY IN.
  //
  // This read used to be `.from("invitations")`, which since Slice 5 has held
  // zero rows: `issue_invitation` -- the authority the Invite Someone form on
  // this very page calls -- writes `public.access_invitations`. So "Pending
  // Invitations" was a section that could never render, and the Revoke button
  // inside it was unreachable. `invitations_admin_view` is the canonical
  // secret-free projection of that table (no token hash, no code HMAC), scoped
  // by the same RLS policy that governs the table itself.
  // CA-M3: the people themselves come from the ONE read model both clients use (club_people):
  // every live membership including suspended ones, roles and team roles in one paged read, an
  // email only under people.member.view_contact. The queues beside it keep their own readers.
  const [directory, { data: teams }, { data: invitations }, { data: joinRequests }, { count: playerRequestCount }, { data: guardianRequests }] =
    await Promise.all([
      readClubPeople(supabase, clubId, { limit: 200 }),
      supabase.from("teams").select("id, display_name").eq("club_id", clubId).eq("active", true),
      supabase
        .from("invitations_admin_view")
        .select("id, invited_email_normalised, intended_outcome, expires_at, created_at, issued_by, resend_count, state, use_count, max_uses")
        .eq("club_id", clubId)
        .eq("state", "ISSUED")
        .order("created_at", { ascending: false }),
      supabase.rpc("list_pending_club_join_requests", { p_club_id: clubId }),
      supabase
        .from("player_club_join_requests")
        .select("id", { count: "exact", head: true })
        .eq("club_id", clubId)
        .eq("status", "pending"),
      supabase.rpc("guardian_link_requests_for_approval"),
    ])

  const people: PersonRowData[] = directory.people
    .filter((p) => p.kind === "member" && p.membershipId && p.userId)
    .map((p) => ({
      membershipId: p.membershipId as string,
      userId: p.userId as string,
      name: [p.firstName, p.surname].filter(Boolean).join(" ") || "Unknown",
      email: p.email ?? "",
      clubRole: (p.role ?? "BASIC_USER") as PersonRowData["clubRole"],
      state: p.state,
      teamRoles: p.teamRoles.map((t) => ({ teamName: t.teamDisplayName, permission: teamPermissionLabel(t.permission) })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ONE LABEL AUTHORITY FOR THE ROLES AN INVITATION CARRIES.
  //
  // `invitation_staff_role_options` is what the Invite Someone form already
  // offers, so the wording a waiting invitation is described with is the exact
  // wording it was created with. A second map here would let the two disagree
  // about what a club just promised somebody.
  const roleOptions = await invitationStaffRoleOptions()
  const roleLabelByKey = new Map(roleOptions.map((o) => [o.roleKey, o.label]))
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.display_name]))
  const describeRole = (key: string) => roleLabelByKey.get(key) ?? clubRoleLabel(key)

  // Read once, outside the map: an invitation is "expired" relative to a single
  // moment, not to whenever each row happened to be evaluated.
  const now = new Date().getTime()
  // Who sent each one, from the club's own authorised directory rather than a
  // second profiles read.
  const issuerName = new Map<string, string>(directory.people.filter((p) => p.userId).map((p) => [p.userId as string, [p.firstName, p.surname].filter(Boolean).join(" ")]))

  const pendingInvitations = (invitations ?? []).map((inv) => {
    // The outcome is described from the invitation's OWN record, through the one
    // shared describer, so a waiting invitation, the panel shown when it was
    // issued and the panel shown when it is reissued all say the same thing.
    const lines = outcomeLines(
      describeIntendedOutcome(inv.intended_outcome, (id) => teamNameById.get(id) ?? "A team", describeRole)
    )
    const expiresAt = inv.expires_at ? new Date(inv.expires_at) : null
    const expired = Boolean(expiresAt && expiresAt.getTime() < now)
    const used = (inv.use_count ?? 0) >= (inv.max_uses ?? 1)
    // The canonical lifecycle, worded. `state` is the stored value; expiry and
    // exhaustion are derived from the row exactly as `preview_invitation`
    // derives them for the recipient, so the club and the person holding the
    // link are never told two different things.
    const storedState = inv.state ?? "ISSUED"
    const status =
      storedState !== "ISSUED"
        ? (INVITATION_STATE_LABEL[storedState] ?? storedState)
        : expired
          ? "Expired"
          : used
            ? "Accepted"
            : "Pending"
    return {
      id: inv.id as string,
      invitedEmail: (inv.invited_email_normalised as string | null) ?? "Someone",
      outcome: lines,
      expiresAt: invitationExpiryLabel(inv.expires_at),
      expired,
      status,
      issuedBy: inv.issued_by ? issuerName.get(inv.issued_by) || null : null,
      issuedOn: inv.created_at ? new Date(inv.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null,
      resendCount: inv.resend_count ?? 0,
    }
  })

  const guardianRequestCount = (guardianRequests ?? []).length
  const waitingCount = pendingInvitations.length + (joinRequests?.length ?? 0) + (playerRequestCount ?? 0) + guardianRequestCount

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      {/* This page already had the shape UX-1 generalises -- workspace above task -- and moving it
          onto the shared primitive is what makes the eyebrow reach assistive technology instead of
          being decorative text a screen reader announces adrift from the heading. */}
      {/* THE PAGE IS NAMED FOR THE QUESTION IT ANSWERS.
          "People" named the list that happened to be longest on it. What a club
          administrator arrives asking is who can get in, what they can do, and
          what is waiting on a decision -- and Step 1 settled "Users &
          Permissions" as the one vocabulary for that across the product. The
          navigation, this heading and the page's own title now agree. */}
      <PageIdentity
        workspace={workspaceLabel("club")}
        title="Users & Permissions"
        className="mt-0"
        titleClassName="mt-2"
        descriptionClassName="mt-2 max-w-md"
        description={<>Who has access to {clubName}, what they can do, which teams they&apos;re assigned to, and who is waiting to be let in.</>}
      />

      {/* WAITING ON YOU -- one place, four queues.
          These four decisions were reachable from four unrelated places: club
          join requests only here, player join requests only from a link in the
          sidebar, guardian requests only from a bare link on this page, and
          pending invitations from a section that could never render. They are
          all the same job -- somebody is waiting for this club to say yes -- so
          they are collected under one heading. Each one still belongs to the
          authority that owns it: nothing is decided here that was not decided
          here before, and the two that live on their own pages keep them. */}
      {waitingCount > 0 && (
        <section className="mt-8" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Waiting On You
          </h2>

          {joinRequests && joinRequests.length > 0 && (
            <>
              <p className="mt-3 text-sm text-ink-muted">People who have asked to join {clubName}. Approving makes them a member; it gives no other role.</p>
              <ul className="mt-2 flex flex-col gap-2">
                {joinRequests.map((r) => (
                  <JoinRequestRow
                    key={r.request_id}
                    highlighted={r.request_id === highlightRequestId}
                    request={{
                      id: r.request_id,
                      name: [r.first_name, r.surname].filter(Boolean).join(" ") || "Unknown",
                      requestedRole: r.requested_role,
                      createdAt: r.created_at,
                    }}
                  />
                ))}
              </ul>
            </>
          )}

          {pendingInvitations.length > 0 && (
            <>
              <p className="mt-4 text-sm text-ink-muted">
                Invitations this club has sent that nobody has accepted yet. An invitation gives nothing until it is accepted, and revoking
                one stops the link working.
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {pendingInvitations.map((inv) => (
                  <PendingInvitationRow key={inv.id} invitation={inv} />
                ))}
              </ul>
            </>
          )}

          {((playerRequestCount ?? 0) > 0 || guardianRequestCount > 0) && (
            <ul className="mt-4 flex flex-col gap-2">
              {(playerRequestCount ?? 0) > 0 && (
                <li>
                  <Link
                    href="/club/join-requests"
                    className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3 outline-none hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">Players Asking to Join</span>
                      <span className="block text-xs text-ink-muted">Placing a player in one of your sides.</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-forest-800">{playerRequestCount}</span>
                  </Link>
                </li>
              )}
              {guardianRequestCount > 0 && (
                <li>
                  {/* Guardian requests live next to People because that is what
                      they are: a decision about which adult gets access to a
                      child. The page itself is scoped server-side, so a viewer
                      without that capability lands on an empty queue rather than
                      being handed one they cannot act on. */}
                  <Link
                    href="/guardian-requests"
                    className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3 outline-none hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">Guardian Requests</span>
                      <span className="block text-xs text-ink-muted">Adults asking to be linked to a child.</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-forest-800">{guardianRequestCount}</span>
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      <section className="mt-8" aria-labelledby="people-heading">
        <h2 id="people-heading" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          People
        </h2>
        <div className="mt-3">
        {people.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
            <p className="text-sm font-medium text-ink">Just you, for now</p>
            <p className="mt-1 text-sm text-ink-muted">Invite coaches, team managers, or other club officials below.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((p) => (
              <PersonRow key={p.membershipId} person={p} isSelf={p.userId === user.id} canChangeRole={peopleCaps.assignClub} canSuspend={peopleCaps.assignClub && peopleCaps.suspend} canRemove={peopleCaps.assignClub && peopleCaps.revoke} />
            ))}
          </ul>
        )}
        </div>
      </section>

      <div className="mt-8">
        <InviteForm
          clubId={clubId}
          clubName={clubName}
          teams={(teams ?? []).map((t) => ({ id: t.id, displayName: t.display_name }))}
          roleOptions={roleOptions}
        />
      </div>

      {/* THE REST OF ACCESS, NAMED RATHER THAN HIDDEN.
          These three are genuine separate authorities -- a capability override
          grid, a guardianship register and a statutory appointment with its own
          two-person state machine -- and collapsing them into this page would
          be merging concepts, not converging them. What was wrong is that from
          the page about access there was no way to know they existed. */}
      <section className="mt-10" aria-labelledby="more-access-heading">
        <h2 id="more-access-heading" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          Roles &amp; Access
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {[
            {
              href: "/club/permissions",
              icon: KeyRound,
              title: "Permissions",
              description: "What each person may do, beyond what their role already allows.",
            },
            {
              href: "/club/settings/guardians",
              icon: Users,
              title: "Guardians & Players",
              description: "Which adult is linked to which child, and who may act for them.",
            },
            // This door stays open whether or not anything is behind it. Before
            // Step 2 it was an unconditional link at the top of the page, and
            // moving it into "Waiting On You" would have made it vanish as soon
            // as the queue emptied -- removing the only way to reach the page
            // that shows a club its guardian approvals. A queue with a count
            // appears above; this is how you get there when there is no count.
            {
              href: "/guardian-requests",
              icon: UserCheck,
              title: "Guardian Requests",
              description: "Adults asking to be linked to a child, and what has already been decided.",
            },
            {
              href: "/club/settings/safeguarding",
              icon: ShieldCheck,
              title: "Safeguarding Officer",
              description: "Who holds the club's Safeguarding Officer appointment, and how it is changed.",
            },
          ].map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <s.icon aria-hidden="true" className="size-5 shrink-0 text-forest-800" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{s.title}</p>
                  <p className="text-xs text-ink-muted">{s.description}</p>
                </div>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
