/**
 * ONE SET OF WORDS FOR ONE SET OF STATES.
 *
 * A register, a filter and a summary all describe a person in the third person
 * -- "Harry can't attend" -- and must use the SAME word for it. They did not:
 * CANNOT_ATTEND rendered as "Can't make it" in the training register, "Can't
 * attend" in the Match Centre register and the Calendar filter, and "Cannot
 * attend" in the Calendar's quick look. One domain state, three names, four
 * surfaces.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT PART OF THE CONTROL.
 *
 * It lived in components/shared/availability-choice.tsx, which carries
 * "use client". A SERVER component importing a plain value from a client
 * module gets a client-reference proxy rather than the value, so every label
 * rendered as an EMPTY STRING -- the register's group headings and count tiles
 * came out as a bare icon and a number. Caught in the browser, because nothing
 * in a type-check or a test suite renders a page.
 *
 * So the vocabulary sits here, in a module with no directive at all, and both
 * the client control and the server-rendered registers import the real value.
 *
 * DELIBERATELY NOT THE BUTTON LABELS. AVAILABILITY_OPTIONS says "I'm
 * available" / "Not available" because there the person is answering ABOUT
 * THEMSELVES, in the first person. That is a different job from a register
 * describing them, and keeping the two apart is a distinction, not drift.
 */

export type AttendanceStateKey = "ATTENDING" | "UNSURE" | "CANNOT_ATTEND" | "AWAITING"

export const ATTENDANCE_STATE_WORDS: Record<AttendanceStateKey, string> = {
  ATTENDING: "Attending",
  UNSURE: "Unsure",
  CANNOT_ATTEND: "Can't attend",
  AWAITING: "Awaiting",
}
