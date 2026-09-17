-- =====================================================================================================
-- SLICE 7c -- THE AN-3 BOOTSTRAP IS A DECLARED EXCEPTION, NOT A CONSTRAINT SWITCHED OFF
--
-- Found by rehearsing docs/identity-auth/SITE_ADMIN_BOOTSTRAP.md against a production-shaped database,
-- which is the only reason a runbook gets rehearsed.
--
-- The procedure said: drop site_admin_grant_requests_decider_not_requester, write the row where the
-- requester and the approver are the same person, apply the grant, then add the constraint back. The
-- last step cannot succeed. Adding a CHECK revalidates every existing row, and the row the procedure
-- has just written is precisely the one that violates it. So the platform owner would be left, at the
-- end of a documented procedure, with the constraint permanently off and no instruction saying so.
--
-- A constraint that has to be removed to do a legitimate thing is a constraint with an undeclared
-- exception. The exception is declared instead.
--
-- public.site_admin_grant_requests.bootstrap says, in the data, that this row is the one-off AN-3
-- bootstrap. The CHECK permits a self-decided row only when it is set. Nothing in the application can
-- set it: authenticated holds no INSERT or UPDATE on this table at all after 7c, and no RPC writes
-- the column. It is reachable only by the database owner, which is the whole point -- the bootstrap
-- is deliberately something only the platform owner can perform, and now it is something anybody
-- auditing can find:
--
--     select * from public.site_admin_grant_requests where bootstrap;
--
-- That query is the audit trail the previous design could not produce, because "the constraint was
-- off for a while" leaves no trace once it is back on.
-- =====================================================================================================

alter table public.site_admin_grant_requests
  add column if not exists bootstrap boolean not null default false;

comment on column public.site_admin_grant_requests.bootstrap is
  'The one-off AN-3 bootstrap that creates the first additional Full Site Admin, per '
  'docs/identity-auth/SITE_ADMIN_BOOTSTRAP.md. Set ONLY by the platform owner in a direct database '
  'session -- no application role can write this table and no RPC writes this column. It is the single '
  'declared exception to the requester-is-not-the-approver rule, and it is set in the data so that the '
  'exception can be found later rather than being a constraint that was briefly switched off.';

alter table public.site_admin_grant_requests drop constraint if exists site_admin_grant_requests_decider_not_requester;
alter table public.site_admin_grant_requests add constraint site_admin_grant_requests_decider_not_requester
  check (decided_by is null or decided_by <> requested_by or bootstrap);

do $$
declare v_rc text;
begin
  -- The exception must not be reachable from the application, or it is not an exception, it is a hole.
  if has_table_privilege('authenticated','public.site_admin_grant_requests','INSERT')
     or has_table_privilege('authenticated','public.site_admin_grant_requests','UPDATE') then
    raise exception 'Slice 7c: a browser role can write site_admin_grant_requests, so it could set bootstrap';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public','internal') and p.prosrc ~ '\mbootstrap\M'
                and p.proname like 'site\_%') then
    raise exception 'Slice 7c: an RPC references the bootstrap column';
  end if;
  raise notice 'Slice 7c: the AN-3 bootstrap is declared in the data, and only the owner can set it';
end $$;
