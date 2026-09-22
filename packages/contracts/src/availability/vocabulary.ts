/**
 * TWO VOCABULARIES FOR FOUR STATES, AND EXACTLY TWO.
 *
 * A register DESCRIBES somebody -- "Harry can't attend" -- and a control lets
 * that person ANSWER -- "Not Available". Those are different jobs and they
 * legitimately use different words. What is not legitimate is a third set, or a
 * fourth.
 *
 * WHAT WAS ACTUALLY WRONG. `lib/attendance/vocabulary.ts` fixed the register
 * words after CANNOT_ATTEND had rendered as "Can't make it" in the training
 * register, "Can't attend" in the Match Centre register and "Cannot attend" in
 * the Calendar's quick look. It did not cover the ANSWER words, and the drift
 * simply moved: the shared control asked "I'm available / Not available /
 * Unsure" while the Agenda's own inline control asked "Can Attend / Can't
 * Attend / Maybe". One product, one question, two sets of buttons -- and a
 * parent who answers on the Agenda and then opens Match Centre sees their
 * answer described in words they were not offered.
 *
 * THE ANSWER WORDS ARE TITLE CASE, the register words are not. That is the
 * content standard rather than a preference: buttons and form labels are Title
 * Case, and body copy -- which is what a register row, a count label and a
 * status line are -- is UK English sentence case. The previous answer labels
 * were sentence case, which is what made "Can Attend" look like the correct one
 * and "I'm available" like the mistake. Both were half right.
 *
 * WHY THIS MODULE HOLDS NO RENDERER. It lived inside a `"use client"` component
 * once. A server component importing a plain value from a client module gets a
 * client-reference proxy rather than the value, so every register label rendered
 * as an EMPTY STRING -- a bare icon and a number. Caught in a browser, because
 * nothing in a type-check or a test suite renders a page. It has no directive at
 * all, and now no web dependency either, so both clients import the real value.
 */

import type { AttendanceGroupKey, AvailabilityStatus } from "./states"

/**
 * THIRD PERSON, sentence case. What a register, a count tile, a filter chip and
 * a summary call each state when they are describing a person.
 */
export const ATTENDANCE_STATE_WORDS: Record<AttendanceGroupKey, string> = {
  ATTENDING: "Attending",
  UNSURE: "Unsure",
  CANNOT_ATTEND: "Can't attend",
  AWAITING: "Awaiting",
}

/**
 * FIRST PERSON, Title Case. What the three buttons say to the person answering
 * -- about themselves, or on behalf of a child they are answering for.
 *
 * "Unsure" is deliberately the same word in both vocabularies. There is no
 * first-person form of it that is any clearer, and "Maybe" -- which the Agenda
 * used -- reads as a lighter commitment than the register's "Unsure" describes.
 */
export const ATTENDANCE_ANSWER_WORDS: Record<AvailabilityStatus, string> = {
  ATTENDING: "I'm Available",
  CANNOT_ATTEND: "Not Available",
  UNSURE: "Unsure",
}

/**
 * The accessible sentence for one answer control, so a screen on which the same
 * three buttons repeat for four children does not announce "I'm Available" four
 * times with nothing to tell them apart.
 *
 * WHO and WHAT, always in that order: "I'm Available — Harry, Saturday's match".
 */
export function answerControlLabel(status: AvailabilityStatus, subject: string, what: string): string {
  return `${ATTENDANCE_ANSWER_WORDS[status]} — ${subject}, ${what}`
}

/** What a register row's state is called when it is read out rather than seen. Identical to the visible word, because the visible word is already a sentence. */
export function spokenState(key: AttendanceGroupKey): string {
  return ATTENDANCE_STATE_WORDS[key]
}
