-- An adult registers themselves.
--
-- Everything a child gets through a guardian, an adult should be able to do for
-- themselves, and until now could not: every route into `players` went through
-- a guardian relationship or a club invitation, so a grown adult who wanted to
-- join a club had to be added by somebody else.
--
-- WHAT THIS IS NOT
--
-- It is not a second player model. There is no adult_players table, no adult
-- profile, no adult allocator. It writes the same `players` row a guardian
-- writes, and everything downstream -- allocation, membership, availability,
-- the compatibility guard -- cannot tell the difference and does not need to.
--
-- AUTHENTICATION IS NOT REGISTRATION
--
-- Signing in with a magic link, Google, Apple or Facebook establishes an
-- ACCOUNT. It says nothing about whether that person plays rugby: they may be a
-- parent, a coach, a club secretary, or all three. So nothing here runs
-- automatically on sign-in. A person becomes a player because they said so.
--
-- ONE PLAYER PER ACCOUNT
--
-- players.user_id already carries a unique index, so an account can only ever
-- own one player row. This function leans on that rather than adding a second
-- rule: coming back through a different provider, or refreshing halfway
-- through, finds the player that already exists.

create or replace function public.create_own_player_profile(
  p_first_name text,
  p_surname text,
  p_date_of_birth date,
  p_playing_pathway text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_pathway text := upper(nullif(trim(coalesce(p_playing_pathway, '')), ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- RESUMABLE, not duplicating. Whatever brought them back -- a refresh, a new
  -- provider, a second tab -- this is the same player.
  select id into v_existing from public.players where user_id = v_uid;
  if v_existing is not null then
    -- Fill in only what is genuinely still missing. An existing value is never
    -- overwritten here: a recorded gender in particular is set once, and
    -- set_player_playing_pathway is the one place that rule lives.
    update public.players
    set date_of_birth = coalesce(date_of_birth, p_date_of_birth),
        updated_by = v_uid, updated_at = now()
    where id = v_existing and date_of_birth is null and p_date_of_birth is not null;

    if v_pathway in ('MALE', 'FEMALE')
       and (select playing_pathway from public.players where id = v_existing) is null then
      perform public.set_player_playing_pathway(v_existing, v_pathway);
    end if;
    return v_existing;
  end if;

  if v_first = '' or v_surname = '' then
    raise exception 'We need your first name and surname.' using errcode = '23514';
  end if;
  if p_date_of_birth is null then
    raise exception 'We need your date of birth. It is what decides which rugby category you play in.' using errcode = '23514';
  end if;
  -- `null not in (...)` is null, not true, so the null case has to be named
  -- explicitly or a player is created with no recorded gender at all.
  if v_pathway is null or v_pathway not in ('MALE', 'FEMALE') then
    raise exception 'Tell us whether you play in the men''s or the women''s game, so Ovalball can work out your rugby category.' using errcode = '23514';
  end if;

  -- The name is normalised by the trigger on players, the same one that runs
  -- for a child added by a guardian. There is no separate formatter here, and
  -- none for a name that arrived from an authentication provider either.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id, active, created_by, updated_by)
  values (v_first, v_surname, p_date_of_birth, v_pathway, v_uid, true, v_uid, v_uid)
  returning id into v_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('players', v_id, 'insert', v_uid, jsonb_build_object('event', 'PLAYER_SELF_REGISTERED'));

  return v_id;
end;
$function$;

comment on function public.create_own_player_profile(text, text, date, text) is
  'An authenticated adult creates their OWN player record, linked by players.user_id. Idempotent against the unique index on that column, so returning through a different sign-in method resumes rather than duplicating. Never runs automatically on authentication: signing in establishes an account, not a rugby player.';

revoke all on function public.create_own_player_profile(text, text, date, text) from public;
grant execute on function public.create_own_player_profile(text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the signed-in person needs next
-- ---------------------------------------------------------------------------
--
-- Post-login routing asks one question in one place, so the answer cannot drift
-- between the dashboard, the onboarding screen and the navigation.

create or replace function public.my_player_context()
returns table(
  player_id uuid,
  first_name text,
  surname text,
  has_date_of_birth boolean,
  has_playing_pathway boolean,
  /** 'NO_PLAYER' | 'PROFILE_INCOMPLETE' | 'NO_CLUB' | 'PENDING' | 'DECLINED' | 'ACTIVE' */
  state text,
  club_id uuid,
  club_name text,
  team_id uuid,
  team_name text,
  request_id uuid,
  resolved_category text,
  decline_reason text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  p public.players;
  m record;
  q record;
begin
  if v_uid is null then return; end if;

  select * into p from public.players where user_id = v_uid;
  if p.id is null then
    return query select null::uuid, null::text, null::text, false, false, 'NO_PLAYER'::text,
      null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, null::text;
    return;
  end if;

  if p.date_of_birth is null or p.playing_pathway is null then
    return query select p.id, p.first_name, p.surname, p.date_of_birth is not null, p.playing_pathway is not null,
      'PROFILE_INCOMPLETE'::text, null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- A real place at a club beats anything else: somebody already playing is not
  -- shown a join journey.
  select t.club_id, cd.name as club_name, t.id as team_id, t.display_name as team_name
  into m
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  join public.clubs c on c.id = t.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where ptm.player_id = p.id and ptm.status = 'active'
  order by ptm.joined_at desc
  limit 1;

  if m.team_id is not null then
    return query select p.id, p.first_name, p.surname, true, true, 'ACTIVE'::text,
      m.club_id, m.club_name, m.team_id, m.team_name, null::uuid, null::text, null::text;
    return;
  end if;

  select r.id, r.status, r.club_id, cd.name as club_name, r.resolved_category, r.decline_reason
  into q
  from public.player_club_join_requests r
  join public.clubs c on c.id = r.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where r.player_id = p.id and r.status in ('pending', 'declined')
  order by (r.status = 'pending') desc, r.created_at desc
  limit 1;

  if q.id is not null then
    return query select p.id, p.first_name, p.surname, true, true,
      case q.status when 'pending' then 'PENDING' else 'DECLINED' end,
      q.club_id, q.club_name, null::uuid, null::text, q.id, q.resolved_category, q.decline_reason;
    return;
  end if;

  return query select p.id, p.first_name, p.surname, true, true, 'NO_CLUB'::text,
    null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, null::text;
end;
$function$;

comment on function public.my_player_context() is
  'The one answer to "what does this signed-in person need next as a player": no player yet, an incomplete profile, no club, a request in flight, a declined request, or a real place in a team. Post-login routing, the dashboard and the navigation all read this, so they cannot disagree.';

revoke all on function public.my_player_context() from public;
grant execute on function public.my_player_context() to authenticated;
