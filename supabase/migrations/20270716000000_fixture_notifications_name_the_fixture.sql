-- =====================================================================================================
-- FIXTURE NOTIFICATIONS SAY WHICH FIXTURE, REACH THE PEOPLE IT AFFECTS, AND ARRIVE ONCE.
--
-- The notification correctness pass (owner: "prove the complete lifecycle") found, in the live data:
--
--   * ONE EVENT, TWO NOTIFICATIONS. Every fixture lifecycle change writes a system note into the
--     fixture's thread AND sends its own notification; the thread trigger then announced the note as
--     a "New fixture message" too (46 pitch changes, 14 kick-off proposals, ... doubled). A system
--     note is now never announced as a message.
--   * "YOUR FIXTURE" AND RAW TIMESTAMPS. "The pitch for your fixture has been set to Pitch 1" and
--     "A change to 2026-10-02 11:00:00 has been proposed" named no fixture and printed database
--     values. One formatter now names the fixture -- home v away (team), date -- and writes every
--     date and kick-off the way a person would, for every caller of `fixture_result_notify` and every
--     system note, rather than each producer carrying its own copy.
--   * NOBODY TOLD ABOUT A FIXTURE AGAINST A CLUB NOT ON OVALBALL. A kick-off or pitch change on such a
--     fixture notified no one. It now notifies the side's own staff like any other change.
--   * FAMILIES NEVER TOLD. Cancellations, kick-off changes and pitch changes reached staff only. They
--     now also reach the families of both sides' players, through the canonical, safeguarding-aware
--     contact rule (`player_contact_eligibility`) -- the same rule fixture communications already use.
--   * A DISPUTE RESOLVED BY RESUBMISSION ASKED NOBODY. The new score now asks the other club to
--     confirm, like any first submission.
--   * PUSH DEPENDED ON IN-APP. Switching in-app off for a topic silently switched push off too,
--     because the row was dropped before push could see it. A push-only notification is now kept,
--     hidden from the inbox, so push delivers it and the inbox stays as the person chose.
--   * ORPHANS. Deleting a fixture, request, tournament game or training session left notifications
--     pointing at nothing. They are now tidied away (dismissed, not deleted) when the target goes,
--     and the ones already orphaned are tidied now.
-- =====================================================================================================

-- ---- Formatting: one place that writes a fixture's name, a date and a kick-off ----------------------

create or replace function internal.kickoff_phrase(p_date date, p_time time without time zone default null)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_date is null then 'a date to be confirmed' else
    to_char(p_date, 'Dy FMDD Mon')
    || case when extract(year from p_date) <> extract(year from current_date) then to_char(p_date, ' YYYY') else '' end
    || case when p_time is null then '' else ', ' || to_char(p_time, 'HH24:MI') end
  end;
$$;

comment on function internal.kickoff_phrase(date, time without time zone) is
  'A date (and kick-off, where known) the way a person writes it: "Sat 17 Oct, 10:30". The year only when it is not this year.';

