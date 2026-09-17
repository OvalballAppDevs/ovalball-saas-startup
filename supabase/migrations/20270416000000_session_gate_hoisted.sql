-- =====================================================================================================
-- SLICE 6 (13/n) -- the session gate is evaluated ONCE per statement, not once per row
--
-- The RESTRICTIVE policy added in 20270409000000 read:
--
--     using (internal.session_ok())
--
-- which PostgreSQL evaluates PER ROW. internal.session_ok() is STABLE, but it is a SECURITY DEFINER
-- plpgsql function, so it is neither inlined nor hoisted out of the qual on its own.
--
-- Measured on a gated table with 5,000 rows: 171.3 ms with the gate, 0.4 ms without it. That is
-- 0.034 ms per row of pure overhead, on 209 tables, on every query the product makes -- a platform-wide
-- regression introduced by a security control, which is the worst way to get one.
--
-- Wrapping it in a scalar sub-select turns it into an InitPlan: computed once, then reused. It is the
-- same trick already used throughout this schema for `(select auth.uid())`, and it changes nothing
-- about WHAT is decided -- the function has no arguments and does not vary by row, so evaluating it
-- once per statement is not an approximation of the per-row answer, it IS the per-row answer.
--
-- This is the fourth time in this programme that a per-row resolver call has been found by measuring
-- rather than by reading. It is worth measuring every time.
-- =====================================================================================================

do $$
declare
  r record;
  v_setup constant text[] := array['profiles','account_security_state','mfa_enforcement_policy'];
  v_n int := 0;
begin
  for r in
    select c.relname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
     where p.polname = 'session_ok_required'
     order by c.relname
  loop
    execute format('drop policy session_ok_required on public.%I', r.relname);
    if r.relname = any (v_setup) then
      execute format($f$
        create policy session_ok_required on public.%I
          as restrictive for all to authenticated
          using ((select internal.session_live_only()))
          with check ((select internal.session_live_only()))$f$, r.relname);
    else
      execute format($f$
        create policy session_ok_required on public.%I
          as restrictive for all to authenticated
          using ((select internal.session_ok()))
          with check ((select internal.session_ok()))$f$, r.relname);
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'Slice 6: % session gates hoisted to one evaluation per statement', v_n;
end $$;

do $$
declare v_unhoisted int;
begin
  -- A gate that is not wrapped is a gate that runs per row. Named here so a future edit that drops the
  -- wrapper fails the migration rather than quietly costing the platform 30 microseconds a row.
  select count(*) into v_unhoisted
    from pg_policy p
   where p.polname = 'session_ok_required'
     and pg_get_expr(p.polqual, p.polrelid) !~ '\( SELECT internal\.session_(ok|live_only)';
  if v_unhoisted > 0 then
    raise exception 'Slice 6: % session gate(s) still call the predicate per row.', v_unhoisted;
  end if;
  raise notice 'Slice 6: every session gate is hoisted';
end $$;
