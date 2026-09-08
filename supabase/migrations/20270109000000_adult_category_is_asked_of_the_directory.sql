-- What adult rugby a player belongs in, and what the club still has to decide.
--
-- WHY THIS IS A SEPARATE QUESTION
--
-- resolve_normal_operational_identity deliberately declines to place an adult.
-- Its adult branch returns CLUB_HOLDING and says so plainly: "Ovalball does not
-- put a player into adult rugby automatically." That is correct and is left
-- exactly as it is -- the Season Handover depends on it, and a youth player who
-- ages out belongs on the club's holding list, not in the first XV.
--
-- But a person registering themselves as an adult is asking a different
-- question. Not "where does this graduating child go", but "what adult rugby am
-- I registering for". That question has an honest answer, and it is not always
-- a team.
--
-- THE ANSWER DEPENDS ON THE CODE, AND THE DIRECTORY ALREADY KNOWS
--
-- Rugby League offers exactly one adult identity per pathway -- Men's Open Age,
-- Women's Open Age -- so a League adult HAS a canonical team, and it can be
-- named.
--
-- Rugby Union offers three -- Men's 1st, 2nd and 3rd -- and a date of birth
-- does not say which. Nothing does, except the club watching someone play.
-- Telling a new player "Your Team: Men's 1st Team" because it sorts first would
-- be an invention, and a conspicuous one to anybody who has ever played club
-- rugby.
--
-- So this asks the CATALOGUE how many identities the code offers that pathway
-- and answers accordingly. One identity means a team; more than one means a
-- category and a decision that belongs to the club. Nothing here hardcodes
-- "union has three" -- if the directory changes, this changes with it.

create or replace function public.resolve_adult_category(
  p_rugby_code text,
  p_playing_pathway text
) returns table(
  -- 'ADULT_TEAM'      the code offers exactly one adult identity: this is it.
  -- 'ADULT_CATEGORY'  the code offers several: the club chooses the squad.
  -- 'CLASSIFICATION_REQUIRED' / 'NOT_OFFERED'
  resolution text,
  /** Set only for ADULT_TEAM. Null for a category -- there is no honest single id. */
  canonical_team_type_id uuid,
  /** "Men's Open Age", or "Adult Men's Rugby" for a category. */
  display_label text,
  /** How many adult identities this code offers this pathway. */
  identity_count integer,
  reason text
)
language plpgsql
stable
as $function$
declare
  v_gender text;
  v_count integer;
  v_id uuid;
  v_label text;
  v_code_name text := case p_rugby_code when 'union' then 'Rugby Union' else 'Rugby League' end;
begin
  v_gender := case upper(nullif(p_playing_pathway, '')) when 'MALE' then 'mens' when 'FEMALE' then 'womens' end;

  -- Adult rugby is played in a men's or a women's game. Ovalball will not pick
  -- one, here or anywhere else.
  if v_gender is null then
    return query select 'CLASSIFICATION_REQUIRED'::text, null::uuid, null::text, 0,
      'Adult rugby is played in a men''s or a women''s game, so Ovalball needs to know which one this player is registered in.'::text;
    return;
  end if;

  select count(*) into v_count
  from public.canonical_team_types_by_code v
  where v.rugby_code = p_rugby_code and v.is_offered
    and v.category = 'senior' and v.gender = v_gender;

  if v_count = 0 then
    return query select 'NOT_OFFERED'::text, null::uuid, null::text, 0,
      format('%s does not currently offer an adult %s side in Ovalball''s Team Directory.',
             v_code_name, case v_gender when 'mens' then 'men''s' else 'women''s' end);
    return;
  end if;

  if v_count = 1 then
    select v.id into v_id
    from public.canonical_team_types_by_code v
    where v.rugby_code = p_rugby_code and v.is_offered
      and v.category = 'senior' and v.gender = v_gender;

    select ap.display_label into v_label
    from internal.allocation_presentation(v_id, p_rugby_code) ap;

    return query select 'ADULT_TEAM'::text, v_id, v_label, 1,
      format('%s runs one adult %s competition, so this is the team.',
             v_code_name, case v_gender when 'mens' then 'men''s' else 'women''s' end);
    return;
  end if;

  -- More than one. The category is established; the squad is not, and saying
  -- otherwise would be inventing a selection decision.
  return query select 'ADULT_CATEGORY'::text, null::uuid,
    case v_gender when 'mens' then 'Adult Men''s Rugby' else 'Adult Women''s Rugby' end,
    v_count,
    format('%s runs %s adult %s sides. Which one a player is in is the club''s decision, made once they have seen them play -- it is not something a date of birth can answer.',
           v_code_name, v_count, case v_gender when 'mens' then 'men''s' else 'women''s' end);
end;
$function$;

comment on function public.resolve_adult_category(text, text) is
  'What adult rugby a player is registering for. Asks the Team Directory how many adult identities the code offers that pathway: exactly one is a team (League Open Age), more than one is a category whose squad the club chooses (Union 1st/2nd/3rd). Never infers a numbered squad from a date of birth.';

