import type { SupabaseClient } from "@supabase/supabase-js"

import type { InvitationSecret } from "../invitations/preview"

/**
 * TEAM CODES PLACE PLAYERS (20270741000000) -- one reading of a team code, for both clients.
 *
 * A team's code, or a personal link for one player, asks for a place on THAT team for one person: the
 * holder, one of their children, a child not on Ovalball yet, or -- for an adult who does not play -- a
 * plain request to join the club. The server decides everything (`team_code_choices`, the redemption's
 * team-code branch, reached only through `redeemInvitation`, and `approve_pending_team_membership`); this
 * module only reads its answers and puts them in the one set of words both apps use.
 */

type Client = SupabaseClient

/** The canonical answer to "may this person use this team's code" (`internal.team_code_fit`). */
export type TeamCodeFit =
  | "FITS"
  | "TOO_YOUNG"
  | "TOO_OLD"
  | "UNDER_18"
  | "OTHER_PATHWAY"
  | "NO_DATE_OF_BIRTH"
  | "NO_PATHWAY"
  | "SEASON_NOT_ESTABLISHED"
  | "AGE_GRADE_NOT_ESTABLISHED"
  | "ADULT_OWN_ACCOUNT"
  | "UNKNOWN_TEAM"

/**
 * AWAITING: a child's own request a parent has not confirmed yet -- not the team's to decide.
 * DISPENSATION: a request waiting on an age-grade dispensation the club has not decided yet -- not the
 * team's to decide either (20270742000000).
 * USED: this person used this code for this player before, and there is no place now.
 */
export type TeamPlaceState = "ACTIVE" | "PENDING" | "AWAITING" | "DISPENSATION" | "USED"

export interface TeamCodeTeam {
  id: string
  label: string
  clubName: string | null
  adultSide: boolean
  /** "U14"; null for an adult side. */
  ageGroup: string | null
  /** The canonical side: boys, girls, mens, womens or mixed. */
  gender: string | null
}

export interface TeamCodeChild {
  playerId: string
  firstName: string
  surname: string
  birthYear: number | null
  fit: TeamCodeFit
  /** Outside the age grade and nothing else in the way: a parent may ask for a dispensation (the server's `team_code_dispensable`). */
  dispensable: boolean
  /** This season's live dispensation for this child and team, if there is one. */
  dispensation: { id: string; status: "requested" | "approved" } | null
  place: TeamPlaceState | null
}

export interface TeamCodeChoices {
  team: TeamCodeTeam
  me: {
    playerId: string | null
    fit: TeamCodeFit | null
    minor: boolean
    establishedAdult: boolean
    hasGuardian: boolean
    needsDetails: boolean
    place: TeamPlaceState | null
  }
  children: TeamCodeChild[]
  member: { membership: "ACTIVE" | "PENDING" | "SUSPENDED" | null; requested: boolean }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const bool = (v: unknown): boolean => v === true

/** Pure: the server's answer, read without guessing. `null` for a code that is not a live team code. */
export function interpretTeamCodeChoices(raw: unknown): TeamCodeChoices | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, Record<string, unknown> & { [k: string]: unknown }>
  const team = r.team ?? {}
  const me = r.me ?? {}
  const member = r.member ?? {}
  const id = str(team.id)
  if (!id) return null
  return {
    team: {
      id,
      label: str(team.label) ?? "This team",
      clubName: str(team.club_name),
      adultSide: bool(team.adult_side),
      ageGroup: str(team.age_group),
      gender: str(team.gender),
    },
    me: {
      playerId: str(me.player_id),
      fit: (str(me.fit) as TeamCodeFit | null) ?? null,
      minor: bool(me.minor),
      establishedAdult: bool(me.established_adult),
      hasGuardian: bool(me.has_guardian),
      needsDetails: bool(me.needs_details),
      place: (str(me.place) as TeamPlaceState | null) ?? null,
    },
    children: (Array.isArray(r.children) ? (r.children as Record<string, unknown>[]) : [])
      .filter((c) => str(c.player_id))
      .map((c) => ({
        playerId: c.player_id as string,
        firstName: str(c.first_name) ?? "",
        surname: str(c.surname) ?? "",
        birthYear: typeof c.birth_year === "number" ? c.birth_year : null,
        fit: (str(c.fit) as TeamCodeFit | null) ?? "NO_DATE_OF_BIRTH",
        dispensable: bool(c.dispensable),
        dispensation: (() => {
          const d = (c.dispensation && typeof c.dispensation === "object" ? c.dispensation : {}) as Record<string, unknown>
          const id = str(d.id)
          return id && (d.status === "requested" || d.status === "approved") ? { id, status: d.status } : null
        })(),
        place: (str(c.place) as TeamPlaceState | null) ?? null,
      })),
    member: {
      membership: (str(member.membership) as TeamCodeChoices["member"]["membership"]) ?? null,
      requested: bool(member.requested),
    },
  }
}

