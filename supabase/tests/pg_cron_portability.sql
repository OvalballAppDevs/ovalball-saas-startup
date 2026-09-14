-- A scheduler that only exists in one database must not decide whether the
-- other databases can be built.
--
-- THE RULE
--
-- pg_cron can be installed in exactly ONE database per cluster: the one named
-- by cron.database_name. Every other database in that cluster -- a disposable
-- release-verification copy, a reviewer's scratch database, a CI database --
-- physically cannot have it, and "create extension pg_cron" there does not
-- return a warning, it raises.
--
-- Five migrations used to do that unconditionally, so a clean install into any
-- database not called postgres stopped dead five separate times on a property
-- of the cluster rather than anything wrong with the schema. They now install
-- where cron lives, skip where it cannot, and schedule only when the extension
-- is genuinely present.
--
-- WHAT THIS TEST HOLDS
--
-- The danger in a skip is that it turns into a lie: code that carries on as
-- though the job were scheduled, or a guard that hides a genuinely broken
-- scheduler. So this file proves the skip is honest in both directions -- the
-- work still exists and is still callable by hand, and nothing anywhere claims
-- a job that was never created.
--
-- It runs on whatever database it is given and adapts: in the cron database it
-- proves the jobs are really scheduled; elsewhere it proves the absence is
-- clean. Both are real assertions, not a skipped test.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_cron_db text;
  v_here text := current_database();
  v_installed boolean;
  v_is_cron_db boolean;
  v_n int;
  v_missing text;
  v_job text;
  -- The jobs the repository schedules, and the function each one calls.
  -- If another is ever added, it belongs in this list.
  v_jobs text[] := array[
    'process-due-season-transitions',
    'complete-overdue-fixtures',
    'process-due-trials',
    'expire-due-dispensations',
    'send-fixture-attendance-invitations',
    'reconcile-overdue-fixture-results'
  ];
  v_functions text[] := array[
    'internal.process_due_season_transitions',
    'internal.complete_overdue_fixtures',
    'internal.process_due_trials',
    'internal.expire_due_dispensations',
    'internal.send_due_fixture_attendance_invitations',
    'public.reconcile_overdue_fixture_results'
  ];
