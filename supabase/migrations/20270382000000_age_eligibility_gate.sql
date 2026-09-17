-- =====================================================================================================
-- SLICE 5 (1/n) -- D-S5-1: unknown age does not establish adulthood
--
-- `internal.person_is_minor` answers "is this person KNOWN to be under 18". An account with no
-- recorded date of birth therefore answers exactly as a forty-year-old does, and every
-- minor-prohibited gate in Ovalball is written as `minor_prohibited and person_is_minor(...)`, so
-- unknown age has always passed. D-S5-1 closes that at the WRITE boundary.
--
-- The owner resolved the three questions this needed (IDENTITY_AUTH_DECISION_RECORD.md):
--   Q1 a canonical recorded DOB establishing adulthood is sufficient AGE evidence -- it is not, and
--      must never be described as, verified proof of identity or age;
--   Q2 it applies to every role and capability the canonical catalogue marks minor_prohibited,
--      derived from that metadata and never from a second list;
--   Q3 a predicate over the canonical recorded DOB -- no eligibility-state table, and
--      `internal.person_is_minor` is NOT redefined (D-S4-4 reads it).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. The canonical recorded date of birth, and the predicate over it.
--
-- The accessor exists so that the age boundary is stated ONCE. `person_is_minor` already coalesces
-- profiles.date_of_birth with the newest owned player record; the predicate below reuses that
-- function rather than repeating the arithmetic, so the two can never drift to different boundaries.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.person_recorded_date_of_birth(p_user_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.date_of_birth from public.profiles p where p.id = p_user_id),
    (select max(pl.date_of_birth) from public.players pl where pl.user_id = p_user_id)
  );
$$;

comment on function internal.person_recorded_date_of_birth(uuid) is
  'The canonical recorded date of birth for an identity, or null when Ovalball has never been told '
  'one. Same source as internal.person_is_minor, deliberately.';

