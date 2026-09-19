import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { cookies } from "next/headers"

/**
 * THE BROWSER'S HALF OF AN ONBOARDING FLOW.
 *
 * Since 6b.2b (SO-4) this cookie carries an opaque **flow id** and nothing else.
 * The wizard's answers live server-side in `public.auth_flow_states`, written by
 * `create_auth_flow_state` and readable only once, by
 * `consume_auth_flow_state`, in an authenticated session. The browser holds a
 * credential; it no longer holds -- or authors -- the context.
 *
 * WHAT THIS REPLACED, and why it was not enough. The answers used to travel as
 * `data` on `signInWithOtp`, which GoTrue writes into
 * `auth.users.user_metadata` **before anybody has authenticated**. Anyone can
 * start a signup for any address, so anyone could author that metadata against
 * somebody else's account. This cookie was the mitigation: the metadata carried
 * only the hash of a random value, and the callback applied the payload only for
 * the browser holding the value. It bounded the blast radius and left the shape
 * intact -- pre-auth, attacker-authored data on a real auth row -- which is the
 * thing Phase 1 H-7 names and SO-4 removes.
 *
 * The legacy hash helpers below remain for exactly one release, because a person
 * who started the wizard before this deployed still has the old cookie and the
 * old metadata, and stranding them mid-signup to tidy a file up is not a trade
 * worth making. Their retirement is the contract half of this change.
 */
const COOKIE_NAME = "ovalball_signup_binding"
const MAX_AGE_SECONDS = 60 * 60 * 24

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Puts the opaque flow id in the browser. It is never in a URL and never in metadata. */
export async function storeSignupFlowId(flowId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, flowId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readSignupFlowId(): Promise<string | null> {
  const store = await cookies()
  return (await store.get(COOKIE_NAME))?.value ?? null
}

/**
 * LEGACY -- the pre-SO-4 binding. Retire in the release after this one.
 *
 * Kept only so a signup already in flight when this deployed still completes.
 * Nothing writes a new one: `submitSignup` no longer sends any metadata at all.
 */
export async function issueSignupBinding(): Promise<string> {
  const value = randomBytes(32).toString("base64url")
  await storeSignupFlowId(value)
  return hash(value)
}

/** LEGACY. True only when this browser holds the value whose hash the old payload carries. */
export async function signupBindingMatches(expectedHash: unknown): Promise<boolean> {
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false
  const value = await readSignupFlowId()
  if (!value) return false
  const actual = Buffer.from(hash(value), "hex")
  const expected = Buffer.from(expectedHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function clearSignupBinding(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}
