import { redirect } from "next/navigation"
import { cookies, headers } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, isFamilyFacingContext, listSwitchableContexts, resolveActiveContext } from "@/lib/app-context/active-context"
import { buildBottomBarItems, buildClubSections, buildNavItems, buildSiteAdminSections } from "@/lib/app-context/build-nav-items"
import { getMessengerRows } from "@/lib/app-context/messenger-rows"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getRecentNotifications } from "@/lib/app-context/notifications"
import { getUnreadCounts } from "@/lib/app-context/unread"
import { resolvePersonalAvatarUrl } from "@/lib/app-context/personal-avatar"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getClubSetupState, isSetupAllowedPath, resumeStep } from "@/lib/club-setup/state"
import { hasCapability } from "@/lib/permissions/has-capability"

import { resolveClubSettingsNavCapabilities } from "./club/settings/resolve-nav-capabilities"
import { getBetaBadgeState } from "@/lib/platform/mode"
import { getNewSupportTicketCount } from "@/lib/support/badges"
import { requireSession, sessionRefusal } from "@/lib/auth/require-session"
import { createClient } from "@/lib/supabase/server"

import { AskOvie } from "@/components/ovie/ask-ovie"
import { BetaBadge } from "@/components/platform/beta-badge"

import { AppMobileNav } from "./app-mobile-nav"
import { AppNav } from "./app-nav"
import { ContextSwitchOverlay } from "./context-switch-overlay"
import { ClubSetupRequired } from "./club-setup-required"
import { DiagnosticBanner } from "./diagnostic-banner"
import { ImpersonationBanner } from "./impersonation-banner"
import { SwitchContextProvider } from "./switch-context-provider"

/**
 * Guards every route in this group: authenticated + at least one active
 * club membership or Site Admin status required, or this redirects to
 * /welcome (the existing pending-state page, unchanged). This is a
 * convenience redirect for a good UX, not the actual security boundary --
 * every page/action underneath still hits its own RLS policy or
 * SECURITY DEFINER function regardless of whether someone reached it
 * through this guard.
 */
