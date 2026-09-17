-- =====================================================================================================
-- SLICE 5 (3/n) -- invitation secrets (Phase 2 O.1 "Secrets", PG-10)
--
-- Two secrets per invitation, and neither is ever stored:
--   * a LINK TOKEN, 32 random bytes base64url, kept as SHA-256. A link is long and is never typed,
--     so a plain hash is right: lookup must be a single indexed probe.
--   * a HUMAN CODE, 10 Crockford base32 characters as XXXXX-XXXXX, about 50 bits, kept as
--     HMAC-SHA256 under a pepper held in Vault. An HMAC rather than a slow hash for the same reason
--     -- redemption looks it up by equality -- and the attempt limits in O.2 cap online guessing.
--     The pepper is what stops a stolen database from being brute-forced offline: 50 bits is
--     comfortably searchable without it, and useless with it.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. The pepper.
--
-- Phase 2's release note says the production pepper is created in Vault BEFORE the migration, with a
-- read-back check that never prints it. This creates one only when none exists, so a clean boot and
-- a disposable rehearsal stack work unattended while production keeps the deliberate prior step.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'invitation_code_pepper';
  if v_id is null then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'),
                                'invitation_code_pepper',
                                'Slice 5: HMAC pepper for human-enterable invitation codes. Never logged.');
    raise notice 'Slice 5: created the invitation code pepper in Vault';
  else
    raise notice 'Slice 5: the invitation code pepper is already in Vault';
  end if;
end $$;

create or replace function internal.invitation_code_pepper()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'invitation_code_pepper';
  if v is null then
    -- Refusing is the only safe answer: a missing pepper must never silently become an empty key,
    -- which would make every code hash reproducible by anyone.
    raise exception 'The invitation code pepper is missing.' using errcode = 'P0001';
  end if;
  return v;
end $$;

revoke all on function internal.invitation_code_pepper() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Normalisation and hashing.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.normalise_invitation_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  -- Crockford's confusable letters fold to digits before comparison, so a code read off a screen and
  -- typed as I/L/O still matches. Case and separators are irrelevant.
  select translate(upper(regexp_replace(coalesce(p_code,''), '[^0-9A-Za-z]', '', 'g')),
                   'ILOU', '1101');
$$;

create or replace function internal.invitation_token_hash(p_token text)
returns bytea language sql immutable set search_path = '' as $$
  select extensions.digest(coalesce(p_token,''), 'sha256');
$$;

create or replace function internal.invitation_code_hash(p_code text)
returns bytea language plpgsql stable security definer set search_path = '' as $$
begin
  return extensions.hmac(internal.normalise_invitation_code(p_code), internal.invitation_code_pepper(), 'sha256');
end $$;

revoke all on function internal.invitation_code_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Generating a pair.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.new_invitation_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  -- Crockford base32: no I, L, O or U, so nothing reads as something else.
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_out text := '';
  i int;
begin
  for i in 1 .. 10 loop
    -- get_byte over random bytes, reduced to the alphabet. 10 characters is about 50 bits.
    v_out := v_out || substr(v_alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1);
  end loop;
  return substr(v_out, 1, 5) || '-' || substr(v_out, 6, 5);
end $$;

create or replace function internal.new_invitation_token()
returns text language sql volatile set search_path = '' as $$
  -- base64url: a link-safe alphabet, no padding.
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;

revoke all on function internal.new_invitation_code() from public, anon, authenticated;
revoke all on function internal.new_invitation_token() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Assertions: the properties this file exists to provide.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_a text; v_b text; v_tok text; i int; v_seen text[] := '{}';
begin
  -- A code is well-shaped and drawn from the Crockford alphabet only.
  for i in 1 .. 50 loop
    v_a := internal.new_invitation_code();
    if v_a !~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$' then
      raise exception 'Slice 5: generated an invitation code with the wrong shape: %', v_a;
    end if;
    v_seen := v_seen || v_a;
  end loop;
  if (select count(distinct x) from unnest(v_seen) x) <> 50 then
    raise exception 'Slice 5: invitation codes are not unique across 50 draws.';
  end if;

  -- Confusable characters fold, so a code typed with I, L, O or U still matches.
  if internal.normalise_invitation_code('abcde-fghjk') <> internal.normalise_invitation_code('ABCDE-FGHJK') then
    raise exception 'Slice 5: invitation code comparison is case sensitive.';
  end if;
  if internal.normalise_invitation_code('I1L1O0') <> '111100' then
    raise exception 'Slice 5: Crockford confusables do not fold.';
  end if;

  -- The pepper actually changes the hash: an HMAC without a key would be reproducible by anyone
  -- holding the database.
  if internal.invitation_code_hash('ABCDE-FGHJK') = extensions.hmac(internal.normalise_invitation_code('ABCDE-FGHJK'), '', 'sha256') then
    raise exception 'Slice 5: the invitation code HMAC is not actually peppered.';
  end if;

  -- A token is long, unique and link-safe.
  v_tok := internal.new_invitation_token();
  if v_tok !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Slice 5: generated an invitation token with the wrong shape: %', v_tok;
  end if;
  if internal.invitation_token_hash(v_tok) = internal.invitation_token_hash(internal.new_invitation_token()) then
    raise exception 'Slice 5: two different tokens hash the same.';
  end if;

  -- Nothing reachable from a browser may compute either hash, or the pepper is pointless.
  if has_function_privilege('authenticated','internal.invitation_code_hash(text)','EXECUTE')
     or has_function_privilege('anon','internal.invitation_code_hash(text)','EXECUTE')
     or has_function_privilege('authenticated','internal.invitation_code_pepper()','EXECUTE')
     or has_function_privilege('anon','internal.invitation_code_pepper()','EXECUTE') then
    raise exception 'Slice 5: a browser role can reach the invitation pepper or its HMAC.';
  end if;
  raise notice 'Slice 5: invitation secret generation verified';
end $$;
