import { assignClubRole, revokeRoleAssignment } from "../master-control"
import { MasterControlAction } from "../master-control-action"

export interface RoleAssignmentRow {
  id: string
  roleKey: string
  roleLabel: string
  clubName: string
  teamName: string | null
  state: string
  confirmationState: string | null
  grantedAt: string
}

/**
 * SLICE 7e -- tab 5. Both RPCs behind this existed and neither had a caller, so
 * the only way a Site Admin could give or take a club role was through the club's
 * own screens as if they were the club, which is exactly the shortcut Slice 7
 * removed.
 *
 * Two things are worth saying out loud on this tab rather than in a comment.
 * A Safeguarding Officer is appointed by nomination and acceptance, not assigned
 * -- `internal.grant_role` refuses it and the refusal reaches the screen. And the
 * last-Club-Admin guard is a separate, explicit tick rather than something the
 * revoke silently overrides, because leaving a club with nobody who can
 * administer it should cost a deliberate action and a sentence.
 */
export function ClubRolesPanel({
  userId,
  userName,
  assignments,
  clubs,
  roles,
  canManageRoles,
}: {
  userId: string
  userName: string
  assignments: RoleAssignmentRow[]
  clubs: { id: string; name: string }[]
  roles: { key: string; label: string }[]
  canManageRoles: boolean
}) {
  const live = assignments.filter((a) => a.state === "ACTIVE" || a.state === "SUSPENDED")
  const past = assignments.filter((a) => a.state !== "ACTIVE" && a.state !== "SUSPENDED")

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Roles Held</h2>
        {live.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
            {userName} holds no club roles.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {live.map((a) => (
              <li key={a.id} className="rounded-lg border border-ink/10 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink">{a.roleLabel}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {a.clubName}
                      {a.teamName ? ` · ${a.teamName}` : ""}
                    </p>
                    {a.state === "SUSPENDED" && <p className="mt-1 text-sm text-destructive-text">Suspended</p>}
                    {a.confirmationState === "PENDING_CONFIRMATION" && (
                      <p className="mt-1 text-sm text-amber-700">Pending confirmation &mdash; grants nothing yet</p>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted">Given {formatDate(a.grantedAt)}</p>
                </div>
                {canManageRoles && (
                  <div className="mt-3">
                    <MasterControlAction
                      label="Take This Role Away"
                      confirmLabel="Revoke Role"
                      tone="destructive"
                      description={`Revokes ${a.roleLabel} at ${a.clubName} through the canonical transition, so every rule that applies when a club does it still applies here.`}
                      placeholder="Stepped down from the committee at the end of the season."
                      fields={[
                        {
                          name: "allowNoClubAdmin",
                          label: "Allow this to leave the club with no Club Admin",
                          kind: "checkbox",
                          hint: "Only tick this if the club genuinely has no replacement yet. It is recorded either way.",
                        },
                      ]}
                      perform={revokeRoleAssignment.bind(null, userId, a.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageRoles && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Give a Role</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            The membership is created if there is none. Every canonical rule still applies: a role with an age
            prohibition is refused, and a role needing a date of birth is refused without one. Safeguarding Officer is
            not on the list because it is appointed by nomination and acceptance, never assigned &mdash; that happens
            on the club&rsquo;s own Safeguarding page.
          </p>
          <div className="mt-3">
            <MasterControlAction
              label="Give a Club Role"
              confirmLabel="Give Role"
              description={`Gives ${userName} a role at a club on site authority.`}
              placeholder="Appointed by the committee on 3 September; their own admin could not do it."
              fields={[
                { name: "clubId", label: "Club", kind: "select", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
                { name: "roleKey", label: "Role", kind: "select", options: roles.map((r) => ({ value: r.key, label: r.label })) },
              ]}
              perform={assignClubRole.bind(null, userId)}
            />
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">No Longer Held</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {past.map((a) => (
              <li key={a.id} className="rounded-lg border border-ink/10 bg-white/60 px-4 py-3 text-sm text-ink-muted">
                {a.roleLabel} &middot; {a.clubName} &middot; {a.state.toLowerCase()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
