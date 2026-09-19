import { resendAccountSetup, revokeInvitation } from "../master-control"
import { MasterControlAction } from "../master-control-action"

export interface InvitationRow {
  id: string
  kind: string
  state: string
  clubName: string | null
  expiresAt: string | null
  createdAt: string
  resendCount: number
  intendedOutcome: string | null
}

const KIND_LABEL: Record<string, string> = {
  SITE_ADMIN: "Site Admin",
  ACCOUNT_SETUP: "Account setup",
  CLUB_STAFF: "Club staff",
  SAFEGUARDING_OFFICER: "Safeguarding Officer",
  GUARDIAN: "Guardian",
  PLAYER_ACCOUNT: "Player account",
  CLUB_REFERRAL: "Club referral",
  TEAM_JOIN_CODE: "Team join code",
}

/**
 * SLICE 7e -- tab 9, the second of the three the reconciliation named as not
 * existing in any form.
 *
 * Step 3 gave clubs a way to see and withdraw their own pending invitations.
 * Site Admin had none: `site_revoke_invitation` and `site_resend_account_setup`
 * were both built and granted and neither had a button, so an invitation issued
 * to the wrong address could be withdrawn by the club that sent it and not by the
 * platform.
 *
 * AN-8 is why nothing here shows a token, a link or a code, not even after a
 * resend. A setup credential is shown once, at the moment it is created, to the
 * person creating it. Rotating one from this screen tells you that it happened
 * and nothing more.
 */
export function InvitationsPanel({
  userId,
  userName,
  invitations,
  canManageInvitations,
}: {
  userId: string
  userName: string
  invitations: InvitationRow[]
  canManageInvitations: boolean
}) {
  const live = invitations.filter((i) => i.state === "ISSUED")
  const settled = invitations.filter((i) => i.state !== "ISSUED")

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Waiting To Be Accepted</h2>
        {live.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-6 text-center text-sm text-ink-muted">
            Nothing is outstanding for {userName}.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {live.map((invitation) => (
              <li key={invitation.id} className="rounded-lg border border-ink/10 bg-white p-4">
                <p className="text-sm font-medium text-ink">{KIND_LABEL[invitation.kind] ?? invitation.kind}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {invitation.clubName ? `${invitation.clubName} · ` : ""}
                  sent {formatDate(invitation.createdAt)}
                  {invitation.expiresAt ? ` · runs out ${formatDate(invitation.expiresAt)}` : ""}
                  {invitation.resendCount > 0 ? ` · reissued ${invitation.resendCount === 1 ? "once" : `${invitation.resendCount} times`}` : ""}
                </p>
                {canManageInvitations && (
                  <div className="mt-3">
                    <MasterControlAction
                      label="Withdraw This Invitation"
                      confirmLabel="Withdraw"
                      tone="destructive"
                      description="Withdraws it through the canonical revocation, which re-decides authority for itself. The link and the code stop working immediately."
                      placeholder="Sent to an address that turned out to belong to somebody else."
                      perform={revokeInvitation.bind(null, userId, invitation.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageInvitations && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Account Setup</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Reissuing revokes any live setup invitation before creating the next one. Two live setup links for one
            person is two ways in, and the older one is the one nobody is watching. The new credential is sent to{" "}
            {userName} and is never shown here.
          </p>
          <div className="mt-3">
            <MasterControlAction
              label="Send a Fresh Setup Invitation"
              confirmLabel="Reissue Setup"
              description="Rotates the account-setup invitation. You will not see the link or the code — by design."
              placeholder="They never received the first one; their club confirmed the address is right."
              perform={resendAccountSetup.bind(null, userId)}
            />
          </div>
        </section>
      )}

      {settled.length > 0 && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Settled</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {settled.map((invitation) => (
              <li key={invitation.id} className="rounded-lg border border-ink/10 bg-white/60 px-4 py-3 text-sm text-ink-muted">
                {KIND_LABEL[invitation.kind] ?? invitation.kind} &middot; {invitation.state.toLowerCase()} &middot;{" "}
                {formatDate(invitation.createdAt)}
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
