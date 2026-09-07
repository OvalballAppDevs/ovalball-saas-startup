import "server-only"

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
 * palette, the display wordmark, generous spacing, and a single confident
 * call to action per message.
 *
 * Colours are the same brand values as globals.css, restated as literal hex
 * because a CSS variable cannot survive the trip into an inbox.
 */

export const EMAIL_COLORS = {
  forest950: "#0b1a12",
  forest800: "#1c4532",
  pitch600: "#2f855a",
  mint100: "#e6f4ec",
  chalk: "#f8faf7",
  white: "#ffffff",
  ink: "#101512",
  /** Body text on white. Chosen for contrast, not for subtlety -- small grey text is the commonest accessibility failure in email. */
  inkMuted: "#4a534d",
  border: "#dbe2dd",
  amber: "#8a6100",
  amberBg: "#fdf6e3",
} as const

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Emails are read on phones far more than on desktops; 600px is the safe maximum width. */
const CONTENT_WIDTH = 600

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
 * that fails this check is dropped rather than rendered.
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
  return `<h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:24px;line-height:1.25;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(text)}</h1>`
}

export function subheading(text: string): string {
  return `<h2 style="margin:28px 0 10px;font-family:${FONT_STACK};font-size:16px;line-height:1.3;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(text)}</h2>`
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:16px;line-height:1.55;color:${EMAIL_COLORS.ink};">${escapeHtml(text)}</p>`
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
    <tr><td style="border-left:3px solid ${EMAIL_COLORS.pitch600};background:${EMAIL_COLORS.chalk};padding:16px 18px;font-family:${FONT_STACK};font-size:16px;line-height:1.55;color:${EMAIL_COLORS.ink};">${safe}</td></tr>
  </table>`
}

/** A bordered card of label/value facts -- fixture details, invitation context. */
export function infoCard(rows: Array<{ label: string; value: string }>): string {
  if (rows.length === 0) return ""
  const body = rows
    .map(
      (row, i) => `<tr>
        <td style="padding:${i === 0 ? "0" : "10px"} 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.4;color:${EMAIL_COLORS.inkMuted};width:38%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:${i === 0 ? "0" : "10px"} 0 0;font-family:${FONT_STACK};font-size:15px;line-height:1.4;font-weight:600;color:${EMAIL_COLORS.ink};vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("")
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;border:1px solid ${EMAIL_COLORS.border};border-radius:8px;background:${EMAIL_COLORS.white};">
    <tr><td style="padding:18px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${body}</table></td></tr>
  </table>`
}

/**
 * Club identity. The crest is included only when a real stored URL is passed
 * -- there is no placeholder image, because a broken image icon in an
 * invitation reads as a broken product.
 */
export function clubIdentity(clubName: string, logoUrl: string | null): string {
  const crest = logoUrl
    ? `<td width="48" style="padding-right:14px;vertical-align:middle;"><img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border-radius:6px;border:1px solid ${EMAIL_COLORS.border};" /></td>`
    : ""
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
    <tr>${crest}<td style="vertical-align:middle;font-family:${FONT_STACK};font-size:18px;font-weight:700;color:${EMAIL_COLORS.forest950};">${escapeHtml(clubName)}</td></tr>
  </table>`
}

/** One confident action per email. A bulletproof button: table-based, so Outlook renders it. */
export function primaryCta(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
    <tr><td align="center" bgcolor="${EMAIL_COLORS.forest800}" style="border-radius:8px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:16px;font-weight:600;line-height:1;color:${EMAIL_COLORS.white};text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
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
  return `<p style="margin:0 0 22px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">If the button doesn&rsquo;t work, paste this into your browser:<br /><a href="${escapeHtml(url)}" style="color:${EMAIL_COLORS.forest800};word-break:break-all;">${escapeHtml(url)}</a></p>`
}

export function statusNote(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;">
    <tr><td style="background:${EMAIL_COLORS.amberBg};border:1px solid #e8d9a8;border-radius:8px;padding:14px 16px;font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.amber};">${escapeHtml(text)}</td></tr>
  </table>`
}

export function divider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;"><tr><td style="border-top:1px solid ${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</td></tr></table>`
}

/**
 * The whole email. `preheader` is the grey line an inbox shows next to the
 * subject; without one, clients scrape the first visible text, which is
 * usually the wordmark.
 */
export function renderEmailDocument(options: {
  title: string
  preheader: string
  body: string
  siteUrl: string
  footerNote?: string
}): string {
  const { title, preheader, body, siteUrl, footerNote } = options
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.chalk};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:${EMAIL_COLORS.chalk};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL_COLORS.chalk};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${CONTENT_WIDTH}" style="width:100%;max-width:${CONTENT_WIDTH}px;">

      <tr><td style="padding:0 0 20px;">
        <span style="font-family:${FONT_STACK};font-size:20px;font-weight:800;letter-spacing:0.02em;color:${EMAIL_COLORS.forest950};">OVAL<span style="color:${EMAIL_COLORS.pitch600};">BALL</span></span>
      </td></tr>

      <tr><td style="background:${EMAIL_COLORS.white};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;padding:32px 28px;">
        ${body}
      </td></tr>

      <tr><td style="padding:20px 4px 0;">
        ${footerNote ? `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">${escapeHtml(footerNote)}</p>` : ""}
        <p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">
          Need help? <a href="${escapeHtml(siteUrl)}/support" style="color:${EMAIL_COLORS.forest800};">Contact Ovalball support</a>
        </p>
        <p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};">
          <a href="${escapeHtml(siteUrl)}/legal/terms" style="color:${EMAIL_COLORS.inkMuted};">Terms</a> &nbsp;&middot;&nbsp;
          <a href="${escapeHtml(siteUrl)}/legal/privacy" style="color:${EMAIL_COLORS.inkMuted};">Privacy</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}
