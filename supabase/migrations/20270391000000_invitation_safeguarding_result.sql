-- =====================================================================================================
-- SLICE 5 (10/n) -- 4G's nomination seam returns the assignment id, not a document
--
-- redeem_invitation assigned internal.enter_safeguarding_nomination's result straight into a jsonb
-- variable. The seam returns the new role_assignments id, so the safeguarding path failed at the
-- point it should have succeeded. Fixed by naming what it returns.
-- =====================================================================================================
do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  v := replace(v,
E'    v_result := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>''officer_type'',''primary''),
      ''SAFEGUARDING_APPOINTMENT'', v.id, ''accepted invitation'');
    v_result := coalesce(v_result, ''{}''::jsonb) || jsonb_build_object(''outcome'',''PENDING_CONFIRMATION'');',
E'    v_id := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>''officer_type'',''primary''),
      ''SAFEGUARDING_APPOINTMENT'', v.id, ''accepted invitation'');
    v_result := jsonb_build_object(''outcome'',''PENDING_CONFIRMATION'',''assignment_id'',v_id);');
  -- v_id is already declared for the duplicate lookup; reuse rather than add a variable.
  v := replace(v, '  v_existing uuid;', E'  v_existing uuid;\n  v_id uuid;');
  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='redeem_invitation') !~ 'assignment_id' then
    raise exception 'Slice 5: the safeguarding outcome does not report the assignment it created.';
  end if;
end $$;