export default async function AuthenticatedAppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  // SLICE 6b.2 -- Phase 2 D.2 enforcement layer 2. This was `getUser()` and a redirect to /login,
  // which answers only "is anybody signed in". It now asks the one canonical question, which also
  // covers session liveness, account state and assurance, and says something different for each.
  //
  // THIS DOES NOT MAKE T0 INTO T1. requireSession reads `enforcement_required` from
  // my_session_assurance(), which is `not internal.session_aal_ok()`, so an AAL1 session passes
  // while no enforcement group is switched on. Asking for AAL2 here instead would redirect every
  // person on the platform to /security/verify on a platform with zero enrolled factors.
  //
  // NO REDIRECT LOOP IS POSSIBLE FROM HERE: every refusal destination -- /login, /security/enrol,
  // /security/verify -- is outside this route group, so none of them re-enters this layout.
  //
  // It is still not the boundary. internal.session_ok() is folded into can(), has_site_capability()
  // and a RESTRICTIVE policy on every non-public table; this is the early, explainable refusal.
  const decision = await requireSession({}, supabase)
  if (!decision.ok) {
    redirect(sessionRefusal(decision.reason).href)
  }
  const user = decision.user

  const ctx = await getSessionContext(supabase, user)

  // A pure Guardian and/or Player (no club_memberships row at all -- never
  // having joined a club as a general member, only ever registered as a
  // parent/player through the canonical Player/Guardian graph) is just as
  // legitimate an entry as a club member. Found live this pass: a
  // Guardian-only account was being bounced to /welcome ("we don't have a
  // club request on file yet"), which is both confusing and wrong -- they
  // have a real, canonical relationship, just not a club_memberships row.
  //
  // hasGuardianRelationship is counted straight from `guardians`, NOT from
  // guardianRelationships: the latter is a (player, ACTIVE team) product, so
  // it is empty for a guardian whose child has not been placed on a team
  // yet. That is the normal state right after a first-child request is
  // approved -- the club still has to assign the age group -- and gating on
  // the derived list sent a freshly-approved parent back to "we don't have a
  // club request on file yet". Found live in Phase 2B UAT.
  const hasAnyRealRelationship =
    ctx.clubMemberships.length > 0 ||
    ctx.teamPermissions.length > 0 ||
    ctx.guardianRelationships.length > 0 ||
    ctx.hasGuardianRelationship ||
    ctx.linkedPlayerTeams.length > 0
  //
  // ACCOUNT SECURITY IS THE EXCEPTION, and has to be. Everybody with an Ovalball account has account
  // security -- a password, an authenticator, recovery codes, the devices they are signed in on -- and
  // Phase 2's upgrade flow asks people to set those up before they have joined anything. Bouncing them
  // to /welcome would mean the one page they were sent to secure their account is the one page they
  // cannot reach. The rest of the product stays behind the relationship check, unchanged.
  const requestPath = (await headers()).get("x-ovalball-pathname") ?? ""
  const isAccountSecurity = requestPath.startsWith("/account/security")
  if (!ctx.isSiteAdmin && !hasAnyRealRelationship && !isAccountSecurity) {
    redirect("/welcome")
  }

  const cookieStore = await cookies()
  const contexts = listSwitchableContexts(ctx)
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // ONE RESOLUTION, THREE CONSUMERS.
  //
  // `resolveClubSettingsNavCapabilities` is the canonical club decision, and `hasCapability` batches
  // every question about one scope into a single request-cached `my_capabilities` call -- so asking it
  // here costs one round trip and gives navigation, the Club Settings hub and the club page the same
  // answers. Step 0's one confirmed regression was the hub deciding this for itself and hiding two
  // finished features from somebody who held their capabilities.
  const navClubId = activeClubId(ctx, activeContext)
  const clubNavCapabilities = navClubId ? await resolveClubSettingsNavCapabilities(supabase, navClubId) : null
  // Whether the active team's subscription state is visible to this session, asked of the capability
  // engine at TEAM scope. Navigation is presentation, so it is told the answer rather than working it
  // out -- and the page behind the link re-checks it regardless.
  const teamFinance =
    activeContext.kind === "team" && activeContext.id
      ? await hasCapability(supabase, "finance.subscription.view", "team", {
          clubId: activeContext.clubId,
          teamId: activeContext.id,
        })
      : false
  // Clubhouse Programme Section 2: whether the active TEAM holds fixture-request authority --
  // discovering opposition and finding a fixture are team-level outcomes, so the nav link's own
  // visibility is asked at team scope, the same shape as teamFinance immediately above.
  const teamClubhouseAccess =
    activeContext.kind === "team" && activeContext.id
      ? (await hasCapability(supabase, "fixture.request.create", "team", { clubId: activeContext.clubId, teamId: activeContext.id })) ||
        (await hasCapability(supabase, "fixture.request.respond", "team", { clubId: activeContext.clubId, teamId: activeContext.id }))
      : false
  const { primary, roleLabel, clubName } = buildNavItems(ctx, activeContext, clubNavCapabilities, teamFinance, teamClubhouseAccess)
  // ONE UNREAD READ FOR THREE BADGES. getUnreadCounts is the single source:
  // the bell, Messenger and Support each take their own slice of it, so no
  // notification is counted in two places and clearing one badge moves the
  // one that was double-counting it.
  const [notifications, unread, conversations, newSupportTicketCount, { data: profile }, diagnosticClub, betaState] =
    await Promise.all([
      getRecentNotifications(supabase),
      getUnreadCounts(supabase),
      // The SAME rows /messages lists. The compact Messenger and the
      // workspace are one product, so they read one query.
      getMessengerRows(supabase, ctx, user.id, { includeClubToClub: !isFamilyFacingContext(activeContext.kind) }),
      ctx.isSiteAdmin ? getNewSupportTicketCount(supabase) : Promise.resolve(0),
      supabase.from("profiles").select("first_name, surname, avatar_storage_path").eq("id", user.id).maybeSingle(),
      ctx.isSiteAdmin ? resolveDiagnosticClub(supabase, cookieStore.get(DIAGNOSTIC_SESSION_COOKIE)?.value ?? null) : Promise.resolve(null),
      getBetaBadgeState(supabase),
    ])

  // ---------------------------------------------------------------
  // First-run activation gate.
  //
  // A club that has not finished setup is not usable: no logo, no home
  // venue, no pitch, no confirmed teams. An authorised Club Admin is sent to
  // finish it; anyone else is shown a bounded explanation rather than a
  // half-working application or an unexplained blank page.
  //
  // Enforced here, on the server, rather than by a dismissible client modal
  // -- and never on a path the gate itself needs, so it cannot loop. Account,
  // support and context switching stay reachable throughout, because being
  // asked to finish setup must not mean being unable to sign out or move to
  // a different club.
  //
  // Clubs that pre-date this lifecycle were grandfathered COMPLETED, so no
  // working club is ever gated by its introduction.
  // ---------------------------------------------------------------
  const pathname = (await headers()).get("x-ovalball-pathname") ?? ""
  let setupGate: { clubName: string; canComplete: boolean } | null = null
  let setupInProgress = false

  // Resolved from the context's CLUB, not from its kind. A Team Admin,
  // coach, parent and player at an unset-up club are looking at the same
  // empty application a Club Admin would be -- no venues, no pitches, an
  // unconfirmed team list -- and every one of those contexts carries the
  // club it belongs to. Keying the gate on `kind === "club"` had meant only
  // a Fixture Secretary ever saw the explanation.
  const contextClubId = activeContext.clubId ?? (activeContext.kind === "club" ? activeContext.id : null)

  // SLICE 9: whose authority is this request using? The server asks its OWN session table, keyed by
  // the real signed-in person -- the browser is never consulted, so there is nothing to forge.
  const { data: actingAsRows } = await supabase.rpc("my_impersonation")
  const actingAs = actingAsRows?.[0]
    ? {
        sessionId: actingAsRows[0].session_id,
        targetName: actingAsRows[0].target_name,
        viewOnly: actingAsRows[0].view_only,
        expiresAt: actingAsRows[0].expires_at,
      }
    : null

  if (contextClubId && !diagnosticClub) {
    const setup = await getClubSetupState(supabase, contextClubId)
    if (setup && setup.status !== "COMPLETED") {
      const canComplete = await hasCapability(supabase, "club.profile.edit", "club", { clubId: contextClubId })
      if (canComplete) {
        if (!isSetupAllowedPath(pathname)) {
          redirect(`/club/setup?step=${resumeStep(setup.requirements)}`)
        }
        setupInProgress = true
      } else if (!isSetupAllowedPath(pathname)) {
        // No redirect: a coach has nowhere useful to be sent. The shell still
        // renders, so they keep their nav, their context switcher and their
        // way out.
        //
        // The club's own name, read from the directory -- NOT the nav's
        // `clubName`, which is the active context's label and in a team
        // context is the team. "Men's 1st isn't ready yet" told a coach the
        // wrong thing was unfinished.
        const { data: gateClub } = await supabase
          .from("clubs")
          .select("slug, club_directory(name)")
          .eq("id", contextClubId)
          .maybeSingle()
        setupGate = {
          clubName: gateClub?.club_directory?.name ?? gateClub?.slug ?? "This club",
          canComplete: false,
        }
      }
    }
  }

  const personName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ")
  const personAvatarUrl = await resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path)

  const primaryWithBadges = primary.map((item) =>
    item.href === "/admin/support" && newSupportTicketCount > 0 ? { ...item, badge: newSupportTicketCount } : item
  )

  // While a Club Admin is finishing setup, the nav shows only what the gate
  // will actually let them open. Offering Fixtures and Calendar during
  // onboarding produced links that silently bounced back to the wizard,
  // which reads as a broken app rather than a deliberate sequence. The
  // context switcher, notifications and account menu are part of AppNav's
  // own chrome and are untouched, so a multi-club person can still leave.
  const navPrimary = setupInProgress
    ? [
        { href: "/club/setup", label: "Set up your club" },
        ...primaryWithBadges.filter((item) => isSetupAllowedPath(item.href)),
      ]
    : primaryWithBadges

  // Grouping is applied to the ALREADY capability-filtered list, and only in
  // a Site Admin context -- Club/Team/Parent/Player keep their existing flat
  // navigation untouched. Both the sidebar and the drawer receive the same
  // two structures, so the two surfaces cannot drift into different
  // taxonomies.
  // Grouping is applied to the ALREADY capability-filtered list, never instead of filtering it. Both
  // the sidebar and the drawer receive the same two structures, so the two surfaces cannot drift into
  // different taxonomies -- and a club now gets the same treatment Site Admin has had all along.
  // Setup is deliberately left flat: a half-built club has four destinations and grouping them would
  // be ceremony.
  const { top: navTop, sections: navSections } = setupInProgress
    ? { top: [] as typeof navPrimary, sections: [] }
    : activeContext.kind === "site_admin"
      ? buildSiteAdminSections(navPrimary)
      : activeContext.kind === "club" || activeContext.kind === "team"
        ? buildClubSections(navPrimary, activeContext.kind === "team" ? activeContext.id : null)
        : { top: [] as typeof navPrimary, sections: [] }

  // UX-4's bottom bar, chosen from the same already-capability-filtered list the sidebar renders. Empty
  // while a club is still being set up, for the same reason the sections are: four destinations and a
  // half-built club do not need a shortcut bar.
  const navBottom = setupInProgress
    ? []
    : buildBottomBarItems(navPrimary, activeContext.kind, activeContext.kind === "team" ? activeContext.id : null)

  return (
    <SwitchContextProvider>
      {/*
        HOW TALL THE CHROME ABOVE THE APPLICATION IS.
        The sidebar claims md:h-screen -- a full 100dvh -- which is correct
        only when nothing sits above it. With the Beta strip or the diagnostic
        banner present the whole row was pushed down while still claiming the
        full viewport, so every authenticated page scrolled by exactly the
        banner height. Harmless on a document page; on Messenger it pushed the
        composer below the fold.
        Published here because this is the only place that knows which banners
        are rendered.
      */}
      <div
        className="flex min-h-screen flex-col bg-chalk"
        style={{ "--app-banner-h": `${(betaState.mode === "beta" ? 36 : 0) + (diagnosticClub ? 44 : 0) + (actingAs ? 44 : 0)}px` } as React.CSSProperties}
      >
        {/* ONE Beta indicator for every authenticated role -- Site Admin,
            Club Admin, Team Admin, Parent and Player all render through this
            shell, so none of them needs its own. Renders nothing at all when
            the platform is Live. */}
        {betaState.mode === "beta" && (
          <div className="flex justify-center border-b border-purple-200 bg-purple-50 px-4 py-1.5">
            <BetaBadge state={betaState} />
          </div>
        )}
        {diagnosticClub && <DiagnosticBanner diagnosticClub={diagnosticClub} />}
        {/* SLICE 9. Beside the diagnostic strip because it answers the same question -- am I seeing
            this as myself? -- and above everything else, so it cannot be scrolled away from. */}
        {actingAs && <ImpersonationBanner session={actingAs} />}
        <div className="flex flex-1 flex-col md:flex-row">
          <div className="hidden md:block">
            <AppNav
              primaryItems={navPrimary}
              top={navTop}
              sections={navSections}
              contexts={contexts}
              activeKey={activeContext.key}
              identityKind={activeContext.kind}
              clubName={clubName}
              roleLabel={roleLabel}
              personName={personName}
              personAvatarUrl={personAvatarUrl}
              notifications={notifications}
              unreadCount={unread.notifications}
            messagesUnreadCount={unread.messages}
              conversations={conversations}
              supportUnreadCount={unread.support}
            />
          </div>
          <AppMobileNav
            primaryItems={navPrimary}
            bottomItems={navBottom}
            top={navTop}
            sections={navSections}
            contexts={contexts}
            activeKey={activeContext.key}
            identityKind={activeContext.kind}
            clubName={clubName}
            roleLabel={roleLabel}
            personName={personName}
            personAvatarUrl={personAvatarUrl}
            notifications={notifications}
            unreadCount={unread.notifications}
            messagesUnreadCount={unread.messages}
            conversations={conversations}
            supportUnreadCount={unread.support}
          />
          {/* THE SHELL RESERVES THE SPACE ITS OWN FURNITURE OCCUPIES.
              UX-4's named defect was that the floating "Ask Ovie" widget -- fixed bottom-right on every
              authenticated page -- sat over the bottom of the content, and the compensation was a
              per-page `pb-28` that exactly EIGHT files remembered to add. A rule most pages do not
              follow is the wrong shape of fix: a page should not have to know what the shell is
              floating over it.
              So it is reserved once, here. On a phone the reserve also clears the bottom bar; on
              desktop there is no bottom bar and only the widget to clear. env(safe-area-inset-bottom)
              keeps both above a home indicator. */}
          <main className="relative min-w-0 flex-1 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-24">
            {setupGate ? <ClubSetupRequired clubName={setupGate.clubName} /> : children}
            <ContextSwitchOverlay />
          </main>
        </div>
        <AskOvie />
      </div>
    </SwitchContextProvider>
  )
}