export async function readTeamCodeChoices(supabase: Client, secret: InvitationSecret): Promise<TeamCodeChoices | null> {
  const { data, error } = await supabase.rpc("team_code_choices", { p_token: secret.token ?? null, p_code: secret.code ?? null })
  if (error) throw error
  return interpretTeamCodeChoices(data)
}

/**
 * The canonical fit of what a parent is typing for a child not on Ovalball yet -- asked of the server,
 * which alone holds the season register and the age-grade rule. Null when the code is not a live team code.
 */
export async function checkTeamCodeFit(
  supabase: Client,
  secret: InvitationSecret,
  dateOfBirth: string,
  playingPathway: "MALE" | "FEMALE" | null
): Promise<TeamCodeFit | null> {
  const { data, error } = await supabase.rpc("team_code_fit_check", {
    p_date_of_birth: dateOfBirth,
    p_playing_pathway: playingPathway ?? null,
    p_token: secret.token ?? null,
    p_code: secret.code ?? null,
  })
  if (error) throw error
  return (typeof data === "string" ? data : null) as TeamCodeFit | null
}

/** "U14" -> "Under 14": the age grade in the words the Team Directory uses. */
export function ageGradeWords(ageGroup: string | null): string | null {
  const n = ageGroup?.match(/(\d+)/)?.[1]
  return n ? `Under ${n}` : null
}

const SIDE: Record<string, string> = { boys: "a boys' side", girls: "a girls' side", mens: "a men's side", womens: "a women's side" }

/**
 * WHY SOMEBODY CANNOT USE THIS CODE, in one sentence, or null when they can. One place, so the greyed
 * row on the phone, the refusal on the website and the server's verdict can never say different things.
 */
export function teamCodeFitSentence(fit: TeamCodeFit | string | null, team: Pick<TeamCodeTeam, "label" | "ageGroup" | "gender" | "adultSide">): string | null {
  const grade = ageGradeWords(team.ageGroup) ?? team.label
  switch (fit) {
    case "FITS":
    case null:
      return null
    case "TOO_YOUNG":
      return `Too young for ${grade}.`
    case "TOO_OLD":
      return `Too old for ${grade}.`
    case "UNDER_18":
      return "Adult sides are for players aged 18 and over."
    case "OTHER_PATHWAY":
      return `${team.label} is ${SIDE[team.gender ?? ""] ?? "for the other pathway"}.`
    case "NO_DATE_OF_BIRTH":
      return "No date of birth on record, so their age grade can't be checked."
    case "NO_PATHWAY":
      return "No gender on record, so this can't be checked."
    case "ADULT_OWN_ACCOUNT":
      return "Players aged 18 or over join with their own account."
    default:
      return "Ovalball can't work out the age grade yet. Ask the club."
  }
}

/**
 * A place they already hold or have asked for, said plainly -- to the person themselves ("mine") or to
 * the parent reading a child's row ("child"), because a child's own request waits on that parent.
 */
export function teamPlaceSentence(place: TeamPlaceState | null, teamLabel: string, whose: "mine" | "child" = "mine"): string | null {
  if (place === "ACTIVE") return `Already on ${teamLabel}.`
  if (place === "PENDING") return "Already asked. The team will decide."
  if (place === "AWAITING") return whose === "child" ? "Asked from their own account. Confirm it from your notifications." : "Already asked. Your parent or guardian confirms it first."
  if (place === "DISPENSATION") return "Already asked. The club decides the dispensation first, then the team decides."
  if (place === "USED") return whose === "child" ? "You've already used this code for them. To ask again, talk to the team." : "You've already used this code. To ask again, talk to the team."
  return null
}

