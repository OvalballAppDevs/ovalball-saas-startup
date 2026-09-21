import { notFound } from "next/navigation"
import { MailPlus, Users } from "lucide-react"

import { GoverningEmpty, GoverningPageHeader, GoverningSection } from "@/components/governing/workspace"
import {
  BODY_ROLE_ALLOWS,
  BODY_ROLE_LABEL,
  BODY_ROLES,
  loadBodyInvitations,
  loadBodyPeople,
  loadGoverningBody,
  type BodyRole,
} from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

import { InviteOfficer, PendingInvitation, RevokeAccess } from "./access-controls"

export const metadata = { title: "People & Access" }

/**
 * CONVERGENCE STEP 15 — WHO CAN ACT FOR THIS ORGANISATION.
 *
 * NOT USERS & PERMISSIONS V2. This is one relationship — `constituent_body_roles` — with three roles
 * and one grant path, presented in the shape the canonical Users & Permissions product already uses: the
 * person, what they hold, and what that actually allows, in that order.
 *
 * NO UI-ONLY TITLES. The three roles on this page are the three the database enforces, and the sentence
 * under each is a description of `internal.can_manage_body` and
 * `internal.can_manage_body_competitions` rather than a promise made in a component. Inventing a
 * fourth, nicer-sounding role here would create authority that does not exist.
 *
 * WHY AN EMAIL ADDRESS IS SOMETIMES MISSING: the reader returns it only to somebody who can already
 * manage access, because that is the only job it is needed for — telling two people with the same name
 * apart before removing one. A Viewer sees names and roles.
 */
export default async function GoverningBodyPeoplePage({ params }: { params: Promise<{ bodyId: string }> }) {
  const { bodyId } = await params
  const supabase = await createClient()
  const body = await loadGoverningBody(supabase, bodyId)
  if (!body) notFound()
  const [people, invitations] = await Promise.all([loadBodyPeople(supabase, bodyId), loadBodyInvitations(supabase, bodyId)])

  const heldRoles = Array.from(new Set(people.map((p) => p.roleKey))) as BodyRole[]

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <GoverningPageHeader
        body={body}
        title="People & Access"
        description={
          body.canManage
            ? "Who can act for this organisation, what each of them may do, and who has been invited."
            : "Who can act for this organisation. Only an administrator here can change it."
        }
        action={body.canManage ? <InviteOfficer bodyId={bodyId} /> : undefined}
      />

      <GoverningSection
        id="gb-people-list"
        title="Who Has Access"
        icon={<Users className="size-4 text-ink-muted" aria-hidden="true" />}
        count={`${people.length} ${people.length === 1 ? "person" : "people"}`}
      >
        {people.length === 0 ? (
          <GoverningEmpty>
            Nobody has access to this organisation yet.
            {body.canManage ? " Invite somebody with their email address — they do not need an Ovalball account yet." : ""}
          </GoverningEmpty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {p.fullName ?? p.email ?? "A person with no name recorded"}
                    {p.isMe && <span className="ml-2 text-xs font-normal text-ink-muted">(you)</span>}
                  </p>
                  {p.email && p.fullName && <p className="text-xs text-ink-muted">{p.email}</p>}
                  <p className="mt-1 text-sm text-ink">
                    {BODY_ROLE_LABEL[p.roleKey]}
                    {/* SUSPENDED IS NOT ACTIVE, and the page must not let it read as though it were: the
                        capability predicates only recognise an ACTIVE row. */}
                    {p.state !== "ACTIVE" && (
                      <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                        {p.state === "SUSPENDED" ? "Suspended" : p.state}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">{BODY_ROLE_ALLOWS[p.roleKey]}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Access given {new Date(p.grantedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    {p.grantedByName ? ` by ${p.grantedByName}` : ""}
                  </p>
                </div>
                {/* A person cannot remove their own access, so they are not offered a control that will
                    refuse them. The database refuses it too -- this is not the boundary. */}
                {body.canManage && !p.isMe && <RevokeAccess bodyId={bodyId} person={p} />}
              </li>
            ))}
          </ul>
        )}
      </GoverningSection>

      {/* INVITATIONS STILL WAITING. Separate from the people list on purpose: somebody who has been
          invited is NOT somebody who has access, and showing them together would read as though they
          were. They appear here until they accept, and then they move to the list above. */}
      {invitations.length > 0 && (
        <GoverningSection
          id="gb-invited"
          title="Invited, Not Yet Accepted"
          icon={<MailPlus className="size-4 text-ink-muted" aria-hidden="true" />}
          count={`${invitations.length} waiting`}
        >
          <ul className="flex flex-col divide-y divide-line">
            {invitations.map((i) => (
              <li key={i.invitationId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{i.invitedEmail}</p>
                  <p className="mt-0.5 text-sm text-ink">{BODY_ROLE_LABEL[i.roleKey]}</p>
                  <p className="text-xs text-ink-muted">
                    Invited{" "}
                    {new Date(i.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                    {i.issuedByName ? ` by ${i.issuedByName}` : ""} · expires{" "}
                    {new Date(i.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                    {i.resendCount > 0 ? ` · sent again ${i.resendCount === 1 ? "once" : `${i.resendCount} times`}` : ""}
                  </p>
                </div>
                {i.canAdminister && <PendingInvitation bodyId={bodyId} invitation={i} />}
              </li>
            ))}
          </ul>
        </GoverningSection>
      )}

      {/* WHAT THE ROLES MEAN, whether or not anybody holds them yet. Somebody about to give access needs
          to be able to read this before they choose, not after. */}
      <GoverningSection id="gb-roles" title="What Each Role Allows">
        <dl className="flex flex-col gap-2">
          {[...BODY_ROLES].reverse().map((r) => (
            <div key={r} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="shrink-0 text-sm font-medium text-ink sm:w-52">
                {BODY_ROLE_LABEL[r]}
                {heldRoles.includes(r) && <span className="ml-1.5 text-xs font-normal text-ink-muted">in use</span>}
              </dt>
              <dd className="text-sm text-ink-muted">{BODY_ROLE_ALLOWS[r]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-ink-muted">
          None of these roles gives access to a club&apos;s members, players, dates of birth, medical information or
          safeguarding records. Access to this organisation is access to the organisation.
        </p>
      </GoverningSection>

      {body.canManage && (
        <section aria-labelledby="gb-invite-note" className="rounded-2xl border border-dashed border-line px-4 py-3">
          <h2 id="gb-invite-note" className="text-sm font-medium text-ink">
            How an Invitation Reaches Them
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            An invitation gives you a link to send however this organisation normally talks to its volunteers.
            Ovalball does not email governing-body invitations yet, so it does not claim to — but the invitation
            itself is the real thing: it expires, it can be withdrawn or sent again, it can only be used once, and
            it can only be accepted by the address it was made out to. Forwarding the link to somebody else does
            not give them access.
          </p>
        </section>
      )}
    </div>
  )
}
