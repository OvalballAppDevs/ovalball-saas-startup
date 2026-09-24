import type { SwitchableContext } from "../active-context-rules"

/**
 * THE ONBOARDING ROUTER (CA-M11): one place that answers "where should this journey continue?"
 *
 * A person signs into Ovalball once. Authentication proves who they are; the assurance level says how
 * sure we are; the canonical context list says what they legitimately hold; a remembered selection says
 * where they last stood. None of those is authority -- the server decides every read and write -- but
 * together they decide the first screen, and that decision must be made in one place rather than
 * scattered across gates, sheets and Home screens.
 *
 * Pure: array in, decision out. No client, no storage, no React.
 */
export type SessionPhase = "restoring" | "signed-out" | "needs-mfa" | "recovering" | "signed-in"

export type OnboardingState =
  | "RESTORING"
  | "SIGNED_OUT"
  | "MFA_REQUIRED"
  | "RECOVERY"
  | "INVITATION"
  | "NO_CONTEXT"
  | "ONE_CONTEXT"
  | "MULTI_CONTEXT_RESTORED"
  | "MULTI_CONTEXT_CHOOSE"

export interface OnboardingDecision {
  state: OnboardingState
  /** The context to stand in, where one is decided; null where the person must choose or holds none. */
  activeKey: string | null
  /** Whether the app should offer the switcher before showing a workspace. */
  askToChoose: boolean
}

export function resolveOnboardingState(input: {
  phase: SessionPhase
  contexts: SwitchableContext[]
  storedKey: string | null
  /** A held invitation intent (a token was opened before or during sign-in). */
  pendingInvitation: boolean
}): OnboardingDecision {
  const { phase, contexts, storedKey } = input
  if (phase === "restoring") return { state: "RESTORING", activeKey: null, askToChoose: false }
  if (phase === "signed-out") return { state: "SIGNED_OUT", activeKey: null, askToChoose: false }
  if (phase === "needs-mfa") return { state: "MFA_REQUIRED", activeKey: null, askToChoose: false }
  if (phase === "recovering") return { state: "RECOVERY", activeKey: null, askToChoose: false }
  if (input.pendingInvitation) return { state: "INVITATION", activeKey: null, askToChoose: false }

  if (contexts.length === 0) return { state: "NO_CONTEXT", activeKey: null, askToChoose: false }
  if (contexts.length === 1) return { state: "ONE_CONTEXT", activeKey: contexts[0].key, askToChoose: false }

  // MANY. A remembered context is restored only while it is still legitimately held; a stale one is not
  // "close enough" to another. With nothing valid remembered, the person is asked -- never handed the
  // broadest role by default.
  const remembered = storedKey ? contexts.find((c) => c.key === storedKey) ?? null : null
  if (remembered) return { state: "MULTI_CONTEXT_RESTORED", activeKey: remembered.key, askToChoose: false }
  return { state: "MULTI_CONTEXT_CHOOSE", activeKey: null, askToChoose: true }
}

/**
 * A REMOVED CONTEXT RECONCILES. After a refresh, a stored key that the live list no longer contains is
 * dropped, and the decision is made again from what is actually held. Returns the key to keep, or null.
 */
export function reconcileSelectedKey(contexts: SwitchableContext[], storedKey: string | null): string | null {
  if (!storedKey) return null
  return contexts.some((c) => c.key === storedKey) ? storedKey : null
}

/** Human words for a context kind, for the switcher and the no-context screen. Never the enum. */
export const CONTEXT_KIND_LABEL: Record<SwitchableContext["kind"], string> = {
  site_admin: "Ovalball",
  club: "Club",
  team: "Team",
  parent: "Parent / Guardian",
  player: "Player",
  family: "Family",
  governing: "Governing body",
}
