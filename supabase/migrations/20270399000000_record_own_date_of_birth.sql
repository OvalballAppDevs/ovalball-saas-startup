-- =====================================================================================================
-- SLICE 5 (18/n) -- the missing half of D-S5-1: somewhere to answer
--
-- D-S5-1 gates the authority boundaries on an ESTABLISHED age, and listed as an open question: "the UI
-- to record a date of birth against an existing adult account does not [exist]". Without it the gate
-- is a dead end rather than a prompt -- an invited Site Admin is refused and has nowhere to go, and an
-- existing member surfaced as NEEDS_ATTENTION has no way to clear it.
--
-- So: a person may SUPPLY a date of birth they have never given. They may not change one. Phase 2 ID-5
-- makes it set once by the person and corrected only through `site.users.identity.correct`, and that
-- distinction is the whole point -- a date of birth that can be edited at will is not evidence of
-- anything, and the gate above it would mean nothing.
--
-- The rule lives here rather than in the form, because a form is not a boundary.
-- =====================================================================================================

create or replace function public.record_own_date_of_birth(
  p_date_of_birth date,
  p_first_name text default null,
  p_surname text default null
) returns void language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_existing date;
  v_has_profile boolean;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_date_of_birth is null then
    raise exception 'Enter your date of birth.' using errcode = '22023';
  end if;
  -- Not a validation flourish: a date in the future or centuries back is how an unchecked field
  -- becomes a way to assert whatever the gate above it wants to hear.
  if p_date_of_birth > current_date then
    raise exception 'A date of birth cannot be in the future.' using errcode = '22023';
  end if;
  if p_date_of_birth < current_date - interval '120 years' then
    raise exception 'That date of birth does not look right.' using errcode = '22023';
  end if;

  select true, pr.date_of_birth into v_has_profile, v_existing
    from public.profiles pr where pr.id = v_actor;

  -- Set once. Correcting one is a different act, by somebody else, through a capability that exists
  -- for it -- so this refuses rather than quietly overwriting.
  if v_existing is not null then
    raise exception 'Your date of birth is already on file. Ask Ovalball support to correct it.'
      using errcode = '42501';
  end if;

  if coalesce(v_has_profile, false) then
    update public.profiles set date_of_birth = p_date_of_birth,
           first_name = coalesce(nullif(btrim(p_first_name), ''), first_name),
           surname    = coalesce(nullif(btrim(p_surname), ''), surname)
     where id = v_actor;
  else
    -- Somebody invited to Ovalball who has never been anybody here yet: first name and surname are
    -- NOT NULL on profiles, so this is the minimum identity, and nothing more is asked for.
    if nullif(btrim(p_first_name), '') is null or nullif(btrim(p_surname), '') is null then
      raise exception 'Enter your first name and last name.' using errcode = '22023';
    end if;
    insert into public.profiles (id, first_name, surname, date_of_birth)
    values (v_actor, btrim(p_first_name), btrim(p_surname), p_date_of_birth);
  end if;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('identity.date_of_birth_recorded', v_actor, 'the person supplied their own date of birth',
          jsonb_build_object('established_adult', internal.person_is_established_adult(v_actor)));
end $$;

comment on function public.record_own_date_of_birth(date, text, text) is
  'A person supplies a date of birth they have never given (Phase 2 ID-5, D-S5-1). It cannot change '
  'one already on file -- that is site.users.identity.correct.';

revoke all on function public.record_own_date_of_birth(date, text, text) from public, anon;
grant execute on function public.record_own_date_of_birth(date, text, text) to authenticated;

-- Visible to the person it is about, and to nobody's club: their age is their own business, and the
-- event exists so that a later question about when the answer was given has an answer.
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('identity.date_of_birth_recorded', 'IDENTITY', 'INFO', false, true, false)
on conflict (event_type) do nothing;

do $$
begin
  if not exists (select 1 from public.security_event_types where event_type = 'identity.date_of_birth_recorded') then
    raise exception 'Slice 5: recording a date of birth emits an unregistered event.';
  end if;
  raise notice 'Slice 5: a person can answer the age question, once';
end $$;
