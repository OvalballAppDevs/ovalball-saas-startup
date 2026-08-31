"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { deleteClubContact, saveClubContact, type ClubContact } from "./actions"

const ROLE_LABEL: Record<ClubContact["role"], string> = {
  fixture_secretary: "Fixture Secretary",
  minis_secretary: "Minis Secretary",
  general: "General enquiries",
}

const EMPTY_DRAFT = { role: "general" as ClubContact["role"], name: "", phone: "", email: "", isPublic: true }

/**
 * Reuses club_contacts (already the schema's answer to "a named contact for
 * this club") for the brief's "public telephone, public email" fields --
 * never adds raw phone/email columns to `clubs` itself. is_public controls
 * whether a row shows on the public /club/{slug} page; unchecked contacts
 * are club-internal only (still visible here, never to the public).
 */
export function ClubContactsSection({ clubId, initial }: { clubId: string; initial: ClubContact[] }) {
  const [contacts, setContacts] = useState(initial)
  const [editingId, setEditingId] = useState<string | "new" | null>(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  function startEdit(contact: ClubContact | null) {
    setError(null)
    if (contact) {
      setEditingId(contact.id)
      setDraft({ role: contact.role, name: contact.name, phone: contact.phone ?? "", email: contact.email ?? "", isPublic: contact.isPublic })
    } else {
      setEditingId("new")
      setDraft(EMPTY_DRAFT)
    }
  }

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await saveClubContact({
      clubId,
      id: editingId !== "new" ? (editingId ?? undefined) : undefined,
      ...draft,
    })
    setStatus("idle")
    if (!result.ok) {
      setError(result.error)
      return
    }
    // Simplest correct refresh for a short admin-only list -- avoids
    // threading the DB-generated id back through a client-only optimistic
    // insert for a section that's rarely more than a handful of rows.
    window.location.reload()
  }

  async function handleDelete(id: string) {
    setStatus("saving")
    const result = await deleteClubContact(id)
    setStatus("idle")
    if (result.ok) {
      setContacts((prev) => prev.filter((c) => c.id !== id))
    } else {
      setError(result.error)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Public contacts</p>
        {editingId === null && (
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => startEdit(null)}>
            Add contact
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink/45">
        Shown on your public club page only when marked public. Never your personal login email.
      </p>

      {contacts.length === 0 && editingId === null && (
        <p className="mt-3 text-sm text-ink/45">No contacts added yet.</p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {c.name} <span className="text-ink/40">&middot; {ROLE_LABEL[c.role]}</span>
              </p>
              <p className="truncate text-xs text-ink/50">
                {[c.phone, c.email].filter(Boolean).join(" · ") || "No phone or email"}
                {!c.isPublic && <span className="ml-1.5 text-ink/35">(private)</span>}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => startEdit(c)}>
                Edit
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => handleDelete(c.id)}>
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {editingId !== null && (
        <div className="mt-3 rounded-lg border border-ink/10 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-name" className="text-ink/80">
                Name
              </Label>
              <Input
                id="contact-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
            <div>
              <Label htmlFor="contact-role" className="text-ink/80">
                Role
              </Label>
              <select
                id="contact-role"
                value={draft.role}
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as ClubContact["role"] }))}
                className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                {(Object.keys(ROLE_LABEL) as ClubContact["role"][]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="contact-phone" className="text-ink/80">
                Phone
              </Label>
              <Input
                id="contact-phone"
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
            <div>
              <Label htmlFor="contact-email" className="text-ink/80">
                Email
              </Label>
              <Input
                id="contact-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={draft.isPublic}
              onChange={(e) => setDraft((d) => ({ ...d, isPublic: e.target.checked }))}
              className="size-4 accent-pitch-600"
            />
            Show on public club page
          </label>

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" className="h-9" disabled={status === "saving" || !draft.name.trim()} onClick={handleSave}>
              {status === "saving" ? "Saving…" : "Save contact"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
