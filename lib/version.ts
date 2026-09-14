/**
 * The build identity -- the short git SHA captured at build time
 * (next.config.ts). Which code is deployed, for Site Admin System Health and
 * for recording a release.
 *
 * There is deliberately NO product version here. Ovalball's version is the
 * release a Site Admin publishes in Release & Platform Mode, read through
 * getBetaBadgeState (lib/platform/mode.ts). package.json's version is npm
 * metadata; it used to be exported from this file as a version constant and rendered
 * as the product version, and it drifted to 0.0.1 while the published release
 * was 0.0.3. supabase/tests/js/release_version.test.mts keeps it from coming back.
 */
export const APP_BUILD_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown"
