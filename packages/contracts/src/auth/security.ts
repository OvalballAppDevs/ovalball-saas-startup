/**
 * SECURITY OPERATIONS -- what a person may do to their own account, on either client.
 *
 * Every operation here is a canonical server operation the website already offers. The phone offers
 * the same set through the same RPCs, with the same assurance rules. Nothing is invented for the phone
 * and nothing is left off it by accident: an operation the website has and the phone lacks is a
 * deliberate hand-off, named as such.
 */

/** The change kinds `record_my_security_change` accepts. Anything else raises 22023 on the server. */
export const SECURITY_CHANGE_KINDS = ["PASSWORD_SET", "PASSWORD_RESET", "MFA_ENROLLED", "MFA_FACTOR_REMOVED", "SESSIONS_REVOKED"] as const
export type SecurityChangeKind = (typeof SECURITY_CHANGE_KINDS)[number]

export type SessionRow = {
  session_id: string
  created_at: string | null
  refreshed_at: string | null
  user_agent: string | null
  aal: string | null
  is_current: boolean
}

export type SessionAssurance = {
  account_usable: boolean
  session_live: boolean
  aal: "aal1" | "aal2" | string | null
  enforcement_required: boolean
  recent_aal2: boolean
  enforcement_group: string | null
}

export function interpretAssurance(data: unknown): SessionAssurance | null {
  if (!data || typeof data !== "object") return null
  const r = data as Record<string, unknown>
  return {
    account_usable: r.account_usable === true,
    session_live: r.session_live === true,
    aal: typeof r.aal === "string" ? r.aal : null,
    enforcement_required: r.enforcement_required === true,
    recent_aal2: r.recent_aal2 === true,
    enforcement_group: typeof r.enforcement_group === "string" ? r.enforcement_group : null,
  }
}

/** A device from its user agent, in words -- never the raw string, which is noise to a person. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ""
  if (/Ovalball|Expo|okhttp|CFNetwork/i.test(ua) && /iPhone|iOS|Darwin/i.test(ua)) return "Ovalball on iPhone"
  if (/Ovalball|Expo|okhttp/i.test(ua) && /Android/i.test(ua)) return "Ovalball on Android"
  if (/iPhone/i.test(ua)) return "iPhone"
  if (/iPad/i.test(ua)) return "iPad"
  if (/Android/i.test(ua)) return "Android device"
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows computer"
  if (/Linux/i.test(ua)) return "Linux computer"
  return ua ? "Another device" : "Unknown device"
}

export function browserOf(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? ""
  if (/Edg\//.test(ua)) return "Edge"
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome"
  if (/Firefox\//.test(ua)) return "Firefox"
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari"
  return null
}

/** The other sessions a "sign out other devices" would end. The current one is never counted. */
export function otherSessions(rows: readonly SessionRow[] | null | undefined): SessionRow[] {
  return (rows ?? []).filter((r) => !r.is_current)
}

/**
 * Which security operations need a recent second factor. This mirrors the server, which is the only
 * place it is enforced: `sign_out_my_other_devices` and `regenerate_my_recovery_codes` demand
 * `internal.recent_aal2(10)`; setting a password and enrolling do not. The phone reads this to know
 * whether to ask for a code BEFORE the server refuses, never instead of it.
 */
export const RECENT_AUTH_OPERATIONS = ["SIGN_OUT_OTHER_DEVICES", "REGENERATE_RECOVERY_CODES"] as const
export type SecurityOperation = "CHANGE_PASSWORD" | "ENROL_TOTP" | "REMOVE_TOTP" | (typeof RECENT_AUTH_OPERATIONS)[number]

export function needsRecentAuth(operation: SecurityOperation): boolean {
  return (RECENT_AUTH_OPERATIONS as readonly string[]).includes(operation)
}
