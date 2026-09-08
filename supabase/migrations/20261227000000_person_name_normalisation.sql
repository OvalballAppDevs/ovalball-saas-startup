-- A person's name is stored the way they would write it, not the way it was typed.
--
-- THE PROBLEM
--
-- "callum krzysik" typed into signup was stored as "callum krzysik" and shown
-- that way everywhere -- on a team sheet, in a message, on a safeguarding
-- record. CSS could hide it, but only in the one place somebody remembered to
-- add text-transform, and never in an export, an email or a report. The name
-- has to be right in the database.
--
-- WHERE THIS LIVES, AND WHY
--
-- Five server functions and several direct writers put a person's name into
-- Ovalball: signup, add-a-child, guardian link requests, duplicate-review
-- resolution, invitation acceptance, Site Admin correction. Copying a
-- formatter into each of them guarantees the next one forgets it. So the rule
-- lives once, in a trigger on each table that holds a canonical person name,
-- and every writer is covered by construction -- including writers that do not
-- exist yet. This is the same shape as the membership pathway guard.
--
-- WHAT IT WILL NOT DO
--
-- Real names are not headings, and a naive Title Case destroys them. McDonald
-- becomes Mcdonald, van der Meer becomes Van Der Meer, O'Neill becomes O'neill.
-- So the normaliser only cleans input that is OBVIOUSLY unformatted:
--
--   * a word that already carries an internal capital is left exactly alone.
--     McDonald, MacLeod, O'Neill and DiCaprio are somebody's deliberate
--     spelling, and re-normalising them is how a corrected name gets damaged
--     a second time.
--   * a word typed entirely in capitals is treated as unformatted -- caps lock,
--     not a decision -- and re-cased.
--   * a word typed entirely in lower case is capitalised, at its start and
--     after each hyphen and apostrophe.
--   * a nobiliary particle in a multi-word name stays lower case, which is how
--     de Silva and van der Meer are actually written.
--
-- Mc is expanded (mcgowan -> McGowan) because a lower-case "mc" surname is
-- essentially always compound. Mac deliberately is NOT: Macey, Machin and Mace
-- are ordinary names that a Mac rule would mangle into MacEy and MacHin. An
-- authorised person can always correct their own name by hand, and once they
-- have, the internal-capital rule means nothing here will touch it again.

create or replace function internal.normalise_name_word(p_word text)
returns text
language plpgsql immutable
as $function$
declare
  v text := p_word;
  v_parts text[];
  v_out text := '';
  v_sep text;
  v_i int;
  v_seg text;
