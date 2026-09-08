-- Adding an identity from the Rugby Union catalogue adds a Rugby Union identity.
--
-- WHAT WAS WRONG
--
-- create_canonical_team_type wrote the identity and nothing else, so it had no
-- per-code mapping and canonical_team_types_by_code fell through to its
-- positive default: offered in BOTH codes. A Site Admin adding a missing union
-- age grade silently offered it to every league club too, and the only way to
-- find out was to go and look at the other catalogue.
--
-- Now the code the administrator is working in is part of the request, and the
-- other code is recorded as NOT_OFFERED with a note saying why. That is a
-- statement about availability, not about the other sport's rugby: the
-- identity still exists, and a later piece of regulatory research can change
-- the mapping without recreating anything.

drop function if exists public.create_canonical_team_type(text, text, text, text, boolean);

create or replace function public.create_canonical_team_type(
  p_category text, p_age_group text, p_gender text,
  p_fixed_squad_designation text default null, p_allows_squads boolean default false,
  p_rugby_code text default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_key text;
  v_label text;
  v_new_id uuid;
  v_sort_order integer;
  v_other text;
begin
  if not internal.can_manage_team_catalogue() then
    raise exception 'Only a Site Admin with Team Directory management access may add a global team type.' using errcode = '42501';
  end if;
  if p_rugby_code is not null and p_rugby_code not in ('union', 'league') then
    raise exception 'A team identity is added to Rugby Union or Rugby League.' using errcode = '23514';
  end if;

  v_label := internal.compute_canonical_type_label(p_category, p_age_group, p_gender, p_fixed_squad_designation);
  v_key := trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'));

  select coalesce(max(sort_order), 0) + 1 into v_sort_order from public.canonical_team_types;

  begin
    insert into public.canonical_team_types
      (key, label, category, age_group, gender, fixed_squad_designation, allows_squads, sort_order, is_active, created_by, updated_by)
    values
      (v_key, v_label, p_category, p_age_group, p_gender, p_fixed_squad_designation, p_allows_squads, v_sort_order, true, auth.uid(), auth.uid())
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception 'This exact team identity (%) already exists in the Team Directory.', v_label using errcode = 'P0001';
  end;

  -- The catalogue it was added from is the catalogue it belongs to. Without
  -- this the by-code view's positive default would offer it to both codes.
  if p_rugby_code is not null then
    v_other := case when p_rugby_code = 'union' then 'league' else 'union' end;
    insert into public.regulatory_team_type_mappings (canonical_team_type_id, rugby_code, mapping_state, notes)
    values (v_new_id, v_other, 'NOT_OFFERED',
      format('Added to the %s catalogue by a Site Admin. Not offered in %s unless regulatory research establishes an equivalent.',
             case when p_rugby_code = 'union' then 'Rugby Union' else 'Rugby League' end,
             case when v_other = 'union' then 'Rugby Union' else 'Rugby League' end))
    on conflict (canonical_team_type_id, rugby_code) do nothing;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('canonical_team_types', v_new_id, 'insert', auth.uid(),
    jsonb_build_object('key', v_key, 'label', v_label, 'category', p_category, 'age_group', p_age_group,
                       'gender', p_gender, 'fixed_squad_designation', p_fixed_squad_designation,
                       'rugby_code', p_rugby_code));

  return v_new_id;
end;
$function$;

comment on function public.create_canonical_team_type(text, text, text, text, boolean, text) is
  'Adds a canonical team identity to ONE rugby code''s catalogue. The other code is recorded as NOT_OFFERED, because the by-code view''s default is to offer, and a union age grade must not quietly appear for every league club.';

grant execute on function public.create_canonical_team_type(text, text, text, text, boolean, text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_canonical_team_type'
      and pg_get_function_identity_arguments(p.oid) !~ 'p_rugby_code'
  ) then
    raise exception 'A code-blind overload of create_canonical_team_type survives, so an identity can still be added to both catalogues by accident.';
  end if;
end $$;
