/**
 * CA-M11.1: the one place the occupied window is calculated -- now in the shared package, so the website and the phone compute the
 * same answer from the same code. The website keeps this import path; the implementation lives in
 * `packages/contracts/src/pitch-allocation/occupancy.ts`.
 */
export * from "@ovalball/contracts/pitch-allocation/occupancy"
