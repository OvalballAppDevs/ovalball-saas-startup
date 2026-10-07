import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"
import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"

import { webUrl } from "../config/environment"
import { friendly, logDetail } from "../errors/translate"

/**
 * CONNECT WITH GOCARDLESS, FROM THE APP (20270750000000).
 *
 * The phone used to open the website's start route in the system browser, which needed a separate WEBSITE
 * sign-in and finished on the website's settings page -- nothing ever came back to the app. Now:
 *
 *   1. the app asks the website, with its own bearer token, to START: the server checks the person may
 *      connect GoCardless for this club and that the club has agreed the Club Memberships terms, fixes the
 *      club, and answers with a one-time begin link;
 *   2. that link opens in an AUTHENTICATION SESSION (ASWebAuthenticationSession on iOS, a Custom Tab on
 *      Android) -- the system browser, never a WebView, so GoCardless's sign-in is never inside this app;
 *   3. the website carries the browser to GoCardless and back, keeps GoCardless's code on the server, and
 *      sends the browser to this app's own address with the intent's id and a one-time RETURN HANDOFF;
 *   4. the app asks the website to FINISH, again with its own token AND the handoff: only the person who
 *      started the connection may, only with the handoff its own return carried, and the club is the one
 *      fixed in step 1.
 *
 * WHY THE HANDOFF. A begin link forwarded to another organisation's GoCardless admin would otherwise let
 * the sender finish a connection THEY consented to. The handoff is given only to the device whose browser
 * finished GoCardless, so the sender's app never has it and the server never lets it claim.
 *
 * NOTHING SECRET TOUCHES THE PHONE. No GoCardless code, token or client secret is ever sent here; the
 * begin link is useless after one use or three minutes, and the intent id and handoff are useless to
 * anybody but the person who started it.
 *
 * THE SERVER IS ASKED HOW IT ENDED, WHATEVER THE BROWSER SAID. The browser's own result is a hint: on
 * Android the "closed" signal and the return can race, and a person may close the sheet a moment after
 * GoCardless sent them back. So FINISH is always called once the browser closes. If the browser handed
 * back no handoff and the server says GoCardless HAS returned ("awaiting_return"), the return is on its
 * way through the router: this waits a few seconds for a screen to pass it in (finishGoCardlessConnect),
 * asks once more, and otherwise says the connection finished somewhere else.
 *
 * WHERE THE RETURN LANDS. On iOS the authentication session takes the return address for itself and the
 * router never sees it. On Android the same address is also delivered to the router as a link, and
 * `+native-intent.ts` passes an address it does not recognise straight to the router -- so the return
 * path is the screen the person is ALREADY on (by default the Subscriptions screen): the router then
 * re-focuses that screen with the extra parameters (`intent`, `result`, `handoff`) instead of pushing a
 * new one. A caller connecting from a different screen passes that screen's path. A screen that receives
 * `intent` (and `handoff`) passes them to `finishGoCardlessConnect`, which joins a running connection
 * rather than finishing twice -- and finishes a return that arrived from cold, when Android closed the
 * app while GoCardless was open.
 *
 * No screen lives here: the screens decide how to present each result.
 */

export type GoCardlessConnectOutcome = "connected" | "cancelled" | "failed"

export interface GoCardlessConnectResult {
  outcome: GoCardlessConnectOutcome
  /** GoCardless's verification status as the server read it after connecting: action_required, in_review, successful or unknown. */
  verification?: string
  /** "membership_terms" when the club has not yet agreed Ovalball's Club Memberships terms: the screen can take the person there. */
  reason?: string
  /** A sentence to show the person. */
  message: string
}

export interface GoCardlessDisconnectResult {
  ok: boolean
  message: string
  /**
   * "42501" when the server refused on authority. Paired with `message`, it is the same shape
   * `isRecentAuthRefusal` reads, so a screen can hand a recent-authenticator refusal to step-up.
   */
  code?: string
}

const DEFAULT_RETURN_PATH = "/admin/subscriptions"
/** The one-time return handoff: 256 bits, base64url. */
const HANDOFF = /^[A-Za-z0-9_-]{43}$/
/** How long a finish without a handoff waits for the router to deliver one. */
const HANDOFF_WAIT_MS = 5_000

const NOT_AVAILABLE = "Connecting GoCardless is not available in this version of the app."
const SIGN_IN = "Your session has ended. Sign in again."
const NOT_CONNECTED = "GoCardless was not connected."
const COULD_NOT_START = "Could not start the GoCardless connection. Please try again."
const COULD_NOT_FINISH = "Could not complete the GoCardless connection. Please try connecting again."
const DIFFERENT_DEVICE = "GoCardless finished in a different browser or on a different device. Start again on this phone."

