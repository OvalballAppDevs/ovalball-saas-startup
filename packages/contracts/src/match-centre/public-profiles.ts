import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * THE PUBLIC TEAM PAGE -- a projection of the canonical team (`get_public_team_profile`, 20270727).
 *
 * Public by default: the overview, the cover photograph and the staff by name and role. The squad (first
 * name and surname initial, nothing else) and the media appear only where the club or team has chosen to
 * share them, and the server decides that -- a hidden squad is never sent to be hidden here.
 */
export interface PublicTeamProfile {
  teamId: string
  name: string
  description: string | null
  coverImagePath: string | null
  coverStockKey: string | null
  category: string | null
  ageGroup: string | null
  rugbyCode: string | null
  club: {
    clubId: string
    directoryId: string
    name: string
    slug: string | null
    logoPath: string | null
    /** Null where the club hides it. */
    homeGround: string | null
    website: string | null
  }
  /** False where the team keeps its staff off the public page. */
  staffShown: boolean
  staff: { name: string | null; role: string }[]
  squadShared: boolean
  /** First name and surname initial, and the number and position the team gave -- nothing else. */
  squad: { playerId: string; name: string; shirtNumber: number | null; positionKey: string | null }[] | null
  mediaShared: boolean
  media: { id: string; path: string; caption: string | null }[] | null
  viewerIsMember: boolean
  /** Squad numbers and positions are this viewer's to set. */
  canEditSquad: boolean
  /**
   * OPPOSITION CONTACT, sent only to staff of a club with a current fixture against this team, and only
   * as the team allows. Never sent to a parent, a player, a member or a signed-out visitor -- absent,
   * not hidden. The phone is the team's or club's OPERATIONAL number, never a coach's own.
   */
  contact?: {
    canMessage: boolean
    /** The shared fixture whose staff conversation Message Staff opens. */
    fixtureId: string | null
    canCall: boolean
    phone: string | null
    phoneLabel: string | null
  } | null
}

export async function readPublicTeamProfile(supabase: Client, teamId: string): Promise<PublicTeamProfile | null> {
  const { data, error } = await supabase.rpc("get_public_team_profile", { p_team_id: teamId })
  if (error) throw error
  return (data as unknown as PublicTeamProfile | null) ?? null
}

/** What a club and its teams put on their public pages. Club Default, then a team's own override. */
export type PublicProfileSetting =
  | "profile_public"
  | "show_overview"
  | "show_cover"
  | "show_staff"
  | "opposition_can_message"
  | "opposition_can_call"
  | "share_squad"
  | "share_media"

export const PUBLIC_PROFILE_SETTINGS: { key: PublicProfileSetting; label: string; detail: string }[] = [
  { key: "profile_public", label: "Public Team Page", detail: "Anyone can open the team's page. Off, only the team's own people can." },
  { key: "show_overview", label: "Overview", detail: "The team's description." },
  { key: "show_cover", label: "Cover Photo", detail: "The team's cover picture." },
  { key: "show_staff", label: "Coaches & Staff", detail: "Names and roles. Never contact details." },
  { key: "opposition_can_message", label: "Opposition Can Message", detail: "Staff of a club you play can message your staff about the match." },
  { key: "opposition_can_call", label: "Opposition Can Call", detail: "Staff of a club you play see your operational phone number." },
  { key: "share_squad", label: "Squad", detail: "First name, surname initial, number and position." },
  { key: "share_media", label: "Media", detail: "Only the photos chosen for the public page." },
]

export type PublicProfileSettings = Record<PublicProfileSetting, boolean>
/** A team's own choices; null means it follows the club default. */
export type TeamPublicProfileOverrides = Record<PublicProfileSetting, boolean | null>

export interface ClubPublicSharing {
  shareSquad: boolean
  shareMedia: boolean
  club: PublicProfileSettings
  teams: { teamId: string; name: string; shareSquad: boolean | null; shareMedia: boolean | null; own: TeamPublicProfileOverrides }[]
}

