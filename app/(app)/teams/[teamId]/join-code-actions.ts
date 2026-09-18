"use server"

import { revalidatePath } from "next/cache"

import type { InvitationShareData } from "@/components/invitations/invitation-share"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { invitationExpiryLabel, invitationJoinUrl, invitationQrSvg } from "@/lib/invitations/share"
import { createClient } from "@/lib/supabase/server"

export type TeamJoinCodeRow = {
  id: string
  codeHint: string
  useCount: number
  maxUses: number
  expiresAt: string
}

export type CreateJoinCodeResult = { ok: true; share: InvitationShareData } | { ok: false; error: string }
export type JoinCodeActionResult = { ok: true } | { ok: false; error: string }

/**
 * `public.issue_invitation` is the authority: the TEAM_JOIN_CODE kind requires
 * `team.join_code.manage` at this team, through the canonical resolver.
 *
 * The code comes back once, from this call, and is never readable again -- only an HMAC of it is
 * stored. So this returns it to the caller and nothing else ever can.
 *
 * It also returns a LINK and a QR of that link. A team join code is the same
 * Slice 5 credential as any other invitation -- one `access_invitations` row,
 * one `/join` redemption path -- and `issue_invitation` has always handed back
 * the token alongside the code. Discarding it meant a club could read a code
 * down the phone but could not put a link in a WhatsApp group or a QR on a
 * poster at the side of the pitch, which is how a code like this actually
 * travels. Possession still grants nothing: redemption produces a REQUEST for
 * somebody at the club to decide.
 */
export async function createTeamJoinCode(teamId: string): Promise<CreateJoinCodeResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("issue_invitation", { p_kind: "TEAM_JOIN_CODE", p_team_id: teamId })
    .maybeSingle()

  if (error || !data?.code || !data.token) {
    console.error("createTeamJoinCode failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  const { data: team } = await supabase.from("teams").select("display_name").eq("id", teamId).maybeSingle()
  const url = invitationJoinUrl(data.token)
  revalidatePath(`/teams/${teamId}`)
  return {
    ok: true,
    share: {
      url,
      code: data.code,
      qrSvg: await invitationQrSvg(url),
      outcome: [`a request to join ${team?.display_name ?? "this team"}`],
      expiresLabel: invitationExpiryLabel(data.expires_at ?? null),
    },
  }
}

export async function revokeTeamJoinCode(invitationId: string): Promise<JoinCodeActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_invitation", {
    p_invitation_id: invitationId,
    p_reason: "withdrawn by the club",
  })
  if (error) {
    console.error("revokeTeamJoinCode failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/teams")
  return { ok: true }
}

/**
 * The codes still open for this team. Read from `invitations_admin_view`, which is the read surface
 * built for exactly this: it carries everything an administrator needs and neither of the hashes.
 */
export async function teamJoinCodes(teamId: string): Promise<TeamJoinCodeRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("invitations_admin_view")
    .select("id, code_hint, use_count, max_uses, expires_at")
    .eq("kind", "TEAM_JOIN_CODE")
    .eq("team_id", teamId)
    .eq("state", "ISSUED")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("teamJoinCodes failed:", error)
    return []
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    codeHint: (row.code_hint as string) ?? "",
    useCount: (row.use_count as number) ?? 0,
    maxUses: (row.max_uses as number) ?? 0,
    expiresAt: row.expires_at as string,
  }))
}
