import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ArrowLeft, KeyRound } from "lucide-react"

import { PageIdentity } from "@/components/shell/page-identity"
import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { workspaceLabel } from "@/lib/app-context/workspace-label"
import { clubAdminMembershipAt, getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { explainDecision, decisionRemedy, type AccessDecision } from "@/lib/permissions/access-explanation"
import { accessEventSentence } from "@/lib/permissions/access-event-sentence"
import { clubRoleLabel, teamPermissionLabel } from "@/lib/permissions/role-labels"
import { CONFIRMABLE_ROLE_KEY, PENDING_CONFIRMATION_EXPLANATION, additionalRoleDescription, roleKeyLabel } from "@/lib/permissions/role-presentation"
import { createClient } from "@/lib/supabase/server"

import { GROUPS } from "../../club/permissions/groups"
import { AdditionalRoles, type AssignableRole, type HeldRole } from "./additional-roles"
import { TeamAccessEditor } from "./team-access-editor"

export const metadata = { title: "Person Access" }

/**
 * ONE PERSON'S ACCESS, IN ONE PLACE.
 *
 * Step 0 of the convergence programme found that "who has access and why" was
 * answered in five places that never referred to each other: a club role on
 * /people, team roles as inert text on the same row, capability overrides on a
 * separate grid, guardianship on a third page and the Safeguarding Officer
 * appointment on a fourth. None of them could answer the question an
 * administrator actually asks, which is about a PERSON rather than about a
 * mechanism: what can this individual do here, and what put it there?
 *
 * This page answers it, and invents nothing to do so. Every line comes from an
 * authority that already existed and was already granted to `authenticated`:
 * the club role from `club_memberships`, team roles from `team_permissions`,
 * and -- for the first time on any screen -- the WHY from
 * `public.explain_access`, which re-runs `internal.capability_decision`, the
 * same resolver the enforcement path runs. The list of permissions explained is
 * the club permissions catalogue the /club/permissions grid already publishes,
 * imported rather than restated, so the two screens can never disagree about
 * what this club decides.
 *
 * It is not a second permissions store and it holds no rules of its own. Every
 * control on it calls the canonical RPC that owns the change, and the database
 * refuses anything this caller may not do -- hiding a control is never the
 * boundary here.
 */
export default async function PersonAccessPage({ params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  if (!isClubAdminAnywhere(ctx)) redirect("/dashboard")

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // The same scoping rule /people applies, from the same resolver, for the same
  // reason: a session that administers SOME club must never manage a different
  // club's people merely because that membership exists somewhere in it.
  const adminMembership = clubAdminMembershipAt(ctx, activeManageableClubId(ctx, activeContext))
  if (!adminMembership) redirect("/dashboard")
  const clubId = adminMembership.clubId
  const clubName = adminMembership.clubName

  const { data: membership } = await supabase
    .from("club_memberships")
    .select("id, user_id, role, status, created_at, club_id")
    .eq("id", membershipId)
    .maybeSingle()
  // Belt and braces over RLS: the row must belong to the club this session is
  // actually administering, not merely be one RLS would return.
  if (!membership || membership.club_id !== clubId) notFound()
  const isSelfMembership = membership.user_id === user.id

  const [{ data: directory }, { data: teamPerms }, { data: teams }] = await Promise.all([
    supabase.rpc("get_club_member_directory", { p_club_id: clubId }),
    supabase.from("team_permissions").select("id, team_id, permission, teams(display_name)").eq("membership_id", membershipId),
    supabase.from("teams").select("id, display_name").eq("club_id", clubId).eq("active", true).order("display_name"),
  ])

  // EVERY ROLE THIS PERSON HOLDS, from the canonical assignments rather than
  // from the compatibility column on the membership. The club-wide seat
  // (Member / Fixture Secretary / Club Admin) is shown above and is not
  // repeated here; what is left is everything else a person can be.
  // `is_primary_seat` comes from the catalogue, which is also what
  // internal.apply_primary_club_role reads. Naming the three seat roles here
  // instead would put an authority list in a page, and two copies of one rule
  // is how the seat and the additive roles come to disagree.
  const { data: assignmentRows } = await supabase
    .from("role_assignments")
    .select("id, role_key, team_id, confirmation_state, teams(display_name), role_definitions(label, is_primary_seat)")
    .eq("membership_id", membershipId)
    .eq("state", "ACTIVE")

  const heldRoles: HeldRole[] = (assignmentRows ?? [])
    .filter(
      (r) =>
        !((r.role_definitions as unknown as { is_primary_seat: boolean } | null)?.is_primary_seat && r.team_id === null)
    )
    .map((r) => ({
      assignmentId: r.id,
      roleKey: r.role_key,
      roleLabel: roleKeyLabel(r.role_key, (r.role_definitions as unknown as { label: string } | null)?.label ?? null),
      teamName: (r.teams as unknown as { display_name: string } | null)?.display_name ?? null,
      // A Safeguarding Officer appointment is not ended from here: it is
      // confirmed or withdrawn through the appointment that owns it, and
      // offering Remove beside it would suggest otherwise.
      removable: r.role_key !== CONFIRMABLE_ROLE_KEY && !isSelfMembership,
      pendingNote:
        r.role_key === CONFIRMABLE_ROLE_KEY && r.confirmation_state === "PENDING_CONFIRMATION"
          ? PENDING_CONFIRMATION_EXPLANATION
          : null,
    }))
    .sort((a, b) => a.roleLabel.localeCompare(b.roleLabel))

  // What the catalogue says this club may give, minus what is already held and
  // minus the seat roles. Safeguarding Officer is deliberately absent: the
  // database refuses to assign it, because an officer is nominated and accepts.
  const { data: catalogueRoles } = await supabase
    .from("role_definitions")
    .select("role_key, label, scope, assignable_by, is_primary_seat")
    .order("role_key")
  const heldKeys = new Set(heldRoles.map((r) => r.roleKey))
  const assignableRoles: AssignableRole[] = (catalogueRoles ?? [])
    .filter(
      (r) =>
        (r.assignable_by ?? []).includes("CLUB") &&
        r.role_key !== CONFIRMABLE_ROLE_KEY &&
        !r.is_primary_seat &&
        r.scope !== "TEAM" &&
        !heldKeys.has(r.role_key)
    )
    .map((r) => ({
      roleKey: r.role_key,
      label: roleKeyLabel(r.role_key, r.label),
      description: additionalRoleDescription(r.role_key),
    }))

  const profile = (directory ?? []).find((p) => p.user_id === membership.user_id)
  const name = [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || profile?.email || "This person"
  const isSelf = isSelfMembership
  const roleLabel = membership.role ? clubRoleLabel(membership.role) : "No club role recorded"

  const held = (teamPerms ?? [])
    .filter((tp): tp is typeof tp & { id: string; team_id: string; permission: string } =>
      Boolean(tp.id && tp.team_id && tp.permission)
    )
    .map((tp) => ({
      id: tp.id,
      teamId: tp.team_id,
      teamName: (tp.teams as unknown as { display_name: string } | null)?.display_name ?? "Team",
      permissionLabel: teamPermissionLabel(tp.permission),
    }))

  // Every permission this club decides, asked of the DATABASE about this
  // person. Ten questions rather than one batched call because explain_access
  // answers about one capability at a time by design -- it returns the decisive
  // rule, which is a different thing from a yes/no list.
  const catalogue = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))
  const explained = await Promise.all(
    catalogue.map(async (item) => {
      const { data, error } = await supabase.rpc("explain_access", {
        p_subject: membership.user_id,
        p_capability_key: item.key,
        p_scope_type: "club",
        p_club_id: clubId,
      })
      const row = Array.isArray(data) ? data[0] : data
      const decision: AccessDecision | null = row
        ? {
            allowed: Boolean(row.allowed),
            decisiveRule: row.decisive_rule ?? null,
            reasonCode: row.reason_code ?? null,
            decisiveSource: (row.decisive_source as Record<string, unknown> | null) ?? null,
            trail: (row.trail as unknown[]) ?? [],
          }
        : null
      return { item, decision, unavailable: Boolean(error) || !decision }
    })
  )

  const allowedCount = explained.filter((e) => e.decision?.allowed).length

  // HOW IT GOT THIS WAY (Slice 8's club audit timeline).
  //
  // A READ of public.security_events, which internal.refuse_history_rewrite()
  // already makes append-only -- not a second log, because an audit trail is
  // the one thing that can least afford two versions. It is scoped to this club
  // by the RPC and filtered to this person here, and it deliberately carries no
  // ip hash, user agent hash, request id or raw metadata: those are forensic
  // fields for a Site Admin surface, not for a club screen.
  const { data: historyRows } = await supabase.rpc("club_access_history", {
    p_club_id: clubId,
    p_subject_user_id: membership.user_id,
    p_limit: 25,
  })
  const history = (historyRows ?? []).map((h) => ({
    at: h.at,
    what: accessEventSentence(h.event_type, h.capability_key, h.role_key, h.team_name),
    by: h.actor_name,
    reason: h.reason,
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/people" className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:text-forest-950">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Users &amp; Permissions
      </Link>

      <PageIdentity
        workspace={workspaceLabel("club")}
        title={name}
        className="mt-3"
        titleClassName="mt-2"
        descriptionClassName="mt-2 max-w-md"
        description={
          <>
            {profile?.email ? `${profile.email} · ` : ""}
            {roleLabel} at {clubName}
            {isSelf ? " · this is you" : ""}
          </>
        }
      />

      <section className="mt-8" aria-labelledby="person-club-access">
        <h2 id="person-club-access" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          Club Access
        </h2>
        <div className="mt-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
          <p className="text-sm text-ink">
            {roleLabel}
            {membership.status !== "active" && <span className="ml-1.5 text-xs text-ink-muted">({membership.status})</span>}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            The club-wide role. Change it, or remove this person from the club, on the{" "}
            <Link href="/people" className="underline underline-offset-2">
              people list
            </Link>
            .
          </p>
        </div>
      </section>

      <AdditionalRoles
        membershipId={membership.id}
        personName={name}
        held={heldRoles}
        assignable={assignableRoles}
      />

      <TeamAccessEditor
        membershipId={membership.id}
        personName={name}
        held={held}
        teams={(teams ?? []).map((t) => ({ id: t.id, displayName: t.display_name }))}
      />

      <section className="mt-8" aria-labelledby="person-permissions">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="person-permissions" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            What They Can Do
          </h2>
          <p className="text-xs text-ink-muted">
            {allowedCount} of {catalogue.length} allowed
          </p>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Ovalball worked each of these out the same way it does when {name} actually tries to do it, and this is the rule that decided
          each one.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {explained.map(({ item, decision, unavailable }) => (
            <li key={item.key} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink">{item.label}</p>
                <p className={decision?.allowed ? "text-xs font-medium text-forest-800" : "text-xs font-medium text-ink-muted"}>
                  {unavailable ? "Cannot be shown" : decision?.allowed ? "Allowed" : "Not allowed"}
                </p>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {unavailable || !decision
                  ? "Ovalball could not explain this one. Nothing has changed."
                  : explainDecision(name, item.label.toLowerCase(), decision)}
              </p>
              {decision && !unavailable && decisionRemedy(decision) && (
                <p className="mt-0.5 text-xs text-ink-muted">{decisionRemedy(decision)}</p>
              )}
            </li>
          ))}
        </ul>
        <Link
          href="/club/permissions"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 bg-white px-4 text-sm font-semibold text-ink hover:border-ink/35"
        >
          <KeyRound aria-hidden="true" className="size-4" />
          Change Permissions
        </Link>
      </section>

      <section className="mt-8" aria-labelledby="person-history">
        <h2 id="person-history" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          How It Got This Way
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Every change to {name}&rsquo;s access at {clubName}, most recent first, and who made it.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {history.length === 0 && (
            <li className="rounded-lg border border-dashed border-ink/15 px-4 py-3 text-sm text-ink-muted">
              Nothing recorded yet.
            </li>
          )}
          {history.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm text-ink">{entry.what}</p>
                <p className="text-xs text-ink-muted">
                  <time dateTime={entry.at}>
                    {new Date(entry.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </time>
                </p>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">
                {[`by ${entry.by}`, entry.reason].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
