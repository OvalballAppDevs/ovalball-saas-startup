import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Verifies the `Webhook-Signature` header GoCardless sends -- HMAC-SHA256
 * of the RAW request body (before any JSON parsing), hex digest, compared
 * against the webhook endpoint's signing secret. Must be called with the
 * untouched request body text; parsing the body first and re-serializing
 * it will not reliably reproduce the exact bytes GoCardless signed (key
 * order, whitespace) and can cause false rejections.
 *
 * Uses a constant-time comparison (timingSafeEqual) rather than `===` so
 * this check itself cannot leak timing information about the secret.
 */
export function verifyGoCardlessWebhookSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string): boolean {
  if (!signatureHeader) return false

  const expected = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex")
  const expectedBuf = Buffer.from(expected, "hex")
  const providedBuf = Buffer.from(signatureHeader, "hex")

  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

export interface GoCardlessWebhookEvent {
  id: string
  resource_type: string
  action: string
  links?: Record<string, string>
  details?: { origin?: string; cause?: string; description?: string; reason_code?: string }
  metadata?: Record<string, string>
  created_at?: string
}

export interface GoCardlessWebhookPayload {
  events: GoCardlessWebhookEvent[]
}
