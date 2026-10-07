import TrainingCentre from "../../calendar/training/[sessionId]"

/**
 * THE SAME TRAINING CENTRE, OPENED FROM ADMIN -- a second address, not a second page (`src/links/stack.ts`).
 * Arena Planning opens a session here, inside the Admin stack, so Back returns to the day being planned
 * rather than to the Calendar.
 */
export default TrainingCentre
