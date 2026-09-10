import "server-only"

// The company, product and contact identity are read from the SAME constants
// the public legal pages use, so an email and a legal page can never disagree
// about who Ovalball is or where to reach it. Nothing is re-typed here.
import { CONTACT_EMAIL, OPERATOR_STATEMENT, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/legal/metadata"

/**
 * The Ovalball email design system.
 *
 * WHY THIS LOOKS LIKE 2005 HTML
 *
 * Email clients are not browsers. Outlook renders through Word, Gmail strips
 * <style> in some contexts, and flexbox/grid/custom-properties are unreliable
 * across the field. So: tables for layout, inline styles only, no external
 * CSS, no web fonts, no JavaScript, no SVG. That is not carelessness; it is
 * the constraint the medium imposes, and fighting it produces mail that looks
 * broken for a large minority of real recipients.
 *
 * Within that constraint the brand still shows: the forest/chalk/pitch
 * palette, the Ovalball mark, generous spacing, and a single confident call
 * to action per message.
 */

/**
 * The brand palette, restated as literal hex because a CSS variable cannot
 * survive the trip into an inbox.
 *
 * These values are checked against app/globals.css by a test rather than
 * trusted to a comment. They had drifted: the email green was #1c4532 while
 * the site's forest-800 is #123d2c, the accent was #2f855a against a site
 * pitch-600 of #32a665, and mint was #e6f4ec against #dcf7e5. Nobody notices
 * that in isolation -- you only see it when an email sits next to the product
 * it is supposedly from, which is exactly the moment it matters.
 */
export const EMAIL_COLORS = {
  forest950: "#071c14",
  forest900: "#0b2b1e",
  forest800: "#123d2c",
  pitch600: "#32a665",
  pitch400: "#5acb83",
  mint100: "#dcf7e5",
  chalk: "#f8faf7",
  white: "#ffffff",
  ink: "#101512",
  /**
   * Secondary text. The site's --ink-muted, which was measured at 5.64:1 on
   * chalk and 5.92:1 on white -- small grey text is the commonest
   * accessibility failure in email, so this is a measured value, not a taste.
   */
  inkMuted: "#616562",
  border: "#dde5e0",
  /** A hairline on the dark band, where the normal border would vanish. */
  borderOnDark: "#1d5540",
  amber: "#8a6100",
  amberBg: "#fdf6e3",
} as const

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Emails are read on phones far more than on desktops; 600px is the safe maximum width. */
const CONTENT_WIDTH = 600

/**
 * The Ovalball mark, as a stable absolute URL on Ovalball's own origin.
 *
 * CODE-OWNED, deliberately. An editable image URL would let whoever controls
 * the copy point a trusted, correctly-branded email at an image on a host
 * they own -- which is a read receipt on every recipient at best, and a
 * different logo entirely at worst. There is one path, it is served by
 * Ovalball, and Site Admin cannot reach it.
 *
 * The path is also PERMANENT. It names no particular file: a route on
 * Ovalball's own origin decides which bytes to serve, so a Full Site Admin
 * can change the logo from Email Configuration without invalidating the image
 * in every message already sitting in somebody's inbox -- and without this
 * renderer needing a database, which is what keeps it synchronous.
 */
export const EMAIL_LOGO_PATH = "/email-assets/logo.png"

/**
 * Displayed at 112px. The asset is larger so it stays sharp on retina screens.
 *
 * Sized for a square mark. A full lockup -- one whose artwork already contains
 * the wordmark and tagline -- wants more again before its smallest line is
 * legible, and at that point the Rugby Connected strip below starts repeating
 * the image rather than supporting it.
 */
const LOGO_DISPLAY_PX = 112

/**
 * `assetOrigin` lets a Site Admin preview fetch this image from the server
 * that is actually rendering the preview, without weakening the rule for real
 * mail: every send leaves it undefined, so `siteUrl` -- the one canonical
 * origin -- is what a recipient's own copy of this URL always resolves. The
 * safety check below still runs, against whichever origin is actually in use,
 * so a preview can never point the logo somewhere neither origin allows.
 */
export function emailLogoUrl(siteUrl: string, assetOrigin?: string): string | null {
  const origin = assetOrigin ?? siteUrl
  return safeUrl(`${origin}${EMAIL_LOGO_PATH}`, origin)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * A URL is only ever emitted if it points at Ovalball's own origin.
 *
 * Every CTA in this system is built from getSiteUrl(), but this is the
 * backstop: a template that ever interpolated a caller-supplied destination
 * would produce an open redirect straight out of a trusted email. Anything
 * that fails this check is dropped rather than rendered. The logo goes
 * through it too, for the same reason.
 */
export function safeUrl(url: string, siteUrl: string): string | null {
  try {
    const parsed = new URL(url, siteUrl)
    const origin = new URL(siteUrl)
    if (parsed.origin !== origin.origin) return null
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 18px;font-family:${FONT_STACK};font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-0.3px;color:${EMAIL_COLORS.forest950};">${escapeHtml(text)}</h1>`
}

export function subheading(text: string): string {
  return `<h2 style="margin:28px 0 10px;font-family:${FONT_STACK};font-size:16px;line-height:1.3;font-weight:700;color:${EMAIL_COLORS.forest950};">${escapeHtml(text)}</h2>`
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${EMAIL_COLORS.ink};">${escapeHtml(text)}</p>`
}

export function mutedParagraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:14px;line-height:1.55;color:${EMAIL_COLORS.inkMuted};">${escapeHtml(text)}</p>`
}

/**
 * Message text written by another person (a safeguarding message, a support
 * reply). Escaped, then newlines restored -- never rendered as HTML, because
 * the author is not trusted to supply markup.
 */
export function quotedBody(text: string): string {
  const safe = escapeHtml(text).replace(/\r?\n/g, "<br />")
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
    <tr><td style="border-left:3px solid ${EMAIL_COLORS.pitch600};background:${EMAIL_COLORS.chalk};padding:16px 18px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${EMAIL_COLORS.ink};">${safe}</td></tr>
  </table>`
}

/**
 * A block of label/value facts -- fixture details, invitation context.
 *
 * The renderer supplies the presentation; the event supplies permitted data.
 * That is what stops a future fixture email inventing its own design: it
 * hands over the rows it is allowed to show and gets the house style back.
 */
export function infoCard(rows: Array<{ label: string; value: string }>): string {
  if (rows.length === 0) return ""
  const body = rows
    .map(
      (row, i) => `<tr>
        <td style="padding-top:${i === 0 ? "0" : "12px"};font-family:${FONT_STACK};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${EMAIL_COLORS.inkMuted};width:34%;padding-right:14px;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding-top:${i === 0 ? "0" : "12px"};font-family:${FONT_STACK};font-size:15px;line-height:1.45;font-weight:600;color:${EMAIL_COLORS.forest950};vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("")
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid ${EMAIL_COLORS.border};border-radius:10px;background:${EMAIL_COLORS.chalk};">
    <tr><td style="padding:18px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${body}</table></td></tr>
  </table>`
}

/**
 * Club identity. The crest is included only when a real stored URL is passed
 * -- there is no placeholder image, because a broken image icon in an
 * invitation reads as a broken product.
 *
 * `siteUrl` is required, not optional, and the crest is dropped rather than
 * rendered when `logoUrl` fails `safeUrl()` against it. `logoUrl` is expected
 * to already be an Ovalball-origin path built by lib/email/club-crest.ts
 * (`/email-assets/club-crest/[clubId]` or `.../directory-crest/[directoryId]`)
 * -- this check is the backstop, not the only gate: a club's crest is
 * data-shaped, but it is still an image URL landing in a trusted,
 * correctly-authenticated email, and it must resolve to Ovalball's own origin
 * or not render at all.
 */
export function clubIdentity(clubName: string, logoUrl: string | null, siteUrl: string): string {
  const safeLogoUrl = logoUrl ? safeUrl(logoUrl, siteUrl) : null
  const crest = safeLogoUrl
    ? `<td width="46" style="padding-right:14px;vertical-align:middle;"><img src="${escapeHtml(safeLogoUrl)}" width="46" height="46" alt="" style="display:block;width:46px;height:46px;border-radius:6px;border:1px solid ${EMAIL_COLORS.border};" /></td>`
    : ""
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
    <tr>${crest}<td style="vertical-align:middle;font-family:${FONT_STACK};font-size:15px;font-weight:700;letter-spacing:0.2px;color:${EMAIL_COLORS.forest800};">${escapeHtml(clubName)}</td></tr>
  </table>`
}

/**
 * MATCH SUMMARY -- the structured, renderer-owned fixture identity block.
 *
 * Consumes lib/email/context/resolve-fixture-email-context.ts's typed
 * output directly: nothing here reads a database, walks a domain object, or
 * lets a template author choose which field appears. A Site Admin can decide
 * this block appears in an email's copy (a future contract flag, mirroring
 * `hasClubCrest`); they cannot change what it shows or how, for the same
 * reason clubIdentity() is not an editable token -- a fixture's own identity
 * is a fact about the event, not wording.
 *
 * NULL-SAFE BY CONSTRUCTION. Real fixtures are frequently incomplete (no
 * pitch assigned yet, meet time not set, opposition not yet confirmed), and
 * this renders each optional row only when it has something to say --
 * never "Meet: —" or "Pitch: undefined". See resolveFixtureEmailContext's
 * own header for why attendance here is an aggregate count, never a named
 * participant.
 */
export function matchSummaryBlock(
  context: import("../context/resolve-fixture-email-context").FixtureEmailContext,
  siteUrl: string
): string {
  const side = (s: { displayName: string; crestUrl: string | null }) => {
    const crest = s.crestUrl
      ? (() => {
          const safe = safeUrl(s.crestUrl!, siteUrl)
          return safe
            ? `<img src="${escapeHtml(safe)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:6px;border:1px solid ${EMAIL_COLORS.border};margin:0 auto 8px;" />`
            : ""
        })()
      : ""
    return `<td align="center" width="46%" style="vertical-align:top;">
      ${crest}
      <div style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${EMAIL_COLORS.forest950};line-height:1.3;">${escapeHtml(s.displayName)}</div>
    </td>`
  }

  const timingParts = [
    context.meetTimeDisplay ? `Meet ${escapeHtml(context.meetTimeDisplay)}` : null,
    context.kickoffTimeDisplay ? `Kick-off ${escapeHtml(context.kickoffTimeDisplay)}` : null,
  ].filter((p): p is string => p !== null)

  const venueLines = context.venue
    ? [context.venue.name, ...context.venue.addressLines, context.venue.postcode].filter((l): l is string => Boolean(l && l.trim()))
    : []

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid ${EMAIL_COLORS.border};border-radius:10px;background:${EMAIL_COLORS.chalk};">
    <tr><td style="padding:20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          ${side(context.home)}
          <td align="center" width="8%" style="vertical-align:middle;font-family:${FONT_STACK};font-size:12px;font-weight:700;color:${EMAIL_COLORS.inkMuted};">v</td>
          ${side(context.away)}
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:16px;border-top:1px solid ${EMAIL_COLORS.border};padding-top:14px;">
        <tr><td style="font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${EMAIL_COLORS.forest950};padding-bottom:${timingParts.length > 0 ? "4px" : "0"};">${escapeHtml(context.fixtureDateDisplay)}</td></tr>
        ${timingParts.length > 0 ? `<tr><td style="font-family:${FONT_STACK};font-size:13px;color:${EMAIL_COLORS.inkMuted};padding-bottom:${venueLines.length > 0 ? "10px" : "0"};">${timingParts.join(" &middot; ")}</td></tr>` : ""}
        ${
          venueLines.length > 0 || context.pitchName
            ? `<tr><td style="font-family:${FONT_STACK};font-size:13px;color:${EMAIL_COLORS.inkMuted};">${[...venueLines, context.pitchName].filter((l): l is string => Boolean(l)).map(escapeHtml).join("<br/>")}</td></tr>`
            : ""
        }
      </table>
    </td></tr>
  </table>`
}

/**
 * A compact, human list for a "how many of these" field a scalar cannot
 * honestly answer -- 0 pitches, 1 pitch, several pitches, many pitches. Never
 * lets a narrow email column try to list eighteen team names.
 */
function compactList(names: string[], manyLabel: (count: number) => string, manyThreshold = 3): string {
  if (names.length === 0) return ""
  if (names.length <= manyThreshold) return names.join(", ")
  return manyLabel(names.length)
}

/**
 * THE TRAINING SUMMARY BLOCK -- same design family as matchSummaryBlock,
 * built for what training actually has (a team, a time, a place) rather than
 * a copy of the match block with fixture-only fields hidden. No home/away,
 * no opposition, no attendance count: training has none of those concepts.
 *
 * NULL-SAFE BY CONSTRUCTION, same rule as matchSummaryBlock: an optional row
 * renders only when it has something to say.
 */
export function trainingSummaryBlock(
  context: import("../context/resolve-training-email-context").TrainingEmailContext
): string {
  const venueLines = context.venue
    ? [context.venue.name, ...context.venue.addressLines, context.venue.postcode].filter((l): l is string => Boolean(l && l.trim()))
    : []

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid ${EMAIL_COLORS.border};border-radius:10px;background:${EMAIL_COLORS.chalk};">
    <tr><td style="padding:20px;">
      ${
        context.teamName
          ? `<div style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${EMAIL_COLORS.forest950};line-height:1.3;padding-bottom:10px;">${escapeHtml(context.teamName)}</div>`
          : ""
      }
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${context.teamName ? `border-top:1px solid ${EMAIL_COLORS.border};padding-top:14px;` : ""}">
        <tr><td style="font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${EMAIL_COLORS.forest950};padding-bottom:${context.timeRangeDisplay ? "4px" : "0"};">${escapeHtml(context.sessionDateDisplay)}</td></tr>
        ${
          context.timeRangeDisplay
            ? `<tr><td style="font-family:${FONT_STACK};font-size:13px;color:${EMAIL_COLORS.inkMuted};padding-bottom:${venueLines.length > 0 || context.pitchName ? "10px" : "0"};">${escapeHtml(context.timeRangeDisplay)}</td></tr>`
            : ""
        }
        ${
          venueLines.length > 0 || context.pitchName
            ? `<tr><td style="font-family:${FONT_STACK};font-size:13px;color:${EMAIL_COLORS.inkMuted};">${[...venueLines, context.pitchName].filter((l): l is string => Boolean(l)).map(escapeHtml).join("<br/>")}</td></tr>`
            : ""
        }
      </table>
    </td></tr>
  </table>`
}

/** One confident action per email. A bulletproof button: table-based, so Outlook renders it. */
export function primaryCta(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
    <tr><td align="center" bgcolor="${EMAIL_COLORS.forest800}" style="border-radius:10px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 30px;font-family:${FONT_STACK};font-size:16px;font-weight:700;line-height:1.25;color:${EMAIL_COLORS.white};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`
}

/**
 * The same destination as plain text, for clients that strip the button.
 *
 * break-all is scoped to the URL alone. Applied to the paragraph it also
 * chops the sentence mid-word ("paste this into your bro / wser"), which is
 * exactly what it looked like at 390px before this was narrowed.
 */
export function ctaFallback(url: string): string {
  return `<p style="margin:0 0 4px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">If the button doesn&rsquo;t work, paste this into your browser:<br /><a href="${escapeHtml(url)}" style="color:${EMAIL_COLORS.forest800};word-break:break-all;">${escapeHtml(url)}</a></p>`
}

export function statusNote(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;">
    <tr><td style="background:${EMAIL_COLORS.amberBg};border:1px solid #e8d9a8;border-radius:10px;padding:14px 16px;font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.amber};">${escapeHtml(text)}</td></tr>
  </table>`
}

/**
 * THE TEST MARKER'S WORDING -- the one copy of this sentence. Used by the
 * HTML banner below AND by renderEmail()'s plain-text pass (lib/email/
 * templates.ts), so a test send discloses itself identically in both parts
 * of the message rather than only in whichever one somebody remembered.
 */
export const TEST_MODE_MESSAGE =
  "TEST EMAIL -- sent by a Site Admin to check this template. This is not a real Ovalball notification and nothing described below has actually happened."

/**
 * THE TEST MARKER -- renderer-owned, never a string a Site Admin can type or
 * omit from a draft. Threaded through renderEmailDocument's own `isTest`
 * flag so it appears in EVERY test send regardless of which event or which
 * copy is being tested, the same way the brand band or the footer cannot be
 * turned off from Email Configuration.
 */
export function testModeBanner(): string {
  return statusNote(TEST_MODE_MESSAGE)
}

export function divider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;"><tr><td style="border-top:1px solid ${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</td></tr></table>`
}

/**
 * The shared shell every Ovalball email is rendered into.
 *
 * THE HIERARCHY
 *
 *   mark  ->  brand band (what kind of message this is)
 *         ->  heading, body, one action
 *         ->  Rugby Connected strip
 *         ->  quiet legal footer
 *
 * THE EYEBROW IS CODE-OWNED. It names the KIND of message -- Welcome,
 * Safeguarding, Support -- which is a fact about the event, not a matter of
 * wording. Site Admin can rewrite a safeguarding email's heading; it must not
 * be able to file it under "Welcome to Ovalball". So it arrives from the
 * event's contract, never from the editable content, and it sits in the green
 * band where it gives that band a job instead of being decoration.
 *
 * BRAND SURVIVES IMAGES BEING OFF. Many clients block remote images by
 * default, so the mark carries real alt text and the wordmark, tagline and
 * operator statement below are live text. The email is fully understandable
 * with every image suppressed.
 *
 * THE FOOTER IS DELIBERATELY THE QUIETEST THING HERE. A transactional email
 * is a service message, and a footer that competes with the content reads as
 * marketing. No social icons, no campaign links, no unsubscribe -- offering
 * to unsubscribe from the invitation that lets somebody into their club would
 * be an offer the product cannot honour.
 *
 * The contact address is rendered as TEXT rather than a mailto link. Every
 * href in an Ovalball email must point at Ovalball's own origin, which is what
 * stops a template ever emitting a redirect out of trusted mail; that rule is
 * worth more than a clickable address, and clients linkify a bare one anyway.
 */
export function renderEmailDocument(options: {
  title: string
  preheader: string
  body: string
  siteUrl: string
  /** The code-owned category label shown in the brand band. */
  eyebrow?: string
  footerNote?: string
  /** Site Admin preview only -- see emailLogoUrl(). Real sends never set this. */
  assetOrigin?: string
  /** Site Admin "Send Test Email" only -- see testModeBanner(). Never settable from template copy. */
  isTest?: boolean
}): string {
  const { title, preheader, body, siteUrl, eyebrow, footerNote, assetOrigin, isTest } = options
  const logo = emailLogoUrl(siteUrl, assetOrigin)

  // The band always renders: it is the brand rule under the mark. With an
  // eyebrow it also says what kind of message this is.
  const band = `<tr><td style="background:${EMAIL_COLORS.forest800};padding:${eyebrow ? "13px 28px" : "6px 28px"};font-family:${FONT_STACK};font-size:12px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${EMAIL_COLORS.mint100};">${eyebrow ? escapeHtml(eyebrow) : "&nbsp;"}</td></tr>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
<style>
  /* Progressive enhancement only. Every measurement below is already
     comfortable at 320px without this block, because Gmail and Outlook
     cannot be relied on to apply it -- a layout that NEEDS a media query to
     be usable is broken in the clients that matter most. */
  @media only screen and (min-width: 620px) {
    .ovb-pad { padding-left: 40px !important; padding-right: 40px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.chalk};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:${EMAIL_COLORS.chalk};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL_COLORS.chalk};">
  <tr><td align="center" style="padding:32px 12px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${CONTENT_WIDTH}" style="width:100%;max-width:${CONTENT_WIDTH}px;">

      <tr><td align="center" style="padding:0 0 22px;">
        ${
          logo
            ? `<img src="${escapeHtml(logo)}" width="${LOGO_DISPLAY_PX}" height="${LOGO_DISPLAY_PX}" alt="${escapeHtml(PRODUCT_NAME)}" style="display:block;width:${LOGO_DISPLAY_PX}px;height:${LOGO_DISPLAY_PX}px;border:0;border-radius:16px;" />`
            : `<span style="font-family:${FONT_STACK};font-size:20px;font-weight:800;letter-spacing:0.02em;color:${EMAIL_COLORS.forest950};">OVAL<span style="color:${EMAIL_COLORS.pitch600};">BALL</span></span>`
        }
      </td></tr>

      <tr><td style="background:${EMAIL_COLORS.white};border:1px solid ${EMAIL_COLORS.border};border-radius:16px;overflow:hidden;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

          ${band}

          <tr><td class="ovb-pad" style="padding:34px 28px 30px;">
            ${isTest ? testModeBanner() : ""}
            ${body}
          </td></tr>

          <tr><td class="ovb-pad" style="background:${EMAIL_COLORS.mint100};border-top:1px solid ${EMAIL_COLORS.border};padding:18px 28px;">
            <p style="margin:0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;font-weight:700;color:${EMAIL_COLORS.forest800};">${escapeHtml(PRODUCT_TAGLINE)}</p>
            <p style="margin:4px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.forest800};">Club, team and player, in one connected place.</p>
          </td></tr>

        </table>
      </td></tr>

      <tr><td style="padding:22px 8px 0;">
        ${footerNote ? `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">${escapeHtml(footerNote)}</p>` : ""}
        <p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">
          Need help? <a href="${escapeHtml(siteUrl)}/support" style="color:${EMAIL_COLORS.forest800};">Contact Ovalball support</a>
        </p>
        <p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">
          <a href="${escapeHtml(siteUrl)}/legal/terms" style="color:${EMAIL_COLORS.inkMuted};">Terms</a> &nbsp;&middot;&nbsp;
          <a href="${escapeHtml(siteUrl)}/legal/privacy" style="color:${EMAIL_COLORS.inkMuted};">Privacy</a>
        </p>

        <p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.inkMuted};">
          <span style="font-weight:700;color:${EMAIL_COLORS.forest950};">${escapeHtml(PRODUCT_NAME)}</span>
          &nbsp;&middot;&nbsp; ${escapeHtml(PRODUCT_TAGLINE)}<br />
          ${escapeHtml(OPERATOR_STATEMENT)}<br />
          Replies to this email go to ${escapeHtml(CONTACT_EMAIL)}.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}
