import "server-only"

/**
 * SLICE 7e -- AB.1's thirteen detail tabs.
 *
 * The reconciliation recorded this row as PARTIALLY IMPLEMENTED with the words
 * "no tabs at all"; five panels were stacked down one page and seventeen of the
 * twenty-three master-control RPCs had no caller anywhere in the product. It
 * named three tabs outright -- Team Memberships, Invitations, Audit History --
 * and gave the completeness condition for the rest: every master-control RPC
 * must be reachable from a screen.
 *
 * These thirteen are the smallest coherent set satisfying both. Each one is the
 * answer to a question somebody actually arrives with, which is why Club Roles
 * is not folded into Club Memberships (Ovalball access, the real-world role and
 * team scope are three separate things, and the product has said so since Step
 * 2) and why the provenance timelines are separate rather than one merged feed
 * (a merged timeline reads well and is useless the moment somebody is looking
 * for one specific decision, which is the only moment anyone opens it).
 *
 * `site_family_history` is the one timeline that is NOT its own tab. It sits
 * inside Family, because a safeguarding question is never "what is the
 * relationship" and separately "who decided it" -- it is always both at once,
 * and splitting them across two tabs would make the answer take two clicks.
 * That frees the thirteenth slot for Audit History, which the reconciliation
 * names by name alongside Team Memberships and Invitations as a tab that does
 * not exist in any form.
 *
 * THE TAB IS URL STATE, NOT COMPONENT STATE. `?tab=` rather than useState, for
 * three reasons that all turned out to matter: an administrator can send a
 * colleague the exact tab they are looking at; only the active tab's data is
 * read, so opening a person's record does not fire three history RPCs and four
 * table reads nobody asked for; and a verification suite can address a tab
 * directly instead of clicking through to it.
 */

export interface UserDetailTab {
  key: string
  label: string
  /**
   * When present, the tab is not rendered at all unless the administrator holds
   * this capability. A tab whose every control would be refused is not a locked
   * door, it is noise -- and the panels behind these still ask again for each
   * individual control, because seeing a tab has never been authority.
   */
  viewCapability?: string
}

export const USER_DETAIL_TABS: readonly UserDetailTab[] = [
  { key: "overview", label: "Overview" },
  { key: "personal", label: "Personal Details", viewCapability: "site.users.view_personal" },
  { key: "security", label: "Account & Security" },
  { key: "clubs", label: "Club Memberships" },
  { key: "club-roles", label: "Club Roles" },
  { key: "teams", label: "Team Memberships" },
  { key: "family", label: "Family", viewCapability: "site.family.manage" },
  { key: "overrides", label: "Capability Overrides", viewCapability: "site.capabilities.override" },
  { key: "invitations", label: "Invitations" },
  { key: "site-admin", label: "Site Admin" },
  { key: "membership-history", label: "Membership History" },
  { key: "team-history", label: "Team History" },
  { key: "audit-history", label: "Audit History" },
]

export const DEFAULT_TAB = "overview"

export function resolveTab(requested: string | undefined, capabilities: ReadonlySet<string>): string {
  const visible = visibleTabs(capabilities)
  return visible.some((tab) => tab.key === requested) ? (requested as string) : DEFAULT_TAB
}

export function visibleTabs(capabilities: ReadonlySet<string>): UserDetailTab[] {
  return USER_DETAIL_TABS.filter((tab) => !tab.viewCapability || capabilities.has(tab.viewCapability))
}
