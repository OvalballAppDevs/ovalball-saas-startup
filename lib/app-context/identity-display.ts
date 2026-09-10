import type { ActiveContextKind } from "./active-context"

export type IdentityAvatarKind = "club" | "person" | "brand" | "family"

export interface IdentityDisplay {
  avatarKind: IdentityAvatarKind
  nameLabel: string
  subLabel: string
  /**
   * Whether the person avatar may show the SIGNED-IN account's photo and
   * initials. False whenever the subject is somebody other than the viewer
   * -- today, a guardian's child.
   *
   * Naming the child but drawing the parent's avatar beside the name is the
   * same defect as the reported "clicking into Pippa still shows Callum",
   * only in the picture instead of the text: live UAT showed "DW" (Dana
   * Whitaker, the parent) sitting next to "Ben Whitaker". With a real
   * uploaded photo it is worse -- an adult's face captioned with a child's
   * name. Children have no avatar of their own yet, so callers fall back to
   * initials derived from nameLabel and pass no URL.
   */
  avatarUsesPersonPhoto: boolean
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
  input: {
    contextLabel: string
    roleLabel: string
    personName: string
    /** The child a Guardian-sourced "parent" context is about, when there is one. */
    subjectName?: string | null
  }
): IdentityDisplay {
  const personLabel = input.personName || "Ovalball User"
  switch (kind) {
    case "club":
      return { avatarKind: "club", nameLabel: input.contextLabel, subLabel: input.roleLabel, avatarUsesPersonPhoto: false }
    case "family":
      // THE IDENTITY BLOCK NAMES THE PERSON SIGNED IN.
      //
      // This used to read "All Children", which is a SCOPE, not a person: the
      // one place in the shell that says who you are was answering a different
      // question, and a parent looking at their own account saw a category
      // where their name belongs. "All Children" survives where it is
      // genuinely the answer -- as the selected entry in the context switcher
      // this block opens, which is where you go to change scope.
      //
      // The photo is correct here for the same reason it is in "player": the
      // subject IS the signed-in adult. The rule this file was written to
      // enforce -- never draw an adult's face beside a child's name -- is
      // untouched, because no child is being named.
      return { avatarKind: "person", nameLabel: personLabel, subLabel: input.roleLabel, avatarUsesPersonPhoto: true }
    case "team":
      return { avatarKind: "person", nameLabel: personLabel, subLabel: `${input.contextLabel} ${input.roleLabel}`, avatarUsesPersonPhoto: true }
    case "parent":
      // The SUBJECT of a child context is the child, not the signed-in
      // adult. This previously returned personLabel, so selecting "Pippa"
      // left the identity block reading the parent's own name and the child
      // disappeared from the one place that says what you are looking at --
      // reported live as "clicking into Pippa still shows Callum Krzysik".
      //
      // The adult's role stays on the second line, so it is still obvious
      // you are acting AS a guardian rather than as the child. A legacy
      // view_only "parent" row has no child to name and keeps the old
      // shape, roleLabel and all.
      if (input.subjectName) {
        return {
          avatarKind: "person",
          nameLabel: input.subjectName,
          subLabel: `${input.contextLabel} · ${input.roleLabel}`,
          avatarUsesPersonPhoto: false,
        }
      }
      return { avatarKind: "person", nameLabel: personLabel, subLabel: input.roleLabel, avatarUsesPersonPhoto: true }
    case "player":
      // A player context IS the signed-in person, so their own photo is right.
      return { avatarKind: "person", nameLabel: personLabel, subLabel: `${input.contextLabel} Player`, avatarUsesPersonPhoto: true }
    case "site_admin":
      return { avatarKind: "brand", nameLabel: "Ovalball", subLabel: "Site Admin", avatarUsesPersonPhoto: false }
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
    case "family":
      return { href: "/account", ariaLabel: "Your personal account settings" }
    case "site_admin":
      return null
  }
}
