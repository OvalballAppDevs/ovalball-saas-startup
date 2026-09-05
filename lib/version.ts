import packageJson from "../package.json"

/**
 * The application release version -- changes on every ordinary deploy,
 * and never affects whether an existing auth session stays valid (see
 * lib/auth/session-version.ts for that separate, deliberately
 * infrequently-changing concern). Safe to display anywhere (footer,
 * Profile, Site Admin System Health): no secrets, no connection strings,
 * just a package version and a short git SHA captured at build time
 * (next.config.ts).
 */
export const APP_VERSION = packageJson.version
export const APP_BUILD_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown"
