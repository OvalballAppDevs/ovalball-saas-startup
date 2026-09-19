import { endGuardianRelationship, linkGuardian } from "../master-control"
import { MasterControlAction } from "../master-control-action"
import { FamilyRelationshipsPanel, type FamilyRelationshipRow } from "../family-relationships-panel"
import { HistoryPanel, type HistoryEntry } from "./history"

export interface GuardianLink {
  id: string
  playerId: string
  childName: string
  relationshipType: string
  state: string
}

/**
 * SLICE 7e -- tab 7. The existing panel could hold and release a relationship;
 * it could not create one, and it could not end one.
 *
 * Creating a family link on site authority is for the case the family cannot
 * repair themselves -- a guardian whose account was merged, a child whose only
 * parent lost their email. The RPC refuses CLUB_VERIFIED outright: a Site Admin
 * attests their own check as SITE_VERIFIED, or records UNVERIFIED. Asserting
 * that a club verified something it never saw is the one thing this control must
 * not be able to do, and so it cannot.
 *
 * Ending a relationship revokes it and never deletes it. The record that the
 * link existed is safeguarding evidence, and safeguarding evidence does not get
 * tidied away because a relationship ended.
 */
export function FamilyPanel({
  userId,
  userName,
  rows,
  links,
  players,
  history,
  canManageFamily,
}: {
  userId: string
  userName: string
  rows: FamilyRelationshipRow[]
  links: GuardianLink[]
  players: { id: string; name: string }[]
  history: HistoryEntry[]
  canManageFamily: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Family Relationships</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Children {userName} is a parent or guardian of. A hold stops everything the relationship allows until it is
          lifted.
        </p>
        <div className="mt-3">
          <FamilyRelationshipsPanel userId={userId} rows={rows} />
        </div>
      </section>

      {canManageFamily && links.length > 0 && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">End a Relationship</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Revokes the link. The record that it existed is kept &mdash; that is safeguarding evidence, not clutter.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {links.map((link) => (
              <MasterControlAction
                key={link.id}
                label={`End the Link to ${link.childName}`}
                confirmLabel="End Relationship"
                tone="destructive"
                description={`Revokes ${userName}'s ${link.relationshipType} relationship with ${link.childName}. Everything it allowed stops immediately.`}
                placeholder="Court order dated 12 August removes parental responsibility."
                perform={endGuardianRelationship.bind(null, userId, link.id)}
              />
            ))}
          </div>
        </section>
      )}

      {canManageFamily && (
        <section>
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Record a Relationship</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            For a family link the family cannot make themselves. You are recording who checked, not only that somebody
            did &mdash; so you may attest your own check, or record that none has happened. You cannot record that a
            club verified it.
          </p>
          <div className="mt-3">
            <MasterControlAction
              label="Record a Family Link"
              confirmLabel="Record Link"
              description={`Creates an active guardian relationship for ${userName}, sourced as a Site Admin assignment.`}
              placeholder="Birth certificate seen at head office on 14 May; the club could not verify it."
              fields={[
                { name: "playerId", label: "Child", kind: "select", options: players.map((p) => ({ value: p.id, label: p.name })) },
                {
                  name: "relationshipType",
                  label: "Relationship",
                  kind: "select",
                  options: [
                    { value: "parent", label: "Parent" },
                    { value: "guardian", label: "Guardian" },
                    { value: "carer", label: "Carer" },
                    { value: "other_with_parental_responsibility", label: "Other with parental responsibility" },
                  ],
                },
                {
                  name: "verificationState",
                  label: "What you are attesting",
                  kind: "select",
                  hint: "A club's verification is the club's to record, and is not offered here.",
                  options: [
                    { value: "SITE_VERIFIED", label: "I have verified this myself" },
                    { value: "UNVERIFIED", label: "Not verified — recording it only" },
                  ],
                },
              ]}
              perform={linkGuardian.bind(null, userId)}
            />
          </div>
        </section>
      )}

      {/*
        The one provenance timeline that is not its own tab. A safeguarding
        question is never "what is the relationship" and separately "who decided
        it" -- it is both at once, so they are read together here.
      */}
      <HistoryPanel
        title="How These Came About"
        explanation={`Every family decision recorded against ${userName}: who linked, held, released or ended a relationship, and why. Append-only — nothing on this list can be edited or removed, including by this screen.`}
        entries={history}
        emptyLine="Nothing has been recorded against this person's family relationships."
      />
    </div>
  )
}
