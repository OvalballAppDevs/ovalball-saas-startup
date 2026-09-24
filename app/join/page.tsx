import type { Metadata } from "next"
import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"
import { FALLBACK_PURPOSE, INVITATION_PURPOSE } from "@ovalball/contracts/invitations"

import { JoinPanel } from "./join-panel"

export const metadata: Metadata = { title: "Accept an Invitation" }

/** What each kind of invitation is, said to the person holding it rather than to the database. */
/**
 * What this invitation is FOR, as a phrase that completes "…has invited you to ___".
 *
 * It used to be a noun list read as "You have been invited to {noun} on Ovalball by {name}", which was
 * never quite English -- "invited to a team on Ovalball" -- and broke outright for a kind that was
 * missing from the map. `GOVERNING_BODY_OFFICER` was missing, because Step 16 added the kind and nobody
 * added the label, so a county officer opening their invitation read
 *
 *   "You have been invited to join on Ovalball by Peter Popper."
 *
 * which is the same defect as the redemption outcome map and was sitting on the first screen anybody
 * meets. Verbs, and the organisation stays in the heading where it is already the biggest thing on the
 * page rather than being repeated in the sentence underneath it.
 */
// The words are the shared package's (CA-M11), so the phone and the website describe an invitation the same way.
const KIND_PURPOSE: Record<string, string> = INVITATION_PURPOSE

/**
 * THE ONE PLACE AN INVITATION IS ACCEPTED.
 *
 * Every kind of invitation Ovalball sends -- club staff, guardian, player, team join code,
 * safeguarding officer, site admin, account setup, club referral -- arrives here, because they are
 * one credential with one redemption path behind them.
 *
 * The page is public, and deliberately says very little. `preview_invitation` returns which club
 * invited you and roughly what for; it never returns who was invited, so an intercepted link does not
 * disclose an email address, and a wrong token previews nothing at all rather than explaining which
 * part was wrong.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; c?: string }>
}) {
  const { t, c } = await searchParams
  const token = t?.trim() || null
  // A CODE IS A FIRST-CLASS WAY IN, NOT A BLIND ONE.
  //
  // `preview_invitation` has always accepted either form, and the canonical
  // redemption path behind `lib/invitations/redeem.ts` has always redeemed
  // either, but this page only ever previewed a TOKEN: the
  // `c` parameter was declared here and never read. So somebody reading a code
  // down the phone typed it into a box and pressed a button with no idea which
  // club they were joining or what they were about to be given, while somebody
  // who clicked a link was told both. Same credential, same authority, two very
  // different experiences.
  const code = c?.trim() || null
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: preview } =
    token || code
      ? await supabase.rpc("preview_invitation", { p_token: token ?? undefined, p_code: code ?? undefined }).maybeSingle()
      : { data: null }

  const usable = preview?.state === "usable"

  // Somebody invited to Ovalball who has never been anybody here yet has no NAME. Creating an account
  // now creates a profile row alongside it, so "has a profile" is not the question -- an empty one is
  // just as nameless, and asking only when the row is missing left those people unable to answer the
  // age question at all, because first name and surname are NOT NULL on that row.
  const { data: profile } = user
    ? await supabase.from("profiles").select("first_name, surname").eq("id", user.id).maybeSingle()
    : { data: null }
  const hasName = Boolean(profile?.first_name?.trim() && profile?.surname?.trim())

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      {/*
        AN ENTRANCE IS ONE QUESTION AND ONE ANSWER, so it sits in the middle of the viewport rather than
        at the top of an empty page. Measured before this: the column ended around a third of the way
        down and left roughly 430px of nothing beneath it at 1280x900, which made a screen with a single
        action read like the top of a document that had failed to load the rest of itself.

        min-h-[calc(100vh-…)] rather than a flex-1 on the parent, because the header above is a fixed
        measured height and this keeps the centring honest without restructuring the page.
      */}
      <div className="mx-auto flex min-h-[calc(100vh-5.5rem)] max-w-lg flex-col justify-center px-4 py-12">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Invitation</p>

        {(token || code) && !preview ? (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">
              {code && !token ? "That code doesn't work" : "This link can't be used"}
            </h1>
            <p className="mt-3 text-base text-ink/60">
              It may have been used already, withdrawn, or {code && !token ? "typed incorrectly" : "copied incompletely"}. Ask
              whoever invited you to send it again.
            </p>
          </>
        ) : (token || code) && !usable ? (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">This invitation is no longer open</h1>
            <p className="mt-3 text-base text-ink/60">
              Ask whoever invited you to send a new one.
            </p>
          </>
        ) : preview ? (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">{preview.scope_label}</h1>
            {/* THE PERSON LEADS, because an invitation is from somebody. */}
            <p className="mt-3 text-base text-ink/60">
              {preview.inviter_label
                ? `${preview.inviter_label} has invited you to ${KIND_PURPOSE[preview.kind] ?? FALLBACK_PURPOSE}.`
                : `You have been invited to ${KIND_PURPOSE[preview.kind] ?? FALLBACK_PURPOSE}.`}
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">Accept an invitation</h1>
            <p className="mt-3 text-base text-ink/60">
              Enter the code from your invitation, or open the link you were sent.
            </p>
          </>
        )}

        <JoinPanel
          token={token}
          code={code}
          signedIn={Boolean(user)}
          hasInvitation={Boolean(usable)}
          needsName={Boolean(user) && !hasName}
        />
      </div>
    </main>
  )
}
