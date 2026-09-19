import crypto from "node:crypto"

/** RFC 4648 base32 decode, for the secret GoTrue hands back at enrolment. */
export function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP: SHA-1, 30-second step, six digits -- what an authenticator app shows. */
export function totp(secretBase32, atMs = Date.now()) {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(atMs / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac("sha1", key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return String(code % 1_000_000).padStart(6, "0")
}

/** How much of a TOTP period must remain for a code to survive being typed and validated. */
export const SAFE_REMAINING_MS = 5000

/**
 * A code that will still be valid when the server checks it.
 *
 * WHY THIS EXISTS (Convergence Step 6, ledger L18). A TOTP code is bound to a
 * 30-second period. `totp(secret)` computes one for the period it is called in,
 * and the browser then has to type it, submit it, and wait for the server to
 * validate it. If that gap crosses a period boundary the code is stale and the
 * server is right to refuse it — and under a full browser batch the gap is
 * wider than it is in a suite running alone.
 *
 * That is what made `62-site-admin-master-control` fail five assertions in one
 * batch and pass 18/18 alone, twice: roughly the proportion of a 30-second
 * period that the submission gap occupies.
 *
 * THIS IS NOT AN ARBITRARY SLEEP, and the distinction matters because the
 * programme forbids those. The wait is on a quantity the algorithm itself
 * defines — the boundary of the current period — it is bounded by construction
 * at under one period, it happens only when the remaining window is genuinely
 * too small, and it removes a real defect in the test rather than papering over
 * one in the product. Retrying a rejected code, or widening a timeout until the
 * failure stopped appearing, would have been the forbidden thing.
 */
export async function totpForSubmission(secretBase32, { minRemainingMs = SAFE_REMAINING_MS } = {}) {
  const periodMs = 30_000
  const remaining = periodMs - (Date.now() % periodMs)
  let waitedMs = 0
  if (remaining < minRemainingMs) {
    waitedMs = remaining + 250
    await new Promise((resolve) => setTimeout(resolve, waitedMs))
  }
  return { code: totp(secretBase32), waitedMs }
}
