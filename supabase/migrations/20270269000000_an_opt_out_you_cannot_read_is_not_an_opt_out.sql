-- =====================================================================
-- AN OPT-OUT YOU CANNOT READ IS NOT AN OPT-OUT
--
-- sendEmailEvent() filters the recipients of an OPTIONAL_OPERATIONAL email
-- by reading notification_preferences.email_enabled. The logic is right.
-- The client it reads with is the ACTING USER's, and
-- notification_preferences_select_self restricts that table to
-- `user_id = auth.uid()`.
--
-- So the query returns nothing -- not "nobody opted out", but "you may not
-- see anyone else's row" -- and the filter removes nobody. A person could
-- switch Fixture updates email off in their settings, and the next
-- cancellation emailed them anyway. The only case that ever worked was the
-- one where the person triggering the event was also the recipient.
--
-- Nothing about this surfaced: an empty result is indistinguishable from
-- unanimous consent, and the delivery row says `sent`.
--
-- THE FIX KEEPS THE AUTHORITY IN THE DATABASE, because the alternative --
-- an RLS-bypassing service-role client -- is explicitly forbidden in code
-- reachable from an ordinary server action, which is exactly what a
-- fixture cancellation is.
--
-- WHAT IT DISCLOSES, AND WHY THAT IS THE NARROW CHOICE. The caller must
-- already hold the user ids, must name one topic, and learns only which of
-- those ids have muted that topic's EMAIL. It cannot enumerate users, read
-- any other preference, or see the in-app channel. Set against the status
-- quo -- an opt-out that silently does nothing for everyone -- that is the
-- smaller disclosure by a wide margin.
-- =====================================================================

create or replace function public.email_opted_out_user_ids(
  p_topic_key text,
  p_user_ids uuid[]
)
returns setof uuid
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select p.user_id
  from public.notification_preferences p
  where p.topic_key = p_topic_key
    and p.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
    and p.email_enabled is false;
$$;

comment on function public.email_opted_out_user_ids(text, uuid[]) is
  'Which of the supplied users have turned this topic''s EMAIL off. Exists because notification_preferences is self-only under RLS, so the email send path -- which runs as whoever triggered the event -- cannot otherwise see a recipient''s own opt-out, and silently emailed everybody. Returns nothing about the in-app channel and cannot enumerate users.';

revoke all on function public.email_opted_out_user_ids(text, uuid[]) from public, anon;
grant execute on function public.email_opted_out_user_ids(text, uuid[]) to authenticated, service_role;
