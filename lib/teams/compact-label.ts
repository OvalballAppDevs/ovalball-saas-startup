/**
 * Moved to `packages/contracts/src/teams/compact-label` so React Native can
 * reach it, and re-exported here so nothing on the web had to change.
 *
 * WHY IT MOVED. The canonical naming rule says a team has two forms from one
 * structured source: the COMPACT form ("U12", "Girls U14") for dense surfaces
 * such as Calendar lanes and filter chips, and the DISPLAY form ("Under 12
 * Boys") everywhere else. The app's fixture filter is a dense surface and was
 * showing the display form, because the compact one was unreachable from it. A
 * second compact rule written in React Native would have been a naming
 * convention invented for one screen -- which is the thing the rule exists to
 * prevent.
 *
 * No `server-only` here: there never was one. The module derives a label from
 * structured fields and talks to nothing.
 */

export * from "@ovalball/contracts/teams/compact-label"
