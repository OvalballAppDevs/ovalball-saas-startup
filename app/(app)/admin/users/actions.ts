"use server"

import { createClient } from "@/lib/supabase/server"

import { requireSiteAdmin } from "../require-site-admin"
import { accessLabel } from "./types"
import { searchAllAdminUsers } from "./query"
import type { AdminUserQuery } from "./types"

const EXPORT_CEILING = 10_000

export type ExportCsvResult = { ok: true; csv: string; filename: string } | { ok: false; error: string }

/**
 * Explicit allowlist, matching admin/clubs/actions.ts's exportClubsCsv --
 * never DOB, address, phone, claim declaration text, audit internals, or
 * any token/secret, per the brief's own explicit exclusion list.
 */
const CSV_COLUMNS = ["user_id", "name", "email", "account_status", "club", "real_world_role", "ovalball_access", "team_scope", "created_at"] as const

export async function exportUsersCsv(query: AdminUserQuery): Promise<ExportCsvResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  // SLICE 7e: the export walks site_search_users' pages so it asks the same
  // question the screen asked. `truncated` is surfaced rather than swallowed --
  // a short CSV that looks complete is worse than an error.
  const { rows, truncated, error } = await searchAllAdminUsers(supabase, query)
  if (error) return { ok: false, error: "Couldn't generate the export. Please try again." }
  if (truncated) {
    return {
      ok: false,
      error: `That filter matches more than ${EXPORT_CEILING.toLocaleString()} people. Narrow it and export again.`,
    }
  }

  const lines = [CSV_COLUMNS.join(",")]
  for (const row of rows) {
    const accountStatus = row.isSiteAdmin
      ? "Site Admin"
      : row.hasActiveMembership
        ? "Active"
        : row.hasPendingRequest
          ? "Pending"
          : "No club access"
    const realWorldRole = row.memberships.map((m) => m.clubRoleTitle).filter(Boolean).join("; ")
    lines.push(
      [
        row.userId,
        row.name,
        row.email,
        accountStatus,
        row.clubNames ?? "",
        realWorldRole,
        accessLabel(row),
        row.teamNames ?? "",
        row.createdAt,
      ]
        .map(csvEscape)
        .join(",")
    )
  }
  const csv = lines.join("\r\n") + "\r\n"

  const timestamp = new Date().toISOString().slice(0, 10)
  return { ok: true, csv, filename: `ovalball-users-${timestamp}.csv` }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
