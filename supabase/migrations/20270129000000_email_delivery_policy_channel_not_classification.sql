-- CORRECTION: email channel enablement is NOT gated by classification.
--
-- 20270128000000 refused to let set_email_event_active() disable any event
-- whose classification was not OPTIONAL_OPERATIONAL, reasoning from that
-- enum's own stated purpose ("MANDATORY_OPERATIONAL is delivered regardless
-- of preference... reserved for things a club cannot opt out of"). The
-- product owner corrected this explicitly: classification governs whether
-- an ordinary RECIPIENT's own preference can suppress a message -- a
-- completely different question from whether Ovalball's own Full Site
-- Admin may switch the whole transactional CHANNEL off, for example during
-- an incident, or before a message is properly configured. The two must
-- never be collapsed into one authority check, here or in Messenger/
-- Notifications' own future Email/In-App/Push channel policy.
--
-- WHAT ACTUALLY GATES THE SWITCH NOW
--
-- Full Site Admin authority (unchanged) and optimistic locking (unchanged).
-- Nothing about the event's classification. A "Not Wired" event (no send
-- trigger exists yet, e.g. referral_reward_earned) can still be toggled at
-- this layer -- there is no harm in it, since nothing calls sendEmailEvent
-- for that key yet -- but the UI deliberately does not offer the control
-- for one, because toggling a channel with nothing sending through it
-- would be showing a Site Admin a decision that does nothing. "Wired" is a
-- TypeScript-side fact (lib/email/wiring.ts#WIRED_EVENT_KEYS, who actually
-- calls sendEmailEvent) that this database layer does not need to know.

begin;

create or replace function public.set_email_event_active(
  p_event_key text,
  p_active boolean,
  p_expected_lock int
)
returns void
language plpgsql
volatile
security definer
set search_path = public, internal
as $$
declare
  v_event public.email_events;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may change whether an email is switched on.' using errcode = '42501';
  end if;

  select * into v_event from public.email_events where event_key = p_event_key for update;
  if not found then
    raise exception 'That is not an email Ovalball sends.';
  end if;

  if v_event.lock_version <> p_expected_lock then
    raise exception 'This email''s status has been changed by someone else since you opened it. Reload to see the current state.';
  end if;

  if v_event.active = p_active then
    return; -- Already in the requested state; nothing to change or audit.
  end if;

  insert into public.email_delivery_policy_audit (event_key, previous_active, new_active, changed_by)
  values (p_event_key, v_event.active, p_active, auth.uid());

  update public.email_events
  set active = p_active, lock_version = lock_version + 1, updated_by = auth.uid(), updated_at = now()
  where event_key = p_event_key;
end;
$$;

revoke execute on function public.set_email_event_active(text, boolean, int) from public, anon;
grant execute on function public.set_email_event_active(text, boolean, int) to authenticated;

commit;
