export type RugbyCode = "union" | "league"

export const COUNTRY_OPTIONS = [
  "England",
  "Republic of Ireland",
  "Northern Ireland",
  "Scotland",
  "Wales",
] as const

export interface PersonalDetails {
  firstName: string
  surname: string
  dateOfBirth: string
  addressLine1: string
  addressLine2: string
  addressLine3: string
  town: string
  county: string
  country: string
  postcode: string
}

export const EMPTY_PERSONAL_DETAILS: PersonalDetails = {
  firstName: "",
  surname: "",
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  addressLine3: "",
  town: "",
  county: "",
  country: "",
  postcode: "",
}

export interface ClubDirectoryResult {
  id: string
  name: string
  town: string | null
  county: string | null
  postcode: string | null
  rugbyCode: RugbyCode
  /** Whether an active `clubs` row already references this directory entry. */
  claimed: boolean
  /**
   * The activated `clubs.id` for this directory entry, when claimed is
   * true -- club_join_requests.club_id references clubs(id), never
   * club_directory(id), so this (not `id` above) is what a join request
   * must use.
   */
  clubId: string | null
  /**
   * Derived from club_directory.verification_status (an internal
   * data-lineage value, e.g. "wru_current_league_verified" -- never shown
   * verbatim). true for any *_verified status; surfaced as a small
   * "Verified" indicator, never a negative flag on the majority of rows
   * that simply haven't been cross-verified yet.
   */
  verified: boolean
}

export interface DirectoryRequestProposal {
  clubName: string
  bio: string
  postcode: string
  addressLine1: string
  addressLine2: string
  addressLine3: string
  town: string
  county: string
  country: string
  phone: string
  email: string
}

export const EMPTY_DIRECTORY_REQUEST: DirectoryRequestProposal = {
  clubName: "",
  bio: "",
  postcode: "",
  addressLine1: "",
  addressLine2: "",
  addressLine3: "",
  town: "",
  county: "",
  country: "",
  phone: "",
  email: "",
}

/**
 * club_claims.claimed_role / club_join_requests.requested_role are both
 * free-text columns (no lookup/enum table in the schema), so a chosen
 * label here is stored verbatim -- that IS the approved mapping, not a
 * shortcut around one.
 */
export const CLUB_ROLES = [
  "Club Chair / Chairman / Chairperson",
  "Club Secretary",
  "Fixture Secretary",
  "Club Administrator",
  "Director of Rugby",
  "Head Coach",
  "Team Manager",
  "Coach",
  "Safeguarding / Welfare Officer",
  "Treasurer",
  "Committee Member",
  "Volunteer",
  "Player",
  "Parent / Guardian",
  "Other",
] as const

/**
 * Which of CLUB_ROLES may START (claim) an unclaimed club's Ovalball
 * account -- enforced server-side by club_claims_claimed_role_eligible
 * (20260831180000, extended by 20260831190000 to add Treasurer), not just
 * here. This list is what decides which UI a claimant sees, not what
 * grants authority: a role outside this list can still be invited into an
 * already-activated club by its Club Admin, and a role inside this list
 * still only produces a *pending* claim -- Site Admin approval remains
 * required either way. "Other" is deliberately excluded: a free-text role
 * is too ambiguous to treat as claim-eligible. Safeguarding/Welfare
 * Officer is deliberately excluded too -- an important club role, but not
 * evidence of authority to set up the club's official account; that
 * distinction is the entire point of this list existing.
 */
export const CLAIM_ELIGIBLE_ROLES: readonly string[] = [
  "Club Chair / Chairman / Chairperson",
  "Club Secretary",
  "Fixture Secretary",
  "Club Administrator",
  "Director of Rugby",
  "Committee Member",
  "Treasurer",
]

/**
 * The fixed declaration a claimant confirms via checkbox (never
 * pre-checked). club_claims.authority_declaration is a free-text NOT NULL
 * column with no separate boolean -- recording this exact sentence as its
 * value is the audit trail: it captures literally what was agreed to, not
 * just a true/false flag with no context.
 */
export const AUTHORITY_DECLARATION_TEXT =
  "I confirm that I have permission from this club to act on its behalf and to request administrative access to its Ovalball account."

/**
 * The team categories a claimant/proposer can flag as existing at their
 * club, grouped for a readable checklist rather than one flat 24-item wall.
 *
 * `allowMultiple` decides whether the B/C lettered-squad toggle appears for
 * a group's categories. A club can genuinely run several age-group sides
 * at once (U12 A/B/C), so age-group and Colts groups allow it. A senior
 * side is already distinguished by its ordinal ("Men's 1st Team", "Men's
 * 2nd Team") -- there is no such thing as "Men's 1st Team B", so senior
 * groups don't offer the letter toggle at all.
 */
export const TEAM_CATEGORY_GROUPS: { label: string; categories: string[]; allowMultiple: boolean }[] = [
  {
    label: "Mini & youth",
    categories: ["Under 6", "Under 7", "Under 8", "Under 9", "Under 10", "Under 11"],
    allowMultiple: true,
  },
  {
    label: "Youth",
    categories: ["Under 12", "Under 13", "Under 14", "Under 15", "Under 16"],
    allowMultiple: true,
  },
  {
    label: "Colts",
    categories: ["Junior Colts", "Senior Colts"],
    allowMultiple: true,
  },
  {
    label: "Senior men's",
    categories: ["Men's 1st Team", "Men's 2nd Team", "Men's 3rd Team"],
    allowMultiple: false,
  },
  {
    label: "Senior women's",
    categories: ["Women's 1st Team", "Women's 2nd Team", "Women's 3rd Team"],
    allowMultiple: false,
  },
  {
    label: "Girls",
    categories: ["Under 12 Girls", "Under 13 Girls", "Under 14 Girls", "Under 15 Girls", "Under 16 Girls"],
    allowMultiple: true,
  },
]

/**
 * A ticked team category, optionally with extra lettered teams at the same
 * level (e.g. ticking "B" and "C" under "Under 12" means the club runs
 * Under 12, Under 12 B, and Under 12 C as three separate teams with their
 * own separate fixture lists -- not one team called "Under 12 B/C").
 */
export interface SelectedTeam {
  category: string
  additionalLetters: string[]
}

/**
 * What the user chose to do in STEP 3. Selecting a directory club never
 * grants control of it -- "existing-unclaimed" leads to a claim request,
 * "existing-claimed" leads to a join request, both reviewed by a human
 * before taking effect. Checking the authority declaration is itself only
 * a declaration, not an approval -- see AUTHORITY_DECLARATION_TEXT.
 */
export type ClubSelection =
  | { kind: "unselected" }
  | {
      kind: "existing-unclaimed"
      directory: ClubDirectoryResult
      role: string
      authorityConfirmed: boolean
      teams: SelectedTeam[]
    }
  | { kind: "existing-claimed"; directory: ClubDirectoryResult; role: string }
  | { kind: "not-found"; proposal: DirectoryRequestProposal; teams: SelectedTeam[] }

export interface SignupFormState {
  email: string
  personal: PersonalDetails
  rugbyCode: RugbyCode | null
  club: ClubSelection
  termsAccepted: boolean
}

export const EMPTY_SIGNUP_STATE: SignupFormState = {
  email: "",
  personal: EMPTY_PERSONAL_DETAILS,
  rugbyCode: null,
  club: { kind: "unselected" },
  termsAccepted: false,
}

export const SIGNUP_STEPS = ["account", "details", "club", "review"] as const
export type SignupStep = (typeof SIGNUP_STEPS)[number]
