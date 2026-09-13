-- ===========================================================================
-- TWO WEEKS OUT, OVALBALL ASKS WHO IS COMING
-- ===========================================================================
--
-- A club should not have to remember to chase availability. Roughly two weeks
-- before a fixture, everyone who is legitimately entitled to answer for a
-- player in it gets asked once, and the notification takes them straight to
-- that fixture's Match Centre to answer.
--
-- WHAT THIS DELIBERATELY DOES NOT BUILD
--
-- No second notification engine, no second recipient model, no second
-- scheduler. Every one of those already exists in Main and is canonical:
--
--   * recipients      internal.fixture_audience_recipients(fixture, audience)
--                     -- the same safeguarding-aware resolver the staff
--                     attendance reminder uses. Active guardians always; the
--                     player themselves only at 18+, or 16-17 where guardians
--                     have granted direct_coach_communication. Having a login
--                     is not the test and never has been.
--
--   * the audience    'ATTENDANCE_REMINDER', which means "has no canonical
--                     response yet". Somebody who has already answered --
--                     attending, cannot attend, or unsure -- is not chased.
--
--   * delivery        public.notifications, gated per recipient by the same
--                     preference machinery every other notification type
--                     goes through. An opted-out user is skipped there, not
--                     here.
--
--   * scheduling      pg_cron, exactly as complete-overdue-fixtures,
--                     process-due-season-transitions and expire-due-
--                     dispensations already do.
--
-- So what is actually new is one question: which fixtures are due to be asked
-- about, and who has already been asked.
--
-- WHY A LEDGER RATHER THAN A FLAG ON THE FIXTURE
--
-- The audience is not fixed at the moment the window opens. A player can join
-- the squad twelve days out, a guardian link can be approved eleven days out,
-- and a call-up can be approved the week of the match. A single
-- "invitations_sent_at" column on the fixture would ask the early joiners and
-- silently never ask anybody who arrived afterwards. Recording who has been
-- asked, per person per fixture, means the job stays idempotent for people
-- already invited while still reaching somebody who became eligible later.
--
-- It is also the honest audit answer to "was I ever asked?", which is a
-- question a club will be asked by a parent.
-- ===========================================================================

create table if not exists public.fixture_attendance_invitations (
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_at timestamptz not null default now(),
  primary key (fixture_id, user_id)
);

comment on table public.fixture_attendance_invitations is
  'Who has already been asked to confirm availability for a fixture, so the two-week invitation job is idempotent per person rather than per fixture. Not a communications log and not a permission: it records that an ask happened, nothing more. A row here never implies the person still holds authority to answer -- that is resolved live from the canonical guardian/consent model every time.';

alter table public.fixture_attendance_invitations enable row level security;

-- Deliberately no policy granting SELECT to authenticated. This table says
-- which adults are connected to which fixture; nobody reads it from the
-- browser. The job below writes it as a definer, and Site Admin reads it
-- through the existing admin surfaces if it is ever needed.

create index if not exists fixture_attendance_invitations_fixture_idx
  on public.fixture_attendance_invitations (fixture_id);

