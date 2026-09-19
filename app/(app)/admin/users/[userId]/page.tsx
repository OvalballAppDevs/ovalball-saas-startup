import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { mySiteCapabilities } from "@/lib/auth/require-capability"
import { createClient } from "@/lib/supabase/server"

import { AuditLog } from "../../clubs/[directoryId]/audit-log"
import { mapAdminUserRow } from "../query"
import { AccountSecurityPanel } from "./panels/account-security"
import { CapabilityOverridesPanel, type OverrideRow } from "./panels/capability-overrides"
import { ClubMembershipsPanel } from "./panels/club-memberships"
import { ClubRolesPanel, type RoleAssignmentRow } from "./panels/club-roles"
import { FamilyPanel, type GuardianLink } from "./panels/family"
import { HistoryPanel, type HistoryEntry } from "./panels/history"
import { InvitationsPanel, type InvitationRow } from "./panels/invitations"
import { SiteAdminPanel, type GrantRequestRow } from "./panels/site-admin"
import { TeamMembershipsPanel, type PlayerPlacement } from "./panels/team-memberships"
import { type FamilyRelationshipRow } from "./family-relationships-panel"
import { PersonalDetailsPanel } from "./personal-details-panel"
import { TabStrip } from "./tab-strip"
import { resolveTab, visibleTabs } from "./tabs"

const PENDING_LABEL: Record<string, string> = { claim: "Pending club claim", join_request: "Pending join request" }

/**
 * SLICE 7e -- AB.1's thirteen detail tabs.
 *
 * This page used to be five panels stacked down one column, and seventeen of the
 * twenty-three master-control RPCs had no caller anywhere in the product: the
 * two-administrator Site Admin rule could not be performed at all, the three
 * provenance timelines answered a question no screen asked, and "sign this
 * account out of everything" was something the platform could do and nobody
 * could ask it to.
 *
 * ONLY THE ACTIVE TAB'S DATA IS READ. The tab is in the URL rather than in
 * component state, so opening somebody's record does not fire three history RPCs
 * and six table reads that nobody looked at. It also means an administrator can
 * send a colleague the exact tab they are on, and a verification suite can
 * address one directly.
 *
 * NOTHING HERE DECIDES AUTHORITY. Each panel is handed the administrator's own
 * site capabilities and renders a control only where the capability is held --
 * but that is presentation. Every RPC behind every control re-asks for the
 * capability, a TOTP code presented within the last ten minutes, a reason of at
 * least ten characters and a refusal to act on the administrator's own account.
 */