create or replace function internal.fixture_notice_label(p_fixture_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format('%s v %s (%s), %s',
           case when f.home_away = 'Away' then f.opp_name else f.own_name end,
           case when f.home_away = 'Away' then f.own_name else f.opp_name end,
           f.own_team,
           internal.kickoff_phrase(f.kickoff_date, null))
  from (
    select fx.home_away, fx.kickoff_date,
           coalesce(ocd.name, 'Your club') as own_name,
           coalesce(ot.display_name, fx.owning_team_display_name_snapshot, 'your team') as own_team,
           coalesce(pcd.name, dcd.name, nullif(btrim(fx.raw_opposition_text), ''), 'the opposition') as opp_name
    from public.fixtures fx
    left join public.teams ot on ot.id = fx.owning_team_id
    left join public.clubs oc on oc.id = ot.club_id
    left join public.club_directory ocd on ocd.id = oc.directory_id
    left join public.teams pt on pt.id = fx.opponent_team_id
    left join public.clubs pc on pc.id = pt.club_id
    left join public.club_directory pcd on pcd.id = pc.directory_id
    left join public.club_directory dcd on dcd.id = fx.opponent_directory_id
    where fx.id = p_fixture_id
  ) f;
$$;

comment on function internal.fixture_notice_label(uuid) is
  'A fixture named the way a notification should name it: home v away (the owning team), and the date.';

-- Rewrites every ISO date (and "date time" / "date (no time)") inside a sentence the way a person
-- writes it. Lets every existing producer's copy become readable without each one being rewritten.
create or replace function internal.humanise_fixture_copy(p_text text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out text := '';
  v_rest text := p_text;
  v_match text[];
  v_whole text;
  v_pos integer;
begin
  if p_text is null then
    return null;
  end if;
  loop
    v_match := regexp_match(v_rest, '(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2})(?::\d{2})?| \(no time\))?');
    exit when v_match is null;
    v_whole := (regexp_match(v_rest, '\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?| \(no time\))?'))[1];
    v_pos := strpos(v_rest, v_whole);
    v_out := v_out || substr(v_rest, 1, v_pos - 1) || internal.kickoff_phrase(v_match[1]::date, v_match[2]::time);
    v_rest := substr(v_rest, v_pos + length(v_whole));
  end loop;
  return v_out || v_rest;
end;
$$;

-- ---- Who a fixture change reaches -------------------------------------------------------------------

-- The families (and the adult players themselves) of BOTH sides' squads, plus approved call-ups,
-- through the canonical contact rule. A child is never contacted directly unless that rule allows it.
create or replace function internal.fixture_family_recipients(p_fixture_id uuid)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = 'public', 'internal', 'pg_temp'
as $$
  select distinct e.user_id
  from internal.player_contact_eligibility(array(
    select ptm.player_id
    from public.player_team_memberships ptm
    join internal.fixture_participant_team_ids(p_fixture_id) t on t.team_id = ptm.team_id
    where ptm.status = 'active'
    union
    select c.player_id
    from public.fixture_player_call_up c
    where c.fixture_id = p_fixture_id and c.status = 'approved'
  )) e
  where e.user_id is not null;
$$;


create or replace function internal.fixture_result_notify(p_fixture_id uuid, p_exclude_user_id uuid, p_type text, p_title text, p_body text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  f record;
  v_label text;
  v_body text;
  v_families boolean;
begin
  select owning_team_id, opponent_team_id into f from public.fixtures where id = p_fixture_id;

  -- THE FIXTURE, NAMED, and every date written for a person.
  v_label := coalesce(internal.fixture_notice_label(p_fixture_id), 'your fixture');
  if strpos(p_body, 'your fixture') > 0 or strpos(p_body, 'Your fixture') > 0 then
    v_body := internal.humanise_fixture_copy(replace(replace(p_body, 'your fixture', v_label), 'Your fixture', v_label));
  else
    -- A message that never said which fixture it is about gets the fixture on its first line, so
    -- every fixture notification is identifiable without opening it.
    v_body := v_label || E'\n' || internal.humanise_fixture_copy(p_body);
  end if;

  -- A CHANGE A FAMILY ACTS ON reaches the families of both sides; results and proposals stay staff
  -- business. Mandatory types (cancellations) still pass the delivery gate for families too.
  v_families := p_type in ('fixture_cancelled', 'fixture_cancelled_team_folded', 'fixture_kickoff_changed', 'fixture_pitch_changed');

  insert into public.notifications (user_id, type, title, body, data)
  select distinct recipient, p_type, p_title, v_body, jsonb_build_object('fixture_id', p_fixture_id)
  from (
    select cm.user_id as recipient
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id in (f.owning_team_id, f.opponent_team_id)
      and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
    union
    select cm.user_id as recipient
    from public.club_memberships cm
    join public.teams t on t.club_id = cm.club_id
    where t.id in (f.owning_team_id, f.opponent_team_id)
      and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
    union
    select r.user_id as recipient
    from internal.fixture_family_recipients(p_fixture_id) r
    where v_families
  ) recipients
  where recipient is distinct from p_exclude_user_id;
end;
$function$;

-- A system note in a fixture thread is written the way a person would write it, too.
create or replace function internal.fixture_result_system_event(p_fixture_id uuid, p_actor uuid, p_body text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body, kind)
  values (p_fixture_id, p_actor, internal.humanise_fixture_copy(p_body), 'system_event');
end;
$function$;


CREATE OR REPLACE FUNCTION internal.notify_fixture_message_recipients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fixture public.fixtures;
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_cc public.club_conversations;
  v_sender_name text;
  v_snippet text;
begin
  -- A SYSTEM NOTE IS NOT A MESSAGE. The change it records has already sent its own, specific
  -- notification; announcing the note as a "new message" as well told everybody twice.
  if coalesce(new.kind, 'message') = 'system_event' then
    return new;
  end if;

  select coalesce(p.first_name || ' ' || p.surname, 'Someone') into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  v_snippet := case
    when coalesce(btrim(new.body), '') = '' and new.content_type = 'image' then 'Sent a photo'
    when coalesce(btrim(new.body), '') = '' then 'Sent an attachment'
    else '“' || left(btrim(new.body), 140) || case when length(btrim(new.body)) > 140 then '…' else '' end || '”'
  end;

  if new.fixture_id is not null then
    select * into v_fixture from public.fixtures where id = new.fixture_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New message',
      format(E'%s · %s\n%s', v_sender_name, coalesce(internal.fixture_notice_label(new.fixture_id), 'a fixture'), v_snippet),
      jsonb_build_object('fixture_id', new.fixture_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      join public.teams t on t.club_id = cm.club_id
      where t.id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      union
      select p.user_id as recipient
      from public.fixture_conversation_participants p
      where p.fixture_id = new.fixture_id
    ) recipients
    where recipient <> new.sender_user_id
      and not exists (
        select 1 from public.fixture_conversation_subscriptions s
        where s.fixture_id = new.fixture_id and s.user_id = recipient and (s.muted or s.left_at is not null)
      );

  elsif new.fixture_request_id is not null then
    select * into v_req from public.fixture_requests where id = new.fixture_request_id;
    select * into v_group from public.fixture_request_groups where id = v_req.group_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New message',
      format(E'%s · a fixture request\n%s', v_sender_name, v_snippet),
      jsonb_build_object('fixture_request_id', new.fixture_request_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_req.requesting_team_id, v_req.target_team_id)
        and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      where cm.club_id in (v_group.requesting_club_id, v_group.opponent_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      union
      select p.user_id as recipient
      from public.fixture_conversation_participants p
      where p.fixture_request_id = new.fixture_request_id
    ) recipients
    where recipient <> new.sender_user_id
      and not exists (
        select 1 from public.fixture_conversation_subscriptions s
        where s.fixture_request_id = new.fixture_request_id and s.user_id = recipient and (s.muted or s.left_at is not null)
      );

  elsif new.club_conversation_id is not null then
    select * into v_cc from public.club_conversations where id = new.club_conversation_id;

    -- Only relevant while the conversation is actually usable -- the
    -- pending-state first message and the accepted system event both fire
    -- this trigger too, but "you have a new message" would be a strange
    -- thing to tell someone about their own just-sent first message
    -- (already covered by the dedicated club_message_request_received
    -- notification) or about a system event they'll see the moment they
    -- open the now-accepted conversation.
    if v_cc.status = 'accepted' and new.kind = 'message' then
      insert into public.notifications (user_id, type, title, body, data)
      select distinct cm.user_id, 'new_fixture_message', 'New message',
        format('%s sent a club message.', v_sender_name),
        jsonb_build_object('club_conversation_id', new.club_conversation_id, 'message_id', new.id)
      from public.club_memberships cm
      where cm.club_id in (v_cc.requesting_club_id, v_cc.recipient_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        and cm.user_id <> new.sender_user_id;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_fixture_result(p_fixture_id uuid, p_home_score integer, p_away_score integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_caller_club_id uuid;
  v_owning_club_id uuid;
  v_is_external boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to submit a result.' using errcode = '42501';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'Scores must be zero or a positive whole number.';
  end if;
  if not internal.can_submit_fixture_result(p_fixture_id) then
    raise exception 'You are not authorized to submit a result for this fixture.' using errcode = '42501';
  end if;
  if not internal.fixture_result_eligible(p_fixture_id) then
    if exists (select 1 from public.fixtures where id = p_fixture_id and status = 'Cancelled') then
      raise exception 'This fixture is cancelled -- a cancelled fixture cannot receive a result.';
    end if;
    raise exception 'This fixture has not kicked off yet -- a result cannot be submitted before then.';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;

  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');

  if v_is_external then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'external_recorded', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'external_recorded', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_confirmed_by = null, result_confirmed_at = null, result_deadline_at = null
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'external_recorded', home_score = p_home_score, away_score = p_away_score,
          result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
          result_confirmed_by = null, result_confirmed_at = null, result_deadline_at = null
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result recorded: %s - %s (external opponent, not mutually confirmed through Ovalball).', p_home_score, p_away_score));
    return;
  end if;

  if f.result_status = 'none' or f.result_status is null then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_deadline_at = now() + interval '24 hours'
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
          result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
          result_deadline_at = now() + interval '24 hours'
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result submitted: %s - %s. Awaiting confirmation (24 hours).', p_home_score, p_away_score));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_awaiting_confirmation', 'Result awaiting your confirmation',
      format('A result of %s - %s has been submitted for your fixture. You have 24 hours to confirm or dispute it.', p_home_score, p_away_score));
    return;
  end if;

  if f.result_status = 'awaiting_confirmation' then
    if v_caller_club_id = f.result_submitted_by_club_id then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set home_score = p_home_score, away_score = p_away_score, result_submitted_by = auth.uid(), result_submitted_at = now() where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set home_score = p_home_score, away_score = p_away_score, result_submitted_by = auth.uid(), result_submitted_at = now() where id = f.mirror_fixture_id;
      end if;
      return;
    end if;

    if p_home_score = f.home_score and p_away_score = f.away_score then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'confirmation', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(), result_deadline_at = null where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(), result_deadline_at = null where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result confirmed: %s - %s. Fixture completed.', p_home_score, p_away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result confirmed', format('The result %s - %s is now final.', p_home_score, p_away_score));
    else
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result disputed: submitted %s - %s, but the original submission was %s - %s. Result requires agreement.', p_home_score, p_away_score, f.home_score, f.away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Result disputed', 'The submitted result did not match -- this fixture''s result now needs agreement.');
    end if;
    return;
  end if;

  if f.result_status = 'final' then
    if p_home_score = f.home_score and p_away_score = f.away_score then
      return;
    end if;
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'amendment_proposal', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'amendment_pending',
        result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score,
        result_amendment_proposed_by = auth.uid(), result_amendment_proposed_by_club_id = v_caller_club_id, result_amendment_proposed_at = now()
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'amendment_pending',
          result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score,
          result_amendment_proposed_by = auth.uid(), result_amendment_proposed_by_club_id = v_caller_club_id, result_amendment_proposed_at = now()
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result amendment proposed: %s - %s (original: %s - %s). Awaiting the other club''s confirmation.', p_home_score, p_away_score, f.home_score, f.away_score));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_amendment_proposed', 'Result amendment proposed',
      format('An amendment to %s - %s (originally %s - %s) has been proposed.', p_home_score, p_away_score, f.home_score, f.away_score));
    return;
  end if;

  if f.result_status = 'amendment_pending' then
    if v_caller_club_id = f.result_amendment_proposed_by_club_id then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_proposal', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score, result_amendment_proposed_at = now() where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score, result_amendment_proposed_at = now() where id = f.mirror_fixture_id;
      end if;
      return;
    end if;

    if p_home_score = f.result_amendment_proposed_home_score and p_away_score = f.result_amendment_proposed_away_score then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_confirmation', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures
      set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
          result_confirmed_by = auth.uid(), result_confirmed_at = now(),
          result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
          result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
            result_confirmed_by = auth.uid(), result_confirmed_at = now(),
            result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
            result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result amendment confirmed. New final result: %s - %s.', p_home_score, p_away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result amendment confirmed', format('The amended result %s - %s is now final.', p_home_score, p_away_score));
    else
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Amendment disputed: proposed %s - %s, but a different amendment (%s - %s) was submitted. The prior final result (%s - %s) is preserved until this is resolved.', f.result_amendment_proposed_home_score, f.result_amendment_proposed_away_score, p_home_score, p_away_score, f.home_score, f.away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Result amendment disputed', 'A proposed amendment did not match -- this fixture''s result now needs agreement.');
    end if;
    return;
  end if;

  if f.result_status = 'disputed' or f.result_status = 'unverified' then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_deadline_at = now() + interval '24 hours'
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
          result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
          result_deadline_at = now() + interval '24 hours'
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('New result submitted to resolve the dispute: %s - %s. Awaiting confirmation.', p_home_score, p_away_score));
    -- A NEW SCORE IS A NEW ASK: the other club confirms or disputes it, exactly as for a first submission.
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_awaiting_confirmation', 'Result awaiting your confirmation',
      format('A result of %s - %s has been submitted for your fixture. You have 24 hours to confirm or dispute it.', p_home_score, p_away_score));
    return;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_kickoff(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_caller_club_id uuid;
  v_is_external boolean;
  v_old_date date;
  v_old_time time;
begin
  if p_kickoff_date is null then
    raise exception 'A kick-off date is required.';
  end if;
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to change the kick-off for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if f.status = 'Cancelled' then
    raise exception 'This fixture is cancelled -- its kick-off cannot be changed.';
  end if;

  v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');
  v_old_date := f.kickoff_date;
  v_old_time := f.kickoff_time;

  -- Nothing actually changing (including a caller merely re-confirming
  -- the current value) is a harmless no-op, not a fresh proposal cycle.
  if v_old_date = p_kickoff_date and v_old_time is not distinct from p_kickoff_time and f.kickoff_amendment_proposed_date is null then
    return;
  end if;

  if v_is_external or internal.has_site_capability('site.fixtures.support') then
    -- No real opponent to agree with (or a Site Admin override) -- apply
    -- directly. Site Admin is deliberately exempt from the negotiation
    -- cycle, matching resolve_fixture_result_dispute's own override
    -- authority for results.
    update public.fixtures
    set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
        kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
        kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = f.mirror_fixture_id;
    end if;
    if f.opponent_team_id is not null then
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off changed: %s %s -> %s %s.', v_old_date, coalesce(v_old_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    end if;
    -- NO OPPONENT TO AGREE WITH IS NOT NOBODY TO TELL: the side's staff and families hear of it.
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off changed',
      format('Your fixture now kicks off %s.', internal.kickoff_phrase(p_kickoff_date, p_kickoff_time)));
    return;
  end if;

  -- A real, activated opponent -- material changes need agreement.
  if f.kickoff_amendment_proposed_date is null then
    update public.fixtures
    set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
        kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
          kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change proposed: %s %s -> %s %s. Awaiting the other club''s agreement.', v_old_date, coalesce(v_old_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off change proposed',
      format('A change to %s %s has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    return;
  end if;

  if v_caller_club_id = f.kickoff_amendment_proposed_by_club_id then
    -- The proposing side revising their own still-pending proposal.
    update public.fixtures
    set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
      where id = f.mirror_fixture_id;
    end if;
    return;
  end if;

  if p_kickoff_date = f.kickoff_amendment_proposed_date and p_kickoff_time is not distinct from f.kickoff_amendment_proposed_time then
    -- The other side proposing back exactly the pending value IS acceptance.
    update public.fixtures
    set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
        kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
        kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off confirmed: %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off confirmed',
      format('The kick-off for your fixture is now %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    return;
  end if;

  -- A genuinely different value from the other side -- a counter-proposal,
  -- replacing the pending one (never silently applied).
  update public.fixtures
  set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
      kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
  where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures
    set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
        kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
    where id = f.mirror_fixture_id;
  end if;
  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off counter-proposed: %s %s (was proposing %s %s).', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)'), f.kickoff_amendment_proposed_date, coalesce(f.kickoff_amendment_proposed_time::text, '(no time)')));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off counter-proposed',
    format('A different kick-off (%s %s) has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_schedule(p_fixture_id uuid, p_kickoff_date date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS TABLE(applied_kickoff_date date, applied_kickoff_time time without time zone, applied_venue_id uuid, applied_pitch_id uuid, kickoff_proposed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_final public.fixtures;
  v_home_club_id uuid;
  v_caller_club_id uuid;
  v_is_external boolean;
  v_old_pitch_text text;
  v_new_pitch_text text;
  v_venue_changing boolean;
  v_pitch_changing boolean;
  v_kickoff_changing boolean;
  v_new_status text;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to change the schedule for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  v_venue_changing := p_venue_id is distinct from f.venue_id;
  v_pitch_changing := (p_pitch_id is distinct from f.pitch_id)
    or (p_pitch_id is null and coalesce(nullif(trim(p_pitch_text), ''), '') is distinct from coalesce(f.pitch_allocation, ''));
  v_kickoff_changing := (p_kickoff_date is distinct from f.kickoff_date)
    or (p_kickoff_time is distinct from f.kickoff_time)
    or f.kickoff_amendment_proposed_date is not null;

  -- ===== VENUE =====
  if v_venue_changing then
    if p_venue_id is not null then
      if f.home_team_id is null then
        raise exception 'A venue can only be set on a home fixture.';
      end if;
      select t.club_id into v_home_club_id from public.teams t where t.id = f.home_team_id;
      if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_home_club_id and v.active) then
        raise exception 'That venue does not belong to this fixture''s home club, or is archived.';
      end if;
    end if;
    update public.fixtures set venue_id = p_venue_id where id = p_fixture_id;
  end if;

  -- ===== PITCH =====
  if v_pitch_changing then
    if p_pitch_id is not null then
      if f.home_team_id is null then
        raise exception 'A named pitch can only be set on a home fixture.';
      end if;
      select t.club_id into v_home_club_id from public.teams t where t.id = f.home_team_id;
      if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
        raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
      end if;
      select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
    else
      v_new_pitch_text := nullif(trim(p_pitch_text), '');
    end if;
    v_old_pitch_text := f.pitch_allocation;

    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = f.mirror_fixture_id;
    end if;

    if coalesce(v_old_pitch_text, '') <> coalesce(v_new_pitch_text, '') or f.pitch_id is distinct from p_pitch_id then
      if f.opponent_team_id is not null then
        perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
          case when v_new_pitch_text is null then 'Pitch allocation removed.'
               else format('Pitch allocated: %s', v_new_pitch_text) end);
      end if;
      -- Told whether or not the opposition is on Ovalball.
      if auth.uid() is not null then
        perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
          case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
               else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
      end if;
    end if;
  end if;

  -- ===== KICKOFF (unchanged verbatim -- already either-side-aware) =====
  if v_kickoff_changing then
    if p_kickoff_date is null then
      raise exception 'A kick-off date is required.';
    end if;
    if f.status = 'Cancelled' then
      raise exception 'This fixture is cancelled -- its kick-off cannot be changed.';
    end if;

    v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
    v_is_external := f.opponent_team_id is null
      or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');

    if f.kickoff_date = p_kickoff_date and f.kickoff_time is not distinct from p_kickoff_time and f.kickoff_amendment_proposed_date is null then
      null;
    elsif v_is_external or internal.has_site_capability('site.fixtures.support') then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
            kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
            kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
        where id = f.mirror_fixture_id;
      end if;
      if f.opponent_team_id is not null then
        perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off changed: %s %s -> %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      end if;
      -- NO OPPONENT TO AGREE WITH IS NOT NOBODY TO TELL: the side's staff and families hear of it.
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off changed',
        format('Your fixture now kicks off %s.', internal.kickoff_phrase(p_kickoff_date, p_kickoff_time)));
    elsif f.kickoff_amendment_proposed_date is null then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
          kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
            kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change proposed: %s %s -> %s %s. Awaiting the other club''s agreement.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)'), p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off change proposed',
        format('A change to %s %s has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    elsif v_caller_club_id = f.kickoff_amendment_proposed_by_club_id then
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
    elsif p_kickoff_date = f.kickoff_amendment_proposed_date and p_kickoff_time is not distinct from f.kickoff_amendment_proposed_time then
      update public.fixtures
      set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
          kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
          kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_date = p_kickoff_date, kickoff_time = p_kickoff_time,
            kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
            kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off confirmed: %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_changed', 'Kick-off confirmed',
        format('The kick-off for your fixture is now %s %s.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    else
      update public.fixtures
      set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
          kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
      where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set kickoff_amendment_proposed_date = p_kickoff_date, kickoff_amendment_proposed_time = p_kickoff_time,
            kickoff_amendment_proposed_by = auth.uid(), kickoff_amendment_proposed_by_club_id = v_caller_club_id, kickoff_amendment_proposed_at = now()
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off counter-proposed: %s %s (was proposing %s %s).', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)'), f.kickoff_amendment_proposed_date, coalesce(f.kickoff_amendment_proposed_time::text, '(no time)')));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_proposed', 'Kick-off counter-proposed',
        format('A different kick-off (%s %s) has been proposed for your fixture.', p_kickoff_date, coalesce(p_kickoff_time::text, '(no time)')));
    end if;
  end if;

  select * into v_final from public.fixtures where id = p_fixture_id;

  -- ===== STATUS LIFECYCLE (Sections 11/12/16) =====
  if v_final.status in ('Planned', 'Booked', 'To Be Determined') then
    if v_final.pitch_id is not null and v_final.kickoff_time is not null then
      v_new_status := 'Booked';
    elsif v_final.status = 'Booked' then
      -- Was Booked, but its pitch (or kickoff time) is no longer set --
      -- no longer satisfies this product's definition of "booked", so it
      -- must not stay falsely Booked. home_away = 'TBD' is this schema's
      -- own existing marker for a genuinely undetermined side; anything
      -- else reverts to the ordinary "scheduled, no pitch yet" state.
      v_new_status := case when v_final.home_away = 'TBD' then 'To Be Determined' else 'Planned' end;
    else
      v_new_status := v_final.status;
    end if;

    if v_new_status is distinct from v_final.status then
      update public.fixtures set status = v_new_status where id = p_fixture_id;
      if v_final.mirror_fixture_id is not null then
        update public.fixtures set status = v_new_status where id = v_final.mirror_fixture_id;
      end if;
      v_final.status := v_new_status;
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values (
    'fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('venue_id', f.venue_id, 'pitch_id', f.pitch_id, 'pitch_allocation', f.pitch_allocation, 'kickoff_date', f.kickoff_date, 'kickoff_time', f.kickoff_time, 'status', f.status),
    jsonb_build_object('source', p_source, 'venue_id', p_venue_id, 'pitch_id', p_pitch_id, 'kickoff_date', p_kickoff_date, 'kickoff_time', p_kickoff_time, 'status', v_final.status)
  );

  return query select v_final.kickoff_date, v_final.kickoff_time, v_final.venue_id, v_final.pitch_id, v_final.kickoff_amendment_proposed_date is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;
  v_old_pitch_id := f.pitch_id;

  if p_pitch_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A named pitch can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
      raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
    end if;

    -- STEP 6: and it has to be a pitch at the ground the fixture is actually being played at.
    select cp.venue_id into v_pitch_venue_id from public.club_pitches cp where cp.id = p_pitch_id;
    if f.venue_id is not null and v_pitch_venue_id is distinct from f.venue_id then
      raise exception 'The selected pitch does not belong to the selected venue. Choose a pitch at this fixture''s ground, or change the fixture''s venue first.'
        using errcode = '23514';
    end if;

    select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
  else
    v_new_pitch_text := nullif(trim(p_pitch_text), '');
  end if;

  update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = f.mirror_fixture_id;
  end if;

  if coalesce(v_old_pitch, '') <> coalesce(v_new_pitch_text, '') or v_old_pitch_id is distinct from p_pitch_id then
    if f.opponent_team_id is not null then
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
        case when v_new_pitch_text is null then 'Pitch allocation removed.'
             else format('Pitch allocated: %s', v_new_pitch_text) end);
    end if;
    -- Told whether or not the opposition is on Ovalball.
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_fixture(p_fixture_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  -- CA-M4: the CANCEL key, not the result key, decides who may call a match off.
  if not internal.can_cancel_fixture(p_fixture_id) then
    raise exception 'You are not authorized to cancel this fixture.' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a fixture.';
  end if;

  if f.status = 'Cancelled' then
    raise exception 'This fixture is already cancelled.';
  end if;

  if f.archived_at is not null then
    raise exception 'This fixture has been archived -- restore it before cancelling.';
  end if;

  update public.fixtures
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(p_reason)
  where id = p_fixture_id;

  if f.mirror_fixture_id is not null then
    update public.fixtures
    set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
        cancellation_reason = format('Cancelled by the opposing club: %s', trim(p_reason))
    where id = f.mirror_fixture_id and status <> 'Cancelled';
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('This fixture has been cancelled. Reason: %s', trim(p_reason)));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_cancelled', 'Fixture cancelled',
    format('Your fixture has been cancelled. Reason: %s', trim(p_reason)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_fixture_kickoff_change(p_fixture_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
begin
  if not (internal.can_edit_fixture_schedule(p_fixture_id)) then
    raise exception 'You are not authorized to respond to this fixture''s kick-off change.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if f.kickoff_amendment_proposed_date is null then
    raise exception 'There is no pending kick-off change to decline.';
  end if;

  update public.fixtures
  set kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
      kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
  where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures
    set kickoff_amendment_proposed_date = null, kickoff_amendment_proposed_time = null,
        kickoff_amendment_proposed_by = null, kickoff_amendment_proposed_by_club_id = null, kickoff_amendment_proposed_at = null
    where id = f.mirror_fixture_id;
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Kick-off change declined -- the fixture stays at %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)')));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_kickoff_change_declined', 'Kick-off change declined',
    format('Your proposed kick-off change was declined -- the fixture stays at %s %s.', f.kickoff_date, coalesce(f.kickoff_time::text, '(no time)')));
