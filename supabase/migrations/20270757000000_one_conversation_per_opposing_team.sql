-- =====================================================================================================================
-- ONE CONVERSATION PER OPPOSING TEAM (owner decision, 7 Oct 2026)
--
-- Until now every fixture had its own conversation, so a season of games between two sides was a season of
-- separate threads ("eight Preston Grasshoppers rows"). From here, every fixture between the same two sides shares
-- ONE conversation: `fixtures.conversation_id` is the same for all of them, and everything that is already keyed on
-- the conversation -- the thread reader on both clients, realtime topics, read receipts and access
-- (`internal.can_access_conversation`, which unions over the fixtures sharing the id) -- follows without change.
--
-- WHO THE OTHER SIDE IS, as a key:
--   * an Ovalball team on the other side: the two team ids, unordered (so both mirror rows agree);
--   * a club in the directory that is not on Ovalball: my team, that directory club and the side's name;
--   * free text only: my team and the text, normalised.
-- A fixture with no opposition recorded keeps a conversation of its own.
--
-- ACCESS DOES NOT WIDEN. Every fixture sharing a conversation is between the same two teams, so the people who
-- may read it are exactly the people who could already read each fixture's own thread.
--
-- A PERSON'S MUTE AND LEAVE follow the conversation: setting either on one fixture applies it to every fixture in
-- the same conversation, and a new fixture joining a conversation inherits the existing choices. So each existing
-- per-fixture reader (notifications, the people list) keeps giving the same answer.
--
-- READING clears the whole conversation: `mark_fixture_conversation_read` marks the reader's message notifications
-- for every fixture in it.
-- =====================================================================================================================

create or replace function internal.fixture_opponent_key(
  p_owning_team_id uuid,
  p_opponent_team_id uuid,
  p_opponent_directory_id uuid,
  p_opponent_side_name text,
  p_raw_opposition_text text
)
 returns text
 language sql
 immutable
 set search_path to 'pg_temp'
as $function$
  select case
    when p_owning_team_id is null then null
    when p_opponent_team_id is not null then
      'teams:' || least(p_owning_team_id, p_opponent_team_id)::text || ':' || greatest(p_owning_team_id, p_opponent_team_id)::text
    when p_opponent_directory_id is not null then
      'directory:' || p_owning_team_id::text || ':' || p_opponent_directory_id::text || ':' || lower(btrim(coalesce(p_opponent_side_name, '')))
    when nullif(btrim(coalesce(p_raw_opposition_text, '')), '') is not null then
      'text:' || p_owning_team_id::text || ':' || lower(regexp_replace(btrim(p_raw_opposition_text), '\s+', ' ', 'g'))
    else null
  end
$function$;

revoke all on function internal.fixture_opponent_key(uuid, uuid, uuid, text, text) from public, anon;
-- EXECUTABLE BY A SIGNED-IN WRITER, deliberately (release readiness, 8 Oct 2026). `fixtures_opponent_key_idx` below
-- is an expression index on this function, and PostgreSQL evaluates index expressions as the user writing the row
-- whenever an update is not HOT (an indexed column changed, or the page had no room). Revoked from authenticated,
-- every such client update of a fixture -- a status change, a cancellation, a note -- failed with "permission
-- denied", intermittently. It composes its arguments into text and reads nothing, so executing it discloses nothing.
grant execute on function internal.fixture_opponent_key(uuid, uuid, uuid, text, text) to authenticated;

create index if not exists fixtures_opponent_key_idx on public.fixtures (
  internal.fixture_opponent_key(owning_team_id, opponent_team_id, opponent_directory_id, opponent_team_display_name_snapshot, raw_opposition_text)
);

/**
 * A fixture joins the conversation its two sides already have; a fixture whose other side changed leaves the old
 * one (what was said there was about the old opponent, and stays there).
 */
create or replace function internal.assign_fixture_conversation_by_opponent()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_key text := internal.fixture_opponent_key(new.owning_team_id, new.opponent_team_id, new.opponent_directory_id,
                                               new.opponent_team_display_name_snapshot, new.raw_opposition_text);
  v_existing uuid;