export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { userId } = await params
  const requestedTab = (await searchParams).tab
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  const { data: overviewRow } = await supabase.from("admin_user_overview").select("*").eq("user_id", userId).maybeSingle()
  if (!overviewRow) notFound()

  const person = mapAdminUserRow(overviewRow)
  const isSelf = person.userId === user.id
  const capabilities = await mySiteCapabilities(supabase)
  const tabs = visibleTabs(capabilities)
  const active = resolveTab(typeof requestedTab === "string" ? requestedTab : undefined, capabilities)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" />
        User management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>

      <h1 className="mt-3 font-display text-display-l text-ink">{person.name}</h1>
      <p className="mt-1 text-sm text-ink-muted">{person.email}</p>

      <div className="mt-6">
        <TabStrip userId={userId} tabs={tabs} active={active} />
      </div>

      <div className="mt-6" role="tabpanel" aria-label={tabs.find((t) => t.key === active)?.label}>
        {active === "overview" && <OverviewTab person={person} />}
        {active === "personal" && (
          <section>
            <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Personal Details</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Date of birth and home address are never in the list grids and are read one person at a time, from here.
            </p>
            <div className="mt-3">
              <PersonalDetailsPanel userId={person.userId} />
            </div>
          </section>
        )}
        {active === "security" && (
          <AccountSecurityPanel
            userId={person.userId}
            userName={person.name}
            isSelf={isSelf}
            status={person.accountStatus}
            canManageSecurity={capabilities.has("site.users.security.manage")}
          />
        )}
        {active === "clubs" && (
          <ClubMembershipsPanel
            userId={person.userId}
            userName={person.name}
            memberships={person.memberships}
            clubs={await loadClubs(supabase)}
            canManageMemberships={capabilities.has("site.memberships.manage") && !isSelf}
          />
        )}
        {active === "club-roles" && (
          <ClubRolesPanel
            userId={person.userId}
            userName={person.name}
            assignments={(await loadRoleAssignments(supabase, userId)).filter((a) => !a.teamName)}
            clubs={await loadClubs(supabase)}
            roles={await loadRoles(supabase, "CLUB")}
            canManageRoles={capabilities.has("site.club_roles.manage") && !isSelf}
          />
        )}
        {active === "teams" && (
          <TeamMembershipsPanel
            userId={person.userId}
            userName={person.name}
            teamRoles={(await loadRoleAssignments(supabase, userId)).filter((a) => Boolean(a.teamName))}
            placements={await loadPlacements(supabase, userId)}
            teams={await loadTeams(supabase)}
            teamRoleOptions={await loadRoles(supabase, "TEAM")}
            canManageTeamRoles={capabilities.has("site.team_roles.manage") && !isSelf}
          />
        )}
        {active === "family" && (
          <FamilyPanel
            userId={person.userId}
            userName={person.name}
            rows={await loadFamilyRows(supabase, userId)}
            links={await loadGuardianLinks(supabase, userId)}
            players={await loadPlayers(supabase)}
            history={await loadHistory(supabase, "site_family_history", userId)}
            canManageFamily={capabilities.has("site.family.manage") && !isSelf}
          />
        )}
        {active === "overrides" && (
          <CapabilityOverridesPanel
            userId={person.userId}
            userName={person.name}
            overrides={await loadOverrides(supabase, userId)}
            capabilities={await loadCapabilities(supabase)}
            clubs={await loadClubs(supabase)}
            teams={await loadTeams(supabase)}
          />
        )}
        {active === "invitations" && (
          <InvitationsPanel
            userId={person.userId}
            userName={person.name}
            invitations={await loadInvitations(supabase, userId, person.email)}
            canManageInvitations={capabilities.has("site.invitations.manage")}
          />
        )}
        {active === "site-admin" && (
          <SiteAdminPanel
            userId={person.userId}
            userName={person.name}
            isSelf={isSelf}
            holdsSiteAdmin={person.isSiteAdmin}
            currentProfileKey={await loadProfileKey(supabase, userId)}
            requests={await loadGrantRequests(supabase, userId)}
            canManageAdmins={capabilities.has("site.admins.manage")}
          />
        )}
        {active === "membership-history" && (
          <HistoryPanel
            title="Membership History"
            explanation={`Every club membership decision recorded against ${person.name}, newest first, with who decided it.`}
            entries={await loadHistory(supabase, "site_membership_history", userId)}
            emptyLine="Nothing has been recorded against this person's club memberships."
          />
        )}
        {active === "team-history" && (
          <HistoryPanel
            title="Team History"
            explanation={`Every team role and player placement decision recorded against ${person.name}, newest first.`}
            entries={await loadHistory(supabase, "site_team_history", userId)}
            emptyLine="Nothing has been recorded against this person's team roles or placements."
          />
        )}
        {active === "audit-history" && <AuditTab supabase={supabase} person={person} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 1 -- Overview
// ---------------------------------------------------------------------------

function OverviewTab({ person }: { person: ReturnType<typeof mapAdminUserRow> }) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Account</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InfoCard label="Account created" value={formatDate(person.createdAt)} />
          <InfoCard
            label="Status"
            value={
              person.accountStatus === "suspended"
                ? "Suspended"
                : person.accountStatus === "disabled"
                  ? "Disabled"
                  : person.isSiteAdmin
                    ? "Site Admin"
                    : person.hasActiveMembership
                      ? "Active member"
                      : person.hasPendingRequest
                        ? "Pending"
                        : "No club access"
            }
          />
          <InfoCard label="Clubs" value={person.clubNames ?? "None"} />
          <InfoCard label="Teams" value={person.teamNames ?? "None"} />
        </div>
      </section>

      {person.pendingRequests.length > 0 && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Pending Requests</h2>
          <p className="mt-1 text-sm text-ink-muted">
            No authority is granted until these are approved &mdash; reviewed in Claims, not here.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {person.pendingRequests.map((r, i) => (
              <div key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <p className="text-sm font-medium text-ink">{PENDING_LABEL[r.type] ?? r.type}</p>
                <p className="text-sm text-ink/60">
                  {r.clubName} &middot; {r.role}
                </p>
              </div>
            ))}
            <Link href="/admin/claims" className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
              Review in Claims &rarr;
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 13 -- Audit History
// ---------------------------------------------------------------------------

async function AuditTab({
  supabase,
  person,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  person: ReturnType<typeof mapAdminUserRow>
}) {
  const auditRecordIds = [person.userId, ...person.memberships.map((m) => m.membershipId)]
  const { data: auditRows } = await supabase
    .from("audit_log")
    .select("id, table_name, action, changed_at, changed_by, before, after")
    .in("record_id", auditRecordIds)
    .in("table_name", ["profiles", "site_admins", "club_memberships"])
    .order("changed_at", { ascending: false })
    .limit(50)

  const changedByIds = [...new Set((auditRows ?? []).map((r) => r.changed_by).filter((id): id is string => Boolean(id)))]
  const { data: changedByProfiles } =
    changedByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", changedByIds) : { data: [] }
  const nameById = new Map((changedByProfiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))

  // SLICE 7e. Seven master-control event types -- account state, sessions,
  // password resets, setup invitations, Site Admin grants, the creation of the
  // identity itself -- were written by 7a-7c and displayed by nothing at all, so
  // "who ended their sessions on the 3rd, and why" had no answer inside the
  // product. site_account_history is where they now surface, beside the
  // row-level audit_log entries, because this is the tab somebody opens when the
  // question is "what happened to this account".
  const accountHistory = await loadHistory(supabase, "site_account_history", person.userId)

  return (
    <div className="flex flex-col gap-8">
      <HistoryPanel
        title="Decisions On This Account"
        explanation="Account state, sessions, credentials, setup invitations and Site Admin grants, newest first, each with the reason the administrator gave at the time."
        entries={accountHistory}
        emptyLine="No account decision has been recorded against this person."
      />

      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Row Changes</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Row-level changes to this person&rsquo;s profile, Site Admin record and club memberships. Append-only:
          nothing here can be edited or removed, including by this screen.
        </p>
        <div className="mt-3">
          <AuditLog
            entries={(auditRows ?? []).map((r) => ({
              id: r.id,
              action: r.action,
              changedAt: r.changed_at,
              changedByLabel: r.changed_by ? nameById.get(r.changed_by) || "Site Admin" : "System",
              before: r.before,
              after: r.after,
            }))}
          />
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loaders. Each is called only by the tab that needs it.
// ---------------------------------------------------------------------------

type Client = Awaited<ReturnType<typeof createClient>>

async function loadClubs(supabase: Client): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("clubs").select("id, club_directory(name)").order("id")
  return (data ?? []).map((row) => ({
    id: row.id,
    name: (row.club_directory as { name: string } | null)?.name ?? "(unnamed club)",
  }))
}

async function loadTeams(supabase: Client): Promise<{ id: string; name: string; clubName: string }[]> {
  const { data } = await supabase.from("teams").select("id, display_name, clubs(club_directory(name))").eq("active", true)
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.display_name ?? "(unnamed team)",
    clubName: ((row.clubs as { club_directory: { name: string } | null } | null)?.club_directory?.name) ?? "",
  }))
}