revoke all on function public.resolve_adult_category(text, text) from public;
grant execute on function public.resolve_adult_category(text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- The registration read, extended rather than forked
-- ---------------------------------------------------------------------------
--
-- preview_player_allocation already answers the youth question. An adult
-- reaching it got the CLUB_HOLDING text, which is the right answer to the
-- handover's question and the wrong one to a person registering. It now hands
-- the adult case to resolve_adult_category and returns it in the SAME shape, so
-- one screen renders both and no second read exists.

create or replace function public.preview_player_allocation(
  p_club_id uuid,
  p_date_of_birth date,
  p_playing_pathway text,
  p_first_name text default null
) returns table(
  normalised_first_name text,
  rugby_code text,
  season_id uuid,
  season_name text,
  regulatory_age_label text,
  allocation_status text,
  reason text,
  canonical_team_type_id uuid,
  compact_label text,
  display_label text,
  club_runs_team boolean,
  operational_team_id uuid,
  operational_team_name text,
  operational_team_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
  v_season_id uuid;
  v_season_name text;
  r record;
  a record;
  v_compact text; v_display text;
  v_count integer := 0;
  v_team_id uuid;
  v_team_name text;
  v_name text;
  v_age record;
begin
  v_name := nullif(internal.normalise_person_name(trim(coalesce(p_first_name, ''))), '');
  if not internal.may_ask_club_allocation(p_club_id) then
    raise exception 'You need an invitation from this club before you can register a player with it.'
      using errcode = '42501';
  end if;
  if p_date_of_birth is null then
    raise exception 'A date of birth is needed before Ovalball can work out an age group.'
      using errcode = '23514';
  end if;

  select cd.rugby_code into v_code
  from public.clubs c
  join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id and c.status = 'active';
  if v_code is null then
    raise exception 'Club not found.';
  end if;

  v_season_id := internal.resolve_season_for_date(v_code, current_date);
  if v_season_id is null then
    return query select v_name, v_code, null::uuid, null::text, null::text, 'SEASON_UNAVAILABLE'::text,
      'Ovalball does not currently have a season set up for this rugby code, so it cannot work out an age group yet. Your club can sort this out.'::text,
      null::uuid, null::text, null::text, false, null::uuid, null::text, 0;
    return;
  end if;
  select s.name into v_season_name from public.seasons s where s.id = v_season_id;

  -- ADULT. Asked as its own question, because it is one.
  select * into v_age from public.resolve_player_regulatory_age(v_code, v_season_id, p_date_of_birth);
  if v_age.status = 'ADULT' then
    select * into a from public.resolve_adult_category(v_code, nullif(upper(nullif(p_playing_pathway, '')), ''));

    if a.canonical_team_type_id is not null then
      select ap.compact_label, ap.display_label into v_compact, v_display
      from internal.allocation_presentation(a.canonical_team_type_id, v_code) ap;

      select count(*) into v_count
      from public.teams t
      where t.club_id = p_club_id and t.active and t.canonical_team_type_id = a.canonical_team_type_id;

      if v_count = 1 then
        select t.id, t.display_name into v_team_id, v_team_name
        from public.teams t
        where t.club_id = p_club_id and t.active and t.canonical_team_type_id = a.canonical_team_type_id;
      end if;
    else
      v_display := a.display_label;
      -- For a category, "does the club run it" means: does the club run ANY
      -- adult side in this pathway. Which one is the club's answer, not ours.
      select count(*) into v_count
      from public.teams t
      join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
      where t.club_id = p_club_id and t.active and ctt.category = 'senior'
        and ctt.gender = case upper(p_playing_pathway) when 'MALE' then 'mens' else 'womens' end;
    end if;

    return query select v_name, v_code, v_season_id, v_season_name, v_age.regulatory_age_label,
      a.resolution, a.reason, a.canonical_team_type_id, v_compact, v_display,
      v_count > 0, v_team_id, v_team_name, v_count;
    return;
  end if;

  select * into r from public.resolve_normal_operational_identity(
    v_code, v_season_id, p_date_of_birth, nullif(upper(nullif(p_playing_pathway, '')), ''));

  if r.canonical_team_type_id is not null then
    select ap.compact_label, ap.display_label into v_compact, v_display
    from internal.allocation_presentation(r.canonical_team_type_id, v_code) ap;

    select count(*) into v_count
    from public.teams t
    where t.club_id = p_club_id and t.active
      and t.canonical_team_type_id = r.canonical_team_type_id;

    if v_count = 1 then
      select t.id, t.display_name into v_team_id, v_team_name
      from public.teams t
      where t.club_id = p_club_id and t.active
        and t.canonical_team_type_id = r.canonical_team_type_id;
    end if;
  end if;

  return query select
    v_name, v_code, v_season_id, v_season_name,
    r.regulatory_age_label, r.allocation_status, r.reason,
    r.canonical_team_type_id, v_compact, v_display,
    v_count > 0, v_team_id, v_team_name, v_count;
end;
$function$;

comment on function public.preview_player_allocation(uuid, date, text, text) is
  'The registration screen''s read, for a youth player or an adult. Youth goes through resolve_normal_operational_identity; an adult goes through resolve_adult_category, which returns a TEAM where the code offers one adult identity and a CATEGORY where it offers several. Writes nothing.';
