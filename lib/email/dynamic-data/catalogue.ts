import "server-only"

/**
 * THE ONE CANONICAL DYNAMIC DATA CATALOGUE.
 *
 * Every semantic fact an Ovalball email is capable of showing -- whether a
 * `{{merge_tag}}` a Site Admin can type, or a renderer-owned structured
 * block like the Match Summary -- is registered here exactly once. Nothing
 * downstream is allowed a second list:
 *
 *   Site Admin's Dynamic Data panel  -- reads this catalogue, filtered to
 *                                        the selected event's `variables`
 *                                        and `structuredBlocks` (contracts.ts)
 *   template validation              -- lib/email/contracts.ts#unknownVariables
 *                                        resolves every allowed name from here
 *   preview / test send / real send  -- lib/email/templates.ts#renderEmail
 *                                        builds its variable map from the
 *                                        SAME resolved context this catalogue
 *                                        describes, through VARIABLE_MAPS
 *
 * scripts/verify-dynamic-data-catalogue.mjs is the structural guard that
 * keeps this true: it fails the build if a second registry, an arbitrary
 * database-column token, or an unregistered structured block appears
 * anywhere in lib/email.
 *
 * WHAT "EXTENSIVE" DOES NOT MEAN
 * --------------------------------
 * A catalogue entry exists because a real, already-reviewed resolver can
 * produce it -- resolveFixtureEmailContext, resolveTrainingEmailContext,
 * the recipient/audience engine. There is no
 * entry here for a database column merely because the column exists: DOB,
 * raw lat/long, auth ids, Player/Guardian ids, another team's private
 * register and provider credentials are never registered, by construction
 * -- see supabase/tests/js/dynamic_data_security.test.mts, which asserts
 * the absence rather than trusting this comment.
 */

/**
 * The product groups the Dynamic Data panel organises by, and searches
 * across. A closed, deliberately larger set than the older EmailVariableCategory
 * it replaces -- "Person" and "Fixture" have grown into the specific domains
 * this task asked for, because "grouped by what kind of fact it is" only
 * works when the group is specific enough to mean something.
 */
export type DynamicDataGroup =
  | "Recipient"
  | "Player"
  | "Guardian"
  | "Club"
  | "Team"
  | "Fixture"
  | "Opposition"
  | "Match"
  | "Training"
  | "Event"
  | "Venue"
  | "Pitch"
  | "Competition"
  | "Season"
  | "Attendance"
  | "Brand"
  | "Account"
  | "Referral"
  | "Support"
  | "System"

/**
 * scalar     -- an insertable `{{merge_tag}}`, validated and substituted like
 *               any other piece of copy.
 * structured -- a renderer-owned block (Match Summary, Training Summary,
 *               Event Summary) that appears in the email's body automatically
 *               when the event's contract enables it. Never a token; nothing
 *               to insert at a cursor.
 * image      -- a renderer-owned embedded image (the Ovalball logo, a club
 *               crest). Same non-insertable reasoning as structured, and the
 *               same controlled /email-assets/* proxy route always serves it.
 */
export type DynamicDataKind = "scalar" | "structured" | "image"

export interface DynamicDataItem {
  /** Stable semantic key. For a scalar, this IS the merge tag name (no braces). For structured/image, an internal id used by contracts.ts and the guard script -- never typed by a Site Admin. */
  key: string
  label: string
  group: DynamicDataGroup
  kind: DynamicDataKind
  /** What it is, in the words a Site Admin reads. */
  description: string
  /** A safe, obviously-fake example. For structured/image, a short description of what renders. Never real data. */
  sample: string
  /** Where this value genuinely comes from, in plain language. */
  source: string
  /** True when this item can only resolve for a recipient whose relationship to the underlying record is unambiguous -- see lib/email/audience/recipient-relative-context.ts. Ambiguous or absent, it is UNAVAILABLE, never a guess. */
  recipientRelative: boolean
  /** Human explanation of when this is actually present, shown next to the item so an unavailable value is never a silent blank. */
  availability: string
  /** Present only for a renamed/retired key kept for published-content compatibility -- see docs/EMAIL_DYNAMIC_DATA_CATALOGUE.md "Existing-template compatibility". Never shown as a first-class option in the panel. */
  deprecated?: { replacedBy: string }
}

const item = (i: DynamicDataItem): DynamicDataItem => i

