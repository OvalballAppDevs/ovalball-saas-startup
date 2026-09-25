import type { ClubSettingsNavCapabilities } from "@/app/(app)/club/settings/resolve-nav-capabilities"

import type { ActiveContextKind, SwitchableContext } from "./active-context"
import { canManageClubFixturesAnywhere, isViewOnlyEverywhere, manageableTeams, type SessionContext } from "./session-context"

export interface NavItem {
  href: string
  label: string
}

/**
 * A grouped navigation section. Presentation only, exactly like NavItem:
 * sections are assembled BELOW from the already-capability-filtered flat
 * list, so a page can never appear in a group that the permission checks
 * did not already produce. Expanding a section is not authorization.
 */
export interface NavSection {
  key: string
  label: string
  /** lucide icon name, resolved by the renderer -- keeps this file server-safe. */
  icon: string
  items: NavItem[]
}

/**
 * Which Site Admin group each route belongs to, and the order of groups.
 *
 * Site Admin had grown to eighteen top-level links, which is unusable on a
 * phone and merely noisy on a desktop. Grouping is information
 * architecture: no page is removed, no permission changes, and every route
 * below still comes from the flat list built by capability checks.
 *
 * Depth is deliberately capped at SECTION -> PAGE. Anything deeper becomes
 * an accordion maze, which is the failure mode this replaces.
 */
const SITE_ADMIN_SECTIONS: { key: string; label: string; icon: string; hrefs: string[] }[] = [
  {
    key: "access",
    label: "Users & Permissions",
    icon: "Users",
    hrefs: ["/admin/users", "/admin/permissions", "/admin/site-admins"],
  },
  {
    key: "clubs",
    label: "Clubs & Teams",
    icon: "Building2",
    hrefs: ["/admin/clubs", "/admin/claims", "/admin/team-directory", "/admin/documents"],
  },
  {
    key: "rugby",
    label: "Fixtures & Competitions",
    icon: "CalendarDays",
    hrefs: [
      "/admin/fixtures",
      "/admin/competitions",
      "/calendar",
      "/admin/seasons",
      "/admin/scheduling-defaults",
      "/admin/lookups",
    ],
  },
  {
    key: "safeguarding",
    label: "Safeguarding",
    icon: "ShieldCheck",
    hrefs: ["/admin/safeguarding"],
  },
  {
    key: "comms",
    label: "Communications & Support",
    icon: "LifeBuoy",
    hrefs: ["/admin/support", "/admin/messages", "/admin/email"],
  },
  {
    key: "commercial",
    label: "Commercial",
    icon: "Receipt",
    hrefs: ["/admin/commercial"],
  },
  {
    // Not a job anybody signs in to do. Keeping platform maintenance out of the jobs above is the
    // whole point of grouping: a console that lists System Health beside Claims is a route list.
    key: "platform",
    label: "Platform & Maintenance",
    icon: "Settings",
    hrefs: ["/admin/system-health", "/admin/releases"],
  },
]

/**
 * THE CLUB'S OWN GROUPING, by the job somebody came to do.
 *
 * Club navigation was nine flat links, which is where "People" and "Deleted Calendar Events" sat at
 * the same level -- one of them a daily job and the other a recycle bin. The groups below are the
 * jobs; the destinations inside them are exactly what `buildNavItems` already decided this person may
 * see, so grouping adds no destination and removes none.
 */
const CLUB_SECTIONS: { key: string; label: string; icon: string; hrefs: string[] }[] = [
  {
    key: "access",
    label: "Users & Permissions",
    icon: "Users",
    hrefs: ["/people", "/club/permissions", "/club/join-requests", "/club/settings/guardians", "/club/settings/safeguarding"],
  },
  {
    key: "teams",
    label: "Teams",
    icon: "Shirt",
    hrefs: ["/teams"],
  },
  {
    key: "rugby",
    label: "Fixtures & Calendar",
    icon: "CalendarDays",
    hrefs: ["/agenda", "/calendar", "/fixtures/management", "/fixtures", "/clubhouse", "/club/player-moves"],
  },
  {
    key: "comms",
    label: "Communications",
    icon: "MessageSquare",
    hrefs: ["/messages", "/documents"],
  },
  {
    key: "management",
    label: "Club Management",
    icon: "Settings",
    // The bin lives here, with the other things you go looking for on purpose, rather than beside the
    // jobs people arrive to do.
    hrefs: ["/club/training", "/club/settings", "/club/calendar/deleted-events"],
  },
]

