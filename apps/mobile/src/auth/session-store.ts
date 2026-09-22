import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

/**
 * WHERE THE SESSION LIVES.
 *
 * A Supabase session is a bearer credential: whoever holds the refresh token is the signed-in person
 * until it is revoked. On a phone it therefore belongs in the platform's own protected storage --
 * Keychain on iOS, Keystore-backed EncryptedSharedPreferences on Android -- which `expo-secure-store`
 * provides and which survives an app restart without being readable by another app or by a file
 * browser on a rooted device.
 *
 * WHAT IS STORED: the Supabase session only -- access token, refresh token, expiry and the user record
 * the library keeps beside them. Nothing else in this app writes a credential to disk. No capability,
 * no context decision and no roster is cached here; what a person may do is asked again on every
 * launch, because a cached "yes" would outlive the permission it came from.
 *
 * THE 2048-BYTE LIMIT IS REAL. iOS accepts far larger Keychain items, but SecureStore warns above
 * 2 KB and a session carrying a long JWT gets close. Values are therefore split across numbered
 * chunks, and the chunk count is written with the key so a partially-written value can never be read
 * back as a whole one.
 *
 * ON WEB THERE IS NO SECURE STORE, and this build runs on web for development and for the automated
 * journey, because this machine has no iOS or Android simulator. `AsyncStorage` there is
 * `localStorage`, which is exactly what the website's own Supabase client uses in a browser -- so web
 * is no weaker than the existing product, and no claim of native-grade storage is made for it. The
 * distinction is reported by `isSecure` rather than glossed over.
 */

const CHUNK_LIMIT = 1800

export const isSecure = Platform.OS !== "web"

export const sessionStorageDescription = isSecure
  ? "iOS Keychain / Android Keystore, through expo-secure-store"
  : "browser localStorage, as the website's own client uses — this platform has no secure store"

async function getRaw(key: string): Promise<string | null> {
  return isSecure ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key)
}

async function setRaw(key: string, value: string): Promise<void> {
  if (isSecure) await SecureStore.setItemAsync(key, value)
  else await AsyncStorage.setItem(key, value)
}

async function removeRaw(key: string): Promise<void> {
  if (isSecure) await SecureStore.deleteItemAsync(key)
  else await AsyncStorage.removeItem(key)
}

/** The Supabase client's storage contract, backed by whichever store this platform actually has. */
export const sessionStore = {
  async getItem(key: string): Promise<string | null> {
    const head = await getRaw(key)
    if (head === null) return null
    if (!head.startsWith("chunks:")) return head
    const count = Number.parseInt(head.slice("chunks:".length), 10)
    if (!Number.isFinite(count) || count < 1) return null
    const parts: string[] = []
    for (let i = 0; i < count; i += 1) {
      const part = await getRaw(`${key}.${i}`)
      // A missing part means a write was interrupted. Half a session is not a session: report nothing
      // rather than hand the library a truncated token it would fail on in a less obvious place.
      if (part === null) return null
      parts.push(part)
    }
    return parts.join("")
  },

  async setItem(key: string, value: string): Promise<void> {
    await clearChunks(key)
    if (value.length <= CHUNK_LIMIT) {
      await setRaw(key, value)
      return
    }
    const parts: string[] = []
    for (let i = 0; i < value.length; i += CHUNK_LIMIT) parts.push(value.slice(i, i + CHUNK_LIMIT))
    // Parts first, header last: the header is what makes the value readable, so writing it last means
    // an interrupted write leaves an unreadable value rather than a corrupt one.
    for (let i = 0; i < parts.length; i += 1) await setRaw(`${key}.${i}`, parts[i])
    await setRaw(key, `chunks:${parts.length}`)
  },

  async removeItem(key: string): Promise<void> {
    await clearChunks(key)
    await removeRaw(key)
  },
}

async function clearChunks(key: string): Promise<void> {
  const head = await getRaw(key)
  if (head === null || !head.startsWith("chunks:")) return
  const count = Number.parseInt(head.slice("chunks:".length), 10)
  if (!Number.isFinite(count)) return
  for (let i = 0; i < count; i += 1) await removeRaw(`${key}.${i}`)
}
