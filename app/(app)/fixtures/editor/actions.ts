"use server"

import { revalidatePath } from "next/cache"

import { loadClubCatalogue, type ClubCatalogueEntry } from "@/lib/fixtures/club-catalogue"
import {
  loadFixtureEditor,
  loadOppositionOptions,
  saveFixtureEditor,
  type EditableFieldKey,
  type FixtureEditorModel,
  type FixtureEditorPatch,
  type FixtureEditorSaveResult,
  type OppositionOptions,
} from "@/lib/fixtures/fixture-editor"
import { requireActiveFixtureAuthority } from "@/lib/fixtures/require-active-fixture-authority"
import { createClient } from "@/lib/supabase/server"

/**
 * THE FIXTURE EDITOR'S THREE REQUESTS.
 *
 * Opening the editor is one request (the fixture, its field authority and its
 * options). The club catalogue is one more, made once per page. Choosing an
 * opposition club is one more, for that club's teams and grounds. Nothing
 * here runs per keystroke.
 *
 * The database decides which fields are editable; this layer only adds the
 * active-context rule the database cannot see: an account that is also a
 * Site Admin, while operating as an unrelated club, gets a read-only editor.
 */

const ALL_FIELDS: EditableFieldKey[] = ["schedule", "meetTime", "venue", "competition", "opposition", "ourTeam", "homeAway", "details", "result"]

async function session() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

export type OpenFixtureEditorResult = { ok: true; model: FixtureEditorModel; opposition: OppositionOptions | null } | { ok: false; error: string }

export async function openFixtureEditor(fixtureId: string): Promise<OpenFixtureEditorResult> {
  const { supabase, user } = await session()
  if (!user) return { ok: false, error: "Sign in to edit this fixture." }
  const model = await loadFixtureEditor(supabase, fixtureId)
  if (!model) return { ok: false, error: "Fixture not found." }
  const acting = await requireActiveFixtureAuthority(supabase, user, fixtureId)
  if (!acting.ok) {
    for (const key of ALL_FIELDS) model.fields[key] = { editable: false, reason: acting.error }
  }
  // The stored opponent's teams and grounds arrive with the editor, so opening it is one request.
  const opposition = model.values.opponentDirectoryId ? await loadOppositionOptions(supabase, model.values.opponentDirectoryId, model.ourTeam) : null
  return { ok: true, model, opposition }
}

export async function fixtureClubCatalogue(rugbyCode: string, ownClubId: string): Promise<ClubCatalogueEntry[]> {
  const { supabase, user } = await session()
  if (!user) return []
  return loadClubCatalogue(supabase, rugbyCode, { excludeClubId: ownClubId })
}

export async function fixtureOppositionOptions(fixtureId: string, directoryId: string, ourTeamId: string): Promise<OppositionOptions | null> {
  const { supabase, user } = await session()
  if (!user) return null
  const model = await loadFixtureEditor(supabase, fixtureId)
  if (!model) return null
  let ourTeam = model.ourTeam
  if (ourTeamId !== model.ourTeam.id) {
    // Suggest against the team being chosen, not the one stored -- but only a team of the same club.
    if (!model.options.ourTeams.some((t) => t.id === ourTeamId)) return null
    const { data: t } = await supabase.from("teams").select("id, rugby_code, category, age_group, gender, squad_designation").eq("id", ourTeamId).maybeSingle()
    if (t) {
      ourTeam = { ...ourTeam, id: t.id, rugbyCode: t.rugby_code, category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation }
    }
  }
  return loadOppositionOptions(supabase, directoryId, ourTeam)
}

export async function saveFixture(fixtureId: string, patch: FixtureEditorPatch): Promise<FixtureEditorSaveResult> {
  const { supabase, user } = await session()
  if (!user) return { ok: false, saved: [], errors: [{ field: "fixture", message: "Sign in to edit this fixture." }], notices: [] }
  const acting = await requireActiveFixtureAuthority(supabase, user, fixtureId)
  if (!acting.ok) return { ok: false, saved: [], errors: [{ field: "fixture", message: acting.error }], notices: [] }

  const result = await saveFixtureEditor(supabase, fixtureId, patch)
  if (result.saved.length > 0) {
    revalidatePath("/fixtures/management")
    revalidatePath("/admin/fixtures")
    revalidatePath(`/admin/fixtures/${fixtureId}`)
    revalidatePath(`/fixtures/${fixtureId}`)
    revalidatePath("/calendar")
    revalidatePath("/fixtures")
  }
  return result
}
