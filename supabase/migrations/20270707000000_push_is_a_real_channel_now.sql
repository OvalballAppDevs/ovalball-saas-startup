-- PUSH NOW EXISTS. `should_deliver_notification`'s push branch was deliberately left honest ("there
-- is no transport") until there was one; this gives it the same shape the in-app branch already has
-- -- mandatory events bypass the preference, everything else obeys `push_enabled`, defaulting to on.

create or replace function internal.should_deliver_notification(p_user_id uuid, p_type text, p_channel text default 'in_app')
returns boolean
language sql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select case
    when not exists (select 1 from public.notification_types where type_key = p_type) then true

    when p_channel = 'in_app' then
      internal.notification_is_mandatory(p_type)
      or coalesce(
        (select np.in_app_enabled from public.notification_preferences np
         join public.notification_types nt on nt.topic_key = np.topic_key
         where nt.type_key = p_type and np.user_id = p_user_id),
        true
      )

    when p_channel = 'email' then
      case
        when exists (
          select 1 from public.email_events e
          join public.notification_types nt on nt.topic_key = e.topic_key
          where nt.type_key = p_type and e.active
            and e.classification in ('MANDATORY_OPERATIONAL', 'TRANSACTIONAL_IDENTITY')
        ) then true
        when exists (
          select 1 from public.email_events e
          join public.notification_types nt on nt.topic_key = e.topic_key
          where nt.type_key = p_type and e.active
            and e.classification = 'OPTIONAL_OPERATIONAL'
        ) then coalesce(
          (select np.email_enabled from public.notification_preferences np
           join public.notification_types nt on nt.topic_key = np.topic_key
           where nt.type_key = p_type and np.user_id = p_user_id),
          true
        )
        else false
      end

    -- PUSH: the same rule as in-app, because a push is the in-app notification's own delivery to a
    -- device rather than a second kind of event -- a mandatory type cannot be silenced on any
    -- channel, and everything else obeys the person's own push switch, defaulting to on.
    when p_channel = 'push' then
      internal.notification_is_mandatory(p_type)
      or coalesce(
        (select np.push_enabled from public.notification_preferences np
         join public.notification_types nt on nt.topic_key = np.topic_key
         where nt.type_key = p_type and np.user_id = p_user_id),
        true
      )

    else false
  end;
$function$;

-- THE DELIVERY ITSELF. A push is sent AFTER the in-app row exists, never instead of it -- there is no
-- notification to push if the gate above suppressed the row, which is the existing, deliberate
-- constraint that in-app being off means off everywhere for that event. One send per registered
-- device; Expo's push service decides what a dead or malformed token does, and a failure here never
-- unwinds the notification itself, because the person was still told in the app regardless of
-- whether their phone also buzzed.
create or replace function internal.deliver_push_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_messages jsonb;
begin
  if not internal.should_deliver_notification(new.user_id, new.type, 'push') then
    return new;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', new.title,
    'body', new.body,
    'data', jsonb_build_object('type', new.type, 'notificationId', new.id) || coalesce(new.data, '{}'::jsonb),
    'sound', 'default'
  )), '[]'::jsonb)
  into v_messages
  from public.push_device_tokens t
  where t.user_id = new.user_id;

  if jsonb_array_length(v_messages) = 0 then
    return new;
  end if;

  -- FIRE-AND-FORGET, deliberately: `net.http_post` queues the request and returns immediately, and
  -- nothing here waits on or inspects Expo's response. A push failing is not a reason to fail the
  -- write that already told this person in the app.
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := v_messages
  );

  return new;
end;
$function$;

create trigger notifications_deliver_push_trigger
  after insert on public.notifications
  for each row execute function internal.deliver_push_notification();
