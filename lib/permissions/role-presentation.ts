/**
 * HOW A CANONICAL ROLE ASSIGNMENT IS WORDED FOR A PERSON.
 *
 * `public.role_definitions` is the catalogue, and its `label` is the default
 * answer -- this file does not replace it and is not a second catalogue. It
 * exists for the two places where the catalogue's own wording does not carry
 * what the product needs to say, and it says so explicitly rather than silently
 * shadowing the whole list.
 *
 * ONE: the catalogue spells the club's fixtures role "Fixtures Secretary" while
 * every other surface in Ovalball -- the people list, the person page, the role
 * select, `lib/permissions/role-labels.ts` -- says "Fixture Secretary". Two
 * spellings of one role is exactly the drift this programme exists to remove,
 * and correcting the catalogue is a migration and a product decision rather than
 * a presentation fix. So the established product term is mapped here and the
 * catalogue is left alone; the underlying naming inconsistency (the key itself
 * is `FIXTURES_SECRETARY` in `role_definitions` and `FIXTURE_SECRETARY` in
 * `club_memberships` and `role_capability_defaults`) is recorded in the
 * convergence ledger for its schema owner. This creates no second role identity:
 * the key is untouched and nothing authorises off this string.
 *
 * TWO: a Safeguarding Officer appointment has a state, and the label has to
 * carry it. A nomination sits in PENDING_CONFIRMATION until Ovalball confirms it
 * (AN-6) and confers ZERO Safeguarding Officer authority in the meantime.
 * Captioning that person plainly "Safeguarding Officer" tells a club the
 * appointment is settled when it is not, which is the defect this closes.
 *
 * Nothing here decides anything. The state is read from the canonical
 * assignment; this only chooses the words for it.
 */

/** Only the keys whose catalogue wording disagrees with the product's. */
const PRODUCT_TERM: Record<string, string> = {
  FIXTURES_SECRETARY: "Fixture Secretary",
}

/** The one role whose appointment is not settled by being granted. */
export const CONFIRMABLE_ROLE_KEY = "SAFEGUARDING_OFFICER"

export function roleKeyLabel(roleKey: string, catalogueLabel?: string | null): string {
  return PRODUCT_TERM[roleKey] ?? catalogueLabel ?? roleKey
}

/**
 * The label a person's role assignment is shown under, carrying its
 * confirmation state where it has one.
 *
 * `confirmationState` is `role_assignments.confirmation_state`: PENDING_CONFIRMATION
 * or CONFIRMED for a Safeguarding Officer, and null for every other role, which
 * is a CHECK constraint rather than a convention.
 */
export function roleAssignmentLabel(
  roleKey: string,
  catalogueLabel?: string | null,
  confirmationState?: string | null
): string {
  const base = roleKeyLabel(roleKey, catalogueLabel)
  return confirmationState === "PENDING_CONFIRMATION" ? `${base} — Pending confirmation` : base
}

/** Whether this assignment is waiting on Ovalball, and therefore confers nothing yet. */
export function isAwaitingConfirmation(confirmationState?: string | null): boolean {
  return confirmationState === "PENDING_CONFIRMATION"
}

/**
 * The sentence shown beside a pending appointment. One wording, so the club
 * settings page and any access surface cannot describe the same state
 * differently -- which is precisely what they were doing.
 */
export const PENDING_CONFIRMATION_EXPLANATION =
  "Nominated by the club and waiting for Ovalball to confirm the appointment. Until it is confirmed they hold no Safeguarding Officer authority."

/**
 * What a club is told an additional role means, in the moment they are choosing it.
 *
 * Presentation only, in the file that already owns role wording, so that a
 * page does not carry a role name of its own. An unrecognised role gets the
 * general sentence rather than a guess about what it confers -- the capability
 * engine decides that, and this is only the caption on a select.
 */
export function additionalRoleDescription(roleKey: string): string {
  if (roleKey === "VOLUNTEER") {
    return "Helps out across the club. Read-only until you allow something on the permissions screen."
  }
  return "A club-wide role from Ovalball's role catalogue."
}
