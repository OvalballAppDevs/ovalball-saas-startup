import type { ActiveContextKind } from "./active-context"

export type IdentityAvatarKind = "club" | "person" | "brand"

export interface IdentityDisplay {
  avatarKind: IdentityAvatarKind
  nameLabel: string
  subLabel: string
}

/**
 * What the sidebar identity block (desktop ContextSwitcher + the mobile
 * nav's slide-out header, which must render this identically) shows for
 * each of the four ActiveContextKind values. Previously both surfaces
 * decided this from `hasClub = ctx.clubMemberships.length > 0` -- a
 * SESSION-WIDE flag, not scoped to the context actually active. That made
 * the identity block wrong for two real, live-reachable cases: a Club
 * Admin who also holds Site Admin saw their club's crest/name while
 * switched INTO Site Admin (because the club membership row still existed
 * session-wide), and a Team Admin/Parent saw the TEAM's name as the
 * primary line with no indication of which person was signed in, because
 * `hasClub` only ever chose between "club identity" and "person identity",
 * never distinguishing team/parent (person-first) from site_admin
 * (brand-first). This function is the single place that decision is made,
 * driven only by which context is actually active -- both rendering
 * surfaces call it instead of re-deriving their own hasClub-style branch.
 */
export function resolveIdentityDisplay(
  kind: ActiveContextKind,
  input: { contextLabel: string; roleLabel: string; personName: string }
): IdentityDisplay {
  const personLabel = input.personName || "Ovalball User"
  switch (kind) {
    case "club":
      return { avatarKind: "club", nameLabel: input.contextLabel, subLabel: input.roleLabel }
    case "team":
      return { avatarKind: "person", nameLabel: personLabel, subLabel: `${input.contextLabel} ${input.roleLabel}` }
    case "parent":
      // roleLabel is either "Parent/Guardian" (canonical, Guardian-relationship-sourced)
      // or the legacy teamPermissionLabel() string for a not-yet-linked
      // view_only row (Relationship Registry §11/§40) -- shown as-is
      // either way rather than hardcoding one wording that would go stale
      // the moment a row is properly classified.
      return { avatarKind: "person", nameLabel: personLabel, subLabel: input.roleLabel }
    case "player":
      return { avatarKind: "person", nameLabel: personLabel, subLabel: `${input.contextLabel} Player` }
    case "site_admin":
      return { avatarKind: "brand", nameLabel: "Ovalball", subLabel: "Site Admin" }
  }
}

export interface ContextSettingsLink {
  href: string
  /** Explicit, scope-naming accessible label (Master Architecture Pass §17: "Burnley RUFC settings", never a bare "Settings") -- both the button's aria-label and its tooltip. */
  ariaLabel: string
}

/**
 * The settings gear in the identity block (desktop ContextSwitcher +
 * mobile nav header) is deliberately CONTEXT-AWARE, not a generic link to
 * /account -- "settings for whatever I am currently operating as", the
 * same principle every other consumer of ActiveContext in this app
 * already follows. Resolving the destination here (never inline in a
 * component) keeps both rendering surfaces identical and this is the one
 * place a future settings surface gets wired in.
 *
 * "club" -> /club/settings (the Club Settings hub -- Club Admin Information
 * Architecture pass: Club/Teams/Lookup Administration consolidated into
 * one destination; the club id itself is resolved server-side there via
 * activeManageableClubId, never passed in the URL). "team" -> /teams/:id,
 * the exact stable team_id of the active context, never a different team
 * the caller might also manage.
 *
 * "parent" and "player" deliberately have NO dedicated settings surface
 * yet (Master Architecture Pass §6/§7: "if a context has no meaningful
 * context-specific settings yet, use an appropriate safe behaviour and
 * report it") -- routing to Personal Settings is that safe behaviour: it
 * is real, it belongs to the signed-in human, and it is explicitly NOT
 * mislabelled as Parent- or Player-specific configuration (§6: "personal
 * identity editing should continue to go to Personal Settings"). Once a
 * genuine Parent/Player preferences surface exists, only this one branch
 * needs to change.
 *
 * "site_admin" returns null (gear hidden) -- Site Admin configuration is
 * spread across many canonical management surfaces (Seasons, Lookups,
 * Site Admins, Competitions, ...), not one settings page; inventing a
 * single destination here would be exactly the "invent an empty page to
 * satisfy the gear" the pass explicitly ruled out (§8).
 */
export function resolveContextSettingsLink(kind: ActiveContextKind, activeId: string | null, contextLabel: string): ContextSettingsLink | null {
  switch (kind) {
    case "club":
      return { href: "/club/settings", ariaLabel: `${contextLabel} settings` }
    case "team":
      return activeId ? { href: `/teams/${activeId}`, ariaLabel: `${contextLabel} settings` } : null
    case "parent":
    case "player":
      return { href: "/account", ariaLabel: "Your personal account settings" }
    case "site_admin":
      return null
  }
}
