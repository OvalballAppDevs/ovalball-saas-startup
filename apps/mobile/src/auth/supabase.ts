import "react-native-url-polyfill/auto"

import { createClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

import { supabasePublishableKey, supabaseUrl } from "../config/environment"
import { sessionStore } from "./session-store"

/**
 * THE MOBILE CLIENT'S ONE CONNECTION TO OVALBALL.
 *
 * The same boundary the website's browser client uses: the publishable key, RLS on every table, and
 * SECURITY DEFINER RPCs for anything that needs to see more than the viewer does. Nothing privileged
 * is bundled, so there is nothing for an attacker with the .ipa to extract -- the app can only ever
 * ask questions that the database is willing to answer to the person signed in.
 *
 * `detectSessionInUrl` is off because that is a browser redirect mechanism; a native app receives an
 * OAuth or invitation callback as a deep link and hands the code to the library explicitly.
 * `autoRefreshToken` is on, and `src/auth/session.tsx` stops it while the app is in the background,
 * because a refresh timer firing in a suspended app is what produces the "signed out overnight"
 * report that nobody can reproduce.
 */
export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: sessionStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