/** One connection at a time: a second tap while the browser is open joins the first rather than opening another. */
let inFlight: Promise<GoCardlessConnectResult> | null = null
/** The intent the running connection started, once the server has given it one. */
let inFlightIntentId: string | null = null
/** How the last few intents this app finished ended, so a late second ask is answered rather than repeated. */
const settled = new Map<string, Promise<GoCardlessConnectResult>>()
/** Handoffs a screen passed in from a router-delivered return, by intent, for a finish that needs one. */
const handoffs = new Map<string, string>()
const handoffWaiters = new Map<string, (handoff: string) => void>()

export function connectGoCardless(params: { supabase: SupabaseClient<Database>; clubId: string; returnPath?: string }): Promise<GoCardlessConnectResult> {
  if (!inFlight) {
    inFlight = runConnect(params).finally(() => {
      inFlight = null
      inFlightIntentId = null
    })
  }
  return inFlight
}

/**
 * Finish a connection from a return the ROUTER delivered: a screen opened with `?intent=<id>&result=...`
 * (and `&handoff=<...>` when GoCardless sent the browser back with an answer) passes them here.
 *
 * On Android that link reaches the router as well as -- or, if the system closed the app while GoCardless
 * was open, instead of -- the running `connectGoCardless`. While that call is still running for the same
 * intent, the handoff is handed to it and its answer is returned; after this app has already finished the
 * intent, the answer already given is returned -- an intent is never finished twice from here. Otherwise
 * this finishes it. Whether the person may finish it at all is the server's decision, as always.
 */
export function finishGoCardlessConnect({
  supabase,
  intentId,
  handoff,
}: {
  supabase: SupabaseClient<Database>
  intentId: string
  handoff?: string | null
}): Promise<GoCardlessConnectResult> {
  const delivered = typeof handoff === "string" && HANDOFF.test(handoff) ? handoff : undefined
  if (delivered) deliverHandoff(intentId, delivered)
  if (inFlight && inFlightIntentId === intentId) return inFlight
  return settled.get(intentId) ?? completeConnect(supabase, intentId, undefined, delivered)
}

async function runConnect({
  supabase,
  clubId,
  returnPath = DEFAULT_RETURN_PATH,
}: {
  supabase: SupabaseClient<Database>
  clubId: string
  returnPath?: string
}): Promise<GoCardlessConnectResult> {
  if (!webUrl) return { outcome: "failed", message: NOT_AVAILABLE }
  const startToken = await accessToken(supabase)
  if (!startToken) return { outcome: "failed", message: SIGN_IN }

  const returnUrl = Linking.createURL(returnPath.startsWith("/") ? returnPath : `/${returnPath}`)
  const started = await post<{ intentId?: string; beginUrl?: string; reason?: string }>("/api/gocardless/oauth/app/start", startToken, { clubId, returnUrl }, 20_000)
  const intentId = started.body?.intentId
  const beginUrl = started.body?.beginUrl
  if (!started.ok || !intentId || !beginUrl || !/^https?:\/\//i.test(beginUrl)) {
    const reason = started.body?.reason === "membership_terms" ? "membership_terms" : undefined
    return { outcome: "failed", message: started.message ?? COULD_NOT_START, ...(reason ? { reason } : {}) }
  }
  inFlightIntentId = intentId

  let browser: WebBrowser.WebBrowserAuthSessionResult | null = null
  try {
    browser = await WebBrowser.openAuthSessionAsync(beginUrl, returnUrl)
  } catch (cause) {
    logDetail("gocardless connect: browser", friendly(cause, "GoCardless"))
  }

  // Always asked, whatever the browser reported (see the header).
  return completeConnect(supabase, intentId, browser, browser?.type === "success" ? handoffFrom(browser.url, intentId) : undefined)
}

/**
 * Ask the website to finish the intent and say how it ended. `browser` is what the authentication session
 * reported: null when it could not be opened, undefined when there was no session in this app's lifetime.
 */
