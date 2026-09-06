import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { ReplyForm } from "./reply-form"

/**
 * A deliberately small, purpose-built thread view for Safeguarding
 * Officer conversations -- NOT a reuse of the generic /messages/[kind]/[id]
 * shell, which is heavily coupled to fixture negotiation (status badges,
 * result panels, inline pitch/kickoff/competition editors) and not a
 * general-purpose message viewer. The underlying data (fixture_messages,
 * scoped to safeguarding_conversation_id) is fully shared -- only the
 * presentation is separate. RLS (fixture_messages_select_scoped, via
 * internal.can_view_safeguarding_conversation) is the real access
 * boundary; this page renders whatever it's actually allowed to read.
 */
export default async function SafeguardingConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: messages } = await supabase
    .from("fixture_messages")
    .select("id, sender_user_id, body, created_at")
    .eq("safeguarding_conversation_id", conversationId)
    .order("created_at", { ascending: true })

  if (!messages) redirect("/club/settings/safeguarding")

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Safeguarding Officer</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Conversation</h1>

      <ul className="mt-6 flex flex-col gap-2">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm ${
              m.sender_user_id === user.id ? "ml-auto bg-pitch-600/10 text-forest-900" : "bg-white text-ink/80 ring-1 ring-ink/10"
            }`}
          >
            <p>{m.body}</p>
            <p className="mt-1 text-[11px] text-ink/40">{new Date(m.created_at).toLocaleString()}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <ReplyForm conversationId={conversationId} />
      </div>
    </div>
  )
}
