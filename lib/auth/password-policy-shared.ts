/**
 * The two numbers from Phase 2 E that a browser is allowed to know.
 *
 * `lib/auth/password-policy.ts` is `server-only` -- it holds the validator and the HaveIBeenPwned
 * check -- so a client component cannot import the constants from it without dragging the server
 * module into the client bundle. These live here so the rule can be SHOWN to somebody before they
 * type, while remaining enforced only on the server.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_BYTES = 72