-- Deliberately NOT named person_is_adult: the whole defect this closes is that people read
-- "not a minor" as "an adult". This name says what it actually answers.
create or replace function internal.person_is_established_adult(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.person_recorded_date_of_birth(p_user_id) is not null
     and not internal.person_is_minor(p_user_id);
$$;

comment on function internal.person_is_established_adult(uuid) is
  'D-S5-1. Does the canonical recorded date of birth establish that this person is currently an '
  'adult? Missing, unusable or minor date of birth -> false. This is an AGE-ELIGIBILITY test over '
  'recorded data; it is NOT verified proof of age or identity, and must not be described as one.';

grant execute on function internal.person_recorded_date_of_birth(uuid) to authenticated;
grant execute on function internal.person_is_established_adult(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. The write boundary.
--
-- internal.grant_role is the narrowest shared canonical point: every route into a role assignment
-- goes through it -- invitation acceptance (legacy and canonical), join requests, team codes, claim
-- approval, site and club admin assignment, and 4G's safeguarding nomination seam. Gating here means
-- a caller cannot go round the rule through REST, an RPC, a server action or a tampered payload,
-- because none of them can create a role assignment any other way.
--
-- GRANDFATHERING. The gate fires on a NEW crossing into minor-prohibited authority, not on the
-- continuation of authority somebody already holds. SEASON_HANDOVER carries a club's existing staff
-- onto next season's team rows, and LEGACY_BACKFILL reconstructs what already existed; refusing
-- either would revoke existing authority at rollover because a date of birth was never recorded,
-- which is exactly what D-S5-1 forbids. Those two sources keep the original known-minor rule.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_src text; v_new text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'grant_role';
  if v_src is null then raise exception 'Slice 5: internal.grant_role is missing.'; end if;

  if v_src ~ 'person_is_established_adult' then
    return;  -- already gated; this migration is re-runnable
  end if;

  v_new := replace(v_src,
$old$  if v_role.minor_prohibited and internal.person_is_minor(v_membership.user_id) then
    raise exception 'The % role cannot be held by someone under 18.', v_role.label using errcode = '23514';
  end if;$old$,
$new$  if v_role.minor_prohibited and internal.person_is_minor(v_membership.user_id) then
    raise exception 'The % role cannot be held by someone under 18.', v_role.label using errcode = '23514';
  end if;
  -- D-S5-1: unknown age is not adulthood. A NEW crossing into minor-prohibited authority needs a
  -- recorded date of birth that establishes the person is an adult. SEASON_HANDOVER and
  -- LEGACY_BACKFILL are continuations of authority already held and keep the older rule, so nobody
  -- loses a role they already have because Ovalball was never told their date of birth.
  if v_role.minor_prohibited
     and p_source not in ('SEASON_HANDOVER', 'LEGACY_BACKFILL')
     and not internal.person_is_established_adult(v_membership.user_id) then
    raise exception 'The % role needs a date of birth on file showing this person is an adult before it can be given.', v_role.label
      using errcode = '23514', hint = 'AGE_ELIGIBILITY_REQUIRED';
  end if;$new$);

  if v_new = v_src then
    raise exception 'Slice 5: could not find the minor-prohibited guard in internal.grant_role to extend.';
  end if;

  execute format(
    'create or replace function internal.grant_role(p_membership_id uuid, p_role_key text, p_team_id uuid, p_source text, p_reason text, p_attributes jsonb default ''{}''::jsonb) returns uuid language plpgsql security definer set search_path to %L as %s',
    'public', quote_literal(v_new));
  raise notice 'Slice 5: internal.grant_role now requires established adulthood for a new minor-prohibited crossing';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. The same rule for a capability override, which is the other way to acquire minor-prohibited
--    authority without a role.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_src text; v_new text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_capability_override';
  if v_src is null then raise exception 'Slice 5: public.set_capability_override is missing.'; end if;
  if v_src ~ 'person_is_established_adult' then return; end if;

  v_new := replace(v_src,
$old$  if p_effect = 'grant' and c.minor_prohibited and internal.person_is_minor(p_user_id) then$old$,
$new$  if p_effect = 'grant' and c.minor_prohibited and not internal.person_is_established_adult(p_user_id) then
    raise exception 'That permission needs a date of birth on file showing this person is an adult.'
      using errcode = '23514', hint = 'AGE_ELIGIBILITY_REQUIRED';
  end if;
  if p_effect = 'grant' and c.minor_prohibited and internal.person_is_minor(p_user_id) then$new$);
  if v_new = v_src then
    raise exception 'Slice 5: could not find the minor-prohibited guard in public.set_capability_override.';
  end if;

  execute format(
    'create or replace function public.set_capability_override(p_user_id uuid, p_capability_key text, p_scope_type text, p_club_id uuid, p_team_id uuid, p_effect text, p_reason text default null, p_expires_at timestamptz default null) returns uuid language plpgsql security definer set search_path to %L as %s',
    'public', quote_literal(v_new));
  raise notice 'Slice 5: public.set_capability_override now requires established adulthood to GRANT a minor-prohibited key';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Assertions. The gate must be where it is claimed to be, and NOT where it would revoke.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'grant_role') !~ 'person_is_established_adult' then
    raise exception 'Slice 5: internal.grant_role is not gated.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_capability_override') !~ 'person_is_established_adult' then
    raise exception 'Slice 5: public.set_capability_override is not gated.';
  end if;

  -- The read path is untouched. A resolver change would retroactively strip authority from every
  -- existing holder whose date of birth was never recorded, which D-S5-1 forbids outright.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision') ~ 'person_is_established_adult' then
    raise exception 'Slice 5: the capability resolver must NOT be gated -- that is retroactive revocation.';
  end if;

  -- Restoring a suspended assignment is continuation, not acquisition.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'transition_role_assignment') ~ 'person_is_established_adult' then
    raise exception 'Slice 5: restoring a suspended role must NOT require established adulthood.';
  end if;

  -- D-S4-4's predicate is untouched.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'person_is_minor') !~ 'interval ''18 years''' then
    raise exception 'Slice 5: internal.person_is_minor has been altered, which D-S5-1 forbids.';
  end if;
end $$;
