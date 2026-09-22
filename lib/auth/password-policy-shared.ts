/**
 * Moved to `packages/contracts` so the mobile app applies the SAME composition rules with the SAME
 * wording, and re-exported here so every existing web import still resolves.
 *
 * `lib/auth/password-policy.ts` remains the whole rule -- it adds the Have I Been Pwned check and
 * stays `server-only` for it.
 */

export * from "@ovalball/contracts/password-policy"
