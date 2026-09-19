import { addClubMembership, transitionClubMembership } from "../master-control"
import { MasterControlAction } from "../master-control-action"
import { MembershipCard } from "../membership-card"
import type { MembershipSummary } from "../../types"

/**
 * SLICE 7e -- tab 4. The cards were already here. What was missing is the pair
 * of RPCs that put somebody into a club without an invitation and move a
 * membership between states: master control's whole reason for existing is the
 * case the ordinary journey cannot reach, and neither had a control.
 *
 * A Site Admin suspension is recorded at SITE level on purpose, so a club cannot
 * quietly lift it afterwards. The wording says so, because an administrator who
 * does not know that will use the wrong one.
 */
export function ClubMembershipsPanel({
  userId,
  userName,
  memberships,
  clubs,
  canManageMemberships,
}: {
  userId: string
  userName: string
  memberships: MembershipSummary[]
  clubs: { id: string; name: string }[]
  canManageMemberships: boolean
}) {
  const clubOptions = clubs.map((c) => ({ value: c.id, label: c.name }))

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Club Memberships</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Ovalball access, real-world club role, and team scope are three separate things &mdash; each shown and
          edited on its own.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {memberships.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
              No club memberships.
            </p>
          ) : (
            memberships.map((m) => (
              <div key={m.membershipId} className="flex flex-col gap-2">
                <MembershipCard
                  userId={userId}
                  userName={userName}
                  membership={m}
                  canReadmit={!memberships.some((other) => other.clubId === m.clubId && other.status === "active")}
                />
                {canManageMemberships && (
                  <MasterControlAction
                    label={`Change This Membership — ${m.clubName}`}
                    confirmLabel="Apply Change"
                    description={`Moves ${userName}'s membership of ${m.clubName} to a different state. A suspension applied here is recorded at site level, so ${m.clubName} cannot lift it themselves.`}
                    placeholder="Suspended at the club's request while a safeguarding matter is reviewed."
                    fields={[
                      {
                        name: "toState",
                        label: "New State",
                        kind: "select",
                        options: [
                          { value: "ACTIVE", label: "Active" },
                          { value: "SUSPENDED", label: "Suspended" },
                          { value: "REVOKED", label: "Revoked" },
                        ],
                      },
                    ]}
                    perform={transitionClubMembership.bind(null, userId, m.membershipId)}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {canManageMemberships && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Add a Membership</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Puts {userName} into a club with no invitation and no pre-existing relationship. That is what master
            control is for, and it is why this is audited with a reason.
          </p>
          <div className="mt-3">
            <MasterControlAction
              label="Add to a Club"
              confirmLabel="Add Membership"
              description={`Creates an active membership for ${userName}. It grants no role by itself — give one on the Club Roles tab.`}
              placeholder="Rejoining after their previous membership was revoked in error."
              fields={[{ name: "clubId", label: "Club", kind: "select", options: clubOptions }]}
              perform={addClubMembership.bind(null, userId)}
            />
          </div>
        </section>
      )}
    </div>
  )
}