/**
 * Groups the Site Admin flat list, preserving the capability filtering that
 * produced it.
 *
 * `/dashboard` stays a top-level item rather than joining a section: it is
 * the landing page, and burying the destination someone arrives on would be
 * perverse.
 *
 * Anything not named in the map above still appears -- in a final
 * "More" section rather than vanishing. A new admin page added later is
 * therefore always reachable, and the missing map entry shows up as an
 * oddly-placed link instead of a silently unreachable one.
 */
/**
 * THE MOBILE BOTTOM BAR — UX-4's "primary destinations one tap away".
 *
 * The shell already had a sticky top bar and a drawer, which puts every destination TWO taps away: open
 * the hamburger, then choose. UX-4's outcome clause is one tap, and its mobile acceptance names a bottom
 * bar. This decides WHICH destinations go on it.
 *
 * THE DECISION LIVES HERE, NOT IN THE COMPONENT, for the reason the rest of this module exists: the
 * information architecture is a product decision, a native client will need the same answer, and a rule
 * buried in a phone-only component is a rule nobody finds. The component renders what this returns.
 *
 * IT CAN ONLY EVER RETURN WHAT `buildNavItems` ALREADY GAVE IT — UX-4's stated authority invariant. It
 * filters and orders; it never adds a destination, so a context whose navigation this session does not
 * hold cannot acquire one by being on a phone.
 *
 * WHY DASHBOARD IS DROPPED where a context has a richer landing page of its own: the governing workspace
 * sends /dashboard straight to its Overview (Step 15), so carrying both would spend one of four slots on
 * a redirect. Where Dashboard IS the landing page it stays first, because burying the page somebody
 * arrives on would be perverse — the same reasoning `groupNavItems` already applies on desktop.
 *
 * FOUR AT MOST, because the fifth cell is "More", which opens the drawer that holds everything. Five
 * labelled cells at 320px is where text starts truncating into initials.
 *
 * GENERIC over the item type on purpose: the shell decorates its items with unread badges before the
 * bar sees them, and a signature pinned to this module's own NavItem would have quietly stripped them.
 * This function filters and orders; it does not reshape.
 */
export function buildBottomBarItems<T extends { href: string }>(
  primary: T[],
  kind: ActiveContextKind,
  /**
   * The team being operated as, for a team context. Its destinations are addressed by the team's id, so a
   * static href map cannot name them -- which is exactly how the first version of this function shipped a
   * team bar with no team on it. `buildClubSections` takes the same argument for the same reason.
   */
  activeTeamId?: string | null
): T[] {
  // Destinations that earn a cell, in the order they should appear, per context. Anything named here
  // that this session does not hold is simply absent — the intersection is what renders.
  const PREFERRED: Partial<Record<ActiveContextKind, string[]>> = {
    // A club administrator's four jobs, ahead of settings and content. `/fixtures/management` is the
    // club's fixtures destination -- `/fixtures` is not a nav destination, and naming it here is how the
    // first version of this map silently produced a three-cell bar.
    club: ["/dashboard", "/agenda", "/teams", "/calendar"],
    // THE TEAM ITSELF IS SECOND, right after the page they land on -- the same order the desktop sidebar
    // uses, where /dashboard is top-level and the Team section follows it. Messages is the item this
    // displaces, and it keeps its place in the drawer: four cells cannot carry five jobs, and a team bar
    // without the team on it was the defect.
    // The team's four most frequent jobs. `/teams/<id>` is deliberately NOT here any more: the team is
    // the workspace, so a cell linking into it from inside it is the same meta layer the sidebar just
    // lost. People takes the slot, which is what somebody actually opens pitch-side.
    team: ["/dashboard", "/agenda", "/calendar", activeTeamId ? `/teams/${activeTeamId}/people` : ""],
    // A guardian's fixed set, minus Settings, which is a rare visit.
    parent: ["/dashboard", "/agenda", "/calendar", "/rugby-hub"],
    player: ["/dashboard", "/agenda", "/calendar", "/rugby-hub"],
    family: ["/dashboard", "/agenda", "/calendar", "/rugby-hub"],
    site_admin: ["/dashboard", "/admin/clubs", "/admin/users", "/admin/fixtures"],
  }

  const byHref = new Map(primary.map((i) => [i.href, i]))
  const preferred = PREFERRED[kind]

  if (preferred) {
    // An empty string is how a context without the id it needs declines a slot, so it is filtered out
    // rather than looked up and silently missed.
    const picked = preferred.filter(Boolean).map((href) => byHref.get(href)).filter((i): i is T => Boolean(i))
    if (picked.length > 0) return picked.slice(0, 4)
  }

  // NO PREFERENCE DECLARED — the governing workspace, and anything added later. Take the first four the
  // context actually offers, skipping /dashboard where it is only a redirect into this workspace. This
  // is the fallback that makes a new context work on a phone the day it is added rather than the day
  // somebody remembers to extend the map, which is the same reasoning as groupNavItems' "More" section.
  return primary.filter((i) => i.href !== "/dashboard").slice(0, 4)
}

