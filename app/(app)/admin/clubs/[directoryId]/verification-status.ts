/**
 * Shared constants for club_directory.admin_verification_status -- kept out
 * of actions.ts because that file is "use server", which only allows async
 * function exports; a plain object/Set export breaks the build.
 */
export type AdminVerificationStatus = "VERIFIED" | "FAILED" | "TBD"

export const ADMIN_VERIFICATION_STATUSES = new Set<AdminVerificationStatus>(["VERIFIED", "FAILED", "TBD"])

/** The one place the glyph+text pairing is defined. Never colour alone: the glyph and the word are both always present. */
export const ADMIN_VERIFICATION_STATUS_LABELS: Record<AdminVerificationStatus, string> = {
  VERIFIED: "✓ Verified",
  FAILED: "✕ Verification Failed",
  TBD: "? TBD",
}
