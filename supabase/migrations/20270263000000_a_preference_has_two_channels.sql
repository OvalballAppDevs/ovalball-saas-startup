-- =====================================================================
-- A PREFERENCE HAS TWO CHANNELS
--
-- set_notification_preference only ever wrote in_app_enabled. That was
-- honest while the delivery gate ignored email anyway, but 20270259000000
-- fixed the gate: notification_preferences.email_enabled is now consulted for
-- every OPTIONAL_OPERATIONAL email event. The column means something, and
-- there is still no way for a person to set it.
--
-- So the writer learns about the second channel. Same function, one more
-- argument, same mandatory guard -- deliberately not a second RPC, because
-- "change my notification preference" is one action and splitting it by
-- channel would invite a screen that saves half of it.
--
-- THE MANDATORY GUARD IS DIFFERENT PER CHANNEL, and that difference is the
-- point of the whole mandatory model:
--
--   IN-APP   a mandatory topic cannot be switched off. Being told inside the
--            product is the safeguard.
--
--   EMAIL    follows the EMAIL event's classification, which lives on
--            email_events. A person may switch off email for a topic that is
--            mandatory in-app -- they will still be told, in the product --
--            and an email whose classification is MANDATORY_OPERATIONAL or
--            TRANSACTIONAL_IDENTITY sends regardless of this column, because
--            should_deliver_notification never consults it for those.
--
-- That is why this function does not refuse an email preference on a
-- mandatory topic: refusing would imply the preference has power it does not
-- have, and would stop somebody muting email they are entitled to mute.
-- =====================================================================

create or replace function public.set_notification_preference(
  p_topic_key text,
  p_in_app_enabled boolean default null,
  p_email_enabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.notification_topics where key = p_topic_key) then
    raise exception 'Unknown notification category.';
  end if;

  -- THE IN-APP SAFEGUARD. A mandatory topic may not be switched off, and
  -- saying so is better than accepting the write and quietly ignoring it.
  if p_in_app_enabled is false
     and (select mandatory from public.notification_topics where key = p_topic_key) then
    raise exception 'This notification topic is mandatory and cannot be turned off.' using errcode = '23514';
  end if;

  insert into public.notification_preferences (user_id, topic_key, in_app_enabled, email_enabled)
  values (
    auth.uid(),
    p_topic_key,
    coalesce(p_in_app_enabled, true),
    coalesce(p_email_enabled, true)
  )
  on conflict (user_id, topic_key) do update set
    -- Only the channel actually named is changed, so a screen that saves one
    -- switch cannot silently reset the other.
    in_app_enabled = coalesce(p_in_app_enabled, public.notification_preferences.in_app_enabled),
    email_enabled  = coalesce(p_email_enabled,  public.notification_preferences.email_enabled),
    updated_at = now();
end;
$$;

comment on function public.set_notification_preference(text, boolean, boolean) is
  'Sets the caller''s preference for a notification category. Pass only the channel being changed; the other is left as it was. A mandatory topic cannot have its in-app notifications switched off; email is governed separately by the email event''s own classification, so muting email on a mandatory topic is permitted and simply has no effect on mandatory email.';

revoke all on function public.set_notification_preference(text, boolean, boolean) from public, anon;
grant execute on function public.set_notification_preference(text, boolean, boolean) to authenticated;
