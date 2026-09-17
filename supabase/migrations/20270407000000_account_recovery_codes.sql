-- =====================================================================================================
-- SLICE 6 (4/n) -- recovery codes (Phase 2 Y.3, G)
--
-- Ten codes, ten Crockford characters each, shown ONCE at the moment they are generated and never
-- again. What is stored is HMAC-SHA256(pepper, normalised code), so the table is not a list of codes --
-- it cannot be read back by anybody, including a Full Site Admin, including whoever holds a copy of the
-- database. That is the whole design: G says a recovery code is a credential the person holds, not a
-- record Ovalball keeps.
--
-- A SEPARATE PEPPER from Slice 5's invitation codes. They use the same alphabet and the same normaliser,
-- which is deliberate -- a person typing a code should not have to know which kind it is -- but sharing
-- the key would mean a leak of one credential class compromises the other, and there is no reason to
-- accept that.
--
-- WHAT A RECOVERY CODE DOES NOT DO: it never grants AAL2. Redeeming one deletes the factors and leaves
-- the session at AAL1, forced to enrol again (G). A code that could hand out AAL2 would be a second,
-- weaker password for the very accounts MFA exists to protect.
-- =====================================================================================================

create table if not exists public.account_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hmac  bytea not null,
  batch_id   uuid not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint account_recovery_codes_unique unique (user_id, code_hmac)
);

create index if not exists account_recovery_codes_unused_idx
  on public.account_recovery_codes (user_id) where used_at is null;

comment on table public.account_recovery_codes is
  'Phase 2 Y.3. HMAC of each code, never the code. Nothing can read a recovery code back out of Ovalball.';

-- RLS on with NO policies, and no grants: not even the owner may select their own hashes. There is
-- nothing a browser could correctly do with this table, so it is reachable only through definer
-- functions. (PG-9 additionally forbids UPDATE/DELETE privilege for any application role.)
alter table public.account_recovery_codes enable row level security;
revoke all on public.account_recovery_codes from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The pepper. Its own secret, in Vault, readable only by definer functions owned by postgres.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'recovery_code_pepper') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'recovery_code_pepper',
      'Phase 2 G. HMAC key for account recovery codes. Separate from the invitation code pepper on '
      'purpose: one credential class leaking must not compromise the other.');
  end if;
end $$;

create or replace function internal.recovery_code_pepper()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'recovery_code_pepper';
  if v is null then
    -- Refusing is the only safe answer. A missing pepper silently becoming an empty key would make
    -- every stored hash reproducible by anyone holding the table.
    raise exception 'The recovery code pepper is missing.' using errcode = 'P0001';
  end if;
  return v;
end $$;

revoke all on function internal.recovery_code_pepper() from public, anon, authenticated;

create or replace function internal.recovery_code_hash(p_code text)
returns bytea language sql stable security definer set search_path = '' as $$
  select extensions.hmac(internal.normalise_invitation_code(p_code),
                         internal.recovery_code_pepper(), 'sha256');
$$;
revoke all on function internal.recovery_code_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Generation. Returns the ten codes ONCE, to the caller, and keeps only their hashes.
-- Regenerating invalidates every previous code (G): a person who regenerates has decided the old set is
-- no longer trustworthy, and leaving them live would defeat the point of asking.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.generate_recovery_codes(p_user_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid := gen_random_uuid();
  v_codes text[] := '{}';
  v_code text;
  i int;
begin
  if p_user_id is null then
    raise exception 'No account given.' using errcode = '22023';
  end if;

  delete from public.account_recovery_codes where user_id = p_user_id;

  for i in 1 .. 10 loop
    loop
      v_code := internal.new_invitation_code();   -- same alphabet and shape; a different pepper
      exit when not exists (
        select 1 from public.account_recovery_codes
         where user_id = p_user_id and code_hmac = internal.recovery_code_hash(v_code));
    end loop;
    insert into public.account_recovery_codes (user_id, code_hmac, batch_id)
    values (p_user_id, internal.recovery_code_hash(v_code), v_batch);
    v_codes := v_codes || v_code;
  end loop;

  update public.account_security_state
     set recovery_codes_generated_at = now(), updated_at = now()
   where user_id = p_user_id;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('mfa.recovery_codes_generated', p_user_id, 'recovery codes generated',
          jsonb_build_object('count', 10));

  return v_codes;
end $$;

revoke all on function internal.generate_recovery_codes(uuid) from public, anon, authenticated;
grant execute on function internal.generate_recovery_codes(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Redemption. Exactly one attempt may consume a code, which is why the row is locked and the update is
-- conditional on it still being unused: two simultaneous uses of the same code must not both succeed.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.redeem_recovery_code(p_user_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_fail int;
begin
  if p_user_id is null or coalesce(btrim(p_code), '') = '' then
    return false;
  end if;

  -- G: five failures in fifteen minutes locks the account out of this route for fifteen minutes.
  select count(*) into v_fail from public.security_events
   where event_type = 'mfa.recovery_code_failed' and actor_user_id = p_user_id
     and occurred_at > now() - interval '15 minutes';
  if v_fail >= 5 then
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('mfa.recovery_code_throttled', p_user_id, 'too many recovery code attempts', '{}'::jsonb);
    return false;
  end if;

  -- Locked, so a second concurrent attempt on the same row waits and then finds it used.
  select id into v_id from public.account_recovery_codes
   where user_id = p_user_id
     and code_hmac = internal.recovery_code_hash(p_code)
     and used_at is null
   for update;

  if v_id is null then
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('mfa.recovery_code_failed', p_user_id, 'recovery code not accepted', '{}'::jsonb);
    return false;
  end if;

  update public.account_recovery_codes set used_at = now()
   where id = v_id and used_at is null;
  if not found then
    -- Somebody else consumed it between the lock and here. One attempt, one code.
    return false;
  end if;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('mfa.recovery_code_used', p_user_id, 'recovery code redeemed',
          jsonb_build_object('remaining',
            (select count(*) from public.account_recovery_codes
              where user_id = p_user_id and used_at is null)));
  return true;
end $$;

revoke all on function internal.redeem_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function internal.redeem_recovery_code(uuid, text) to service_role;

-- How many are left, for the person's own Security page. A count is not a code.
create or replace function public.my_recovery_code_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.account_recovery_codes
   where user_id = (select auth.uid()) and used_at is null;
$$;
revoke all on function public.my_recovery_code_count() from public, anon;
grant execute on function public.my_recovery_code_count() to authenticated;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('mfa.recovery_codes_generated','IDENTITY','INFO',false,true,false),
       ('mfa.recovery_code_used','IDENTITY','WARNING',false,true,false),
       ('mfa.recovery_code_failed','IDENTITY','WARNING',false,true,false),
       ('mfa.recovery_code_throttled','IDENTITY','CRITICAL',false,true,false),
       ('mfa.factors_reset','IDENTITY','CRITICAL',false,true,false)
on conflict (event_type) do nothing;

do $$
begin
  if has_table_privilege('authenticated','public.account_recovery_codes','SELECT') then
    raise exception 'Slice 6: a browser role can read recovery code hashes.';
  end if;
  if internal.recovery_code_hash('ABCDE-FGHJK') = internal.invitation_code_hash('ABCDE-FGHJK') then
    raise exception 'Slice 6: recovery codes and invitation codes share a pepper.';
  end if;
  raise notice 'Slice 6: recovery codes are hashed with their own pepper and readable by nobody';
end $$;