function completeConnect(
  supabase: SupabaseClient<Database>,
  intentId: string,
  browser: WebBrowser.WebBrowserAuthSessionResult | null | undefined,
  handoffGiven: string | undefined
): Promise<GoCardlessConnectResult> {
  const answer = (async (): Promise<GoCardlessConnectResult> => {
    // Only the server's own, final answer is remembered. After signing in again, a dropped connection, or
    // a return that has not reached this phone yet, asking again is still right.
    const unsettled = (result: GoCardlessConnectResult) => {
      settled.delete(intentId)
      return result
    }
    // A fresh token: the person may have been at GoCardless long enough for the first one to be refreshed.
    const token = await accessToken(supabase)
    if (!token) return unsettled({ outcome: "failed", message: SIGN_IN })

    let handoff = handoffGiven ?? handoffs.get(intentId)
    let finished = await finish(token, intentId, handoff)
    if (finished.body?.outcome === "awaiting_return" && !handoff) {
      handoff = (await waitForHandoff(intentId, HANDOFF_WAIT_MS)) ?? undefined
      if (!handoff) return unsettled({ outcome: "failed", message: DIFFERENT_DEVICE })
      finished = await finish((await accessToken(supabase)) ?? token, intentId, handoff)
    }
    if (finished.body === null) return unsettled({ outcome: "failed", message: finished.message ?? COULD_NOT_FINISH })

    if (finished.ok && finished.body.ok === true) {
      return { outcome: "connected", verification: finished.body.verification ?? "unknown", message: "GoCardless is connected." }
    }
    // A browser that never opened reads to the server as "never came back"; say what actually happened.
    if (browser === null) return { outcome: "failed", message: "GoCardless could not be opened. Please try again." }
    if (browser?.type === "locked") return { outcome: "failed", message: "Another browser window is already open. Close it and try again." }
    if (finished.body.outcome === "cancelled") return { outcome: "cancelled", message: finished.message ?? NOT_CONNECTED }
    if (finished.body.outcome === "awaiting_return") return unsettled({ outcome: "failed", message: DIFFERENT_DEVICE })
    return { outcome: "failed", message: finished.message ?? COULD_NOT_FINISH }
  })()
  remember(settled, intentId, answer)
  return answer
}

function finish(token: string, intentId: string, handoff: string | undefined) {
  return post<{ ok?: boolean; outcome?: string; verification?: string }>(
    "/api/gocardless/oauth/app/finish",
    token,
    handoff ? { intentId, handoff } : { intentId },
    45_000
  )
}

/** The handoff the browser came back with, when the return address it came back to is this intent's. */
function handoffFrom(url: string, intentId: string): string | undefined {
  try {
    const params = new URL(url).searchParams
    const intent = params.get("intent")
    const handoff = params.get("handoff")
    if (intent && intent !== intentId) return undefined
    return handoff && HANDOFF.test(handoff) ? handoff : undefined
  } catch {
    return undefined
  }
}

function deliverHandoff(intentId: string, handoff: string): void {
  remember(handoffs, intentId, handoff)
  const wake = handoffWaiters.get(intentId)
  if (wake) {
    handoffWaiters.delete(intentId)
    wake(handoff)
  }
}

function waitForHandoff(intentId: string, ms: number): Promise<string | null> {
  const ready = handoffs.get(intentId)
  if (ready) return Promise.resolve(ready)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      handoffWaiters.delete(intentId)
      resolve(null)
    }, ms)
    handoffWaiters.set(intentId, (handoff) => {
      clearTimeout(timer)
      resolve(handoff)
    })
  })
}

/** A small, bounded memory: the last few intents are all a person's phone ever needs. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.set(key, value)
  while (map.size > 5) map.delete(map.keys().next().value as string)
}

/**
 * Disconnect the club's GoCardless account through the website, which revokes the club's token at
 * GoCardless straight away -- the database alone can only queue it, because revoking needs the partner
 * app's secret, which never leaves the server.
 */
export async function disconnectGoCardless({
  supabase,
  clubId,
  reason,
}: {
  supabase: SupabaseClient<Database>
  clubId: string
  reason: string
}): Promise<GoCardlessDisconnectResult> {
  if (!webUrl) return { ok: false, message: "Disconnecting GoCardless is not available in this version of the app." }
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, message: "Give a reason for disconnecting GoCardless." }
  const token = await accessToken(supabase)
  if (!token) return { ok: false, message: SIGN_IN }

  const result = await post<{ ok?: boolean; code?: string }>("/api/gocardless/connection/disconnect", token, { clubId, reason: trimmed }, 30_000)
  if (result.ok && result.body?.ok === true) return { ok: true, message: "GoCardless is disconnected." }
  const code = typeof result.body?.code === "string" ? result.body.code : undefined
  return { ok: false, message: result.message ?? "Could not disconnect GoCardless. Please try again.", ...(code ? { code } : {}) }
}

async function accessToken(supabase: SupabaseClient<Database>): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * One JSON POST to the website, as the signed-in person. The website's routes answer with sentences
 * written for a person (`message`), which are passed on; a network failure or a timeout is said here.
 */
async function post<T>(
  path: string,
  token: string,
  body: unknown,
  timeoutMs: number
): Promise<{ ok: boolean; body: (T & { message?: unknown }) | null; message: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${webUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let parsed: (T & { message?: unknown }) | null = null
    try {
      parsed = (await response.json()) as T & { message?: unknown }
    } catch {
      parsed = null
    }
    const message = parsed && typeof parsed.message === "string" && parsed.message ? parsed.message : null
    return { ok: response.ok, body: parsed, message }
  } catch (cause) {
    const timedOut = controller.signal.aborted
    const problem = friendly(cause, "GoCardless")
    logDetail(`gocardless ${path}`, problem)
    return { ok: false, body: null, message: timedOut ? "Ovalball took too long to answer. Please try again." : problem.message }
  } finally {
    clearTimeout(timer)
  }
}
