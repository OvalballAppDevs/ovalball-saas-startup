-- Published content should not be signed by an account that was never a person.
--
-- WHAT HAPPENED
--
-- Two Rugby Hub content migrations (20270255000000 glossary, 20270257000000
-- officiating) needed an author to hang published_by/reviewed_by on, and each
-- minted one for itself:
--
--   hub-admin-glossary-<uuid>@ovalball.test
--   hub-admin-officiating-<uuid>@ovalball.test
--
-- That ran everywhere the migrations ran, production included, so a live
-- auth.users table ended up holding two accounts on a TEST domain. They are
-- inert -- no password, no linked identity, no session, no role, no club
-- membership, never signed in -- but they are not nothing: between them they
-- own the published_by and reviewed_by of real, published Hub content.
--
-- So this is deliberately NOT a delete. Deleting them would either break the
-- foreign keys or strip the authorship from content people can read. The
-- authorship is moved to the identity that should have had it all along --
-- the same canonical system author every other Hub import migration uses --
-- and only then are the scaffold accounts removed.
--
-- WHY THE GUARD IS SHAPED LIKE THIS
--
-- The scaffold email embeds a uuid generated per database, so the address
-- differs in every environment and no fixed id can be targeted. Matching the
-- address pattern alone would be far too blunt a weapon to point at
-- auth.users, so the pattern is only the first of six conditions: an account
-- is touched only if it ALSO has no usable password, no auth identity, no
-- session, no club membership and no site-admin row. A real person fails that
-- test on the first condition they meet.
--
-- Running this on every environment rather than only production is the point:
-- a fresh install still creates the scaffold, and this cleans up after it, so
-- no new database inherits the problem.

do $$
declare
  v_canonical uuid;
  v_scaffold  uuid[];
  v_ref       record;
  v_moved     bigint := 0;
  v_n         bigint;
begin
  -- The one identity Hub content should be attributed to. Resolved the same
  -- lookup-or-create way the import migrations resolve it, so this works on a
  -- database where the Hub migrations have run and on one where they have not.
  select id into v_canonical
  from auth.users
  where email = 'rugby-hub-content-import@system.ovalball.internal';

  if v_canonical is null then
    v_canonical := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (v_canonical, 'rugby-hub-content-import@system.ovalball.internal', '',
            now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  end if;

  -- Six conditions, not one. Pattern first, then five separate proofs that the
  -- account has never been and could never be used by a person.
  select coalesce(array_agg(u.id), '{}')
    into v_scaffold
  from auth.users u
  where u.email like 'hub-admin-%@ovalball.test'
    and coalesce(u.encrypted_password, '') = ''
    and not exists (select 1 from auth.identities i where i.user_id = u.id)
    and not exists (select 1 from auth.sessions s where s.user_id = u.id)
    and not exists (select 1 from public.club_memberships m where m.user_id = u.id)
    and not exists (select 1 from public.site_admins a where a.user_id = u.id);

  if array_length(v_scaffold, 1) is null then
    raise notice 'No Hub scaffold identities present -- nothing to do.';
    return;
  end if;

  raise notice 'Reassigning content authored by % Hub scaffold identity/identities.',
    array_length(v_scaffold, 1);

  -- The profile row is keyed BY the user id, so it cannot be repointed without
  -- colliding with the canonical author's own profile. It is scaffold in the
  -- same sense the account is, and goes with it.
  delete from public.profiles p where p.id = any(v_scaffold);

  -- Every remaining reference is moved, discovered from the catalogue rather
  -- than listed. A hand-written list of columns would silently miss the next
  -- table that records who published something.
  for v_ref in
    select n.nspname as sch, c.relname as tbl, a.attname as col
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(k.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = ck.attnum
    where k.contype = 'f'
      and k.confrelid = 'auth.users'::regclass
      -- never a key column: moving one of those is a different operation
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.oid and i.indisprimary
          and a.attnum = any (i.indkey))
  loop
    execute format('update %I.%I set %I = $1 where %I = any($2)',
                   v_ref.sch, v_ref.tbl, v_ref.col, v_ref.col)
      using v_canonical, v_scaffold;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
  end loop;

  raise notice 'Moved % authorship reference(s) to the canonical system author.', v_moved;

  -- Only now, with nothing pointing at them. These accounts have no identity
  -- and no session, so there is no auth state anywhere else to fall out of
  -- step -- which is exactly why removing them here is safe rather than
  -- something that needs an out-of-band admin operation.
  delete from auth.users u where u.id = any(v_scaffold);

  if exists (select 1 from auth.users where email like 'hub-admin-%@ovalball.test') then
    raise exception 'Hub scaffold identities still present after cleanup.';
  end if;
end $$;

-- Proof, in the migration, that nothing was orphaned on the way through.
do $$
declare v_orphans bigint := 0; v_ref record; v_n bigint;
begin
  for v_ref in
    select n.nspname as sch, c.relname as tbl, a.attname as col
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(k.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = ck.attnum
    where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
  loop
    execute format(
      'select count(*) from %I.%I t where t.%I is not null
         and not exists (select 1 from auth.users u where u.id = t.%I)',
      v_ref.sch, v_ref.tbl, v_ref.col, v_ref.col) into v_n;
    v_orphans := v_orphans + v_n;
  end loop;

  if v_orphans > 0 then
    raise exception 'Cleanup left % reference(s) pointing at a user that no longer exists.', v_orphans;
  end if;
  raise notice 'No dangling user references remain.';
end $$;
