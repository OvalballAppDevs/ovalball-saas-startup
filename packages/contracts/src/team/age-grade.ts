/**
 * THE AGE-GRADE ANSWER, in one set of words (Convergence Step 12; the one dispensation workflow,
 * 20270742000000).
 *
 * `team_age_grade_attention` and `my_player_age_grade_status` answer per player with a STATUS and a
 * SENTENCE -- never a date of birth, an age or anything medical. Both apps draw the status from here, so
 * a player's age grade never reads one way on the phone and another on the website. Statuses are
 * sentences in the content standard, so these are in sentence case.
 */

export type AgeGradeStatus =
  | "ELIGIBLE"
  | "OUTSIDE_AGE_GRADE"
  | "DISPENSATION_APPROVED"
  | "DISPENSATION_PENDING"
  | "AGE_EVIDENCE_REQUIRED"
  | "AGE_GRADE_NOT_ESTABLISHED"
  | "SEASON_NOT_ESTABLISHED"
  | "UNKNOWN_TEAM"

/** Human wording for a status. Never "invalid", never a label about the child. */
export const AGE_GRADE_STATUS_LABEL: Record<AgeGradeStatus, string> = {
  ELIGIBLE: "Eligible",
  OUTSIDE_AGE_GRADE: "Outside this age grade",
  DISPENSATION_APPROVED: "Dispensation approved",
  DISPENSATION_PENDING: "Dispensation pending",
  AGE_EVIDENCE_REQUIRED: "Date of birth needed",
  AGE_GRADE_NOT_ESTABLISHED: "Age grade not established",
  SEASON_NOT_ESTABLISHED: "Season not established",
  UNKNOWN_TEAM: "Team not found",
}

export function ageGradeStatusLabel(status: string): string {
  return AGE_GRADE_STATUS_LABEL[status as AgeGradeStatus] ?? "Age grade not established"
}
