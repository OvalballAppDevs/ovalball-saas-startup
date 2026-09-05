// Next.js's client-bundle env-var inlining only works on a LITERAL
// `process.env.NEXT_PUBLIC_X` member expression -- a shared helper doing
// `process.env[name]` with a runtime variable can't be statically replaced,
// so each getter reads its own var directly rather than going through a
// generic requireEnv(name) indirection.

export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!value) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL. Copy .env.example to .env.local and fill it in.")
  }
  return value
}

export function getSupabasePublishableKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!value) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local and fill it in.")
  }
  return value
}
