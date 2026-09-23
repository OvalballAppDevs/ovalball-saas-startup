import "server-only"

/**
 * Moved to `packages/contracts/src/club/home-content` so React Native can reach
 * it, and re-exported here under its existing names so nothing on the web had to
 * change.
 *
 * WHY IT MOVED. The app's home screen shows the club's notices, and it must show
 * the SAME notices under the same two rules -- PUBLISHED and inside its window,
 * with PUBLIC vs MEMBERS left entirely to RLS. A second query written for the
 * phone would have agreed until the first time one of them was touched.
 *
 * `server-only` stays on this side, as it does for every other module the two
 * clients now share: it was always a bundling directive rather than a secret,
 * and the reader takes an already-authenticated client.
 */

export { listLiveClubNotices as listLiveAnnouncements } from "@ovalball/contracts/club/home-content"
export type { ClubNotice as ClubAnnouncement } from "@ovalball/contracts/club/home-content"
