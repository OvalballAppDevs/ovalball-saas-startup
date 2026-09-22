/**
 * THE FOUR ANSWERS OVALBALL HAS, AND THE ORDER THEY ARE ALWAYS IN.
 *
 * ONE PRODUCT, ONE SET OF STATES. A person says one of three things -- they can
 * come, they cannot, or they do not yet know -- and until they say any of them
 * there is no row at all. That is the whole model, it is the database's own
 * (`player_fixture_attendance.status`, plus absence), and it is identical for a
 * matchday and for a training session because it is the same question about the
 * same person.
 *
 * WHY THIS MODULE IS PLATFORM-NEUTRAL. Match Centre, Training Centre, the
 * Agenda, the Calendar filter, the club registers and both clients all describe
 * these four states. Every one of them used to name them, order them and colour
 * them for itself, which is how "Can't attend", "Can't make it" and "Cannot
 * attend" all came to mean the same thing on one product. The words, the order,
 * the semantic tone and the icon now come from here, so a client chooses only
 * how to DRAW them.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   * AUTHORITY. Whether a given person may answer for a given player is
 *     `internal.resolve_attendance_response_source` and nothing else. A client
 *     that computed it would be a security boundary on a device an attacker
 *     owns.
 *   * A DEADLINE. Ovalball has no availability deadline. It has a 14-day ASK
 *     WINDOW (`RESPONSE_HORIZON_DAYS`), which decides when somebody is invited
 *     and prompted -- not when they are locked out. An expiry invented in a
 *     component would be a product decision made in a component.
 *   * SELECTION. Saying "I'm available" tells the club you are free. It does
 *     not put you in the team, and nothing in this module implies it does.
 */

/** What a person can actually say. The database's own three values. */
export type AvailabilityStatus = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"

/** The three answers plus the absence of one, which is how a register groups people. */
export type AttendanceGroupKey = AvailabilityStatus | "AWAITING"

/**
 * THE CANONICAL GROUP ORDER: said yes, not sure, said no, has not said.
 *
 * Settled-positive first and unanswered last, because a register is read to
 * find out what is still unknown and the unknown is what gets acted on. This is
 * the order Match Centre's participant list has always used and the one the
 * training register was brought into line with; nothing may re-sort it locally.
 */
export const ATTENDANCE_GROUP_ORDER: readonly AttendanceGroupKey[] = ["ATTENDING", "UNSURE", "CANNOT_ATTEND", "AWAITING"] as const

/**
 * THE CANONICAL ANSWER ORDER, which is NOT the group order.
 *
 * A person answering reaches for yes, no, or not-sure -- the two decided
 * answers adjacent, the hedge last -- and the three buttons have sat in that
 * order since the control existed. A parent answering four things on a Tuesday
 * evening is recognising positions, not reading, so this order is a promise.
 */
export const AVAILABILITY_ANSWER_ORDER: readonly AvailabilityStatus[] = ["ATTENDING", "CANNOT_ATTEND", "UNSURE"] as const

/**
 * The semantic meaning of a state, for a client with no cascade to inherit.
 *
 * A NAME, NOT A COLOUR. "positive" is what ATTENDING means; which green that is
 * belongs to the client. Naming the meaning rather than the paint is what stops
 * one surface's amber becoming another's yellow.
 */
export type AvailabilityTone = "positive" | "caution" | "negative" | "neutral"

/**
 * The icon each state carries, as a Lucide NAME rather than a component.
 *
 * Both clients draw Lucide -- `lucide-react` on the web, `lucide-react-native`
 * in the app -- so naming the icon here gives them the same shape without this
 * module importing either renderer. Colour is never the only carrier of a
 * state: every surface shows the icon AND the word as well.
 */
export type AvailabilityIconName = "check" | "x" | "help-circle" | "circle-dashed"

export interface AttendanceStateShape {
  key: AttendanceGroupKey
  tone: AvailabilityTone
  icon: AvailabilityIconName
}

const SHAPES: Record<AttendanceGroupKey, AttendanceStateShape> = {
  ATTENDING: { key: "ATTENDING", tone: "positive", icon: "check" },
  UNSURE: { key: "UNSURE", tone: "caution", icon: "help-circle" },
  CANNOT_ATTEND: { key: "CANNOT_ATTEND", tone: "negative", icon: "x" },
  AWAITING: { key: "AWAITING", tone: "neutral", icon: "circle-dashed" },
}

export function attendanceStateShape(key: AttendanceGroupKey): AttendanceStateShape {
  return SHAPES[key]
}

/** A person's answer, or its absence, as the group they belong to. `null` is AWAITING and never a fourth answer. */
export function groupKeyForStatus(status: AvailabilityStatus | null | undefined): AttendanceGroupKey {
  return status ?? "AWAITING"
}

/** Every state, in the canonical register order, with its shape. */
export const ATTENDANCE_STATES: readonly AttendanceStateShape[] = ATTENDANCE_GROUP_ORDER.map((k) => SHAPES[k])

/**
 * MEASURED BRAND VALUES FOR EACH TONE.
 *
 * Copied by VALUE from `app/globals.css`, exactly as `apps/mobile/src/design/
 * tokens.ts` copies the rest of the palette, because React Native cannot read a
 * CSS custom property and translating Tailwind at runtime would be a second
 * design system pretending to be one. The web keeps using its class names and
 * never reads these; they exist so the app cannot invent a different green for
 * "available".
 *
 * `text` is the value measured against a white or chalk ground. forest-900 is
 * used for the positive tone rather than pitch-600, which measures 3.14:1 on
 * white and fails AA for semibold body text -- the same correction the web's
 * own group palette records.
 */
export const AVAILABILITY_TONE_VALUES: Record<AvailabilityTone, { text: string; edge: string; wash: string }> = {
  positive: { text: "#0b2b1e", edge: "rgba(50,166,101,0.30)", wash: "rgba(90,203,131,0.12)" },
  caution: { text: "#8a5a00", edge: "rgba(217,155,10,0.32)", wash: "rgba(250,204,21,0.14)" },
  negative: { text: "#8f1a15", edge: "rgba(193,34,27,0.26)", wash: "rgba(193,34,27,0.08)" },
  neutral: { text: "#616562", edge: "rgba(16,21,18,0.14)", wash: "rgba(16,21,18,0.04)" },
}
