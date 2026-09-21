-- =====================================================================
-- WHAT HAPPENS WHEN A PLAYER TURNS EIGHTEEN.
--
-- Today: nothing. The guardian relationship stays active, every guardian keeps
-- exactly the access they had the day before, nobody is told, and the adult
-- player has no way to change it -- `remove_guardian_relationship` asks for
-- `family.relationship.remove` at the club, which is a staff capability, so the
-- one person whose data it is cannot act on it.
--
-- That is the "child to adult handover" the programme recorded at Step 0 and
-- carried to Step 9 unresolved.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO.
--
-- The instruction is explicit that the transition must NOT delete guardians,
-- transfer ownership, silently change permissions or disconnect family records.
-- It does none of those. A guardian relationship is a fact about a family and
-- it survives a birthday; what changes is that the adult it concerns can now
-- decide about it.
--
-- So there are two objects here and no automation:
--
--   1. A deterministic READ of where a player stands relative to the adult
--      boundary, taking the date as a parameter so the rule can be proved at
--      the boundary without waiting for a birthday;
--
--   2. One WRITE, available to the adult player alone, ending a guardian's
--      access over their own record -- audited, reasoned, and touching
--      nothing except that one relationship.
--
-- The proactive half -- noticing a birthday on the day it happens and telling
-- the people involved -- needs a scheduler, and Ovalball has no background
-- processing owner yet. The RULE is complete here and the EXECUTION MECHANISM
-- is deferred deliberately rather than omitted quietly; the state below is
-- exactly what such a scheduler would read.
-- =====================================================================

