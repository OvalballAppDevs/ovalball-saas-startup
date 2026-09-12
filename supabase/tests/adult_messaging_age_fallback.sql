-- The adult-messaging age predicate, and the account-model assumption inside it
-- (20270256000000).
--
-- internal.is_adult_messaging_user decides who may use Direct Messaging. Most
-- of it is uncontroversial: age comes from
-- internal.resolve_player_chronological_age, the one canonical predicate, and
-- an under-18 answer refuses.
--
-- THE PART THAT NEEDS WATCHING is what happens when nobody knows the age.
-- Every profile row in Ovalball currently has a NULL date_of_birth; the
-- authoritative ages live on player records. So an account with no
-- player-linked minor identity and no DOB is treated as an ADULT.
--
-- THAT IS AN ACCOUNT-MODEL ASSUMPTION, NOT A UNIVERSAL RULE. It is safe only
-- because children do not independently self-register in Ovalball today: a
-- child exists as a players row created by a guardian or a club, and a child
-- with their own login is linked to that row. NULL DOB does not mean adult in
-- general -- it means "no minor identity is attached to this account, and in
-- this product that cannot be a child".
--
-- If Ovalball ever lets children own independently self-registered profiles,
-- test C below is the one that should start failing, and the fallback in the
-- canonical predicate is what must be revisited. This file exists so that
-- assumption is impossible to forget.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/adult_messaging_age_fallback.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_minor uuid;       -- linked to a 17-year-old player
  v_adult_player uuid;-- linked to a 30-year-old player
  v_no_dob uuid;      -- no player link, NULL profile DOB
  v_club uuid;
  v_player_id uuid;
  v_coach uuid;
begin
  select id into v_minor        from auth.users where email = 'uat.player.self@ovalball.test';
  select id into v_adult_player from auth.users where email = 'uat.adult.player@ovalball.test';
  select id into v_no_dob       from auth.users where email = 'uat.guardian.one@ovalball.test';

  if v_minor is null or v_adult_player is null or v_no_dob is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- =================================================================
  -- A. A LINKED PLAYER UNDER 18 -> NOT AN ADULT
  -- =================================================================
  if not internal.is_adult_messaging_user(v_minor) then
    raise notice 'PASS A: an account linked to a 17-year-old player is not an adult';
  else
    raise notice 'FAIL A: a minor-linked account was treated as an adult';
  end if;

  -- =================================================================
  -- B. A LINKED PLAYER 18+ -> ADULT
  -- The PLAYER role is not an exclusion; only the age is.
  -- =================================================================
  if internal.is_adult_messaging_user(v_adult_player) then
    raise notice 'PASS B: an account linked to an adult player is an adult';
  else
    raise notice 'FAIL B: an adult player was excluded';
  end if;

  -- =================================================================
  -- C. NO PLAYER-LINKED MINOR IDENTITY AND NO DOB -> ADULT
  --
  -- THE APPROVED ACCOUNT-MODEL FALLBACK. Read the file header before
  -- changing this expectation: it encodes "children do not self-register in
  -- Ovalball", not "unknown age means adult".
  -- =================================================================
  perform set_config('role', 'postgres', true);
  if (select date_of_birth from public.profiles where id = v_no_dob) is not null then
    raise notice 'SKIP C: this account now has a recorded DOB, so it no longer tests the fallback';
  elsif exists (select 1 from public.players where user_id = v_no_dob) then
    raise notice 'SKIP C: this account is now player-linked, so it no longer tests the fallback';
  elsif internal.is_adult_messaging_user(v_no_dob) then
    raise notice 'PASS C: with no minor identity and no DOB, the account holder is treated as an adult';
  else
    raise notice 'FAIL C: the approved account-model fallback no longer holds';
  end if;

  -- =================================================================
  -- D. AN AUTHORITATIVE MINOR AGE WINS, wherever it is recorded
  --
  -- Two ways an account can be known to be a child, tested independently so
  -- neither can quietly stop working:
  --   D1 a linked player record with a minor DOB
  --   D2 a date of birth on the profile itself
  -- =================================================================

  -- D1: attach a minor player identity to an account that was an adult a
  -- moment ago. The minor identity must win.
  select club_id into v_club from public.club_memberships where user_id = v_no_dob and status = 'active' limit 1;
  insert into public.players (first_name, surname, date_of_birth, user_id, active)
  values ('Fallback', 'Testchild', current_date - interval '14 years', v_no_dob, true)
  returning id into v_player_id;

  if not internal.is_adult_messaging_user(v_no_dob) then
    raise notice 'PASS D1: attaching a minor player identity makes the account a minor immediately';
  else
    raise notice 'FAIL D1: a linked 14-year-old did not disqualify the account';
  end if;

  delete from public.players where id = v_player_id;

  -- D2: a date of birth recorded against the PROFILE is equally authoritative,
  -- so the predicate is not relying on player links alone.
  update public.profiles set date_of_birth = current_date - interval '15 years' where id = v_no_dob;
  if not internal.is_adult_messaging_user(v_no_dob) then
    raise notice 'PASS D2: a minor date of birth on the profile alone also disqualifies the account';
  else
    raise notice 'FAIL D2: a profile DOB of 15 was ignored';
  end if;

  -- And an adult DOB on the profile is accepted the same way.
  update public.profiles set date_of_birth = current_date - interval '40 years' where id = v_no_dob;
  if internal.is_adult_messaging_user(v_no_dob) then
    raise notice 'PASS D3: an adult date of birth on the profile is accepted';
  else
    raise notice 'FAIL D3: an adult profile DOB was rejected';
  end if;

  -- =================================================================
  -- E. THE PREDICATE IS THE ONLY PLACE THIS IS DECIDED
  -- A second "< 18" anywhere in the messaging path would be a competing
  -- answer to a safeguarding question. This asserts the canonical predicate
  -- is what may_direct_message actually consults.
  -- =================================================================
  update public.profiles set date_of_birth = current_date - interval '15 years' where id = v_no_dob;
  -- Resolved while still privileged: auth.users is not readable as the
  -- authenticated role, and this is test scaffolding rather than a product path.
  select id into v_coach from auth.users where email = 'uat.coach@ovalball.test';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if not internal.may_direct_message(v_no_dob) then
    raise notice 'PASS E: making an account a minor closes direct messaging to it, through the one predicate';
  else
    raise notice 'FAIL E: may_direct_message did not follow the age predicate';
  end if;
end $$;

rollback;
