"use server"

import { sendSignInLinkIfAccountExists } from "@/lib/auth/check-account"

export type SubmitLoginResult =
  | { ok: true }
  | { ok: false; reason: "error"; message: string }

/**
 * The only auth entry point on this page. sendSignInLinkIfAccountExists
 * never reveals whether the email it was given actually has an account --
 * see that file for why -- so this always returns `{ok:true}` for the same
 * request that used to distinguish "existing" from "no-account". A
 * genuinely new visitor isn't left stuck: the login form's own "New to
 * Ovalball? Create an account" link is always visible, not conditional on
 * this result.
 */
export async function submitLogin(email: string): Promise<SubmitLoginResult> {
  const result = await sendSignInLinkIfAccountExists(email)

  if (result.status === "error") return { ok: false, reason: "error", message: result.message }
  return { ok: true }
}