export function buildSiteAdminSections(items: NavItem[]): { top: NavItem[]; sections: NavSection[] } {
  return groupNavItems(items, SITE_ADMIN_SECTIONS)
}

/**
 * The same grouping, over the club's catalogue. One function rather than two, because two would be
 * the very drift Step 0 found: the moment the rule for "what happens to a destination nobody mapped"
 * exists twice, the two answers stop matching.
 */
export function buildClubSections(items: NavItem[], activeTeamId?: string | null): { top: NavItem[]; sections: NavSection[] } {
  // A team context's own destinations are addressed by the team's id, so its group is assembled for
  // the team actually being operated as rather than declared as a constant. Everything else -- the
  // fixtures, the calendar, the messages a team manager also holds -- falls into the club groups
  // below, because they are the same jobs at a narrower scope.
  /**
   * A TEAM CONTEXT HAS ITS OWN GROUPS, rather than the club's with pieces bolted on.
   *
   * This used to be `[a team group, ...CLUB_SECTIONS]`, and the team group was another
   * "Fixtures & Calendar" beside the one CLUB_SECTIONS already had. `groupNavItems` adds an item to
   * EVERY group whose spec names its href -- the claimed set only decides what is left over -- so
   * /agenda and /calendar landed in both and the sidebar rendered "Fixtures & Calendar" twice, with
   * Fixtures and Calendar under each. Giving the second group a unique key stopped React complaining
   * about duplicate keys and left the duplication on screen, which is the more visible half.
   *
   * A team's groups are genuinely different from a club's -- no Users & Permissions, no Teams list, no
   * Club Management -- so they are written out rather than inherited. Order is frequency: fixtures and
   * the calendar most weeks, then who is in the squad, then money, then talking to people, then the
   * laws. The administrative fixture surfaces sit inside the fixtures group and appear only with club
   * fixture authority, which is what puts them there for a Club Admin operating as a team and hides
   * them from everybody else.
   */
  const spec = activeTeamId
    ? [
        {
          key: "rugby",
          label: "Fixtures & Calendar",
          icon: "CalendarDays",
          // No club-wide administration here: a team context never pushes those items now.
          hrefs: ["/agenda", "/calendar"],
        },
        { key: "people", label: "People", icon: "Users", hrefs: [`/teams/${activeTeamId}/people`] },
        { key: "money", label: "Subscriptions", icon: "Receipt", hrefs: [`/teams/${activeTeamId}/subscriptions`] },
        { key: "comms", label: "Communications", icon: "MessageSquare", hrefs: ["/messages", "/documents"] },
        // Knowledge rather than a daily job, so it sits last -- but named and visible, not swept into
        // the "More" drawer that ungrouped items fall into.
        { key: "hub", label: "Rugby Hub", icon: "BookOpen", hrefs: ["/rugby-hub"] },
      ]
    : CLUB_SECTIONS
  return groupNavItems(items, spec)
}