/** Who a team code is used for, as the client sends it. Nothing here is trusted: the server re-decides it all. */
export type TeamCodeSubject =
  | { for: "MEMBER" }
  | { for: "SELF"; dateOfBirth?: string | null; playingPathway?: "MALE" | "FEMALE" | null }
  /** `dispensationReason`: asking for the place AND an age-grade dispensation together, for a child who does not fit. */
  | { for: "CHILD"; playerId: string; dispensationReason?: string | null }
  | { for: "NEW_CHILD"; firstName: string; surname: string; dateOfBirth: string; playingPathway: "MALE" | "FEMALE"; dispensationReason?: string | null }

export function teamCodeSubjectPayload(subject: TeamCodeSubject): Record<string, string> {
  switch (subject.for) {
    case "MEMBER":
      return { for: "MEMBER" }
    case "SELF": {
      const out: Record<string, string> = { for: "SELF" }
      if (subject.dateOfBirth) out.date_of_birth = subject.dateOfBirth
      if (subject.playingPathway) out.playing_pathway = subject.playingPathway
      return out
    }
    case "CHILD": {
      const out: Record<string, string> = { for: "CHILD", player_id: subject.playerId }
      if (subject.dispensationReason?.trim()) out.dispensation_reason = subject.dispensationReason.trim()
      return out
    }
    case "NEW_CHILD": {
      const out: Record<string, string> = {
        for: "NEW_CHILD",
        first_name: subject.firstName.trim(),
        surname: subject.surname.trim(),
        date_of_birth: subject.dateOfBirth,
        playing_pathway: subject.playingPathway,
      }
      if (subject.dispensationReason?.trim()) out.dispensation_reason = subject.dispensationReason.trim()
      return out
    }
  }
}

/** One row of Who Is Joining?: who, what the server says about them, and where choosing it leads. */
export interface TeamCodeOption {
  key: string
  label: string
  description: string | null
  disabled: boolean
  subject?: TeamCodeSubject
  next?: "child" | "details"
  /**
   * A child who does not fit, whom a parent may ask a dispensation for. The row stays greyed -- the normal
   * way in is closed -- and this is the one way offered: a reason, then the place AND the dispensation are
   * asked for together, and nothing happens until the club approves it.
   */
  requestDispensation?: { playerId: string; firstName: string }
}

/** May a child the parent is adding now, who does not fit, be asked a dispensation for? The server decides again. */
export function teamCodeFitMayBeDispensed(fit: TeamCodeFit | null): boolean {
  return fit === "TOO_YOUNG" || fit === "TOO_OLD"
}

/**
 * THE ROWS OF WHO IS JOINING? -- one implementation for both apps, from the server's answers.
 *
 * Themselves as a player where it could be them (a child's own login, an adult side, or a person the
 * server already says fits -- a parent holding an Under 14s' code is not offered themselves); every one
 * of their children, greyed with the reason where the code is not for them; a child not on Ovalball yet,
 * for a youth side, by an adult; and for an adult who does not play, a plain request to join the club.
 */