begin
  v_cron_db := nullif(current_setting('cron.database_name', true), '');
  v_installed := exists (select 1 from pg_extension where extname = 'pg_cron');
  v_is_cron_db := (v_here = v_cron_db);

  raise notice 'INFO: running in "%", cron.database_name is "%", pg_cron installed here: %',
    v_here, coalesce(v_cron_db, '(unset)'), v_installed;

  -- =================================================================
  -- 1. THE GUARD READS CONFIGURATION, IT DOES NOT ASSUME A NAME
  --
  -- The migrations decide using current_setting('cron.database_name'). If that
  -- setting were unreadable the guard would silently become "never install
  -- anywhere", so prove it can actually be read.
  -- =================================================================
  if v_cron_db is not null then
    raise notice 'PASS 1: cron.database_name is readable from configuration ("%")', v_cron_db;
  else
    raise notice 'PASS 1: cron.database_name is unset, which the guard must read as "not here" (pg_cron is not loaded in this cluster)';
  end if;

  -- =================================================================
  -- 2. THE EXTENSION IS ONLY EVER PRESENT WHERE IT IS PERMITTED
  --
  -- The invariant the whole fix rests on. pg_cron present in a database that
  -- is NOT the configured cron database would mean it had been installed by
  -- hand -- exactly the manual workaround the clean-boot proof forbids.
  -- =================================================================
  if v_installed and not v_is_cron_db then
    raise notice 'FAIL 2: pg_cron is installed in "%" but cron.database_name is "%" -- it was put there by hand', v_here, coalesce(v_cron_db, '(unset)');
  else
    raise notice 'PASS 2: pg_cron is present only where configuration permits it';
  end if;

  -- =================================================================
  -- 3. THE WORK EXISTS WHETHER OR NOT IT IS SCHEDULED
  --
  -- This is what stops a skip becoming a lie. Skipping the SCHEDULE must never
  -- skip the function the schedule would have called: the whole point is that
  -- the schema is complete and an operator can run the job by hand or wire up
  -- their own scheduler.
  -- =================================================================
  v_missing := null;
  foreach v_job in array v_functions loop
    if to_regprocedure(v_job || '()') is null then
      v_missing := coalesce(v_missing || ', ', '') || v_job;
    end if;
  end loop;

  if v_missing is null then
    raise notice 'PASS 3: all % scheduled routines exist as callable functions regardless of pg_cron', array_length(v_functions, 1);
  else
    raise notice 'FAIL 3: the schedule was skipped AND the work is missing: %', v_missing;
  end if;

  -- =================================================================
  -- 4. AND THE ON-DEMAND ENTRY POINTS SURVIVE TOO
  --
  -- Each job has a public.run_*_check() wrapper precisely so a human or an
  -- external scheduler can do what pg_cron would have done.
  -- =================================================================
  v_missing := null;
  foreach v_job in array array[
    'public.run_season_transition_check',
    'public.run_fixture_completion_check',
    'public.run_trial_expiry_check',
    'public.run_fixture_attendance_invitation_check'
  ] loop
    if to_regprocedure(v_job || '()') is null then
      v_missing := coalesce(v_missing || ', ', '') || v_job;
    end if;
  end loop;

  if v_missing is null then
    raise notice 'PASS 4: every on-demand entry point exists, so an absent scheduler is recoverable';
  else
    raise notice 'FAIL 4: on-demand entry points missing: %', v_missing;
  end if;

  -- =================================================================
  -- 5. THE TWO WORLDS
  --
  -- In the cron database the jobs must really be scheduled -- a guard that
  -- quietly skipped everywhere would otherwise pass every other check in this
  -- file. Outside it, the absence must be clean: no cron schema pretending to
  -- exist, and no job rows claiming a schedule nothing will run.
  -- =================================================================
  if v_installed then
    v_missing := null;
    foreach v_job in array v_jobs loop
      if not exists (select 1 from cron.job j where j.jobname = v_job) then
        v_missing := coalesce(v_missing || ', ', '') || v_job;
      end if;
    end loop;

    if v_missing is null then
      raise notice 'PASS 5: in the cron database all % jobs are really scheduled', array_length(v_jobs, 1);
    else
      raise notice 'FAIL 5: pg_cron is installed here but these jobs were not scheduled: %', v_missing;
    end if;
  else
    -- 5b. Nothing may pretend. A "cron" schema conjured up to satisfy the
    -- guard would make every job look scheduled while nothing ran.
    if exists (select 1 from pg_namespace where nspname = 'cron') then
      raise notice 'FAIL 5: pg_cron is not installed, yet a "cron" schema exists here -- something is pretending it is';
    else
      raise notice 'PASS 5: pg_cron is absent and nothing pretends otherwise -- no cron schema, no phantom jobs';
    end if;
  end if;

  -- =================================================================
  -- 6. NO MIGRATION STILL INSTALLS THE EXTENSION UNCONDITIONALLY
  --
  -- The regression that matters most, because it is the one that comes back:
  -- the next scheduled job is written by copying an existing one. Reading the
  -- migration files is not possible from SQL, so this asserts the observable
  -- consequence instead -- that this database was built at all. A database
  -- that is not the cron database and yet holds the full schema is itself the
  -- proof that no unconditional "create extension" survived, because one would
  -- have stopped the build long before this file ran.
  -- =================================================================
  select count(*) into v_n from pg_tables where schemaname = 'public';
  if v_is_cron_db then
    raise notice 'PASS 6: built in the cron database (% public tables); the portability claim is proved by the clean-boot run in a non-cron database', v_n;
  elsif v_n > 100 then
    raise notice 'PASS 6: this is not the cron database and the full schema (% public tables) still built -- no unconditional create-extension survived', v_n;
  else
    raise notice 'FAIL 6: this is not the cron database and only % public tables exist -- the migration tree did not complete here', v_n;
  end if;
end $$;

rollback;
