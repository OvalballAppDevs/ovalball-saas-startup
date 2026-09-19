import { AccountStatusControl } from "../account-status-control"
import { forcePasswordReset, revokeSessions } from "../master-control"
import { MasterControlAction } from "../master-control-action"

/**
 * SLICE 7e -- tab 3. Account state was already here; the two security actions
 * were not, and they are the ones somebody reaches for at the worst moment.
 *
 * `site_revoke_sessions` and `site_force_password_reset` were both built, both
 * granted, both fully specified, and neither had a button. An account reported
 * as compromised could be suspended -- which blocks protected actions but leaves
 * the session alive -- and could not be signed out.
 */
export function AccountSecurityPanel({
  userId,
  userName,
  isSelf,
  status,
  canManageSecurity,
}: {
  userId: string
  userName: string
  isSelf: boolean
  status: "active" | "suspended" | "disabled"
  canManageSecurity: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Account Status</h2>
        <div className="mt-3">
          <AccountStatusControl userId={userId} userName={userName} status={status} isSelf={isSelf} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Sessions & Password</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Suspending an account blocks what it can do; it does not end the session it is already in. These two do.
        </p>

        {isSelf ? (
          <p className="mt-3 text-sm text-ink-muted">
            These act on someone else&rsquo;s account. Sign yourself out, or change your own password, from Account
            &rsaquo; Security.
          </p>
        ) : !canManageSecurity ? (
          <p className="mt-3 text-sm text-ink-muted">
            Ending sessions and requiring a password reset need <code className="text-xs">site.users.security.manage</code>,
            which your Site Admin profile does not hold.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <MasterControlAction
              label="End All Sessions"
              confirmLabel="End Every Session"
              tone="destructive"
              description={`Signs ${userName} out of every device immediately. They can sign in again straight away — this ends access, it does not remove it.`}
              placeholder="The member reported their laptop was stolen this morning."
              perform={revokeSessions.bind(null, userId)}
            />
            <MasterControlAction
              label="Require a Password Reset"
              confirmLabel="Require a Reset"
              tone="destructive"
              description={`Ends ${userName}'s sessions and marks the account as needing a new password, which they set themselves through recovery. Nobody at Ovalball sees, sets or chooses it.`}
              placeholder="Their password was shared in a club WhatsApp group."
              perform={forcePasswordReset.bind(null, userId)}
            />
          </div>
        )}
      </section>
    </div>
  )
}