-- ---------------------------------------------------------------------
-- WHERE A PLAYER STANDS.
--
-- Four states, and "unknown" is one of them: a player with no date of birth on
-- file has not secretly turned eighteen, and saying so is the only honest
-- answer. The safeguarding default elsewhere in the product treats an unknown
-- age on a youth team as protected, and nothing here overrides that -- this
-- function reports, it does not authorise.
-- ---------------------------------------------------------------------
create or replace function public.player_adult_transition(
  p_player_id uuid,
  p_as_of date default current_date
)
returns TABLE(
  state text,
  age integer,
  turns_18_on date,
  days_until integer,
  active_guardians integer,
  has_own_account boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_dob date;
  v_user uuid;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select p.date_of_birth, p.user_id into v_dob, v_user from public.players p where p.id = p_player_id;
  if not found then
    raise exception 'Player not found.' using errcode = 'P0002';
  end if;

  -- WHO MAY ASK. A guardian, the player themselves, or somebody the capability
  -- engine already trusts with this player's family relationships at the club
  -- they play for. No new authority: every branch is a question the estate
  -- already answers.
  -- `v_user is not null and ...` rather than a bare comparison. A player with
  -- no linked account has `user_id = null`, and `null = <uuid>` is NULL, not
  -- false -- so `false or NULL or false` is NULL, `if not NULL` does not fire,
  -- and the refusal below would be skipped for every unrelated caller asking
  -- about a child who has no account. Three-valued logic in an authority check
  -- fails OPEN, which is the one direction it must never fail. This suite's
  -- C6 and C7 found it.
  if not (
    exists (select 1 from public.guardians g
             where g.player_id = p_player_id and g.guardian_user_id = internal.actor() and g.status = 'active')
    or (v_user is not null and v_user = internal.actor())
    or exists (select 1 from internal.player_scopes(p_player_id) s
                where s.place_state = 'ACTIVE'
                  and internal.can('family.relationship.approve', 'club', s.club_id, null, null))
  ) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  age := case when v_dob is null then null else extract(year from age(p_as_of, v_dob))::int end;
  turns_18_on := case when v_dob is null then null else (v_dob + interval '18 years')::date end;
  days_until := case when turns_18_on is null then null else (turns_18_on - p_as_of) end;
  select count(*) into active_guardians from public.guardians
   where player_id = p_player_id and status = 'active';
  has_own_account := v_user is not null;

  state := case
    when v_dob is null then 'UNKNOWN'
    when age >= 18 and active_guardians > 0 then 'ADULT_WITH_GUARDIAN_ACCESS'
    when age >= 18 then 'ADULT'
    -- Ninety days is a window for telling somebody something is coming, not a
    -- rule about authority: nothing changes until the birthday itself.
    when days_until <= 90 then 'APPROACHING_ADULT'
    else 'MINOR'
  end;

  return next;
end;
$$;

revoke all on function public.player_adult_transition(uuid, date) from public;
grant execute on function public.player_adult_transition(uuid, date) to authenticated;

comment on function public.player_adult_transition(uuid, date) is
  'Where one player stands relative to the adult boundary, as of a date. A READ: it authorises nothing '
  'and changes nothing. ADULT_WITH_GUARDIAN_ACCESS is the state a scheduler would act on, and the state '
  'end_my_guardian_access exists to let the adult themselves resolve.';

-- ---------------------------------------------------------------------
-- THE ADULT'S OWN DECISION.
--
-- Narrow on purpose. It ends ONE guardian's access over the caller's OWN
-- player record and does nothing else: the player, their identity, their club
-- membership, their team placement, every other guardian and every unrelated
-- role are untouched, which `supabase/tests/step9_family_and_availability.sql`
-- proves one at a time.
-- ---------------------------------------------------------------------
create or replace function public.end_my_guardian_access(
  p_guardian_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.guardians;
  v_age int;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_not_impersonating();

  select * into g from public.guardians where id = p_guardian_id for update;
  if g.id is null then
    raise exception 'That relationship was not found.' using errcode = 'P0002';
  end if;

  -- IT MUST BE THEIR OWN RECORD. Not their child's, not a team-mate's: the
  -- only person this function will act for is the player the relationship is
  -- about, signed in as themselves.
  if not exists (select 1 from public.players p where p.id = g.player_id and p.user_id = internal.actor()) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  -- AND THEY MUST BE AN ADULT. A fifteen year old cannot dismiss their parent,
  -- and a player with no date of birth on file has not proved they are
  -- eighteen -- the same predicate the rest of the product uses, asked here
  -- rather than reinvented.
  v_age := internal.player_effective_age(g.player_id);
  if v_age is null then
    raise exception 'Ovalball has no date of birth on file for you, so it cannot confirm you are an adult.'
      using errcode = '23514', hint = 'AGE_ELIGIBILITY_REQUIRED';
  end if;
  if v_age < 18 then
    raise exception 'Only an adult player can end a Guardian''s access to their own record.' using errcode = '42501';
  end if;

  if g.state not in ('ACTIVE', 'SUSPENDED') then
    raise exception 'This relationship is not active, so there is nothing to end.' using errcode = '23514';
  end if;

  update public.guardians
     set state = 'REVOKED',
         status = 'revoked',
         revoked_at = now(),
         revoked_by = internal.actor(),
         revocation_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Ended by the player on reaching adulthood'),
         updated_by = internal.actor(),
         updated_at = now()
   where id = p_guardian_id;

  perform internal.emit_security_event('guardian.unlinked', g.guardian_user_id, 'SUCCESS',
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Ended by the player on reaching adulthood'),
    jsonb_build_object('guardian_id', g.id, 'player_id', g.player_id, 'ended_by', 'adult_player'),
    null, null, g.player_id);
end;
$$;

revoke all on function public.end_my_guardian_access(uuid, text) from public;
grant execute on function public.end_my_guardian_access(uuid, text) to authenticated;

comment on function public.end_my_guardian_access(uuid, text) is
  'An ADULT player ending one Guardian''s access to their own record. Touches that relationship and '
  'nothing else -- not the player, the membership, the placement, another Guardian or any role. The '
  'relationship is revoked with a reason, never deleted: a family fact survives a birthday.';

do $guard$
declare v_def text;
begin
  -- The adult predicate must be the canonical one, not a second age calculator.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'end_my_guardian_access';
  if position('internal.player_effective_age' in v_def) = 0 then
    raise exception 'end_my_guardian_access does not use the canonical age predicate.';
  end if;
  if v_def ~ 'date_of_birth' then
    raise exception 'end_my_guardian_access reads a date of birth directly instead of asking the predicate.';
  end if;

  -- And it must touch exactly one table.
  if v_def ~ 'update public\.(players|club_memberships|player_team_memberships|role_assignments)' then
    raise exception 'end_my_guardian_access writes to something other than the relationship it was asked about.';
  end if;

  if to_regprocedure('public.player_adult_transition(uuid,date)') is null then
    raise exception 'the adult transition resolver does not exist';
  end if;
end;
$guard$;
