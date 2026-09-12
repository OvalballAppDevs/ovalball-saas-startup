-- =====================================================================
-- REPORTING IS FOR EVERY CONVERSATION
--
-- report_fixture_message authorises the reporter with
-- internal.can_access_fixture_conversation(fixture_id, fixture_request_id).
-- That was the whole of the message store when it was written. It is now
-- two of seven containers, and for the other five BOTH arguments are null,
-- so the predicate returns false and the report is refused with "You do
-- not have access to this conversation."
--
-- The practical result is the one that matters: a person could report a
-- message in a club-to-club fixture thread, and could not report a private
-- direct message -- the surface where reporting is most likely to be the
-- thing somebody actually needs. The control never appeared to be broken,
-- because the refusal only arrives after you have written the reason.
--
-- THE FIX IS ONE PREDICATE, NOT SEVEN BRANCHES AT THE CALL SITE.
-- internal.can_access_message dispatches on the container exactly as
-- internal.message_realtime_topic does, and each branch defers to the same
-- canonical viewer predicate that already decides whether that person may
-- READ the message. Reporting therefore cannot become either a weaker or a
-- stronger answer than reading: if you can see it, you can report it, and
-- if you cannot see it, reporting it is not a way to find out it exists.
-- =====================================================================

create or replace function internal.can_access_message(p_message public.fixture_messages)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if p_message.club_conversation_id is not null then
    return internal.can_access_any_conversation(null, null, p_message.club_conversation_id);

  elsif p_message.team_conversation_id is not null then
    return internal.can_view_team_conversation(p_message.team_conversation_id);

  elsif p_message.safeguarding_conversation_id is not null then
    return internal.can_view_safeguarding_conversation(p_message.safeguarding_conversation_id);

  -- An announcement reply is visible to the recipient who wrote it and to
  -- the sending side; either may report what they can see.
  elsif p_message.announcement_id is not null then
    return internal.is_announcement_recipient(p_message.announcement_id)
        or internal.is_announcement_sender(p_message.announcement_id);

  elsif p_message.direct_conversation_id is not null then
    return internal.can_view_direct_conversation(p_message.direct_conversation_id);
  end if;

  -- A fixture message is the case with no distinguishing column set, and
  -- keeps the predicate it always had.
  return internal.can_access_fixture_conversation(
    p_message.fixture_id,
    p_message.fixture_request_id
  );
end;
$$;

comment on function internal.can_access_message(public.fixture_messages) is
  'Whether the current user may see one message, whichever of the seven containers holds it. Each branch defers to that container''s canonical viewer predicate, so this can never disagree with what the message store itself allows.';

-- ---------------------------------------------------------------------
-- The report action, now reaching every container
-- ---------------------------------------------------------------------
create or replace function public.report_fixture_message(p_message_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_msg public.fixture_messages;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to report a message.' using errcode = '42501';
  end if;

  select * into v_msg from public.fixture_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found.';
  end if;

  if not internal.can_access_message(v_msg) then
    raise exception 'You do not have access to this conversation.' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to report a message.';
  end if;

  -- REPORTING YOUR OWN MESSAGE IS NOT A THING. It was never possible
  -- before, because the only reportable containers put the control on
  -- other people's messages only; saying so here keeps that true now that
  -- the predicate is broader.
  if v_msg.sender_user_id = auth.uid() then
    raise exception 'You cannot report your own message.' using errcode = '42501';
  end if;

  update public.fixture_messages
  set reported_at = now(),
      reported_by = auth.uid(),
      report_reason = trim(p_reason),
      report_status = 'open'
  where id = p_message_id;
end;
$$;

comment on function public.report_fixture_message(uuid, text) is
  'Reports a message to Ovalball Support from any conversation the reporter can see, including a direct conversation. Authority comes from internal.can_access_message, so reporting is available exactly where reading is.';

revoke all on function public.report_fixture_message(uuid, text) from public, anon;
grant execute on function public.report_fixture_message(uuid, text) to authenticated;
