import "server-only"

/** CA-M11.1: the board's read model lives in the shared package; the website keeps this path. */
export { getPitchAllocationBoard, type EventOccupancy, type PitchAllocationBoard } from "@ovalball/contracts/pitch-allocation/board"