end;
$function$;

-- ---- Channels are independent: a push-only notification is kept (hidden), so push can send it ------

create or replace function internal.notifications_gate_delivery()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not internal.should_deliver_notification(new.user_id, new.type, 'in_app') then
    -- IN-APP OFF IS NOT PUSH OFF. Where this person still wants it pushed, the row is kept -- read and
    -- hidden from their inbox, exactly as if they had dismissed it -- so the push trigger, which runs
    -- after the insert, can still deliver it. Nothing reaches the inbox they switched off.
    if internal.should_deliver_notification(new.user_id, new.type, 'push') then
      new.read_at := coalesce(new.read_at, now());
      new.dismissed_at := coalesce(new.dismissed_at, now());
      return new;
    end if;
    return null; -- neither channel wants it; the mandatory/safety path above never reaches here
  end if;
  return new;
end;
$function$;

-- ---- Orphans: a notification about something that no longer exists is tidied away -----------------

create or replace function internal.dismiss_notifications_for_deleted_target()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- DISMISSED, NOT DELETED: the record of what was said survives; the person just stops being shown
  -- a notification that leads nowhere. TG_ARGV[0] names the payload key that carries this target's id.
  update public.notifications n
     set dismissed_at = now()
   where n.dismissed_at is null
     and n.data ->> tg_argv[0] = old.id::text;
  return old;