begin
  if tg_op = 'UPDATE' and v_key is not distinct from internal.fixture_opponent_key(old.owning_team_id, old.opponent_team_id,
       old.opponent_directory_id, old.opponent_team_display_name_snapshot, old.raw_opposition_text) then
    return new;
  end if;

  if v_key is not null then
    select f.conversation_id into v_existing
      from public.fixtures f
     where internal.fixture_opponent_key(f.owning_team_id, f.opponent_team_id, f.opponent_directory_id,
                                         f.opponent_team_display_name_snapshot, f.raw_opposition_text) = v_key
       and f.id is distinct from new.id
       and f.conversation_id is not null
     limit 1;
  end if;

  if v_existing is not null then
    new.conversation_id := v_existing;
  elsif tg_op = 'UPDATE' then
    -- A NEW OTHER SIDE NEVER INHERITS THE OLD ONE'S THREAD (release readiness, 8 Oct 2026). What was said there was
    -- between the previous two sides; it stays in its own conversation, readable by them, and this fixture starts
    -- a conversation of its own -- even when it was the only fixture in the old one.
    new.conversation_id := gen_random_uuid();
  end if;
  return new;
end;
$function$;

drop trigger if exists assign_fixture_conversation_by_opponent on public.fixtures;
create trigger assign_fixture_conversation_by_opponent
  before insert or update of owning_team_id, opponent_team_id, opponent_directory_id, opponent_team_display_name_snapshot, raw_opposition_text
  on public.fixtures
  for each row execute function internal.assign_fixture_conversation_by_opponent();

/** A person's mute and leave apply to the whole conversation, not to one fixture in it. */
create or replace function internal.propagate_fixture_conversation_subscription()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  -- A merge writes everybody's settled choice itself; it must not be overwritten mid-merge by synthesised rows.
  if current_setting('ovalball.conversation_merge', true) = 'on' then
    return new;
  end if;
  if pg_trigger_depth() > 1 or new.fixture_id is null then
    return new;
  end if;
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at)
  select s.id, new.user_id, new.muted, new.left_at
    from public.fixtures f
    join public.fixtures s on s.conversation_id = f.conversation_id and s.id <> f.id
   where f.id = new.fixture_id
  on conflict (fixture_id, user_id) where fixture_id is not null
    do update set muted = excluded.muted, left_at = excluded.left_at, updated_at = now();
  return new;
end;
$function$;

drop trigger if exists propagate_fixture_conversation_subscription on public.fixture_conversation_subscriptions;
create trigger propagate_fixture_conversation_subscription
  after insert or update of muted, left_at on public.fixture_conversation_subscriptions
  for each row execute function internal.propagate_fixture_conversation_subscription();

/** A fixture joining a conversation inherits the choices people have already made in it. */
create or replace function internal.inherit_fixture_conversation_subscriptions()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  -- A merge writes everybody's settled choice itself; it must not be overwritten mid-merge by synthesised rows.
  if current_setting('ovalball.conversation_merge', true) = 'on' then
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.conversation_id is not distinct from old.conversation_id then
    return new;
  end if;
  insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at)
  select distinct on (s.user_id) new.id, s.user_id, s.muted, s.left_at
    from public.fixture_conversation_subscriptions s
    join public.fixtures f on f.id = s.fixture_id
   where f.conversation_id = new.conversation_id and f.id <> new.id
   order by s.user_id, s.updated_at desc
  on conflict (fixture_id, user_id) where fixture_id is not null do nothing;
  return new;
end;
$function$;

drop trigger if exists inherit_fixture_conversation_subscriptions on public.fixtures;
create trigger inherit_fixture_conversation_subscriptions
  after insert or update of conversation_id on public.fixtures
  for each row execute function internal.inherit_fixture_conversation_subscriptions();

/**
 * I have read this conversation: every unread message notification of mine for any fixture in it. Refused for a
 * fixture whose conversation I cannot read. Only ever changes read_at, and only on my own notifications.
 */
