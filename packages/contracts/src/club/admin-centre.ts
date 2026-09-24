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
  capability: string
  /** The app's own screen, when it has one. */
  native: boolean
  /** The website's page for this job. */
  webPath: string
}

export const ADMIN_CENTRE_SECTIONS: AdminCentreSection[] = [
  { key: "club-profile", label: "Club Profile", caption: "Introduction, web links, home ground and public contacts", capability: "club.profile.edit", native: true, webPath: "/club" },
  { key: "branding", label: "Branding", caption: "The club's crest and its home and away kit", capability: "club.profile.edit", native: true, webPath: "/club" },
  { key: "venues", label: "Venues", caption: "Grounds, pitches and the home ground", capability: "venue.venue.manage", native: true, webPath: "/club/venues" },
  { key: "teams", label: "Teams", caption: "The sides the club runs, from the Team Directory", capability: "team.team.manage", native: true, webPath: "/teams" },
  { key: "people", label: "People", caption: "Members, staff, team roles and who is waiting to join", capability: "people.member.view", native: true, webPath: "/people" },
  { key: "news", label: "News & Announcements", caption: "What the club publishes to its members and the public", capability: "club.news.manage", native: true, webPath: "/club/settings/news" },
  { key: "permissions", label: "Roles & Permissions", caption: "Who may do what, and where", capability: "people.capability.manage", native: true, webPath: "/club/permissions" },
  { key: "guardians", label: "Guardians & Players", caption: "Approving who looks after which player", capability: "family.relationship.approve", native: true, webPath: "/club/settings/guardians" },
  { key: "safeguarding", label: "Safeguarding Officer", caption: "Who the club's safeguarding contact is", capability: "safeguarding.officer.nominate", native: true, webPath: "/club/settings/safeguarding" },
  { key: "rollover", label: "Season Handover", caption: "Moving every side up at the end of the season", capability: "team.handover.prepare", native: true, webPath: "/club/rollover" },
  { key: "subscriptions", label: "Subscriptions & Payments", caption: "What members pay and how", capability: "finance.subscription.configure", native: true, webPath: "/club/settings/subscriptions" },
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
  return { sections: ADMIN_CENTRE_SECTIONS.filter((s) => allowed.has(s.capability)) }
}
