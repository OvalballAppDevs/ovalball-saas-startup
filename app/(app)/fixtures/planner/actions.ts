"use server"

import { revalidatePath } from "next/cache"

import { hasCapability } from "@/lib/permissions/has-capability"
import { stageImportBatch } from "@/lib/fixtures/import-engine"
import { isBlankRow, toRawRecord, type PlannerDraftRow, type PlannerRowResult } from "@/lib/fixtures/planner-model"
import { validatePlannerRows } from "@/lib/fixtures/planner-rows"

import { resolvePlannerScope, type PlannerScope } from "./planner-scope"

/**
 * THE PLANNER'S TWO SERVER ACTIONS.
 *
 * Typing, pasting, filling, uploading and Fixture Day all end here, and there
 * is nothing else for them to end in: one validation call and one creation
 * call, both over the canonical engine.
 *
 * PASTE IS INPUT. Nothing about where a row's text came from appears
 * below, and nothing could: authority is resolved from the signed-in
 * person and the active club before a single row is read. A clipboard
 * cannot carry a permission -- and neither can the grid's own clipboard.
 */

export type PlannerValidateResult = { ok: true; rows: PlannerRowResult[] } | { ok: false; error: string }

export interface PlannerCreateOutcome {
  key: string
  created: boolean
  /** Set when this row asked an Ovalball opponent rather than booking. */
  requested: boolean
  error: string | null
}

export type PlannerCreateResult =
  | { ok: true; outcomes: PlannerCreateOutcome[]; created: number; failed: number }
  | { ok: false; error: string }

/**
 * The capability checks here are the friendly early exit. RLS on
 * fixture_import_batches / fixture_import_rows and the per-row
 * re-authorisation inside publish_import_row remain the real boundary, and
 * neither of them trusts anything this file computed.
 */
async function resolvePlannerClub(
  needsMassAuthority: boolean,
  requestedClubId?: string,
): Promise<PlannerScope | { error: string }> {
  const scope = await resolvePlannerScope(requestedClubId)
  // Team staff arrive here only by hand-written request: they have no Planner.
  if (!scope) return { error: "Planning fixtures in bulk is for club fixture administrators." }

  // CREATING A SEASON IS NOT CREATING A FIXTURE. Arranging one match is
  // fixture.create, which a team's own staff may well hold; putting two
  // hundred matches into the club's calendar in one action is the same
  // authority a file upload has always needed, and a club that withheld
  // fixture.import from somebody did not mean "unless they paste".
  if (
    needsMassAuthority &&
    !(await hasCapability(scope.supabase, "fixture.import", "club", { clubId: scope.universe.clubId }))
  ) {
    return {
      error:
        "You can create fixtures one at a time, but adding several at once needs the Import Fixtures permission. A club administrator can allow this under Club Admin → Permissions.",
    }
  }

  return scope
}

/** How many rows a person may create without the mass authority. */
const SINGLE_ROW = 1

export async function validatePlanner(rows: PlannerDraftRow[], clubId?: string): Promise<PlannerValidateResult> {
  const resolved = await resolvePlannerClub(false, clubId)
  if ("error" in resolved) return { ok: false, error: resolved.error }

  // Validation WRITES NOTHING. It is a read against the same canonical
  // records the creation path resolves against, so what the planner shows
  // and what it will do cannot drift apart.
  try {
    const results = await validatePlannerRows(resolved.supabase, rows, resolved.universe.clubId)
    return { ok: true, rows: results }
  } catch (error) {
    console.error("validatePlanner failed:", error)
    return { ok: false, error: "Couldn't check those rows just now. Try again in a moment." }
  }
}

/**
 * Creates every row that is fit to create, and says plainly what happened
 * to each one.
 *
 * PARTIAL SUCCESS IS THE NORMAL CASE, not an error path. Forty-eight
 * fixtures created and two refused is a good outcome a person can act on;
 * discarding all fifty because two were wrong would be worse, and would
 * teach people to submit rows in small batches to protect themselves.
 */
export async function createPlannerFixtures(rows: PlannerDraftRow[], clubId?: string): Promise<PlannerCreateResult> {
  const live = rows.filter((r) => !isBlankRow(r))
  if (live.length === 0) return { ok: false, error: "There is nothing to create yet." }

  const resolved = await resolvePlannerClub(live.length > SINGLE_ROW, clubId)
  if ("error" in resolved) return { ok: false, error: resolved.error }

  const { supabase, universe, userId } = resolved

  // Staged through the SAME batch machinery a CSV upload uses. That is
  // what makes the planner auditable: every fixture it creates has a
  // batch behind it, with the row it came from and the errors it had, and
  // Fixture Management already knows how to show that.
  const staged = await stageImportBatch(
    supabase,
    userId,
    `Mass Fixture Planner · ${new Date().toISOString().slice(0, 10)}`,
    live.map(toRawRecord),
    universe.clubId,
  )
  if (!staged.ok) return { ok: false, error: staged.error }

  const { data: stagedRows } = await supabase
    .from("fixture_import_rows")
    .select("id, row_number, status, errors, resolved_home_team_id, resolved_away_team_id")
    .eq("batch_id", staged.batchId)
    .order("row_number")

  const outcomes: PlannerCreateOutcome[] = []
  let created = 0

  for (const staged_row of stagedRows ?? []) {
    const draft = live[staged_row.row_number - 1]
    const key = draft?.key ?? `row-${staged_row.row_number}`

    // A row the engine would not pass is reported against ITS OWN row and
    // the rest continue. The staged batch keeps the refused row, so
    // nothing is lost and the person can see why.
    if (staged_row.status !== "ready") {
      outcomes.push({
        key,
        created: false,
        requested: false,
        error: (staged_row.errors as string[] | null)?.[0] ?? describeUnready(staged_row.status),
      })
      continue
    }

    const { error } = await supabase.rpc("publish_import_row", { p_row_id: staged_row.id })
    if (error) {
      outcomes.push({ key, created: false, requested: false, error: error.message })
      continue
    }
    created += 1
    outcomes.push({ key, created: true, requested: Boolean(staged_row.resolved_away_team_id), error: null })
  }

  await supabase
    .from("fixture_import_batches")
    .update({
      state: created === outcomes.length ? "completed" : "completed_with_exclusions",
      published_at: new Date().toISOString(),
      published_by: userId,
    })
    .eq("id", staged.batchId)

  revalidatePath("/fixtures")
  revalidatePath("/fixtures/management")

  return { ok: true, outcomes, created, failed: outcomes.length - created }
}

function describeUnready(status: string): string {
  if (status === "conflict") return "This team already has a match on that date."
  if (status === "update") return "This row names an existing fixture; edit it in Fixture Management instead."
  return "This row still needs attention before it can be created."
}