create or replace function public.mark_fixture_conversation_read(p_fixture_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_conversation uuid;
  v_count integer;
begin
  perform internal.require_live_session();
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select conversation_id into v_conversation from public.fixtures where id = p_fixture_id;
  if v_conversation is null or not internal.can_access_conversation(v_conversation) then
    raise exception 'That conversation isn''t available.' using errcode = '42501';
  end if;
  update public.notifications n
     set read_at = now()
   where n.user_id = v_uid
     and n.type = 'new_fixture_message'
     and n.read_at is null
     and (n.data ->> 'fixture_id') in (select f.id::text from public.fixtures f where f.conversation_id = v_conversation);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.mark_fixture_conversation_read(uuid) from public, anon;
grant execute on function public.mark_fixture_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- THE EXISTING THREADS, MERGED. For each pair of sides with more than one conversation, the one with the earliest
-- message (else the earliest fixture) becomes the conversation; the others' messages, reviews and read positions
-- move into it.
--
-- FAIL-FAST AND WHOLE (release readiness, 8 Oct 2026). The first version caught any error per fixture, kept that
-- fixture on its old thread and carried on, so the migration could commit a half-merged conversation with nothing
-- but a notice. Now any failure -- a fixture validator refusing the move included -- aborts the migration with its
-- own error, and the merge ends by proving its result: one conversation per opposing pair, no message left
-- pointing at a merged-away conversation, no message newly separated from its fixture's conversation, and every
-- fixture-request thread exactly as it was.
--
-- WHAT PEOPLE CHOSE SURVIVES THE MERGE.
--   * Mute and leave: each person's most recent real choice in any of the merged threads applies to the merged
--     conversation, with its original time. While the merge runs, the two subscription triggers stand aside, so a
--     row they would synthesise (stamped "now") can never outrank a genuine choice. A tie goes to the more
--     withdrawn choice (left, then muted): a merge never quietly turns notifications back on.
--   * Read positions: the merged cursor is the EARLIEST point anything is still unread for that person across the
--     merged threads -- their own cursor in each thread, or, in a thread with messages from others where they have
--     no cursor, just before its first such message. Taking the latest instead would move the cursor past the other
--     thread's unread messages and they would never be marked read: silently treated as read. Already-read
--     messages keep their receipts (`message_reads` is untouched), and notifications are not touched at all.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function internal.merge_fixture_conversations_by_opponent()
 returns jsonb
 language plpgsql
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  g record;
  v_canonical uuid;
  v_convs uuid[];
  v_others uuid[];
  v_all_others uuid[] := '{}';
  v_group_fixtures uuid[];
  v_groups int := 0;
  v_fixtures int := 0;
  v_messages int := 0;
  v_n int;
  v_mismatch_before uuid[];
  v_mismatch_new int;
  v_requests_before text;
  v_requests_after text;
begin
  perform set_config('ovalball.conversation_merge', 'on', true);

  -- The state the merge must not disturb, taken before anything moves.
  v_mismatch_before := array(
    select m.id from public.fixture_messages m join public.fixtures f on f.id = m.fixture_id
     where m.conversation_id is not null and m.conversation_id is distinct from f.conversation_id);
  select coalesce(md5(string_agg(concat_ws('|', m.id, m.fixture_request_id, m.conversation_id, m.fixture_id, m.deleted_at),
                                 ',' order by m.id)), '')
    into v_requests_before
    from public.fixture_messages m
   where m.fixture_request_id is not null;

  for g in
    select internal.fixture_opponent_key(owning_team_id, opponent_team_id, opponent_directory_id,
                                         opponent_team_display_name_snapshot, raw_opposition_text) as k
      from public.fixtures
     group by 1
    having count(distinct conversation_id) > 1
  loop
    continue when g.k is null;
    v_groups := v_groups + 1;

    select fx.conversation_id into v_canonical
      from public.fixtures fx
      left join lateral (select min(m.created_at) as first_at from public.fixture_messages m where m.conversation_id = fx.conversation_id) x on true
     where internal.fixture_opponent_key(fx.owning_team_id, fx.opponent_team_id, fx.opponent_directory_id,
                                         fx.opponent_team_display_name_snapshot, fx.raw_opposition_text) = g.k
       and fx.conversation_id is not null
     order by x.first_at nulls last, fx.kickoff_date nulls last, fx.id
     limit 1;

    v_group_fixtures := array(
      select fx.id from public.fixtures fx
       where internal.fixture_opponent_key(fx.owning_team_id, fx.opponent_team_id, fx.opponent_directory_id,
                                           fx.opponent_team_display_name_snapshot, fx.raw_opposition_text) = g.k);
    v_convs := array(select distinct fx.conversation_id from public.fixtures fx
                      where fx.id = any(v_group_fixtures) and fx.conversation_id is not null);
    v_others := array(select c from unnest(v_convs) c where c is distinct from v_canonical);
    v_all_others := v_all_others || v_others;

    -- Read positions, decided BEFORE any message moves (each thread's own messages are still its own).
    create temp table if not exists pg_temp.merge_cursor_plan (user_id uuid primary key, last_read_at timestamptz not null) on commit drop;
    truncate pg_temp.merge_cursor_plan;
    insert into pg_temp.merge_cursor_plan (user_id, last_read_at)
    select u.user_id, min(p.point)
      from (select distinct c.user_id from public.thread_read_cursors c where c.thread_key = any(v_convs)) u
      cross join lateral (
        select coalesce(
                 (select c.last_read_at from public.thread_read_cursors c where c.thread_key = t.conv and c.user_id = u.user_id),
                 (select min(m.created_at) - interval '1 microsecond' from public.fixture_messages m
                   where m.conversation_id = t.conv and m.sender_user_id <> u.user_id
                     and m.kind = 'message' and m.deleted_at is null)
               ) as point
          from unnest(v_convs) as t(conv)
      ) p
     where p.point is not null
     group by u.user_id;

    -- Every fixture between the pair joins the one conversation. No handler: a refusal aborts the migration.
    update public.fixtures set conversation_id = v_canonical
     where id = any(v_group_fixtures) and conversation_id is distinct from v_canonical;
    get diagnostics v_n = row_count;
    v_fixtures := v_fixtures + v_n;

    -- The pair's messages follow; so does anything else still pointing at a thread no fixture uses any more.
    update public.fixture_messages m set conversation_id = v_canonical
     where m.conversation_id = any(v_others)
       and (m.fixture_id = any(v_group_fixtures)
            or not exists (select 1 from public.fixtures fx where fx.conversation_id = m.conversation_id));
    get diagnostics v_n = row_count;
    v_messages := v_messages + v_n;

    update public.safeguarding_thread_reviews r set conversation_id = v_canonical
     where r.conversation_id = any(v_others)
       and not exists (select 1 from public.fixtures fx where fx.conversation_id = r.conversation_id);

    delete from public.thread_read_cursors c
     where c.thread_key = any(v_others)
       and not exists (select 1 from public.fixtures fx where fx.conversation_id = c.thread_key);
    insert into public.thread_read_cursors (thread_key, user_id, last_read_at)
    select v_canonical, p.user_id, p.last_read_at from pg_temp.merge_cursor_plan p
    on conflict (thread_key, user_id) do update
      set last_read_at = excluded.last_read_at, updated_at = now();

    -- One choice per person for the merged conversation: their latest real one, the more withdrawn on a tie.
    insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted, left_at, updated_at)
    select fx.id, latest.user_id, latest.muted, latest.left_at, latest.updated_at
      from (
        select distinct on (s.user_id) s.user_id, s.muted, s.left_at, s.updated_at
          from public.fixture_conversation_subscriptions s
         where s.fixture_id = any(v_group_fixtures)
         order by s.user_id, s.updated_at desc, (s.left_at is not null) desc, s.muted desc
      ) latest
      cross join public.fixtures fx
     where fx.id = any(v_group_fixtures)
    on conflict (fixture_id, user_id) where fixture_id is not null
      do update set muted = excluded.muted, left_at = excluded.left_at, updated_at = excluded.updated_at;
  end loop;

  perform set_config('ovalball.conversation_merge', 'off', true);

  -- THE RESULT, PROVED.
  select count(*) into v_n from (
    select internal.fixture_opponent_key(owning_team_id, opponent_team_id, opponent_directory_id,
                                         opponent_team_display_name_snapshot, raw_opposition_text) as k
      from public.fixtures group by 1
    having count(distinct conversation_id) > 1
  ) x where x.k is not null;
  if v_n > 0 then
    raise exception 'conversation merge: % opposing pair(s) still have more than one conversation.', v_n;
  end if;

  select count(*) into v_n from public.fixture_messages m
   where m.conversation_id = any(v_all_others)
     and not exists (select 1 from public.fixtures fx where fx.conversation_id = m.conversation_id);
  if v_n > 0 then
    raise exception 'conversation merge: % message(s) still point at a merged-away conversation.', v_n;
  end if;

  -- No message may be NEWLY separated from its fixture's conversation (one already separated before -- history
  -- kept with an earlier opponent -- is not this merge's to change, in either direction).
  select count(*) into v_mismatch_new
    from public.fixture_messages m join public.fixtures f on f.id = m.fixture_id
   where m.conversation_id is not null and m.conversation_id is distinct from f.conversation_id
     and not (m.id = any(v_mismatch_before));
  if v_mismatch_new > 0 then
    raise exception 'conversation merge: % message(s) newly separated from their fixture''s conversation.', v_mismatch_new;
  end if;

  select coalesce(md5(string_agg(concat_ws('|', m.id, m.fixture_request_id, m.conversation_id, m.fixture_id, m.deleted_at),
                                 ',' order by m.id)), '')
    into v_requests_after
    from public.fixture_messages m
   where m.fixture_request_id is not null;
  if v_requests_after is distinct from v_requests_before then
    raise exception 'conversation merge: a fixture-request thread changed.';
  end if;

  return jsonb_build_object('groups', v_groups, 'fixtures_moved', v_fixtures, 'messages_moved', v_messages);
end;
$function$;

revoke all on function internal.merge_fixture_conversations_by_opponent() from public, anon, authenticated;

select internal.merge_fixture_conversations_by_opponent();
