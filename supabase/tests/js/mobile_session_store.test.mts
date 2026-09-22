import { test } from "node:test"
import assert from "node:assert/strict"

/**
 * THE SESSION STORE'S CHUNKING, EXERCISED.
 *
 * A Supabase session carrying a long JWT exceeds what `expo-secure-store` will accept in one item, so
 * values are split. Splitting is easy; splitting SAFELY is the part worth testing, because the failure
 * mode is silent: a half-written value read back as a whole one hands the auth library a truncated
 * token, and the person is mysteriously signed out with an error pointing somewhere else entirely.
 *
 * The store's platform half is `expo-secure-store` and `AsyncStorage`, neither of which exists in Node.
 * Rather than mock the module -- which would test the mock -- the same algorithm is exercised against
 * an in-memory backing, and `mobile_foundation.test.mts` separately pins that the real module is the
 * one the app uses. The header-last write order and the missing-part rule are the logic under test.
 */

const CHUNK_LIMIT = 1800

function makeStore() {
  const backing = new Map<string, string>()

  async function getRaw(key: string) {
    return backing.has(key) ? backing.get(key)! : null
  }
  async function setRaw(key: string, value: string) {
    backing.set(key, value)
  }
  async function removeRaw(key: string) {
    backing.delete(key)
  }
  async function clearChunks(key: string) {
    const head = await getRaw(key)
    if (head === null || !head.startsWith("chunks:")) return
    const count = Number.parseInt(head.slice("chunks:".length), 10)
    if (!Number.isFinite(count)) return
    for (let i = 0; i < count; i += 1) await removeRaw(`${key}.${i}`)
  }

  return {
    backing,
    async getItem(key: string): Promise<string | null> {
      const head = await getRaw(key)
      if (head === null) return null
      if (!head.startsWith("chunks:")) return head
      const count = Number.parseInt(head.slice("chunks:".length), 10)
      if (!Number.isFinite(count) || count < 1) return null
      const parts: string[] = []
      for (let i = 0; i < count; i += 1) {
        const part = await getRaw(`${key}.${i}`)
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
      for (let i = 0; i < parts.length; i += 1) await setRaw(`${key}.${i}`, parts[i])
      await setRaw(key, `chunks:${parts.length}`)
    },
    async removeItem(key: string): Promise<void> {
      await clearChunks(key)
      await removeRaw(key)
    },
  }
}

test("a short value is stored whole", async () => {
  const store = makeStore()
  await store.setItem("k", "a session")
  assert.equal(await store.getItem("k"), "a session")
  assert.equal(store.backing.size, 1, "a short value was split unnecessarily")
})

test("a long value survives the round trip exactly", async () => {
  const store = makeStore()
  const session = "x".repeat(4321) + "END"
  await store.setItem("k", session)
  assert.equal(await store.getItem("k"), session)
  assert.ok(store.backing.size > 2, "a long value was not split at all")
})

test("a value at the boundary is not split, and one byte over is", async () => {
  const store = makeStore()
  await store.setItem("k", "y".repeat(CHUNK_LIMIT))
  assert.equal(store.backing.size, 1)
  const second = makeStore()
  await second.setItem("k", "y".repeat(CHUNK_LIMIT + 1))
  assert.equal(second.backing.size, 3, "one byte over the limit did not produce two parts plus a header")
})

test("a half-written value reads as nothing, never as a truncated session", async () => {
  // THE FAILURE THIS DESIGN EXISTS FOR. An interrupted write leaves parts behind; returning what is
  // there would hand the auth library a token that is the right shape and the wrong length, and the
  // resulting error names something else entirely.
  const store = makeStore()
  await store.setItem("k", "z".repeat(5000))
  store.backing.delete("k.1")
  assert.equal(await store.getItem("k"), null)
})

test("replacing a long value with a short one leaves no orphaned parts", async () => {
  const store = makeStore()
  await store.setItem("k", "a".repeat(5000))
  await store.setItem("k", "small")
  assert.equal(await store.getItem("k"), "small")
  assert.equal(store.backing.size, 1, `orphans left: ${[...store.backing.keys()].join(", ")}`)
})

test("removing clears every part, so signing out leaves nothing on the device", async () => {
  const store = makeStore()
  await store.setItem("k", "b".repeat(6000))
  await store.removeItem("k")
  assert.equal(store.backing.size, 0, `left behind: ${[...store.backing.keys()].join(", ")}`)
  assert.equal(await store.getItem("k"), null)
})
