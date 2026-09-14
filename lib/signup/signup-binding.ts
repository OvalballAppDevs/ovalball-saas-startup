import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { cookies } from "next/headers"

/**
 * Binds a signup wizard's payload to the browser that submitted it.
 *
 * submitSignup stores the wizard's answers in user_metadata, and anyone can
 * start a signup for any email address. Without a binding, someone could
 * submit a wizard naming another person's email and their own choice of
 * name, date of birth and club claim; when that person next signed in, the
 * callback would write those answers as their profile.
 *
 * The submitting browser keeps a random value in an httpOnly cookie, and the
 * metadata carries only its hash. The callback writes the payload only when
 * the same browser presents the matching value. The magic link is already
 * PKCE-bound to that browser, so a genuine signup loses nothing; anyone else
 * who reaches the callback is sent through the signup wizard instead.
 */
const COOKIE_NAME = "ovalball_signup_binding"
const MAX_AGE_SECONDS = 60 * 60 * 24

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Sets the binding cookie and returns the hash to store with the payload. */
export async function issueSignupBinding(): Promise<string> {
  const value = randomBytes(32).toString("base64url")
  const store = await cookies()
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  })
  return hash(value)
}

/** True only when this browser holds the value whose hash the payload carries. */
export async function signupBindingMatches(expectedHash: unknown): Promise<boolean> {
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false
  const store = await cookies()
  const value = store.get(COOKIE_NAME)?.value
  if (!value) return false
  const actual = Buffer.from(hash(value), "hex")
  const expected = Buffer.from(expectedHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function clearSignupBinding(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}
