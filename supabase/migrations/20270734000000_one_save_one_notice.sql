-- =====================================================================================================
-- ONE SAVE, ONE NOTICE
--
-- Edit Match Details is one form with one Save. It wrote through four governed writers, one after another:
-- update_fixture_details, update_fixture_kickoff, update_fixture_meet_time and set_fixture_facilities. Each
-- is right on its own and each tells the people its change affects -- so a coach who moved the kick-off,
-- the meet time and the pitch in one Save sent every family three notices about one decision (integration
-- audit: "no duplicate notification because one Save called several RPCs").
--
-- The writers are unchanged. `save_match_details` runs them in ONE transaction, and while it does, the
-- notices they raise are held rather than sent; when the last has run, each person who would have been told
-- anything is told once -- their notices' sentences together, under one title. Nothing is held outside a
-- save_match_details call: the hold is a transaction-local setting, so every other caller of the four
-- writers behaves exactly as before. A kick-off change that needs the other club's AGREEMENT is a question,
-- not news, and is never folded into the summary.
-- =====================================================================================================

create table if not exists internal.notification_batch_items (
  seq bigserial primary key,
  batch_id uuid not null,
  user_id uuid not null,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb
);
create index if not exists notification_batch_items_batch_idx on internal.notification_batch_items (batch_id, user_id);
revoke all on table internal.notification_batch_items from public, anon, authenticated;
comment on table internal.notification_batch_items is
  'Notices held while save_match_details runs, so one Save tells each person once. Emptied by the same transaction.';

-- The change notices one Save may raise. A proposal (fixture_kickoff_change_proposed) asks for an answer and is
-- deliberately absent.
create or replace function internal.notification_batch_capture()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_batch text := nullif(current_setting('ovalball.notice_batch', true), '');
begin
  if v_batch is null then
    return new;
  end if;
  if new.type not in ('fixture_details_changed', 'fixture_kickoff_changed', 'fixture_meet_time_changed', 'fixture_pitch_changed', 'fixture_arrangements_changed') then
    return new;
  end if;
  insert into internal.notification_batch_items (batch_id, user_id, type, title, body, data)
  values (v_batch::uuid, new.user_id, new.type, new.title, new.body, coalesce(new.data, '{}'::jsonb));
  return null;
end;
$function$;
revoke all on function internal.notification_batch_capture() from public, anon, authenticated;

-- Named to fire AFTER the delivery gate (BEFORE triggers run in name order), so only a notice a person's own
-- preferences would let through is held; the single notice is gated again when it is written.
drop trigger if exists notifications_zz_batch_capture on public.notifications;
create trigger notifications_zz_batch_capture
  before insert on public.notifications
  for each row execute function internal.notification_batch_capture();

create or replace function public.save_match_details(p_fixture_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_batch uuid := gen_random_uuid();
  v_facilities jsonb;
  v_meet time;
  v_notified integer := 0;
begin
  perform internal.require_live_session();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;

  perform set_config('ovalball.notice_batch', v_batch::text, true);

  -- The same order the form has always used: home or away and the notes first (a host change re-resolves
  -- the ground), then the schedule and the meet time, then the ground and pitch this form chose.
  if p_patch ? 'details' then
    perform public.update_fixture_details(p_fixture_id, p_patch -> 'details');
  end if;
  if p_patch ? 'kickoff' then
    perform public.update_fixture_kickoff(p_fixture_id, (p_patch -> 'kickoff' ->> 'date')::date, nullif(p_patch -> 'kickoff' ->> 'time', '')::time);
  end if;
  if p_patch ? 'meet_time' then
    v_meet := public.update_fixture_meet_time(p_fixture_id, nullif(p_patch ->> 'meet_time', '')::time);
  end if;
  if p_patch ? 'facilities' then
    v_facilities := public.set_fixture_facilities(p_fixture_id, p_patch -> 'facilities');
  end if;

  perform set_config('ovalball.notice_batch', '', true);

  -- EACH PERSON ONCE: their held sentences together, in the order the changes were made; one change keeps its
  -- own title and type, several become "Match details changed".
  with held as (
    select b.user_id, b.type, b.title, b.body, b.data, b.seq,
           row_number() over (partition by b.user_id, coalesce(b.body, '') order by b.seq) as dup
      from internal.notification_batch_items b
     where b.batch_id = v_batch
  ), per_person as (
    select h.user_id,
           count(distinct h.type) as kinds,
           (array_agg(h.type order by h.seq))[1] as first_type,
           (array_agg(h.title order by h.seq))[1] as first_title,
           string_agg(h.body, ' ' order by h.seq) filter (where h.dup = 1) as body,
           (array_agg(h.data order by h.seq))[1] as data
      from held h
     group by h.user_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select p.user_id,
         case when p.kinds = 1 then p.first_type else 'fixture_details_changed' end,
         case when p.kinds = 1 then p.first_title else 'Match details changed' end,
         p.body,
         p.data
    from per_person p;
  get diagnostics v_notified = row_count;

  delete from internal.notification_batch_items where batch_id = v_batch;

  return jsonb_build_object('facilities', v_facilities, 'meetTime', v_meet, 'notified', v_notified);
end;
$function$;
revoke all on function public.save_match_details(uuid, jsonb) from public, anon;
grant execute on function public.save_match_details(uuid, jsonb) to authenticated;
comment on function public.save_match_details(uuid, jsonb) is
  'Edit Match Details in one transaction: details, kick-off, meet time and facilities through their own governed writers, with each affected person told once.';
