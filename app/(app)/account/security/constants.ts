/**
 * Plain constants, deliberately NOT in actions.ts.
 *
 * A "use server" module may only export async functions -- everything in it becomes a callable server
 * endpoint -- so a shared constant needs its own home rather than being smuggled in beside the actions.
 *
 * Phase 2 F: up to three verified TOTP factors, so somebody can keep a backup device. The number now
 * lives in the shared package (CA-M11), where the phone reads the same one.
 */
export { MAX_TOTP_FACTORS } from "@ovalball/contracts/auth"