-- ---------------------------------------------------------------------------
-- Which fixtures are due to be asked about?
-- ---------------------------------------------------------------------------
--
-- The window opens 14 days before kickoff and stays open until the fixture
-- happens. It is a window rather than a single day on purpose: a job that only
-- fired on exactly day 14 would silently skip every fixture created inside
-- fourteen days, which in club rugby is a great many of them.
--
-- CANCELLED and COMPLETED fixtures are excluded. Asking whether somebody can
-- make a match that is not happening is worse than not asking.
create or replace function internal.fixtures_due_attendance_invitation()
returns table (fixture_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select f.id
  from public.fixtures f
  where f.cancelled_at is null
    and f.status not in ('Completed')
    and f.kickoff_date >= current_date
    and f.kickoff_date <= current_date + 14;
$$;

comment on function internal.fixtures_due_attendance_invitation is
  'Fixtures inside the two-week availability window: still to be played, not cancelled, kicking off within the next 14 days. A window rather than a single day, so a fixture added nine days out is still asked about.';

revoke all on function internal.fixtures_due_attendance_invitation() from public;

-- ---------------------------------------------------------------------------
-- The job
-- ---------------------------------------------------------------------------
--
-- Returns the number of invitations actually sent, so the on-demand wrapper
-- and the tests can assert on a real figure rather than a side effect.
--
-- The insert into notifications and the insert into the ledger happen in the
-- same statement chain within one transaction: either a person was asked and
-- recorded as asked, or neither.
create or replace function internal.send_due_fixture_attendance_invitations()
returns integer
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_sent integer := 0;
  v_fixture record;
  v_inserted integer;
begin
  for v_fixture in
    select f.id,
           f.kickoff_date,
           f.kickoff_time,
           coalesce(t.display_name, 'your team') as team_label
    from public.fixtures f
    join internal.fixtures_due_attendance_invitation() d on d.fixture_id = f.id
    left join public.teams t on t.id = f.owning_team_id
  loop
    with eligible as (
      -- 'ATTENDANCE_REMINDER' is the audience meaning "no canonical response
      -- yet". Resolved fresh on every run, so somebody who answers between
      -- two runs stops being eligible without any bookkeeping here.
      select r.user_id
      from internal.fixture_audience_recipients(v_fixture.id, 'ATTENDANCE_REMINDER') r
      where not exists (
        select 1 from public.fixture_attendance_invitations i
        where i.fixture_id = v_fixture.id and i.user_id = r.user_id
      )
    ),
    recorded as (
      insert into public.fixture_attendance_invitations (fixture_id, user_id)
      select v_fixture.id, e.user_id from eligible e
      on conflict do nothing
      returning user_id
    )
    insert into public.notifications (user_id, type, title, body, data)
    select
      rec.user_id,
      'fixture_attendance_invitation',
      'Can you make the match?',
      v_fixture.team_label
        || ' play on '
        || to_char(v_fixture.kickoff_date, 'FMDay FMDD FMMonth')
        || coalesce(', kick-off ' || to_char(v_fixture.kickoff_time, 'HH24:MI'), '')
        || '. Let the club know if you can make it.',
      jsonb_build_object('fixture_id', v_fixture.id)
    from recorded rec;

    get diagnostics v_inserted = row_count;
    v_sent := v_sent + v_inserted;
  end loop;

  return v_sent;
end;
$$;

comment on function internal.send_due_fixture_attendance_invitations is
  'Asks every legitimate outstanding participant/guardian to confirm availability for each fixture inside the two-week window, once each. Recipients come from internal.fixture_audience_recipients -- the same safeguarding-aware resolver the staff reminder uses -- never from a list computed here. Idempotent per person per fixture via public.fixture_attendance_invitations, so a person who becomes eligible later is still asked while everybody already asked is not asked twice. The notification deep-links to that fixture''s Match Centre by fixture_id.';

revoke all on function internal.send_due_fixture_attendance_invitations() from public;

-- ---------------------------------------------------------------------------
-- On-demand trigger, mirroring public.run_fixture_completion_check()
-- ---------------------------------------------------------------------------
create or replace function public.run_fixture_attendance_invitation_check()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may manually trigger the attendance invitation check.' using errcode = '42501';
  end if;
  return internal.send_due_fixture_attendance_invitations();
end;
$$;

grant execute on function public.run_fixture_attendance_invitation_check() to authenticated;

-- Local-only scheduling, consistent with every other pg_cron job in this
-- repository: provisioning the equivalent on the REMOTE Supabase project is a
-- deployment step for whoever operates it. Daily rather than every 15 minutes
-- -- this is a two-week horizon, and asking a family about the same match more
-- often than once a day would be a defect even if the ledger made it
-- harmless.
--
-- pg_cron can only be installed in the single database named by
-- cron.database_name, so in any other database -- a disposable release
-- verification copy, a reviewer's scratch database -- the attempt is not
-- redundant but impossible, and doing it unconditionally stops the whole
-- migration tree on a property of the cluster rather than a fault in this
-- schema. Install where cron lives, skip where it cannot, and schedule only
-- when the extension is genuinely present. The invitation machinery above is
-- complete either way, and public.run_fixture_attendance_invitation_check()
-- still runs it on demand.
do $$
begin
  if current_database() = nullif(current_setting('cron.database_name', true), '') then
    execute 'create extension if not exists pg_cron';
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'send-fixture-attendance-invitations',
      '0 9 * * *',
      $job$select internal.send_due_fixture_attendance_invitations()$job$);
  else
    raise notice 'pg_cron is not installed in %; send-fixture-attendance-invitations was not scheduled.', current_database();
  end if;
end $$;
