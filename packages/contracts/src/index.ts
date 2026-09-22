/**
 * OVALBALL SHARED CONTRACTS — what both clients are allowed to agree about.
 *
 * WHAT THIS PACKAGE IS FOR. The mobile app needs the same answers the website already has: who is
 * signed in, which rugby contexts that identity may operate as, which picture belongs to a person and
 * which belongs to a club. Every one of those was already written down once, correctly, inside
 * `lib/` -- and every one of them was unreachable from React Native only because the file said
 * `import "server-only"`. That directive was about Next.js bundling, not about secrecy: none of these
 * functions holds a credential, and each takes an ALREADY-AUTHENTICATED Supabase client and asks the
 * database questions that the database itself authorises.
 *
 * So nothing was rewritten for mobile. The modules moved here unchanged and `lib/` re-exports them, so
 * every existing web import path still resolves to the same implementation. If a rule changes, it
 * changes once and both clients change with it -- which is the only reason a shared package earns its
 * place.
 *
 * WHAT THIS PACKAGE IS NOT. It holds no authority. `listSwitchableContexts` decides which contexts a
 * person may SELECT; it does not decide what they may DO. Capabilities come from `internal.can` on the
 * server, through RPCs, every time, for both clients. A client that computed a capability would be
 * wrong the moment a Club Admin changed a permission, and would be a security boundary living on a
 * device an attacker owns.
 *
 * WHAT MAY BE ADDED. Platform-neutral domain rules and readers that are already correct on the web.
 * Nothing that imports `next/*`, `react`, `react-native`, `server-only`, a Node built-in, or a secret.
 * `packages/contracts/contracts.test.mts` fails the build if any of those appear.
 */

export * from "./active-context-rules"
export * from "./agenda"
export * from "./age-state"
export * from "./availability"
export * from "./club-logo"
export * from "./governing-body"
export * from "./governing-roles"
export * from "./conversation-parties"
export * from "./conversations"
export * from "./document-sharing"
export * from "./messenger-direct"
export * from "./messenger-rows"
export * from "./messenger-thread"
export * from "./messenger-thread-types"
export * from "./messenger-view-model"
export * from "./password-policy"
export * from "./support-conversations"
export * from "./support-types"
export * from "./weather/types"
export * from "./personal-avatar"
export * from "./resolve-identities"
/**
 * `role-labels` names two types that `session-context` also names -- ClubRole and
 * TeamPermissionValue. They are not a duplicate to be tidied away: session-context's are derived from
 * the generated schema row, role-labels' are the presentation unions, and on the web each module has
 * always been imported directly by callers who wanted that one. The barrel must not silently pick a
 * winner, so it re-exports the label module's other members and leaves those two to be imported from
 * `@ovalball/contracts/role-labels` explicitly, exactly as the web does today.
 */
export {
  CLUB_ROLE_LABEL,
  CLUB_ROLE_OPTIONS,
  TEAM_PERMISSION_LABEL,
  TEAM_PERMISSION_OPTIONS,
  TEAM_STAFF_PERMISSION_OPTIONS,
  clubRoleLabel,
  teamPermissionLabel,
} from "./role-labels"
export type { TeamStaffPermission } from "./role-labels"
export * from "./session-context"
export type { Database, Json } from "./database"
