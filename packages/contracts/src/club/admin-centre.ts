import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * THE ADMIN CENTRE'S SECTIONS, named once (CA-M1).
 *
 * Each section is a job at a club, gated by ONE canonical capability -- the same key the website's
 * Club Settings navigation gates the same job on (`app/(app)/club/settings/resolve-nav-capabilities.ts`).
 * A section appears for a person only when the SERVER says they hold its capability at the club
 * (`my_capabilities`); nothing is derived from a role label, and nothing here is authority: every
 * read and write behind a section is judged again by the server.
 *
 * `native` names the sections the app does itself. The rest are deliberately "on the web today" --
 * a real destination in the system browser, never a dead row and never a WebView -- and each moves
 * to `native` in its own milestone.
 */
export interface AdminCentreSection {
  key: string
  label: string
  /** What the job is, in the person's words. */
  caption: string
  /** The picture beside it, by name from the app's icon set. More draws the same destination with the same one. */
  icon: string
  capability: string
  /**
   * Further keys that also open the section. Subscriptions & Payments is where the club RUNS its memberships as
   * well as configures them (Part 2): somebody allowed to see the club's memberships, but not to change their
   * settings, must be able to find it.
   */
  orCapabilities?: string[]
  /** The app's own screen, when it has one. */
  native: boolean
  /** Where the app's screen lives when it is not `/admin/<key>` (the Season Planner lives with Fixtures). */
  appPath?: string
  /** The website's page for this job. */
  webPath: string
}

export const ADMIN_CENTRE_SECTIONS: AdminCentreSection[] = [
  { key: "club-profile", label: "Club Profile", caption: "Introduction, web links, home ground and public contacts", icon: "Landmark", capability: "club.profile.edit", native: true, webPath: "/club" },
  { key: "branding", label: "Branding", caption: "The club's crest and its home and away kit", icon: "Shirt", capability: "club.profile.edit", native: true, webPath: "/club" },
  { key: "venues", label: "Venues & Pitches", caption: "Grounds, pitches and the home ground", icon: "MapPin", capability: "venue.venue.manage", native: true, webPath: "/club/venues" },
  { key: "teams", label: "Teams", caption: "The sides the club runs, from the Team Directory", icon: "Users", capability: "team.team.manage", native: true, webPath: "/teams" },
  { key: "people", label: "People", caption: "Members, staff, team roles and who is waiting to join", icon: "IdCard", capability: "people.member.view", native: true, webPath: "/people" },
  { key: "news", label: "News & Announcements", caption: "What the club publishes to its members and the public", icon: "Newspaper", capability: "club.news.manage", native: true, webPath: "/club/settings/news" },
  { key: "permissions", label: "Roles & Permissions", caption: "Who may do what, and where", icon: "KeyRound", capability: "people.capability.manage", native: true, webPath: "/club/permissions" },
  { key: "guardians", label: "Guardians & Players", caption: "Approving who looks after which player", icon: "HeartHandshake", capability: "family.relationship.approve", native: true, webPath: "/club/settings/guardians" },
  { key: "safeguarding", label: "Safeguarding Officer", caption: "Who the club's safeguarding contact is", icon: "Shield", capability: "safeguarding.officer.nominate", native: true, webPath: "/club/settings/safeguarding" },
  { key: "rollover", label: "Season Handover", caption: "Moving every side up at the end of the season", icon: "ArrowRightLeft", capability: "team.handover.prepare", native: true, webPath: "/club/rollover" },
  { key: "subscriptions", label: "Subscriptions & Payments", caption: "What members pay and how", icon: "Receipt", capability: "finance.subscription.configure", orCapabilities: ["finance.subscription.view"], native: true, webPath: "/club/settings/subscriptions" },
  { key: "events", label: "Events", caption: "Club and team events, invitations and catering", icon: "CalendarDays", capability: "calendar.event.manage", native: true, webPath: "/club/events" },
  { key: "documents", label: "Club Documents", caption: "Visitor guides, ground information and the club's own files", icon: "FileText", capability: "club.documents.view", native: true, webPath: "/documents" },
  { key: "training-planning", label: "Training Planning", caption: "Recurring training schedules for every team", icon: "Dumbbell", capability: "training.plan.manage", native: true, webPath: "/club/training" },
  { key: "fixture-planner", label: "Season Planner", caption: "Arrange club days with other clubs and keep the season on track", icon: "LayoutGrid", capability: "fixture.planner.use", native: true, appPath: "/fixtures/planner", webPath: "/fixtures/planner" },
  { key: "fixture-import", label: "Import Fixtures", caption: "Upload or paste a season's fixtures and publish them after review", icon: "Download", capability: "fixture.import.run", native: false, webPath: "/fixtures/import" },
  { key: "competition-creator", label: "Competition Creator", caption: "Start a new competition and its fixture schedule", icon: "Trophy", capability: "competition.creator.use", native: false, webPath: "/fixtures/competitions/new" },
]

export interface AdminCentreAccess {
  /** Sections the server says this person may use at this club, in canonical order. */
  sections: AdminCentreSection[]
}

/**
 * Which sections THIS person may use at THIS club, from one `my_capabilities` read. Re-asked on every
 * context change and every time the screen comes back into focus; never cached across either --
 * a cached yes outlives the permission it came from.
 */
export async function readAdminCentreAccess(supabase: SupabaseClient<Database>, clubId: string): Promise<AdminCentreAccess> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) throw error
  const allowed = new Set((data ?? []).filter((row) => row.allowed === true).map((row) => row.capability_key))
  return { sections: ADMIN_CENTRE_SECTIONS.filter((s) => allowed.has(s.capability) || (s.orCapabilities ?? []).some((key) => allowed.has(key))) }
}
