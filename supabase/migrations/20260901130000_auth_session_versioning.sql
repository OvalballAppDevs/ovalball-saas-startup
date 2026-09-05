-- Auth session compatibility versioning. Deliberately separate from
-- application release versioning (package.json version / build id, which
-- changes on every ordinary deploy and must NEVER force a re-login) --
-- this only changes when Ovalball intentionally ships a security- or
-- session-format-breaking release. The compatibility number itself lives
-- in application code (lib/auth/session-version.ts), never in this
-- table or any user-editable row -- this table only records, per user,
-- which version their most recently confirmed session was issued/
-- refreshed under, so proxy.ts can compare it against the current
-- required version on every request without trusting anything the
-- browser sends.

create table public.user_session_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null,
  set_at timestamptz not null default now()
);

comment on table public.user_session_versions is
  'One row per user: the AUTH_SESSION_VERSION their session was last confirmed compatible with. Written only by record_session_version() (called right after a successful sign-in, and opportunistically backfilled by proxy.ts for a user who authenticated before this table existed). A missing row is treated as compatible with the current version -- shipping this feature must not force every existing session to re-authenticate, only a later deliberate version bump does.';

alter table public.user_session_versions enable row level security;

create policy user_session_versions_select_self on public.user_session_versions for select
  using (user_id = auth.uid());

-- No insert/update/delete policy for `authenticated` -- this is
-- application/security configuration, not a user-editable preference
-- (the brief's own explicit requirement). record_session_version() is
-- the only write path, and even that only ever writes the CALLER's own
-- row, never an arbitrary target.

create function public.record_session_version(p_version integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  insert into public.user_session_versions (user_id, version, set_at)
  values (auth.uid(), p_version, now())
  on conflict (user_id) do update set version = excluded.version, set_at = now();
end;
$$;

comment on function public.record_session_version(integer) is
  'Records the AUTH_SESSION_VERSION the caller''s own current session is compatible with. p_version is passed by server code (lib/auth/session-version.ts''s AUTH_SESSION_VERSION constant) -- the caller cannot claim compatibility with a version their code was not actually built against, since this runs from server-controlled call sites only (the auth callback route, and proxy.ts''s lazy backfill), never from client-submitted input.';

revoke execute on function public.record_session_version(integer) from public;
grant execute on function public.record_session_version(integer) to authenticated;
