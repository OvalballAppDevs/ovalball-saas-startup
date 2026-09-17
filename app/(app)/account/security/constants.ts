/**
 * Plain constants, deliberately NOT in actions.ts.
 *
 * A "use server" module may only export async functions -- everything in it becomes a callable server
 * endpoint -- so a shared constant needs its own home rather than being smuggled in beside the actions.
 */

/** Phase 2 F: up to three verified TOTP factors, so somebody can keep a backup device. */
export const MAX_TOTP_FACTORS = 3