export const DYNAMIC_DATA_CATALOGUE: Record<string, DynamicDataItem> = {
  // ---------------------------------------------------------------------
  // RECIPIENT -- who this specific copy of the email is addressed to.
  // ---------------------------------------------------------------------
  recipient_first_name: item({
    key: "recipient_first_name",
    label: "Recipient first name",
    group: "Recipient",
    kind: "scalar",
    description: "The first name of the person this email is addressed to.",
    sample: "Callum",
    source: "The recipient's own profile.",
    recipientRelative: false,
    availability: "Available whenever this event addresses a named person.",
  }),
  recipient_full_name: item({
    key: "recipient_full_name",
    label: "Recipient full name",
    group: "Recipient",
    kind: "scalar",
    description: "The full name of the person this email is addressed to.",
    sample: "Callum Krizz",
    source: "The recipient's own profile.",
    recipientRelative: false,
    availability: "Available whenever this event addresses a named person.",
  }),
  recipient_relationship_label: item({
    key: "recipient_relationship_label",
    label: "Recipient's relationship",
    group: "Recipient",
    kind: "scalar",
    description: "A friendly description of how the recipient relates to the player this email concerns -- 'Guardian' or 'Player'. Never a database role name.",
    sample: "Guardian",
    source: "The recipient/audience engine's own relationship record.",
    recipientRelative: true,
    availability: "Available only where the recipient relates to exactly one player for this email -- ambiguous or unrelated, this is unavailable rather than a guess.",
  }),

  // ---------------------------------------------------------------------
  // PLAYER -- recipient-relative by construction; see
  // lib/email/audience/recipient-relative-context.ts for the ambiguity rule
  // every one of these obeys.
  // ---------------------------------------------------------------------
  player_first_name: item({
    key: "player_first_name",
    label: "Player's first name",
    group: "Player",
    kind: "scalar",
    description: "The first name of the single player this email concerns.",
    sample: "Callum",
    source: "The player's own profile, resolved for this recipient.",
    recipientRelative: true,
    availability: "Available only when the recipient relates to exactly one player. A guardian of more than one relevant child sees this as unavailable, never a guess at which child.",
  }),
  player_full_name: item({
    key: "player_full_name",
    label: "Player's full name",
    group: "Player",
    kind: "scalar",
    description: "The full name of the single player this email concerns.",
    sample: "Callum Krizz",
    source: "The player's own profile, resolved for this recipient.",
    recipientRelative: true,
    availability: "Available only when the recipient relates to exactly one player. A guardian of more than one relevant child sees this as unavailable, never a guess at which child.",
  }),
  player_team_name: item({
    key: "player_team_name",
    label: "Player's team",
    group: "Player",
    kind: "scalar",
    description: "The canonical short name of the single player's team for this event -- e.g. 'U12 Boys'.",
    sample: "U12 Boys",
    source: "The canonical Team Directory, resolved for this recipient's player.",
    recipientRelative: true,
    availability: "Available only when the recipient relates to exactly one player who has an active team.",
  }),

  // ---------------------------------------------------------------------
  // CLUB
  // ---------------------------------------------------------------------
  club_name: item({
    key: "club_name",
    label: "Club name",
    group: "Club",
    kind: "scalar",
    description: "The club's own name.",
    sample: "Solihull Rugby Club",
    source: "The club's own record.",
    recipientRelative: false,
    availability: "Available whenever this event concerns one specific club.",
  }),
  club_rugby_code: item({
    key: "club_rugby_code",
    label: "Club rugby code",
    group: "Club",
    kind: "scalar",
    description: "Which code the club plays -- Rugby Union or Rugby League.",
    sample: "Rugby Union",
    source: "The Club Directory's own rugby_code field.",
    recipientRelative: false,
    availability: "Available whenever this event concerns one specific club.",
  }),
  club_website: item({
    key: "club_website",
    label: "Club website",
    group: "Club",
    kind: "scalar",
    description: "The club's own website address, only when the club has chosen to show it publicly.",
    sample: "https://solihullrugby.example",
    source: "The club's own profile, respecting its own show-website setting.",
    recipientRelative: false,
    availability: "Available only when the club has both recorded a website and chosen to show it.",
  }),
  club_crest: item({
    key: "club_crest",
    label: "Club crest",
    group: "Club",
    kind: "image",
    description: "Shown automatically at the top of this email when the club has a crest on file. Not a token -- there is nothing to insert.",
    sample: "The club's own crest image, proxied through Ovalball's own /email-assets/ route.",
    source: "The club's approved crest, or the claimed directory crest.",
    recipientRelative: false,
    availability: "Available when the club (or, for an unclaimed opponent, the directory) has an approved crest image on file.",
  }),

  // ---------------------------------------------------------------------
  // TEAM -- the canonical Team Directory only. See the pinned canonical
  // team naming rule: display form is the site-wide name, never a
  // per-screen convention.
  // ---------------------------------------------------------------------
  team_name: item({
    key: "team_name",
    label: "Team name",
    group: "Team",
    kind: "scalar",
    description: "The specific team's canonical short label -- e.g. 'U12 Boys'.",
    sample: "U12 Boys",
    source: "The canonical Team Directory (lib/teams/compact-label.ts), derived from the team's own structured identity.",
    recipientRelative: false,
    availability: "Available whenever this event concerns one specific team with a recorded identity.",
  }),
  team_club_name: item({
    key: "team_club_name",
    label: "Team's club",
    group: "Team",
    kind: "scalar",
    description: "The club the team belongs to.",
    sample: "Solihull Rugby Club",
    source: "The team's own club record.",
    recipientRelative: false,
    availability: "Available whenever this event concerns one specific team.",
  }),

  // ---------------------------------------------------------------------
  // FIXTURE -- resolved by lib/email/context/resolve-fixture-email-context.ts,
  // the canonical, recipient-agnostic fixture identity resolver.
  // ---------------------------------------------------------------------
  fixture_date: item({
    key: "fixture_date",
    label: "Fixture date",
    group: "Fixture",
    kind: "scalar",
    description: "The fixture's date, in full -- 'Sunday 20 September 2026'.",
    sample: "Sunday 20 September 2026",
    source: "The fixture's own kickoff date.",
    recipientRelative: false,
    availability: "Always available for a fixture-based event.",
  }),
  fixture_day: item({
    key: "fixture_day",
    label: "Fixture day",
    group: "Fixture",
    kind: "scalar",
    description: "Just the day of the week -- 'Sunday'.",
    sample: "Sunday",
    source: "The fixture's own kickoff date.",
    recipientRelative: false,
    availability: "Always available for a fixture-based event.",
  }),
  fixture_kickoff_time: item({
    key: "fixture_kickoff_time",
    label: "Kick-off time",
    group: "Fixture",
    kind: "scalar",
    description: "The scheduled kick-off time.",
    sample: "14:15",
    source: "The fixture's own kickoff time.",
    recipientRelative: false,
    availability: "Available when a kick-off time has been set.",
  }),
  fixture_meet_time: item({
    key: "fixture_meet_time",
    label: "Meet time",
    group: "Fixture",
    kind: "scalar",
    description: "When players should arrive, if different from kick-off.",
    sample: "13:30",
    source: "The fixture's own meet time.",
    recipientRelative: false,
    availability: "Available when a meet time has been set.",
  }),
  fixture_home_away: item({
    key: "fixture_home_away",
    label: "Home or away",
    group: "Fixture",
    kind: "scalar",
    description: "Whether our team is playing at home or away.",
    sample: "Home",
    source: "The fixture's own record.",
    recipientRelative: false,
    availability: "Available once the fixture's home/away side is set.",
  }),
  fixture_our_team: item({
    key: "fixture_our_team",
    label: "Our team",
    group: "Fixture",
    kind: "scalar",
    description: "Our own side's club name, whichever of home/away it is playing.",
    sample: "Solihull Rugby Club",
    source: "The fixture's owning side, resolved regardless of home/away.",
    recipientRelative: false,
    availability: "Always available for a fixture-based event.",
  }),
  fixture_opposition_name: item({
    key: "fixture_opposition_name",
    label: "Opposition name",
    group: "Opposition",
    kind: "scalar",
    description: "The opposing club's name, or 'Opposition to be confirmed' when not yet set.",
    sample: "Sample RUFC",
    source: "The fixture's opposing side -- a claimed club, or an unclaimed Club Directory entry.",
    recipientRelative: false,
    availability: "Always available for a fixture-based event, though the value itself may say 'to be confirmed'.",
  }),
  fixture_opposition_crest: item({
    key: "fixture_opposition_crest",
    label: "Opposition crest",
    group: "Opposition",
    kind: "image",
    description: "Shown inside the Match Summary block when Ovalball has an approved crest for the opposition. Not a separate token.",
    sample: "The opposition's own crest image, proxied through /email-assets/.",
    source: "The opposition's approved crest, claimed or directory.",
    recipientRelative: false,
    availability: "Available when the opposition (claimed or unclaimed) has an approved crest image on file.",
  }),
  fixture_competition_name: item({
    key: "fixture_competition_name",
    label: "Competition",
    group: "Competition",
    kind: "scalar",
    description: "The competition this fixture is part of.",
    sample: "Premiership",
    source: "The fixture's own competition edition record.",
    recipientRelative: false,
    availability: "Available only when the fixture is part of a recorded competition -- most friendlies have none.",
  }),
  fixture_venue_name: item({
    key: "fixture_venue_name",
    label: "Venue name",
    group: "Venue",
    kind: "scalar",
    description: "The ground the fixture is played at.",
    sample: "Sample Park",
    source: "The fixture's own recorded venue.",
    recipientRelative: false,
    availability: "Available once a venue has been recorded for the fixture.",
  }),
  fixture_venue_address: item({
    key: "fixture_venue_address",
    label: "Venue address",
    group: "Venue",
    kind: "scalar",
    description: "The venue's address, as recorded.",
    sample: "Sample Road, Sample Town",
    source: "The fixture's own recorded venue.",
    recipientRelative: false,
    availability: "Available once a venue with an address has been recorded.",
  }),
  fixture_venue_postcode: item({
    key: "fixture_venue_postcode",
    label: "Venue postcode",
    group: "Venue",
    kind: "scalar",
    description: "The venue's postcode.",
    sample: "SA1 1PL",
    source: "The fixture's own recorded venue.",
    recipientRelative: false,
    availability: "Available once a venue with a postcode has been recorded.",
  }),
  fixture_pitch_name: item({
    key: "fixture_pitch_name",
    label: "Pitch",
    group: "Pitch",
    kind: "scalar",
    description: "Which pitch the fixture is assigned to.",
    sample: "Pitch 1",
    source: "The fixture's own pitch allocation.",
    recipientRelative: false,
    availability: "Available when a pitch has been assigned.",
  }),
  fixture_status: item({
    key: "fixture_status",
    label: "Fixture status",
    group: "Fixture",
    kind: "scalar",
    description: "The fixture's own lifecycle status -- Planned, Accepted, Cancelled, and so on.",
    sample: "Cancelled",
    source: "The fixture's own record.",
    recipientRelative: false,
    availability: "Always available for a fixture-based event.",
  }),
  match_centre_link: item({
    key: "match_centre_link",
    label: "Match Centre link",
    group: "Match",
    kind: "scalar",
    description: "Not an inserted merge tag -- the button on a fixture-based email is always this link, generated server-side from the fixture's own id. Listed so a Site Admin can see where the button already goes.",
    sample: "https://ovalball.co.uk/fixtures/…",
    source: "Generated from the canonical site URL and the fixture's own id. Never editable.",
    recipientRelative: false,
    availability: "Always the destination for a fixture-based event's call to action.",
  }),
  match_summary: item({
    key: "match_summary",
    label: "Match Summary",
    group: "Match",
    kind: "structured",
    description: "The full fixture identity block -- both crests, both team names, date, meet/kick-off time, home/away, venue, pitch and competition -- shown automatically. Missing optional details collapse cleanly rather than showing as blank.",
    sample: "A compact card: Solihull Rugby Club v Sample RUFC, Sunday 20 September 2026, Meet 13:30 · Kick-off 14:15, Sample Park.",
    source: "lib/email/context/resolve-fixture-email-context.ts, rendered by lib/email/design/components.ts#matchSummaryBlock.",
    recipientRelative: false,
    availability: "Available for any event whose contract enables the Match Summary block.",
  }),
  fixture_responded_attending: item({
    key: "fixture_responded_attending",
    label: "Responded: attending",
    group: "Attendance",
    kind: "scalar",
    description: "How many players have RESPONDED that they are attending -- an availability response, not proof anyone actually turned up.",
    sample: "12",
    source: "Aggregate count of availability responses on the fixture.",
    recipientRelative: false,
    availability: "Available for a fixture-based event with an authorised, management-oriented audience.",
  }),
  fixture_responded_cannot_attend: item({
    key: "fixture_responded_cannot_attend",
    label: "Responded: can't attend",
    group: "Attendance",
    kind: "scalar",
    description: "How many players have responded that they can't attend.",
    sample: "2",
    source: "Aggregate count of availability responses on the fixture.",
    recipientRelative: false,
    availability: "Available for a fixture-based event with an authorised, management-oriented audience.",
  }),
  fixture_awaiting_response: item({
    key: "fixture_awaiting_response",
    label: "Awaiting response",
    group: "Attendance",
    kind: "scalar",
    description: "How many players have not yet responded at all.",
    sample: "5",
    source: "Aggregate count of availability responses on the fixture.",
    recipientRelative: false,
    availability: "Available for a fixture-based event with an authorised, management-oriented audience.",
  }),

  // ---------------------------------------------------------------------
  // TRAINING -- resolve-training-email-context.ts. No event sends this yet;
  // see docs/EMAIL_DYNAMIC_DATA_CATALOGUE.md.
  // ---------------------------------------------------------------------
  training_date: item({
    key: "training_date",
    label: "Training date",
    group: "Training",
    kind: "scalar",
    description: "The session's date, in full.",
    sample: "Wednesday 9 September 2026",
    source: "The training session's own record.",
    recipientRelative: false,
    availability: "Always available for a training-based event.",
  }),
  training_day: item({
    key: "training_day",
    label: "Training day",
    group: "Training",
    kind: "scalar",
    description: "Just the day of the week.",
    sample: "Wednesday",
    source: "The training session's own record.",
    recipientRelative: false,
    availability: "Always available for a training-based event.",
  }),
  training_time_range: item({
    key: "training_time_range",
    label: "Training time",
    group: "Training",
    kind: "scalar",
    description: "The session's start and end time, where both are recorded.",
    sample: "18:00–19:30",
    source: "The training session's own record.",
    recipientRelative: false,
    availability: "Available once a start time has been recorded.",
  }),
  training_team_name: item({
    key: "training_team_name",
    label: "Training team",
    group: "Training",
    kind: "scalar",
    description: "Which team this session is for.",
    sample: "U12 Boys",
    source: "The training session's own team, if it is team-specific.",
    recipientRelative: false,
    availability: "Available when the session is scoped to a single team, rather than a wider scheduling group.",
  }),
  training_venue_name: item({
    key: "training_venue_name",
    label: "Training venue",
    group: "Venue",
    kind: "scalar",
    description: "Where the session is held.",
    sample: "Sample Training Ground",
    source: "The training session's own recorded venue.",
    recipientRelative: false,
    availability: "Available once a venue has been recorded.",
  }),
  training_venue_postcode: item({
    key: "training_venue_postcode",
    label: "Training venue postcode",
    group: "Venue",
    kind: "scalar",
    description: "The training venue's postcode.",
    sample: "SA1 1PL",
    source: "The training session's own recorded venue.",
    recipientRelative: false,
    availability: "Available once a venue with a postcode has been recorded.",
  }),
  training_pitch_name: item({
    key: "training_pitch_name",
    label: "Training pitch",
    group: "Pitch",
    kind: "scalar",
    description: "Which pitch the session is assigned to.",
    sample: "Pitch 2",
    source: "The training session's own pitch allocation.",
    recipientRelative: false,
    availability: "Available when a pitch has been assigned.",
  }),
  training_summary: item({
    key: "training_summary",
    label: "Training Summary",
    group: "Training",
    kind: "structured",
    description: "A compact card: team, date, time, venue and pitch. No home/away, no opposition -- training has neither.",
    sample: "A compact card: U12 Boys, Wednesday 9 September 2026, 18:00-19:30, Sample Training Ground.",
    source: "lib/email/context/resolve-training-email-context.ts, rendered by lib/email/design/components.ts#trainingSummaryBlock.",
    recipientRelative: false,
    availability: "Available for any event whose contract enables the Training Summary block.",
  }),

  // ---------------------------------------------------------------------
  // EVENT -- PLANNED / NOT AVAILABLE. Main's Club Event schema
  // (public.club_events and its team/pitch join tables) is not yet part of
  // the committed platform, so there is deliberately no resolver and no
  // catalogue item here -- the same treatment as Tournament. See
  // docs/EMAIL_DYNAMIC_DATA_CATALOGUE.md.
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // SEASON -- the canonical Seasons register only. Never derived from
  // today's date, never parsed from a display label.
  // ---------------------------------------------------------------------
  season_name: item({
    key: "season_name",
    label: "Season",
    group: "Season",
    kind: "scalar",
    description: "The current season's own display label, from the canonical Seasons register.",
    sample: "2026/27",
    source: "public.seasons, Site Admin -> Seasons.",
    recipientRelative: false,
    availability: "Available whenever this event's underlying record has a season on file.",
  }),

  // ---------------------------------------------------------------------
  // BRAND
  // ---------------------------------------------------------------------
  ovalball_logo: item({
    key: "ovalball_logo",
    label: "Ovalball logo",
    group: "Brand",
    kind: "image",
    description: "Shown at the top of every email. Not a token -- there is nothing to insert.",
    sample: "Ovalball's own logo, or the chosen custom upload, proxied through /email-assets/logo.png.",
    source: "Site Admin -> Email Configuration -> Email Branding.",
    recipientRelative: false,
    availability: "Always present.",
  }),

  // ---------------------------------------------------------------------
  // ACCOUNT / SUPPORT / REFERRAL -- unchanged from the pre-existing
  // catalogue, migrated in with their original keys so no published copy
  // breaks. See docs/EMAIL_DYNAMIC_DATA_CATALOGUE.md "Existing-template
  // compatibility".
  // ---------------------------------------------------------------------
  role_label: item({
    key: "role_label",
    label: "Invited role",
    group: "Account",
    kind: "scalar",
    description: "The role they are being invited into, if one was chosen.",
    sample: "Club Administrator",
    source: "Chosen by the inviter when the invitation was created.",
    recipientRelative: false,
    availability: "Available for a club invitation with a chosen role.",
  }),
  invited_club_name: item({
    key: "invited_club_name",
    label: "Invited club name",
    group: "Club",
    kind: "scalar",
    description: "The club being invited.",
    sample: "Sample RUFC",
    source: "The Club Directory.",
    recipientRelative: false,
    availability: "Available for a partner club invitation.",
  }),
  reference: item({
    key: "reference",
    label: "Ticket reference",
    group: "Support",
    kind: "scalar",
    description: "The support ticket reference.",
    sample: "SUP-1042",
    source: "The support ticket.",
    recipientRelative: false,
    availability: "Available for a support reply.",
  }),
  referred_club_name: item({
    key: "referred_club_name",
    label: "Referred club name",
    group: "Referral",
    kind: "scalar",
    description: "The club that joined.",
    sample: "Sample RUFC",
    source: "The referred club's own record.",
    recipientRelative: false,
    availability: "Available for a referral reward email.",
  }),
  cancellation_reason: item({
    key: "cancellation_reason",
    label: "Cancellation reason",
    group: "Fixture",
    kind: "scalar",
    description: "The reason recorded when the fixture was cancelled.",
    sample: "Waterlogged pitch",
    source: "The fixture's own cancellation record.",
    recipientRelative: false,
    availability: "Available for a match cancellation email.",
  }),

  // ---------------------------------------------------------------------
  // DEPRECATED -- kept resolvable so a published template using the old
  // name still validates and renders, never silently rewritten. Never
  // offered as a first-class option in the Dynamic Data panel.
  // ---------------------------------------------------------------------
  first_name: item({
    key: "first_name",
    label: "First name",
    group: "Recipient",
    kind: "scalar",
    description: "The recipient's first name.",
    sample: "Callum",
    source: "The recipient's own profile.",
    recipientRelative: false,
    availability: "Available whenever this event addresses a named person.",
    deprecated: { replacedBy: "recipient_first_name" },
  }),
} as const

/** Every registered key, once, asserted distinct from its own object literal -- a duplicate key in the object above is a TypeScript error before it is ever a runtime one. */
export const DYNAMIC_DATA_KEYS = Object.keys(DYNAMIC_DATA_CATALOGUE)

export function dynamicDataItem(key: string): DynamicDataItem | undefined {
  return DYNAMIC_DATA_CATALOGUE[key]
}

/** Every non-deprecated item in a group, for the panel's grouped view. */
export function dynamicDataByGroup(group: DynamicDataGroup): DynamicDataItem[] {
  return Object.values(DYNAMIC_DATA_CATALOGUE).filter((i) => i.group === group && !i.deprecated)
}

/** Simple substring search across label, description and group -- no database, no schema walk. */
export function searchDynamicData(query: string, items: DynamicDataItem[]): DynamicDataItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => `${i.label} ${i.description} ${i.group}`.toLowerCase().includes(q))
}