end;
$function$;

create trigger fixtures_dismiss_orphaned_notifications
  after delete on public.fixtures
  for each row execute function internal.dismiss_notifications_for_deleted_target('fixture_id');
create trigger fixture_requests_dismiss_orphaned_notifications
  after delete on public.fixture_requests
  for each row execute function internal.dismiss_notifications_for_deleted_target('fixture_request_id');
create trigger tournament_games_dismiss_orphaned_notifications
  after delete on public.tournament_games
  for each row execute function internal.dismiss_notifications_for_deleted_target('tournament_game_id');
create trigger training_sessions_dismiss_orphaned_notifications
  after delete on public.training_sessions
  for each row execute function internal.dismiss_notifications_for_deleted_target('training_session_id');

-- The ones already orphaned, tidied the same way.
update public.notifications n set dismissed_at = now()
 where n.dismissed_at is null and n.data ? 'fixture_id' and (n.data ->> 'fixture_id') is not null
   and not exists (select 1 from public.fixtures f where f.id::text = n.data ->> 'fixture_id');
update public.notifications n set dismissed_at = now()
 where n.dismissed_at is null and n.data ? 'fixture_request_id' and (n.data ->> 'fixture_request_id') is not null
   and not exists (select 1 from public.fixture_requests r where r.id::text = n.data ->> 'fixture_request_id');
update public.notifications n set dismissed_at = now()
 where n.dismissed_at is null and n.data ? 'tournament_game_id' and (n.data ->> 'tournament_game_id') is not null
   and not exists (select 1 from public.tournament_games g where g.id::text = n.data ->> 'tournament_game_id');
update public.notifications n set dismissed_at = now()
 where n.dismissed_at is null and n.data ? 'training_session_id' and (n.data ->> 'training_session_id') is not null
   and not exists (select 1 from public.training_sessions s where s.id::text = n.data ->> 'training_session_id');

revoke all on function internal.fixture_notice_label(uuid) from public;
revoke all on function internal.fixture_family_recipients(uuid) from public;
revoke all on function internal.dismiss_notifications_for_deleted_target() from public;