async function loadPlayers(supabase: Client): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("players").select("id, first_name, surname").eq("active", true).limit(500)
  return (data ?? []).map((row) => ({ id: row.id, name: [row.first_name, row.surname].filter(Boolean).join(" ") }))
}

/**
 * SLICE 7e. A Safeguarding Officer is excluded on purpose.
 *
 * `internal.grant_role` refuses it outright -- the appointment is a nomination
 * that the officer accepts, and the PENDING_CONFIRMATION state machine is the
 * whole point of 4G. Offering it here would be offering an option that can only
 * ever end in a refusal, which reads as the product being broken rather than as
 * the rule being kept. The refusal still stands underneath, so nothing rests on
 * this filter.
 */
const NOT_ASSIGNABLE = new Set(["SAFEGUARDING_OFFICER"])

async function loadRoles(supabase: Client, scope: "CLUB" | "TEAM"): Promise<{ key: string; label: string }[]> {
  const { data } = await supabase.from("role_definitions").select("role_key, label, scope").eq("visible", true)
  // CLUB_OR_TEAM roles (Volunteer) legitimately belong in both lists.
  return (data ?? [])
    .filter((row) => row.scope === scope || row.scope === "CLUB_OR_TEAM")
    .filter((row) => !NOT_ASSIGNABLE.has(row.role_key))
    .map((row) => ({ key: row.role_key, label: row.label }))
}