function groupNavItems(
  items: NavItem[],
  spec: { key: string; label: string; icon: string; hrefs: string[] }[]
): { top: NavItem[]; sections: NavSection[] } {
  const byHref = new Map(items.map((i) => [i.href, i]))
  const top: NavItem[] = []
  const claimed = new Set<string>()

  const dashboard = byHref.get("/dashboard")
  if (dashboard) {
    top.push(dashboard)
    claimed.add("/dashboard")
  }

  const sections: NavSection[] = []
  for (const group of spec) {
    const sectionItems: NavItem[] = []
    for (const href of group.hrefs) {
      // FIRST GROUP TO NAME AN HREF OWNS IT.
      //
      // Without this, a destination listed in two group specs was pushed into both and rendered twice
      // -- the sidebar showed "Fixtures & Calendar" twice, each with Fixtures and Calendar under it.
      // The claimed set existed only to decide leftovers; it now also decides ownership, which is what
      // its name always implied.
      if (claimed.has(href)) continue
      const item = byHref.get(href)
      if (item) {
        sectionItems.push(item)
        claimed.add(href)
      }
    }
    if (sectionItems.length > 0) {
      sections.push({ key: group.key, label: group.label, icon: group.icon, items: sectionItems })
    }
  }

  // TWO SECTIONS MAY NEVER SHARE A KEY.
  //
  // The section key is React's list key and the id of its disclosure panel, so a duplicate is both a
  // rendering hazard and two elements claiming one aria-controls target. It happened: a team group was
  // given the key "rugby" while CLUB_SECTIONS already had one, and the only signal was a console error
  // on one persona in one context. A spec is authored by hand and this is cheap.
  const seen = new Set<string>()
  for (const section of sections) {
    if (seen.has(section.key)) {
      throw new Error(
        `Two navigation sections share the key "${section.key}". Section keys are React list keys and ` +
          `aria-controls ids, so they have to be unique across the whole spec.`
      )
    }
    seen.add(section.key)
  }

  const leftovers = items.filter((i) => !claimed.has(i.href))
  if (leftovers.length > 0) {
    sections.push({ key: "more", label: "More", icon: "Ellipsis", items: leftovers })
  }

  return { top, sections }
}

/**
 * Turns a session's real permissions -- SCOPED to whichever context is
 * currently active (see active-context.ts) -- into the nav item list from
 * the brief's own worked examples. This is presentation logic only: every
 * route this points at re-checks the same permissions server-side before
 * rendering anything, so a stale or tampered client render of this list
 * can hide a link but never grant the page behind it. Context changes
 * WHICH of the session's real, already-held permissions the nav reflects
 * -- it never adds one that getSessionContext didn't already return.
 */
