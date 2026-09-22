import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SwitchableContext } from "@ovalball/contracts"

/**
 * WHAT MAY I DO WITH THIS TEAM'S FIXTURES -- ASKED OF THE SERVER, EVERY TIME.
 *
 * `my_capabilities` runs `internal.capability_decision`, which is the same resolver the website uses
 * and the same one every mutation re-runs before it writes. So this is not a second opinion: it is the
 * ONE opinion, asked for the purpose of drawing an interface.
 *
 * UI VISIBILITY IS NOT AUTHORITY, and the reverse matters just as much: a control that is hidden has
 * not been secured, and a control that is shown has not been granted. Every action below is refused by
 * the database independently, so the worst a wrong answer here can do is offer a button that then says
 * no. That is the acceptable direction to be wrong in.
 *
 * NOTHING IS CACHED ACROSS A CONTEXT. A cached yes outlives the permission it came from and would still
 * be on the phone after a Club Admin took it away.
 *
 * THE KEYS ARE THE DELEGABLE ONES, and that distinction is load-bearing. `fixture.create`,
 * `fixture.edit` and `fixture.cancel` exist and are NOT delegable -- they are the older club/site shape.
 * The keys a Club Admin can actually grant to a team are `fixture.fixture.create`, `.edit` and
 * `.cancel`, and asking for the wrong pair would have produced an interface that ignored every
 * delegation the owner's authority model is built on.
 *
 * FOUR THINGS ARE DELIBERATELY ABSENT and no amount of team authority brings them back: the Planner,
 * Import, bulk edit and delete are club-scoped in the capability catalogue itself. Mobile does not need
 * to enforce that -- it needs only to never ask for them at team scope, which is why there is no key
 * for them here.
 */

export interface FixtureAuthority {
  view: boolean
  create: boolean
  edit: boolean
  cancel: boolean
  requestCreate: boolean
  requestRespond: boolean
  recordResult: boolean
}

const NONE: FixtureAuthority = {
  view: false,
  create: false,
  edit: false,
  cancel: false,
  requestCreate: false,
  requestRespond: false,
  recordResult: false,
}

const KEYS = {
  view: "fixture.fixture.view",
  create: "fixture.fixture.create",
  edit: "fixture.fixture.edit",
  cancel: "fixture.fixture.cancel",
  requestCreate: "fixture.request.create",
  requestRespond: "fixture.request.respond",
  recordResult: "fixture.result.record",
} as const

export async function loadFixtureAuthority(
  supabase: SupabaseClient<Database>,
  active: SwitchableContext | null
): Promise<FixtureAuthority> {
  if (!active) return NONE

  // A TEAM CONTEXT ASKS AT TEAM SCOPE; A CLUB CONTEXT ASKS AT CLUB SCOPE. Asking at club scope while
  // standing in a team would answer a different question -- "may you do this anywhere at this club" --
  // and would hand a Club Admin's authority to a coach standing in their own side.
  const scope = active.kind === "team" ? "team" : active.kind === "club" ? "club" : null
  if (!scope) return NONE

  const { data, error } = await supabase.rpc("my_capabilities", {
    p_scope_type: scope,
    p_club_id: (active.clubId ?? undefined) as string | undefined,
    p_team_id: (scope === "team" ? (active.id ?? undefined) : undefined) as string | undefined,
  })
  if (error || !data) return NONE

  const allowed = new Set(data.filter((row) => row.allowed === true).map((row) => row.capability_key))
  return {
    view: allowed.has(KEYS.view),
    create: allowed.has(KEYS.create),
    edit: allowed.has(KEYS.edit),
    cancel: allowed.has(KEYS.cancel),
    requestCreate: allowed.has(KEYS.requestCreate),
    requestRespond: allowed.has(KEYS.requestRespond),
    recordResult: allowed.has(KEYS.recordResult),
  }
}

/** True where any management control is worth drawing at all, so an ordinary viewer gets a clean screen. */
export function anyManagement(authority: FixtureAuthority): boolean {
  return authority.create || authority.edit || authority.cancel || authority.requestCreate
}