export function teamCodeOptions(c: TeamCodeChoices): TeamCodeOption[] {
  const team = c.team
  const club = team.clubName ?? "the club"
  const out: TeamCodeOption[] = []

  if (c.me.minor || team.adultSide || c.me.fit === "FITS") {
    const already = teamPlaceSentence(c.me.place, team.label)
    if (already) out.push({ key: "me", label: "Me", description: already, disabled: true })
    else if (c.me.minor) {
      if (!c.me.hasGuardian || c.me.needsDetails) out.push({ key: "me", label: "Me", description: "Ask your parent or guardian to use this code for you.", disabled: true })
      else if (c.me.fit !== "FITS") out.push({ key: "me", label: "Me", description: teamCodeFitSentence(c.me.fit, team), disabled: true })
      else out.push({ key: "me", label: "Me", description: "Your parent or guardian confirms it first.", disabled: false, subject: { for: "SELF" } })
    } else if (c.me.needsDetails) {
      out.push({ key: "me", label: "Me", description: "Add your date of birth and gender next.", disabled: false, next: "details" })
    } else if (c.me.fit !== "FITS") {
      out.push({ key: "me", label: "Me", description: teamCodeFitSentence(c.me.fit, team), disabled: true })
    } else {
      out.push({ key: "me", label: "Me", description: `Ask for a place on ${team.label}.`, disabled: false, subject: { for: "SELF" } })
    }
  }

  for (const child of c.children) {
    const label = `${child.firstName} ${child.surname}`.trim()
    const born = child.birthYear ? `Born ${child.birthYear}.` : null
    const already = teamPlaceSentence(child.place, team.label, "child")
    const misfit = teamCodeFitSentence(child.fit, team)
    // A dispensation already decided for this team and season is the exception: the place may be asked
    // for (it joins the approval). One still waiting may be joined too; the place then waits on it.
    if (!already && misfit && child.dispensation) {
      const note = child.dispensation.status === "approved" ? "A dispensation is approved for this season." : "A dispensation is waiting for the club's decision."
      out.push({ key: `child:${child.playerId}`, label, description: [born, misfit, note].filter(Boolean).join(" "), disabled: false, subject: { for: "CHILD", playerId: child.playerId } })
      continue
    }
    const why = already ?? misfit
    out.push({
      key: `child:${child.playerId}`,
      label,
      description: [born, why].filter(Boolean).join(" ") || null,
      disabled: !!why,
      subject: why ? undefined : { for: "CHILD", playerId: child.playerId },
      requestDispensation: !already && misfit && child.dispensable ? { playerId: child.playerId, firstName: child.firstName } : undefined,
    })
  }

  if (!team.adultSide && !c.me.minor) {
    out.push({ key: "new", label: "A Child Not on Ovalball Yet", description: "Add their name, date of birth and gender next.", disabled: false, next: "child" })
  }

  if (!c.me.minor) {
    const membership = c.member.membership
    if (membership === "ACTIVE") out.push({ key: "member", label: "Just Me, as a Member", description: `You're already a member of ${club}.`, disabled: true })
    else if (membership === "SUSPENDED") out.push({ key: "member", label: "Just Me, as a Member", description: "Your membership is deactivated. The club must reactivate it.", disabled: true })
    else if (membership === "PENDING" || c.member.requested) out.push({ key: "member", label: "Just Me, as a Member", description: "You've already asked to join.", disabled: true })
    else out.push({ key: "member", label: "Just Me, as a Member", description: `Ask ${club} to add you as a member, without a place on the team.`, disabled: false, subject: { for: "MEMBER" } })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------
// A PARENT'S ANSWER -- their child's own request waits on them (confirm_team_place_request).
// ---------------------------------------------------------------------------------------------------

export interface FamilyTeamRequest {
  membershipId: string
  playerId: string
  firstName: string
  surname: string
  teamId: string
  teamLabel: string
  clubId: string | null
  clubName: string | null
  requestedAt: string | null
}

export async function readFamilyTeamRequests(supabase: Client): Promise<FamilyTeamRequest[]> {
  const { data, error } = await supabase.rpc("family_team_requests")
  if (error) throw error
  return (Array.isArray(data) ? (data as Record<string, unknown>[]) : [])
    .filter((r) => str(r.membership_id))
    .map((r) => ({
      membershipId: r.membership_id as string,
      playerId: str(r.player_id) ?? "",
      firstName: str(r.first_name) ?? "",
      surname: str(r.surname) ?? "",
      teamId: str(r.team_id) ?? "",
      teamLabel: str(r.team_label) ?? "the team",
      clubId: str(r.club_id),
      clubName: str(r.club_name),
      requestedAt: str(r.requested_at),
    }))
}

/** A request this person made with a team code that still waits -- for a child of theirs, or themselves. */
export interface MyTeamRequest {
  membershipId: string
  firstName: string
  forSelf: boolean
  teamLabel: string
  clubName: string | null
  awaitingGuardian: boolean
  /** Waiting on an age-grade dispensation the club has not decided yet (20270742000000). */
  awaitingDispensation: boolean
  dispensationId: string | null
  requestedAt: string | null
}

export async function readMyTeamRequests(supabase: Client): Promise<MyTeamRequest[]> {
  const { data, error } = await supabase.rpc("my_team_requests")
  if (error) throw error
  return (Array.isArray(data) ? (data as Record<string, unknown>[]) : [])
    .filter((r) => str(r.membership_id))
    .map((r) => ({
      membershipId: r.membership_id as string,
      firstName: str(r.first_name) ?? "",
      forSelf: bool(r.for_self),
      teamLabel: str(r.team_label) ?? "the team",
      clubName: str(r.club_name),
      awaitingGuardian: bool(r.awaiting_guardian),
      awaitingDispensation: bool(r.awaiting_dispensation),
      dispensationId: str(r.dispensation_id),
      requestedAt: str(r.requested_at),
    }))
}

/** One line about a waiting request, for whoever asked. */
export function myTeamRequestLine(r: MyTeamRequest): string {
  const where = r.clubName ? `${r.teamLabel} at ${r.clubName}` : r.teamLabel
  if (r.forSelf) {
    if (r.awaitingGuardian) return `Your request to join ${where} is waiting for your parent or guardian to confirm.`
    if (r.awaitingDispensation) return `Your request to join ${where} is waiting for the club to decide a dispensation.`
    return `Your request to join ${where} is waiting for the team to decide.`
  }
  if (r.awaitingDispensation) return `${r.firstName}'s request to join ${where} is waiting for the club to decide the dispensation. Asking is not approval.`
  return `${r.firstName}'s request to join ${where} is waiting for the team to decide.`
}

export async function confirmChildTeamRequest(supabase: Client, membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_team_place_request", { p_membership_id: membershipId })
  if (error) throw error
}

export async function declineChildTeamRequest(supabase: Client, membershipId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc("decline_team_place_request", { p_membership_id: membershipId, p_reason: reason?.trim() || null })
  if (error) throw error
}

/** What Happens Next, for a parent reading their child's own request -- the same three steps in both apps. */
export function childRequestSteps(r: Pick<FamilyTeamRequest, "firstName" | "teamLabel">): string[] {
  const first = r.firstName || "your child"
  return [`You confirm that ${first} asked.`, "The team's staff decide.", `If they approve, ${first} joins ${r.teamLabel}.`]
}

/**
 * What a parent reads once they have answered. The team is named in front of "staff", never as a
 * possessive: a team called Under 13 Boys read "Under 13 Boys's staff".
 */
export function childRequestAnswered(answer: "confirmed" | "declined", r: Pick<FamilyTeamRequest, "firstName" | "teamLabel">): { title: string; sentence: string } {
  if (answer === "declined") return { title: "Declined", sentence: `${r.firstName || "Your child"} has been told.` }
  const staff = r.teamLabel ? `The ${r.teamLabel} staff` : "The team's staff"
  return { title: "Confirmed", sentence: `${staff} decide next. You and ${r.firstName || "your child"} will both hear when they have.` }
}

// ---------------------------------------------------------------------------------------------------
// THE APPROVER'S CARD -- what each waiting request is, and exactly what approving it does.
// ---------------------------------------------------------------------------------------------------

export type TeamPlaceAskedBy = "PARENT" | "OWN_ACCOUNT" | "CLUB"

export interface TeamPlaceRequest {
  membershipId: string
  playerId: string
  firstName: string
  surname: string
  dateOfBirth: string | null
  fit: TeamCodeFit
  source: string
  requestedAt: string | null
  askedBy: TeamPlaceAskedBy
  requesterName: string | null
  confirmedByName: string | null
  confirmsGuardian: boolean
  admitsMembers: string[]
  /** The viewer may not decide this one: it is theirs, or their child's. Another approver will. */
  decidedByOthers: boolean
  /** The age-grade dispensation this place was approved under, if it needed one (the team sees it only once decided). */
  dispensation: { decidedByName: string | null; decidedAs: "SAFEGUARDING_OFFICER" | "CLUB_ADMIN" | "LEGACY" | null; decidedAt: string | null; governingBody: boolean } | null
}

export interface TeamPlaceRequests {
  /** The team the requests are for, so a card says its own words wherever it is drawn. */
  team: TeamCodeTeam | null
  requests: TeamPlaceRequest[]
  /** Requests a child made themselves that still wait for a parent: counted, never described. */
  awaitingGuardian: number
  /** Requests still waiting on a dispensation the club has not decided: counted, never described -- not the team's yet. */
  awaitingDispensation: number
}

export function interpretTeamPlaceRequests(raw: unknown): TeamPlaceRequests {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const rows = Array.isArray(r.requests) ? (r.requests as Record<string, unknown>[]) : []
  const t = (r.team && typeof r.team === "object" ? r.team : {}) as Record<string, unknown>
  return {
    team: str(t.id)
      ? { id: t.id as string, label: str(t.label) ?? "This team", clubName: str(t.club_name), adultSide: bool(t.adult_side), ageGroup: str(t.age_group), gender: str(t.gender) }
      : null,
    requests: rows
      .filter((x) => str(x.membership_id))
      .map((x) => ({
        membershipId: x.membership_id as string,
        playerId: str(x.player_id) ?? "",
        firstName: str(x.first_name) ?? "",
        surname: str(x.surname) ?? "",
        dateOfBirth: str(x.date_of_birth),
        fit: (str(x.fit) as TeamCodeFit | null) ?? "NO_DATE_OF_BIRTH",
        source: str(x.source) ?? "",
        requestedAt: str(x.requested_at),
        askedBy: (str(x.asked_by) as TeamPlaceAskedBy | null) ?? "CLUB",
        requesterName: str(x.requester_name),
        confirmedByName: str(x.confirmed_by_name),
        confirmsGuardian: bool(x.confirms_guardian),
        admitsMembers: Array.isArray(x.admits_members) ? (x.admits_members as unknown[]).filter((n): n is string => typeof n === "string") : [],
        decidedByOthers: bool(x.decided_by_others),
        dispensation: (() => {
          const d = (x.dispensation && typeof x.dispensation === "object" ? x.dispensation : null) as Record<string, unknown> | null
          if (!d) return null
          const as = d.decided_as === "SAFEGUARDING_OFFICER" || d.decided_as === "CLUB_ADMIN" || d.decided_as === "LEGACY" ? d.decided_as : null
          return { decidedByName: str(d.decided_by_name), decidedAs: as, decidedAt: str(d.decided_at), governingBody: bool(d.governing_body) }
        })(),
      })),
    awaitingGuardian: typeof r.awaiting_guardian === "number" ? r.awaiting_guardian : 0,
    awaitingDispensation: typeof r.awaiting_dispensation === "number" ? r.awaiting_dispensation : 0,
  }
}

export async function readTeamPlaceRequests(supabase: Client, teamId: string): Promise<TeamPlaceRequests> {
  const { data, error } = await supabase.rpc("team_place_requests", { p_team_id: teamId })
  if (error) throw error
  return interpretTeamPlaceRequests(data)
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

/** "Born 12 March 2013. Fits Under 14." -- the card's first fact, or its reason when the player does not fit. */
export function requestFitLine(request: Pick<TeamPlaceRequest, "dateOfBirth" | "fit">, team: Pick<TeamCodeTeam, "label" | "ageGroup" | "gender" | "adultSide">): string {
  const born = request.dateOfBirth ? `Born ${LONG_DATE.format(new Date(`${request.dateOfBirth}T00:00:00Z`))}.` : "No date of birth on record."
  if (request.fit === "FITS") {
    const grade = ageGradeWords(team.ageGroup)
    return grade ? `${born} Fits ${grade}.` : `${born} An adult.`
  }
  return `${born} ${teamCodeFitSentence(request.fit, team) ?? ""}`.trim()
}

/** "Outside the age grade: dispensation approved by Ann Lee (Safeguarding Officer)." -- why a misfit may be placed. */
export function requestDispensationLine(request: Pick<TeamPlaceRequest, "dispensation">): string | null {
  const d = request.dispensation
  if (!d) return null
  const role = d.decidedAs === "SAFEGUARDING_OFFICER" ? " (Safeguarding Officer)" : d.decidedAs === "CLUB_ADMIN" ? " (Club Admin)" : ""
  return `Dispensation approved${d.decidedByName ? ` by ${d.decidedByName}${role}` : ""} for this team and season.`
}

/** How it was asked, in one line. */
export function requestAskedLine(request: Pick<TeamPlaceRequest, "askedBy" | "requesterName" | "confirmedByName" | "firstName">): string {
  if (request.askedBy === "OWN_ACCOUNT") {
    return request.confirmedByName
      ? `Asked from ${request.firstName}'s own account. ${request.confirmedByName} (parent) confirmed it.`
      : `Asked from ${request.firstName}'s own account.`
  }
  if (request.askedBy === "PARENT") return `Added by ${request.requesterName ?? "a parent"} (parent) with the team code.`
  return "Added at the club."
}

/** Exactly what approving does -- the sentence on the card above Approve. */
export function requestApprovalSentence(request: Pick<TeamPlaceRequest, "firstName" | "confirmsGuardian" | "requesterName" | "admitsMembers">, teamLabel: string, clubName: string | null): string {
  const parts = [`Approving adds ${request.firstName} to ${teamLabel}`]
  if (request.confirmsGuardian && request.requesterName) parts.push(` and confirms ${request.requesterName} as ${request.firstName}'s parent or guardian`)
  let sentence = `${parts.join("")}.`
  const members = request.admitsMembers
  if (members.length === 1) sentence += ` ${members[0]} joins ${clubName ?? "the club"} as a member.`
  else if (members.length > 1) sentence += ` ${members.join(" and ")} join ${clubName ?? "the club"} as members.`
  return sentence
}
