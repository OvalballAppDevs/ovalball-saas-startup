/**
 * WHOSE ANSWER IS THIS, AND WHAT IS IT ABOUT.
 *
 * The question is contextual and the design is not. An adult player answering
 * for themselves reads "Can you make it?"; a guardian answering for a child
 * reads "Can Harry make it?"; and the verb changes for training because a
 * session is not a match. Everything else -- the control, the order, the
 * colours, the icons, the spacing -- is identical, which is what makes the two
 * surfaces one product rather than two.
 *
 * WHY THE SENTENCE IS BUILT HERE. Four surfaces ask it: Match Centre, Training
 * Centre, and the Agenda row on each client. Left to themselves they produced
 * "Can you make it?", "Can you make training?", and an Agenda that asked nothing
 * at all and simply labelled three buttons. A parent with two children on a
 * phone needs to know which child a control belongs to before they tap it, and
 * that is the same need on both clients.
 *
 * FIRST NAME ONLY, and never a surname. The person being asked is a member of
 * this family; "Can Harry Whitfield make it?" is how a letter from a solicitor
 * opens. The first name comes from the canonical `players.first_name`, which is
 * normalised server-side -- never re-formatted here.
 */

export type AvailabilityEventKind = "fixture" | "training"

/** The question a person is actually being asked. */
export function availabilityQuestion(kind: AvailabilityEventKind, isSelf: boolean, firstName: string): string {
  const verb = kind === "training" ? "make training" : "make it"
  if (isSelf) return `Can you ${verb}?`
  const name = firstName.trim()
  return name.length > 0 ? `Can ${name} ${verb}?` : `Can they ${verb}?`
}

/**
 * WHOSE answer, for an accessible label. "you" for the viewer's own rugby, the
 * child's first name otherwise -- the same two cases the question has, so the
 * two cannot disagree about who is being asked.
 */
export function availabilitySubject(isSelf: boolean, firstName: string): string {
  if (isSelf) return "you"
  const name = firstName.trim()
  return name.length > 0 ? name : "this player"
}

/**
 * WHAT is being answered, for an accessible label. Short on purpose: it follows
 * the subject inside one control's name, and the page already says which fixture
 * or session this is.
 */
export function availabilityEventLabel(kind: AvailabilityEventKind, dateLabel: string): string {
  return kind === "training" ? `training on ${dateLabel}` : `the match on ${dateLabel}`
}

/**
 * THE LINE SHOWN WHEN SOMEBODY HAS NOT ANSWERED YET.
 *
 * Present tense and no reproach. "You haven't responded yet" is a state of the
 * record, not a judgement of the person, and it is the same sentence whichever
 * surface they are looking at.
 */
export const NO_ANSWER_YET = "You haven't responded yet."

/**
 * The line shown while a write is in flight, on the one button being written.
 *
 * ONE BUTTON, NOT ALL THREE. A control that greys out entirely while saving
 * loses which answer was chosen, and on a slow connection that is exactly the
 * moment somebody needs to see it.
 */
export const SAVING_LABEL = "Saving…"

/**
 * WHAT IS NOW TRUE OF THE PERSON, once an answer has landed.
 *
 * Owner decision O-4: a confirmation is a STATEMENT ABOUT THE CHILD, not a report
 * that a record was written. "Pippa can attend training on Saturday 18 October at
 * Prairie Playing Fields" tells a parent the thing they wanted to know; "Response
 * saved" tells them about the database.
 *
 * FIRST NAME ONLY, and "You" for somebody answering about themselves -- the same
 * two cases `availabilityQuestion` has, so the question and the answer cannot
 * disagree about who was being asked.
 *
 * IT SAYS NOTHING ABOUT ANYBODY HAVING BEEN TOLD. Turning an availability answer
 * into a notification for the coach is a real platform gap rather than something
 * either client may imply, so this sentence stops at what the record now says.
 *
 * EVERY VALUE IS CANONICAL: the state comes from the three the database accepts,
 * the date label from the agenda's own formatter, the venue from the event.
 */
export function attendanceConfirmation(input: {
  status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"
  /** The child's first name, or null when the person is answering about themselves. */
  subjectFirstName: string | null
  kind: AvailabilityEventKind
  /** The date in the agenda's own words -- "Saturday 18 October". */
  whenLabel: string
  venueName?: string | null
}): string {
  const subject = input.subjectFirstName?.trim() || "You"
  const event = input.kind === "training" ? "training" : "the match"
  // "Might attend" for Unsure, because UNSURE IS A RECORDED ANSWER rather than a
  // failure to give one, and the sentence has to read like one.
  const verb = { ATTENDING: "can attend", CANNOT_ATTEND: "cannot attend", UNSURE: "might attend" }[input.status]
  const where = input.venueName?.trim() ? ` at ${input.venueName.trim()}` : ""
  return `${subject} ${verb} ${event} on ${input.whenLabel}${where}.`
}