async function loadRoleAssignments(supabase: Client, userId: string): Promise<RoleAssignmentRow[]> {
  const { data } = await supabase
    .from("role_assignments")
    .select("id, role_key, state, confirmation_state, granted_at, clubs(club_directory(name)), teams(display_name)")
    .eq("user_id", userId)
    .order("granted_at", { ascending: false })

  const { data: definitions } = await supabase.from("role_definitions").select("role_key, label")
  const labels = new Map((definitions ?? []).map((d) => [d.role_key, d.label]))

  return (data ?? []).map((row) => ({
    id: row.id,
    roleKey: row.role_key,
    roleLabel: labels.get(row.role_key) ?? row.role_key,
    clubName: ((row.clubs as { club_directory: { name: string } | null } | null)?.club_directory?.name) ?? "",
    teamName: (row.teams as { display_name: string | null } | null)?.display_name ?? null,
    state: row.state ?? "ACTIVE",
    confirmationState: row.confirmation_state,
    grantedAt: row.granted_at ?? new Date(0).toISOString(),
  }))
}

async function loadPlacements(supabase: Client, userId: string): Promise<PlayerPlacement[]> {
  // SLICE 7e: a definer read, because the roster's own RLS answers to
  // team.roster.view at TEAM scope and a platform administrator holds no such
  // thing -- see 20270505000000 for why that policy was not widened instead.
  const { data } = await supabase.rpc("site_player_team_memberships", { p_user_id: userId })
  return (data ?? []).map((row) => ({
    membershipId: row.membership_id,
    playerId: row.player_id,
    playerName: row.player_name,
    teamId: row.team_id,
    teamName: row.team_name,
    clubName: row.club_name,
    status: row.status,
    joinedAt: row.joined_at,
  }))
}

async function loadFamilyRows(supabase: Client, userId: string): Promise<FamilyRelationshipRow[]> {
  const { data } = await supabase.rpc("get_person_family_relationships", { p_user_id: userId })
  return (data ?? []).map((r) => ({
    guardianId: r.guardian_id,
    childName: `${r.child_first_name} ${r.child_surname}`,
    relationshipType: r.relationship_type,
    state: r.state as FamilyRelationshipRow["state"],
    confidential: r.confidential,
    holdReason: r.suspension_reason,
  }))
}

async function loadGuardianLinks(supabase: Client, userId: string): Promise<GuardianLink[]> {
  const { data } = await supabase
    .from("guardians")
    .select("id, player_id, relationship_type, state, players(first_name, surname)")
    .eq("guardian_user_id", userId)
    .eq("state", "ACTIVE")
  return (data ?? []).map((row) => {
    const player = row.players as { first_name: string | null; surname: string | null } | null
    return {
      id: row.id,
      playerId: row.player_id,
      childName: [player?.first_name, player?.surname].filter(Boolean).join(" ") || "this child",
      relationshipType: row.relationship_type,
      state: row.state ?? "ACTIVE",
    }
  })
}