export async function readClubPublicSharing(supabase: Client, clubId: string): Promise<ClubPublicSharing> {
  const { data, error } = await supabase.rpc("get_club_public_sharing", { p_club_id: clubId })
  if (error) throw error
  return data as unknown as ClubPublicSharing
}

export async function setClubPublicSharing(supabase: Client, clubId: string, shareSquad: boolean, shareMedia: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_club_public_sharing", { p_club_id: clubId, p_share_squad: shareSquad, p_share_media: shareMedia })
  if (error) throw error
}

/** A null leaves that choice to the club's default. */
export async function setTeamPublicSharing(supabase: Client, teamId: string, shareSquad: boolean | null, shareMedia: boolean | null): Promise<void> {
  const { error } = await supabase.rpc("set_team_public_sharing", {
    p_team_id: teamId,
    p_share_squad: shareSquad as boolean,
    p_share_media: shareMedia as boolean,
  })
  if (error) throw error
}

export async function setClubPublicProfile(supabase: Client, clubId: string, settings: Partial<PublicProfileSettings>): Promise<void> {
  const { error } = await supabase.rpc("set_club_public_profile", { p_club_id: clubId, p_settings: settings as never })
  if (error) throw error
}

/** A null for a key returns that choice to the club default. */
export async function setTeamPublicProfile(supabase: Client, teamId: string, settings: Partial<TeamPublicProfileOverrides>): Promise<void> {
  const { error } = await supabase.rpc("set_team_public_profile", { p_team_id: teamId, p_settings: settings as never })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// SQUAD NUMBERS AND POSITIONS -- on the player's place in the team, in the team's own rugby code.
// ---------------------------------------------------------------------------------------------------

const POSITION_LABELS: Record<string, string> = {
  loosehead_prop: "Loosehead Prop",
  hooker: "Hooker",
  tighthead_prop: "Tighthead Prop",
  lock: "Lock",
  blindside_flanker: "Blindside Flanker",
  openside_flanker: "Openside Flanker",
  number_eight: "Number 8",
  scrum_half: "Scrum-half",
  fly_half: "Fly-half",
  left_wing: "Left Wing",
  inside_centre: "Inside Centre",
  outside_centre: "Outside Centre",
  right_wing: "Right Wing",
  fullback: "Full-back",
  prop: "Prop",
  flanker: "Flanker",
  centre: "Centre",
  wing: "Wing",
  replacement: "Replacement",
  forward: "Forward",
  back: "Back",
  utility: "Utility",
  stand_off: "Stand-off",
  second_row: "Second Row",
  loose_forward: "Loose Forward",
  interchange: "Interchange",
}

export function positionLabel(key: string | null | undefined): string | null {
  if (!key) return null
  return POSITION_LABELS[key] ?? null
}

export interface TeamSquadDetails {
  rugbyCode: string | null
  positions: string[]
  players: { playerId: string; name: string; shirtNumber: number | null; positionKey: string | null }[]
}

export async function readTeamSquadDetails(supabase: Client, teamId: string): Promise<TeamSquadDetails> {
  const { data, error } = await supabase.rpc("get_team_squad_details", { p_team_id: teamId })
  if (error) throw error
  return data as unknown as TeamSquadDetails
}

/** Both null removes the player's number and position. */
export async function setTeamSquadDetail(
  supabase: Client,
  teamId: string,
  playerId: string,
  shirtNumber: number | null,
  positionKey: string | null
): Promise<void> {
  const { error } = await supabase.rpc("set_team_squad_detail", {
    p_team_id: teamId,
    p_player_id: playerId,
    p_shirt_number: shirtNumber as number,
    p_position_key: positionKey as string,
  })
  if (error) throw error
}

/** Whether one team photo appears on the public page (only ever where the team shares media at all). */
export async function setTeamMediaPublic(supabase: Client, mediaId: string, shared: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_team_media_public", { p_media_id: mediaId, p_shared: shared })
  if (error) throw error
}