export function buildNavItems(
  ctx: SessionContext,
  activeContext: SwitchableContext,
  /**
   * The canonical club capability decisions, already resolved once for this request by
   * `resolveClubSettingsNavCapabilities`. Navigation consumes them rather than re-deriving them:
   * Step 0 found the Club Settings hub doing exactly that and silently hiding two finished features
   * from a Club Admin who held their capabilities. One destination, one authority rule.
   *
   * Null where a context has no club (Site Admin, a family view spanning clubs).
   */
  clubNav: ClubSettingsNavCapabilities | null = null,
  /**
   * Whether this session may see the ACTIVE TEAM's subscription state.
   *
   * Resolved by the caller from `internal.can('finance.subscription.view', 'team', …)`, because this
   * module is presentation and must not become a second place authority is decided. A role name is
   * never the answer: a Team Manager holds it through their bundle, a Club Admin holds the club-scoped
   * version, and anybody else holds it because somebody granted it -- all three arrive here as the
   * same boolean.
   */
  teamFinance: boolean = false
): { primary: NavItem[]; roleLabel: string; clubName: string; clubLogoUrl: string | null } {
  // "Overview" in a team context: the page is that team's operational home, and "Dashboard" names the
  // furniture rather than the content. Everywhere else it stays Dashboard.
  const items: NavItem[] = [
    { href: "/dashboard", label: activeContext.kind === "team" ? "Overview" : "Dashboard" },
  ]
  const viewOnly = isViewOnlyEverywhere(ctx)

  const inTeamContext = activeContext.kind === "team"
  const inSiteAdminContext = activeContext.kind === "site_admin"
  const inParentContext = activeContext.kind === "parent"
  const inPlayerContext = activeContext.kind === "player"
  const inFamilyContext = activeContext.kind === "family"
  const inGoverningContext = activeContext.kind === "governing"
  // Player View gets exactly the same restriction as Parent View below --
  // both are read-only-by-design contexts over one team (Relationship
  // Registry §20: "this distinguishes Player View from Parent View even
  // when both experiences happen to be mostly read-only").
  const inParentOrPlayerContext = inParentContext || inPlayerContext || inFamilyContext

  // Parent/Player View is presentation-only and MUST NOT inherit whatever
  // other real authority this same account holds elsewhere in the session
  // -- canManageClubFixturesAnywhere()/manageableTeams() are deliberately
  // session-wide (their own names say "Anywhere"), so using them unguarded
  // here would leak Fixtures/Messages/Teams/People links into Parent/Player
  // View for a multi-role account (e.g. a Club Admin who is ALSO a parent)
  // purely because the account holds admin authority on a DIFFERENT
  // team/club, not because the parent/player relationship itself grants
  // it. hasClubFixtureAuthority/manageable are forced empty in this
  // context specifically to prevent that -- Dashboard and this one team's
  // Calendar are the only items a parent/player view is currently designed
  // to show; broader parent-facing visibility (Messages, Documents) is a
  // real, disclosed, separate product decision, not silently included here.
  const hasClubFixtureAuthority = inParentOrPlayerContext ? false : canManageClubFixturesAnywhere(ctx)
  const manageable = inParentOrPlayerContext ? [] : manageableTeams(ctx)

  // Parent/Guardian/Player navigation is a FIXED five-link set:
  //
  //   Dashboard · Fixtures · Calendar · Rugby Hub · Settings
  //
  // Fixed, because a parent's navigation should not silently change shape
  // depending on how many children they have or which one is selected --
  // and because everything a guardian needs is one of these five. It is
  // returned before any of the authority-gated sections below, so a
  // multi-role account (a Club Admin who is also a parent) sees exactly
  // this and nothing inherited from their other authority.
  //
  // "Fixtures" here is /agenda, a parent-facing list of that child's real
  // fixtures and training. It is deliberately NOT /fixtures, which is the
  // inter-club negotiation register (requesting, accepting and rejecting
  // fixtures between clubs) -- an admin surface a guardian has no business
  // operating and, in Parent View, would only have offered write controls
  // that fail.
  if (inParentOrPlayerContext) {
    const parentItems: NavItem[] = [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/agenda", label: "Fixtures" },
      { href: "/calendar", label: "Calendar" },
      { href: "/rugby-hub", label: "Rugby Hub" },
      { href: "/account", label: "Settings" },
      // A player pays for their own membership, and a guardian pays for a
      // child's. Both reach the same real subscription surface -- there is no
      // second place where somebody could be told a different thing about
      // their own money.
      { href: "/player/payments", label: "Payments & Subscriptions" },
    ]
    return { primary: parentItems, roleLabel: activeContext.roleLabel, clubName: activeContext.label, clubLogoUrl: activeContext.logoUrl }
  }

  // THE GOVERNING BODY WORKSPACE (Convergence Step 15).
  //
  // A fixed set, returned BEFORE every authority-gated section below, for the same reason Parent View
  // is: a county fixtures secretary is very often also somebody's Club Admin, and
  // canManageClubFixturesAnywhere() is session-wide by design. Falling through would offer this person
  // their CLUB's Fixtures, Teams and People while they are acting for the county -- two jobs bleeding
  // into one navigation, which is the precise failure the context system exists to prevent.
  //
  // FOUR DESTINATIONS, not six. Overview, Clubs, Competitions, People & Access are the jobs the
  // product can actually do today. Regulation is reached as Rugby Hub, because it is knowledge rather
  // than an operation this organisation performs, and there is no empty destination standing in for
  // welfare oversight or organisation messaging -- neither has a backend, and a nav item promising one
  // would be the dishonest version of the same gap.
  if (inGoverningContext && activeContext.id) {
    const bodyId = activeContext.id
    // NO DASHBOARD ENTRY: /dashboard is built from a club's week, a family's children or the platform,
    // and it sends a governing context straight here instead. A link that only bounces is worse than
    // no link, and the Overview is this workspace's own home.
    const governingItems: NavItem[] = [
      { href: `/governing/${bodyId}`, label: "Overview" },
      { href: `/governing/${bodyId}/clubs`, label: "Clubs" },
      { href: `/governing/${bodyId}/competitions`, label: "Competitions" },
      { href: `/governing/${bodyId}/people`, label: "People & Access" },
      { href: "/rugby-hub", label: "Rugby Hub" },
      { href: "/account", label: "Settings" },
    ]
    return { primary: governingItems, roleLabel: activeContext.roleLabel, clubName: activeContext.label, clubLogoUrl: null }
  }

  // THE TEAM ITSELF, FOR THE PEOPLE WHO RUN IT.
  //
  // Step 0 found a legitimate Team Manager could reach their own team only by typing its URL: the
  // teams LIST is club-authority-gated and refuses them, and nothing else pointed at the team. The
  // destination comes from the ACTIVE context -- the team this session has already been resolved
  // into -- so it can never name a team the person does not hold, and a multi-team identity sees the
  // one they are operating as rather than a list of all of them.
  // NO GENERIC "TEAM" LAYER, AND NO LINK BACK INTO THE TEAM YOU ARE ALREADY IN.
  //
  // Navigation used to carry a group called "Team" containing the team's own name and Player Requests,
  // inside a context that WAS that team -- so opening Under 12 Boys took Team -> Under 12 Boys from a
  // workspace already called Under 12 Boys. The team is the workspace's identity now, not an item in
  // its own menu, and Overview is where the team's operational home lives.
  //
  // Navigation is RECURRING JOBS. People is one; a team's players, parents and coaches are looked at
  // most weeks. Player Requests is not -- it is occasional administration, and it moved to the team's
  // administration page behind the gear, where infrequent configuration already lives. It stays
  // discoverable through Needs Attention and its notification, which is where exceptional work belongs.
  if (inTeamContext && activeContext.id) {
    items.push({ href: `/teams/${activeContext.id}/people`, label: "People" })
  }

  // SUBSCRIPTIONS, where the bounded team-scoped finance capability is held. `teamFinance` is resolved
  // by the caller from the capability engine at TEAM scope -- never from a role name, and never from
  // the fact that somebody happens to be a manager.
  if (inTeamContext && activeContext.id && teamFinance) {
    items.push({ href: `/teams/${activeContext.id}/subscriptions`, label: "Subscriptions" })
  }

  // RUGBY HUB, FROM THE TEAM.
  //
  // A guardian, a player and a governing officer all had it; the people who actually coach did not,
  // and reached it only through a promotional card on the dashboard. Somebody planning a session on a
  // Tuesday evening is exactly who the laws, positions and skills are for, and moving between running
  // rugby and reading about it should not require going back to a dashboard to find the door.
  if (inTeamContext) {
    items.push({ href: "/rugby-hub", label: "Rugby Hub" })
  }

  // Calendar keeps the team's name ONLY where the team page is not already carrying it; two adjacent
  // links reading "Under 12 Boys" would say nothing about which is which.
  const calendarLabel = inTeamContext
    ? "Calendar"
    : viewOnly && ctx.teamPermissions.length === 1
      ? ctx.teamPermissions[0].teamDisplayName
      : "Calendar"
  items.push({ href: "/calendar", label: calendarLabel })

  // A Site Admin context is the admin console -- deliberately never the
  // club/team operational surface too, even for someone who separately
  // holds real club/team authority elsewhere. Switching context is how
  // they move between those worlds; nav never shows both superimposed.
  if (!inSiteAdminContext) {
    // FIXTURES MEANS THE TEAM'S FIXTURES.
    //
    // Three pages answered to some form of the word, and "Fixtures" in staff navigation pointed at the
    // one that is least like an overview:
    //
    //   /agenda              "Fixtures"                the canonical shared agenda -- opponent, date,
    //                                                  venue, status, result, training, attendance
    //   /fixtures/management "Fixture Control Centre"  club-authority CRUD: edit, delete, results
    //   /fixtures            "Fixtures"                the inter-club negotiation register
    //
    // /agenda already says of itself that it is ONE SHARED ROLE-AWARE SURFACE and that it exists
    // because "a coach, a club admin and a site admin had no agenda at all" -- resolveAgendaScope has
    // had a `teams` branch for team staff the whole time. The product was built; the navigation simply
    // never pointed at it, so staff got the negotiation register and guardians got the overview.
    //
    // So Fixtures is the agenda for everybody, and the two administrative surfaces keep their own
    // honest names below rather than impersonating it.
    items.push({ href: "/agenda", label: "Fixtures" })

    // CLUB-WIDE FIXTURE ADMINISTRATION IS A CLUB-CONTEXT PRODUCT.
    //
    // `!inTeamContext` is the whole correction. A Club Admin who deliberately steps into Under 12 Boys
    // was still shown the club's Fixture Control Centre and the inter-club negotiation register,
    // because they happen to hold club fixture authority -- so standing in one team offered a console
    // for every team at the club. That is the context leakage this programme keeps removing: CONTEXT
    // decides the product, CAPABILITY decides the actions within it.
    //
    // Nothing is lost. Both surfaces are unchanged and still reachable from Club context, and the
    // team's own fixture actions -- add, edit, cancel, request -- now live in the team's fixture
    // product where somebody running that team can actually use them.
    if (hasClubFixtureAuthority && !inTeamContext) {
      // Its own metadata title, used as its nav label: this is the CRUD surface, not the overview.
      items.push({ href: "/fixtures/management", label: "Fixture Control Centre" })
      // NAMED FOR WHAT IT IS. Requesting, accepting and rejecting fixtures between clubs is real work
      // and a real page; it is not what somebody means when they tap Fixtures.
      items.push({ href: "/fixtures", label: "Fixture Requests" })
    }
    // PLAYER REQUESTS NO LONGER HOLDS A PLACE IN NAVIGATION.
    //
    // Owner decision: it is occasional work, and navigation is for recurring jobs. It kept a permanent
    // slot beside Fixtures for something a team does a handful of times a season. It has NOT gone --
    // it lives on the team's administration page behind the gear, and a pending one still reaches the
    // person through Needs Attention and through its notification, both of which link to the decision
    // itself. Exceptional work belongs in those two places, not in the furniture.
    // Messages is team-scoped, not club-scoped -- a Team Admin/Coach needs
    // it for their own team's fixture conversations even with no club-wide
    // role, unlike Partner Clubs (club_partnerships RLS has no team-level
    // read clause at all, so a team-only manager genuinely has nothing to
    // see there).
    if (hasClubFixtureAuthority || manageable.length > 0) {
      items.push({ href: "/messages", label: "Messages" })
    }
    // Club-wide-only tools (Partner Clubs, People) only show in a CLUB
    // context -- a Team-scoped context is a deliberately narrower "operate
    // as this one team" mode, per the "U13 Boys A Team Manager should see
    // their authorized U13 scope, not automatically gain other club-wide
    // tools" requirement.
    //
    // Club Settings and Season Rollover are deliberately NOT primary nav
    // items (Master Architecture Pass addendum, "Club Settings still
    // incorrect in nav"/"Season Rollover still incorrect") -- both are
    // pure configuration, reached exclusively through the gear next to the
    // active identity block (resolveContextSettingsLink() -> /club/settings),
    // never duplicated as a second top-level entry. Season Rollover lives
    // as a section inside that same Club Settings hub now, alongside Club
    // Profile/Teams/Lookup Administration -- see app/(app)/club/settings/page.tsx.
    if (!inTeamContext) {
      if (hasClubFixtureAuthority) {
        items.push({ href: "/clubhouse", label: "Clubhouse" })
      }
      if (ctx.clubMemberships.length > 0) {
        items.push({ href: "/documents", label: "Documents" })
      }

      /*
        THE SAFEGUARDING OFFICER'S OWN WORKSPACE.

        Standing in the Safeguarding Officer context used to produce the generic
        club navigation -- Fixtures, Calendar, Fixture Control Centre, Partner
        Clubs -- which is somebody else's job entirely. A context that offers
        nothing belonging to the role it is named after is a context in name
        only, and it is worse than no context, because it looks like the product
        has an answer.

        The destination is the club's own safeguarding hub, which is where the
        officer's contact details, their nomination state and their safeguarding
        conversations live. Gated on `clubNav.canSafeguarding`, the canonical
        resolver's answer -- not on the context being selected, which decides
        only what is OFFERED.
      */
      if (activeContext.kind === "club" && activeContext.clubRoleKey === "SAFEGUARDING_OFFICER" && clubNav?.canSafeguarding) {
        items.push({ href: "/club/settings/safeguarding", label: "Safeguarding" })
      }
      /*
        THE ROLE KEY, NOT THE PRINTED WORD.

        This compared `activeContext.roleLabel === "Club Admin"` -- the label a
        person reads. It worked, and it would have stopped working silently the
        first time somebody reworded the label, taking the entire
        club-administration group with it. The key is `role_definitions.role_key`
        and is not presentation.

        Still presentation-gating, exactly as this whole file is: every page and
        every RPC behind these links re-checks the real capability server-side,
        and `clubNav` below is the canonical resolver's answer rather than a role
        string.
      */
      if (activeContext.kind === "club" && activeContext.clubRoleKey === "CLUB_ADMIN") {
        // The landing page of the Users & Permissions group. It was called
        // "People", which named the longest list on it rather than the question
        // it answers, and sat as a sibling of Permissions and Join Requests as
        // though it were a fourth thing of the same kind. It is the way in to
        // all of them, so it is the group's Overview -- the same shape the Club
        // Settings tab strip already uses for a hub's own landing page. The
        // page's heading stays "Users & Permissions", because a page title
        // should name the concept rather than the nav position.
        items.push({ href: "/people", label: "Overview" })
        // USERS & PERMISSIONS, IN ONE PLACE.
        //
        // These three were the Step 0 finding in miniature: People was in the navigation, Permissions
        // was hidden behind a hub that re-derived its own capability list, and Join Requests was
        // linked from nowhere at all. All three are the same job -- who may do what here -- and the
        // grouping below puts them together under that name.
        //
        // The decisions come from the canonical resolver, not from a role string: a Club Admin who
        // does not hold people.capability.manage does not get Permissions, and somebody who is not a
        // Club Admin at all never reaches this branch.
        if (clubNav?.canPermissions) items.push({ href: "/club/permissions", label: "Permissions" })
        items.push({ href: "/club/join-requests", label: "Join Requests" })
        if (clubNav?.canGuardians) items.push({ href: "/club/settings/guardians", label: "Guardians & Players" })
        if (clubNav?.canSafeguarding) items.push({ href: "/club/settings/safeguarding", label: "Safeguarding Officer" })
        if (clubNav?.canTeams) items.push({ href: "/teams", label: "Teams" })
        // SIDE PROJECT 2 -- Training Management (Section 5): a dedicated
        // primary nav section, not buried inside Calendar/Pitch
        // Allocation/Club Settings. club.training.manage is Club-Admin-only
        // (Section 44), matching People's own gating here -- the page and
        // every RPC it calls re-check the real capability server-side
        // regardless (this file's own stated "presentation only" contract).
        items.push({ href: "/club/training", label: "Training Management" })
        // Calendar Fixture Lifecycle hardening (Section H): the unified
        // back-office archive for both archived fixtures and removed
        // training -- Club-Admin-gated exactly like Training Management
        // above (the page/view itself re-checks real RLS regardless).
        items.push({ href: "/club/calendar/deleted-events", label: "Deleted Calendar Events" })
        // The club administration hub, named. Until now the only door to venues, the season handover,
        // the club profile and the rest was a 16px unlabelled gear beside the identity block -- which
        // is a fine shortcut and a poor entrance.
        items.push({ href: "/club/settings", label: "Club Settings" })
      }
    }
  }

  if (inSiteAdminContext) {
    // Phase 2 SA-4: Site Admin navigation renders from the database's site capabilities
    // (ctx.siteCapabilities, public.my_site_capabilities). A section whose entry needs no
    // particular capability is readable by every active Site Admin; its controls and the
    // actions behind them re-check server-side.
    const holds = (key: string) => ctx.siteCapabilities.includes(key)
    const siteSections: { href: string; label: string; needs?: string[] }[] = [
      { href: "/admin/claims", label: "Claims", needs: ["site.claims.review"] },
      { href: "/admin/documents", label: "Documents", needs: ["site.clubs.view"] },
      { href: "/admin/clubs", label: "Club Management", needs: ["site.clubs.view"] },
      { href: "/admin/users", label: "User Management", needs: ["site.users.view"] },
      { href: "/admin/permissions", label: "Permission Management", needs: ["site.users.view"] },
      { href: "/admin/fixtures", label: "Fixture Control Centre", needs: ["site.fixtures.view", "site.fixtures.support"] },
      { href: "/admin/messages", label: "Message Management", needs: ["site.messages.moderate"] },
      { href: "/admin/seasons", label: "Seasons" },
      { href: "/admin/team-directory", label: "Team Directory" },
      { href: "/admin/competitions", label: "Competitions" },
      { href: "/admin/lookups", label: "Lookup Administration" },
      // What the platform reserves around a fixture is operational context; the setter re-checks server-side.
      { href: "/admin/scheduling-defaults", label: "Pitch Allocation Defaults" },
      { href: "/admin/support", label: "Support Tickets", needs: ["site.support.view"] },
      { href: "/admin/site-admins", label: "Site Admin Management", needs: ["site.users.view"] },
      { href: "/admin/system-health", label: "System Health" },
      { href: "/admin/email", label: "Email Configuration", needs: ["site.email.manage", "site.email.deliveries.view"] },
      // Whether Ovalball is charging clubs is operational context; changing it needs site.system.*.
      { href: "/admin/releases", label: "Release & Platform Mode" },
      // Money across every club: only with commercial visibility.
      { href: "/admin/commercial", label: "Commercial", needs: ["site.commercial.view"] },
      // Step 0 found this finished surface -- Safeguarding Officer capability control across every
      // club -- linked from nothing but its own action file.
      { href: "/admin/safeguarding", label: "Safeguarding Officers", needs: ["site.users.view"] },
    ]
    for (const section of siteSections) {
      if (!section.needs || section.needs.some(holds)) items.push({ href: section.href, label: section.label })
    }
  }

  return {
    primary: items,
    roleLabel: activeContext.roleLabel,
    clubName: activeContext.label,
    clubLogoUrl: activeContext.logoUrl,
  }
}
