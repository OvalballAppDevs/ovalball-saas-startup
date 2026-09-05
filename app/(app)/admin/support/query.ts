import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize } from "../pagination-constants"

export interface AdminSupportQuery {
  q: string
  status: "all" | "new" | "in_progress" | "closed"
  category: string
  origin: "all" | "authenticated" | "public"
  page: number
  size: PageSize
}

export function parseAdminSupportQuery(params: Record<string, string | string[] | undefined>): AdminSupportQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""
  const status = one(params.status)
  const origin = one(params.origin)
  const sizeParam = parseInt(one(params.size), 10) as PageSize
  return {
    q: one(params.q).trim(),
    status: status === "new" || status === "in_progress" || status === "closed" ? status : "all",
    category: one(params.category),
    origin: origin === "authenticated" || origin === "public" ? origin : "all",
    page: Math.max(1, parseInt(one(params.page) || "1", 10) || 1),
    size: PAGE_SIZES.includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE,
  }
}

export interface AdminSupportRow {
  id: string
  reference: string
  status: string
  category: string
  subject: string
  clubName: string | null
  raisedBy: string
  origin: "authenticated" | "public"
  createdAt: string
  updatedAt: string
}

export async function fetchAdminSupportTickets(
  supabase: SupabaseClient<Database>,
  query: AdminSupportQuery
): Promise<{ rows: AdminSupportRow[]; total: number }> {
  let q = supabase
    .from("support_tickets")
    .select(
      "id, reference, status, category, subject, created_at, updated_at, created_by_user_id, origin, contact_name, clubs(club_directory(name))",
      { count: "exact" }
    )

  if (query.status !== "all") q = q.eq("status", query.status)
  if (query.category) q = q.eq("category", query.category)
  if (query.origin !== "all") q = q.eq("origin", query.origin)
  if (query.q.length >= 2) {
    const escaped = query.q.replace(/[%_]/g, (c) => `\\${c}`)
    q = q.or(`reference.ilike.%${escaped}%,subject.ilike.%${escaped}%`)
  }

  const from = (query.page - 1) * query.size
  const { data, count } = await q.order("updated_at", { ascending: false }).range(from, from + query.size - 1)

  const raisedByIds = Array.from(new Set((data ?? []).map((r) => r.created_by_user_id).filter((id): id is string => id !== null)))
  const { data: profiles } =
    raisedByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", raisedByIds) : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Ovalball user"]))

  const rows: AdminSupportRow[] = (data ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    category: r.category,
    subject: r.subject,
    clubName: r.clubs?.club_directory?.name ?? null,
    raisedBy: r.created_by_user_id ? (nameById.get(r.created_by_user_id) ?? "Ovalball user") : (r.contact_name ?? "—"),
    origin: r.origin as "authenticated" | "public",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))

  return { rows, total: count ?? 0 }
}

export interface SupportStatusCounts {
  new: number
  inProgress: number
  closed: number
}

export async function fetchSupportStatusCounts(supabase: SupabaseClient<Database>): Promise<SupportStatusCounts> {
  const countFor = async (status: string) => {
    const { count } = await supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", status)
    return count ?? 0
  }
  const [newCount, inProgress, closed] = await Promise.all([countFor("new"), countFor("in_progress"), countFor("closed")])
  return { new: newCount, inProgress, closed }
}
