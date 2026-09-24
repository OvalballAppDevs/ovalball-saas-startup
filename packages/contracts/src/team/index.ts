/**
 * TEAM OPERATIONS -- the shared half of the Team workspace (CA-M7).
 *
 * The website and the app both read a team through these modules: what may I do here (`authority`), what
 * needs me (`attention`, `overview`), who is in it (`people`), what is it being asked (`requests`), and how
 * is the squad's money (`subscriptions`). Nothing here holds authority; every read is the caller's own
 * client under RLS, and every write is a canonical operation that re-decides.
 */
export * from "./attention"
export * from "./authority"
export * from "./overview"
export * from "./people"
export * from "./players"
export * from "./requests"
export * from "./subscriptions"
