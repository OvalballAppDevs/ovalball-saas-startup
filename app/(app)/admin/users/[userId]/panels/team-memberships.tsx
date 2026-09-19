import { assignTeamRole, setPlayerTeamMembership } from "../master-control"
import { MasterControlAction } from "../master-control-action"
import type { RoleAssignmentRow } from "./club-roles"

export interface PlayerPlacement {
  membershipId: string
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  clubName: string
  status: string
  joinedAt: string | null
}

/**
 * SLICE 7e -- tab 6, one of the three the reconciliation named as not existing
 * in any form.
 *
 * It carries two different things that both mean "team membership" and are not
 * the same, so the tab shows them separately rather than merging them into one
 * misleading list: a STAFF role held for a team (Coach, Team Manager), and a
 * PLAYER's place on a team's roster.
 *
 * The player half needed a read that did not exist. Site Admin could already
 * change a placement through site_set_player_team_membership but could not see
 * one, because the roster's RLS answers to team.roster.view at team scope and a
 * platform administrator holds no such thing. Rather than widen that policy --
 * which would hand every roster to every administrator with any site read
 * capability -- Slice 7e added one narrow per-person definer read. Governing-body
 * rules still bind: the RPC calls internal.assert_player_team_pathway_compatible
 * on an add, so an age grade or pathway the RFU refuses is refused here too.
 */
export function TeamMembershipsPanel({
  userId,
  userName,
  teamRoles,
  placements,
  teams,
  teamRoleOptions,
  canManageTeamRoles,
}: {
  userId: string
  userName: string
  teamRoles: RoleAssignmentRow[]
  placements: PlayerPlacement[]
  teams: { id: string; name: string; clubName: string }[]
  teamRoleOptions: { key: string; label: string }[]
  canManageTeamRoles: boolean
}) {
  const teamOptions = teams.map((t) => ({ value: t.id, label: `${t.clubName} — ${t.name}` }))
  const playerOptions = [...new Map(placements.map((p) => [p.playerId, p])).values()].map((p) => ({
    value: p.playerId,
    label: p.playerName,
  }))

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Team Staff Roles</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Roles {userName} holds for a specific team. A team role hangs from a club membership; giving one creates the
          membership if there is none.
        </p>
        {teamRoles.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
            No team roles.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {teamRoles.map((role) => (
              <li key={role.id} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                <p className="text-sm font-medium text-ink">{role.roleLabel}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {role.teamName ?? "(team not named)"} &middot; {role.clubName}
                  {role.state !== "ACTIVE" ? ` · ${role.state.toLowerCase()}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canManageTeamRoles && (
          <div className="mt-3">
            <MasterControlAction
              label="Give a Team Role"
              confirmLabel="Give Team Role"
              description={`Appoints ${userName} to a team role. Where there is no club membership, one is created first — a team role cannot exist without one.`}
              placeholder="Taking over U14s coaching from this weekend; their Club Admin is away."
              fields={[
                { name: "teamId", label: "Team", kind: "select", options: teamOptions },
                {
                  name: "roleKey",
                  label: "Role",
                  kind: "select",
                  options: teamRoleOptions.map((r) => ({ value: r.key, label: r.label })),
                },
              ]}
              perform={assignTeamRole.bind(null, userId)}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Player Placements</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Where {userName}&rsquo;s own player record, or a child they are a guardian of, is placed. This is a roster
          place, not a role.
        </p>
        {placements.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
            No player placements.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {placements.map((p) => (
              <li key={p.membershipId} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                <p className="text-sm font-medium text-ink">{p.playerName}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {p.teamName} &middot; {p.clubName} &middot; {p.status.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canManageTeamRoles && playerOptions.length > 0 && (
          <div className="mt-3">
            <MasterControlAction
              label="Change a Player Placement"
              confirmLabel="Apply Placement"
              description="Adds, ends or moves a place on a team's roster. The governing body's age-grade and pathway rules are checked on an add and are not waived by platform authority."
              placeholder="Moving up an age grade a week early, agreed with both coaches."
              fields={[
                { name: "playerId", label: "Player", kind: "select", options: playerOptions },
                { name: "teamId", label: "Team", kind: "select", options: teamOptions },
                {
                  name: "action",
                  label: "What to do",
                  kind: "select",
                  options: [
                    { value: "add", label: "Add to this team" },
                    { value: "end", label: "End their place in this team" },
                    { value: "move", label: "Move them to this team" },
                  ],
                },
              ]}
              perform={setPlayerTeamMembership.bind(null, userId)}
            />
          </div>
        )}
      </section>
    </div>
  )
}
