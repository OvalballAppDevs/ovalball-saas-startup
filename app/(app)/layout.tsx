import { redirect } from "next/navigation"
import { cookies, headers } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, isFamilyFacingContext, listSwitchableContexts, resolveActiveContext } from "@/lib/app-context/active-context"
import { buildNavItems, buildSiteAdminSections } from "@/lib/app-context/build-nav-items"
import { getMessengerRows } from "@/lib/app-context/messenger-rows"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getRecentNotifications } from "@/lib/app-context/notifications"
import { getUnreadCounts } from "@/lib/app-context/unread"
import { resolvePersonalAvatarUrl } from "@/lib/app-context/personal-avatar"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getClubSetupState, isSetupAllowedPath, resumeStep } from "@/lib/club-setup/state"
import { hasCapability } from "@/lib/permissions/has-capability"
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
  const { primary, roleLabel, clubName, clubLogoUrl } = buildNavItems(ctx, activeContext)
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
  const { top: navTop, sections: navSections } =
    activeContext.kind === "site_admin"
      ? buildSiteAdminSections(navPrimary)
      : { top: [] as typeof navPrimary, sections: [] }

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
        style={{ "--app-banner-h": `${(betaState.mode === "beta" ? 36 : 0) + (diagnosticClub ? 44 : 0)}px` } as React.CSSProperties}
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
              clubLogoUrl={clubLogoUrl}
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
            top={navTop}
            sections={navSections}
            contexts={contexts}
            activeKey={activeContext.key}
            identityKind={activeContext.kind}
            clubName={clubName}
            clubLogoUrl={clubLogoUrl}
            roleLabel={roleLabel}
            personName={personName}
            personAvatarUrl={personAvatarUrl}
            notifications={notifications}
            unreadCount={unread.notifications}
            messagesUnreadCount={unread.messages}
            conversations={conversations}
            supportUnreadCount={unread.support}
          />
          <main className="relative min-w-0 flex-1">
            {setupGate ? <ClubSetupRequired clubName={setupGate.clubName} /> : children}
            <ContextSwitchOverlay />
          </main>
        </div>
        <AskOvie />
      </div>
    </SwitchContextProvider>
  )
}