async function loadOverrides(supabase: Client, userId: string): Promise<OverrideRow[]> {
  const { data } = await supabase
    .from("capability_overrides")
    .select("id, capability_key, scope_type, effect, status, reason, expires_at, clubs(club_directory(name)), teams(display_name)")
    .eq("user_id", userId)
    .order("granted_at", { ascending: false })

  const { data: definitions } = await supabase.from("capabilities").select("key, label")
  const labels = new Map((definitions ?? []).map((c) => [c.key, c.label]))

  return (data ?? []).map((row) => ({
    id: row.id,
    capabilityKey: row.capability_key,
    capabilityLabel: labels.get(row.capability_key) ?? row.capability_key,
    scopeType: row.scope_type,
    scopeName:
      (row.teams as { display_name: string | null } | null)?.display_name ??
      ((row.clubs as { club_directory: { name: string } | null } | null)?.club_directory?.name ?? null),
    effect: row.effect,
    status: row.status ?? "",
    reason: row.reason,
    expiresAt: row.expires_at,
  }))
}

/**
 * SLICE 7e. `site.*` capabilities are deliberately excluded.
 *
 * K.3 in internal.capability_decision is explicit: at site scope only rule 7 can
 * allow, and overrides are never consulted -- site authority comes from the Site
 * Admin profile. public.set_capability_override refuses a `site.*` key for the
 * same reason. Offering them here would have produced a picker whose most
 * powerful-looking options always end in a refusal, which reads as the product
 * being broken rather than as the rule being kept.
 */
async function loadCapabilities(supabase: Client): Promise<{ key: string; label: string }[]> {
  const { data } = await supabase.from("capabilities").select("key, label").eq("status", "ACTIVE").order("key")
  return (data ?? []).filter((row) => !row.key.startsWith("site.")).map((row) => ({ key: row.key, label: row.label }))
}

async function loadInvitations(supabase: Client, userId: string, email: string): Promise<InvitationRow[]> {
  const { data } = await supabase
    .from("access_invitations")
    .select("id, kind, state, expires_at, created_at, resend_count, intended_outcome, clubs(club_directory(name))")
    .or(`target_user_id.eq.${userId},invited_email_normalised.eq.${email.toLowerCase()}`)
    .order("created_at", { ascending: false })
    .limit(50)

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    state: row.state ?? "",
    clubName: ((row.clubs as { club_directory: { name: string } | null } | null)?.club_directory?.name) ?? null,
    expiresAt: row.expires_at,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    resendCount: row.resend_count ?? 0,
    intendedOutcome: row.intended_outcome ? JSON.stringify(row.intended_outcome) : null,
  }))
}

async function loadProfileKey(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await supabase.from("site_admins").select("profile_key").eq("user_id", userId).eq("status", "active").maybeSingle()
  return data?.profile_key ?? null
}

async function loadGrantRequests(supabase: Client, userId: string): Promise<GrantRequestRow[]> {
  const { data } = await supabase
    .from("site_admin_grant_requests")
    .select("id, profile_key, state, reason, created_at, expires_at, requested_by")
    .eq("target_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20)

  const requesterIds = [...new Set((data ?? []).map((r) => r.requested_by))]
  const { data: requesters } =
    requesterIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", requesterIds) : { data: [] }
  const nameById = new Map((requesters ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))

  return (data ?? []).map((row) => ({
    id: row.id,
    profileKey: row.profile_key,
    state: row.state ?? "",
    reason: row.reason,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    expiresAt: row.expires_at ?? new Date(0).toISOString(),
    requestedByName: nameById.get(row.requested_by) || "another administrator",
  }))
}

async function loadHistory(
  supabase: Client,
  rpc: "site_membership_history" | "site_team_history" | "site_family_history" | "site_account_history",
  userId: string
): Promise<HistoryEntry[]> {
  const { data } = await supabase.rpc(rpc, { p_user_id: userId })
  const actorIds = [...new Set((data ?? []).map((r: { actor_user_id: string | null }) => r.actor_user_id).filter((id): id is string => Boolean(id)))]
  const { data: actors } =
    actorIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", actorIds) : { data: [] }
  const nameById = new Map((actors ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))

  return (data ?? []).map((row: { at: string; entry: string; detail: string | null; club_name?: string | null; actor_user_id: string | null }) => ({
    at: row.at,
    entry: row.entry,
    detail: row.detail,
    where: row.club_name ?? null,
    actorName: row.actor_user_id ? nameById.get(row.actor_user_id) || "a Site Admin" : null,
  }))
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
