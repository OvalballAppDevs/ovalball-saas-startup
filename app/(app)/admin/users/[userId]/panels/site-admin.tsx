import { changeSiteAdminProfile, requestSiteAdminGrant } from "../master-control"
import { MasterControlAction } from "../master-control-action"
import { SiteAdminControl } from "../site-admin-control"
import { ADMIN_PROFILES } from "../../../site-admins/profiles"

export interface GrantRequestRow {
  id: string
  profileKey: string
  state: string
  reason: string
  createdAt: string
  expiresAt: string
  requestedByName: string
}

/**
 * SLICE 7e -- tab 10, and the UI half of S7-8.
 *
 * Slice 7c built the two-administrator rule completely: a request table with the
 * full state machine, a requester-is-not-decider constraint, a decider-is-not-
 * target constraint, expiry, and five RPCs. It was recorded as IMPLEMENTED — NOT
 * ENFORCED for one reason: nothing in the product could raise a request or
 * approve one, so the only way to make somebody a Site Admin was the older
 * invitation path, and the rule guarded a door nobody used.
 *
 * Raising is here, on the subject's own record, because that is where you are
 * when you decide somebody should have it. DECIDING is deliberately not here: a
 * person's own record is not the page on which their own elevation is approved,
 * and putting both on one screen would invite the two clicks to be the same
 * administrator's. The queue lives on Site Admin Management, and the RPC refuses
 * the requester and the target regardless of which screen asks.
 */
export function SiteAdminPanel({
  userId,
  userName,
  isSelf,
  holdsSiteAdmin,
  currentProfileKey,
  requests,
  canManageAdmins,
}: {
  userId: string
  userName: string
  isSelf: boolean
  holdsSiteAdmin: boolean
  currentProfileKey: string | null
  requests: GrantRequestRow[]
  canManageAdmins: boolean
}) {
  const profileOptions = ADMIN_PROFILES.map((p) => ({ value: p.profileKey, label: p.label }))
  const pending = requests.filter((r) => r.state === "PENDING")

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SiteAdminControl userId={userId} holdsSiteAdmin={holdsSiteAdmin} isSelf={isSelf} />
      </section>

      {pending.length > 0 && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Waiting On A Second Administrator</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {pending.map((request) => (
              <li key={request.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <p className="text-sm font-medium text-ink">
                  {ADMIN_PROFILES.find((p) => p.profileKey === request.profileKey)?.label ?? request.profileKey}
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  Asked for by {request.requestedByName} on {formatDate(request.createdAt)} &middot; runs out{" "}
                  {formatDate(request.expiresAt)}
                </p>
                <p className="mt-1 text-sm text-ink/70">{request.reason}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  Somebody other than {request.requestedByName} and {userName} approves this on Site Admin Management.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManageAdmins && !isSelf && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            {holdsSiteAdmin ? "Change Their Profile" : "Ask For Site Admin"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            {holdsSiteAdmin
              ? "A move down or sideways is a reduction and one administrator may do it. A move up to Full Site Admin needs a second, because it grants the authority the rule exists to protect."
              : "Raising this grants nothing. A second administrator — not you, and not this person — approves it on Site Admin Management, and it runs out in 72 hours if nobody does."}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {holdsSiteAdmin && (
              <MasterControlAction
                label="Change Site Admin Profile"
                confirmLabel="Change Profile"
                description={`Moves ${userName} between Site Admin profiles. Currently ${
                  ADMIN_PROFILES.find((p) => p.profileKey === currentProfileKey)?.label ?? "unrecorded"
                }.`}
                placeholder="Moving to Read-Only while they hand over the fixtures work."
                fields={[{ name: "profileKey", label: "Profile", kind: "select", options: profileOptions }]}
                perform={changeSiteAdminProfile.bind(null, userId)}
              />
            )}
            <MasterControlAction
              label="Ask For Site Admin Access"
              confirmLabel="Raise Request"
              description={`Raises a pending request for ${userName}. It grants nothing until a second administrator approves it.`}
              placeholder="Taking over platform support from October; agreed with the board on 2 September."
              fields={[{ name: "profileKey", label: "Profile being asked for", kind: "select", options: profileOptions }]}
              perform={requestSiteAdminGrant.bind(null, userId)}
            />
          </div>
        </section>
      )}

      {isSelf && (
        <p className="text-sm text-ink-muted">
          You cannot raise, approve or change your own Site Admin access. Every one of those refusals is in the database,
          not only on this screen.
        </p>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