begin
  if v is null or v = '' then return v; end if;

  -- Already deliberately cased. Leave it completely alone -- this is what
  -- stops a corrected name being re-spelled every time it is saved.
  if v ~ '[A-Z]' and v !~ '^[^a-z]+$' then
    return v;
  end if;

  -- Typed in capitals. Not a decision, so re-case it from scratch.
  if v ~ '^[^a-z]+$' and v ~ '[A-Z]' then
    v := lower(v);
  end if;

  -- Capitalise at the start and after every hyphen or apostrophe, keeping the
  -- separators exactly where they were.
  v_out := '';
  v_seg := '';
  for v_i in 1..length(v) loop
    v_sep := substr(v, v_i, 1);
    if v_sep in ('-', '''', '’', '.') then
      v_out := v_out || internal.capitalise_name_segment(v_seg) || v_sep;
      v_seg := '';
    else
      v_seg := v_seg || v_sep;
    end if;
  end loop;
  v_out := v_out || internal.capitalise_name_segment(v_seg);

  return v_out;
end;
$function$;

create or replace function internal.capitalise_name_segment(p_seg text)
returns text
language sql immutable
as $function$
  select case
    when p_seg is null or p_seg = '' then p_seg
    -- mcgowan -> McGowan. Mac is deliberately excluded: Macey and Machin are
    -- ordinary surnames a Mac rule would turn into MacEy and MacHin.
    when p_seg ~ '^mc[a-z]{2,}$' then 'Mc' || upper(substr(p_seg, 3, 1)) || substr(p_seg, 4)
    else upper(substr(p_seg, 1, 1)) || substr(p_seg, 2)
  end;
$function$;

create or replace function internal.normalise_person_name(p_name text)
returns text
language plpgsql immutable
as $function$
declare
  -- Written lower case in a full name: de Silva, van der Meer, Ali ibn Sina.
  -- Never applied to a single-word name, where the particle IS the name.
  v_particles constant text[] := array[
    'de','del','della','der','den','di','da','das','dos','du','la','le','les',
    'van','von','vd','ter','ten','af','al','bin','binte','bint','ibn','of','y','e'
  ];
  v_words text[];
  v_out text[] := '{}';
  v_w text;
begin
  if p_name is null then return null; end if;

  -- Trim, and collapse any run of internal whitespace to one space.
  v_words := regexp_split_to_array(btrim(regexp_replace(p_name, '\s+', ' ', 'g')), ' ');
  if array_length(v_words, 1) is null then return btrim(p_name); end if;

  foreach v_w in array v_words loop
    if v_w = '' then continue; end if;
    if array_length(v_words, 1) > 1
       and lower(v_w) = any (v_particles)
       and v_w !~ '[A-Z]' then
      v_out := v_out || lower(v_w);
    else
      v_out := v_out || internal.normalise_name_word(v_w);
    end if;
  end loop;

  return array_to_string(v_out, ' ');
end;
$function$;

comment on function internal.normalise_person_name(text) is
  'The one person-name normaliser. Cleans obviously unformatted input and leaves deliberate spellings -- McDonald, O''Neill, de Silva -- exactly as they are, so a corrected name is never re-spelled.';

-- ---------------------------------------------------------------------------
-- The write boundary
-- ---------------------------------------------------------------------------
--
-- Every table below holds a name a person gave for themselves or a child.
-- teams.display_name, club_pitches.display_name and the fixture identity
-- snapshots are deliberately NOT here: those are club and team names with
-- their own canonical authorities, and person-name rules would corrupt them.

create or replace function internal.normalise_player_names()
returns trigger
language plpgsql
as $function$
begin
  new.first_name := internal.normalise_person_name(new.first_name);
  new.surname := internal.normalise_person_name(new.surname);
  return new;
end;
$function$;

create or replace function internal.normalise_profile_names()
returns trigger
language plpgsql
as $function$
begin
  new.first_name := internal.normalise_person_name(new.first_name);
  new.surname := internal.normalise_person_name(new.surname);
  return new;
end;
$function$;

create or replace function internal.normalise_submitted_names()
returns trigger
language plpgsql
as $function$
begin
  new.submitted_first_name := internal.normalise_person_name(new.submitted_first_name);
  new.submitted_surname := internal.normalise_person_name(new.submitted_surname);
  return new;
end;
$function$;

drop trigger if exists players_normalise_names on public.players;
create trigger players_normalise_names
  before insert or update of first_name, surname on public.players
  for each row execute function internal.normalise_player_names();

drop trigger if exists profiles_normalise_names on public.profiles;
create trigger profiles_normalise_names
  before insert or update of first_name, surname on public.profiles
  for each row execute function internal.normalise_profile_names();

drop trigger if exists guardian_link_requests_normalise_names on public.guardian_link_requests;
create trigger guardian_link_requests_normalise_names
  before insert or update of submitted_first_name, submitted_surname on public.guardian_link_requests
  for each row execute function internal.normalise_submitted_names();

drop trigger if exists player_duplicate_reviews_normalise_names on public.player_duplicate_reviews;
create trigger player_duplicate_reviews_normalise_names
  before insert or update of submitted_first_name, submitted_surname on public.player_duplicate_reviews
  for each row execute function internal.normalise_submitted_names();

-- ---------------------------------------------------------------------------
-- Existing data
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT a bulk re-casing of every stored name. Only rows whose
-- value is entirely lower case or entirely upper case are touched -- input
-- nobody formatted -- and even then only when the change is pure re-casing,
-- so no letter, space or punctuation can move. Everything else, including
-- every mixed-case name, is left exactly as its owner has it.

do $$
declare v_players int; v_profiles int;
begin
  update public.players
  set first_name = internal.normalise_person_name(first_name)
  where first_name is not null
    and (first_name !~ '[A-Z]' or first_name !~ '[a-z]')
    and lower(internal.normalise_person_name(first_name)) = lower(first_name)
    and internal.normalise_person_name(first_name) is distinct from first_name;
  get diagnostics v_players = row_count;

  update public.players
  set surname = internal.normalise_person_name(surname)
  where surname is not null
    and (surname !~ '[A-Z]' or surname !~ '[a-z]')
    and lower(internal.normalise_person_name(surname)) = lower(surname)
    and internal.normalise_person_name(surname) is distinct from surname;

  update public.profiles
  set first_name = internal.normalise_person_name(first_name)
  where first_name is not null
    and (first_name !~ '[A-Z]' or first_name !~ '[a-z]')
    and lower(internal.normalise_person_name(first_name)) = lower(first_name)
    and internal.normalise_person_name(first_name) is distinct from first_name;
  get diagnostics v_profiles = row_count;

  update public.profiles
  set surname = internal.normalise_person_name(surname)
  where surname is not null
    and (surname !~ '[A-Z]' or surname !~ '[a-z]')
    and lower(internal.normalise_person_name(surname)) = lower(surname)
    and internal.normalise_person_name(surname) is distinct from surname;

  raise notice 'Person-name normalisation: % unformatted player first name(s) and % profile first name(s) cleaned. Mixed-case names were left untouched.',
    v_players, v_profiles;
end $$;

do $$
begin
  if internal.normalise_person_name('  callum   krzysik ') <> 'Callum Krzysik' then
    raise exception 'The normaliser does not clean obviously unformatted input.';
  end if;
  if internal.normalise_person_name('McDonald') <> 'McDonald'
     or internal.normalise_person_name('van der Meer') <> 'van der Meer'
     or internal.normalise_person_name('O''Neill') <> 'O''Neill' then
    raise exception 'The normaliser damages a deliberately spelled name.';
  end if;
end $$;
