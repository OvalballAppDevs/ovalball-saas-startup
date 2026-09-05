"use server"

import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE } from "@/lib/app-context/active-context"

/**
 * A UI preference only -- see active-context.ts's own comment. Not
 * validated against the session's real contexts here (resolveActiveContext
 * does that on every read, server-side, and silently falls back if the
 * key no longer names a context this session actually has), so there is
 * nothing for a client to gain by setting an arbitrary value.
 */
export async function setActiveContext(key: string): Promise<void> {
  const store = await cookies()
  store.set(ACTIVE_CONTEXT_COOKIE, key, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 })
}
