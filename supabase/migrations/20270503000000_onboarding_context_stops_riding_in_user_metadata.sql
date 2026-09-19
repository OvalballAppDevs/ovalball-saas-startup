-- =====================================================================================================
-- SO-4 / H-7 -- ONBOARDING CONTEXT MOVES OUT OF user_metadata (Slice 6b.2b)
--
-- THE DEFECT, from the programme reconciliation:
--
--   SO-4  "Onboarding context in auth_flow_states; OAuth `state` carries only an opaque id"
--         MISSED -- table exists, 0 application references; context still rides in
--         ovalballSignupPayload user metadata (Phase 1 H-7).
--
-- `public.auth_flow_states` shipped in Slice 5 and nothing ever called it: the right shape, unused.
-- Meanwhile the signup wizard's answers travel as `data` on `signInWithOtp`, which GoTrue writes to
-- `auth.users.user_metadata` BEFORE anybody has authenticated. Anyone can start a signup for any
-- address, so anyone can author that metadata for an account that is not theirs. A browser-bound
-- httpOnly cookie bounds the blast radius -- the callback only applies the payload for the browser
-- that submitted it -- but the architecture is still pre-auth, attacker-authored data sitting on
-- somebody's auth row, which is what SO-4 exists to remove.
--
-- WHAT THIS MIGRATION ADDS. Two functions over the table that already exists. No new table, no second
-- onboarding carrier, and no schema change beyond the two functions.
--
--   create_auth_flow_state(kind, payload)  -> the flow id, ONCE
--   consume_auth_flow_state(flow_id, kind) -> the payload, ONCE
--
-- THE PROPERTIES THE DESIGN ASKS FOR, and where each one lives:
--
--   unguessable id        256 bits from gen_random_bytes; only its SHA-256 is stored, so the row
--                         cannot be turned back into the credential that opens it
--   server-authored       the row is written by a SECURITY DEFINER function against a table with RLS
--                         on and NO policies -- nothing else can write or read it, ever
--   bounded purpose       `kind` is a CHECK constraint, and this migration narrows further: only the
--                         purposes Slice 6 owns may be created today
--   expiry                one hour, from the table's own default
--   single use            consumption is one UPDATE with `consumed_at is null` in its WHERE clause,
--                         so two callers race and exactly one wins
--   identity binding      consumption stamps auth.uid() onto the row; a state already consumed by
--                         somebody else is simply not there for the second caller
--   purpose confusion     the consumer names the kind it expects and gets nothing if it differs
--   fail closed           every refusal returns NULL rather than raising, so a prober learns nothing
--                         from the shape of the answer -- the same rule preview_invitation follows
--   auditable             consumption emits a security event naming the kind, never the payload
--
-- Creation is callable by `anon` and it has to be: a signup has no session yet. That is the same
-- shape `record_password_reset_requested` uses, and for the same reason.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- The credential. Same idiom as invitation tokens: 256 bits, base64url, hashed at rest.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.new_auth_flow_id()
returns text language sql volatile set search_path = '' as $$
  -- base64url: the two substitutions plus the padding removed, so the id can sit
  -- in a cookie or a URL without ever needing to be encoded again -- and so two
  -- encodings of the same id can never disagree.
  select rtrim(replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=');
$$;

create or replace function internal.auth_flow_id_hash(p_flow_id text)
returns bytea language sql immutable set search_path = '' as $$
  select extensions.digest(coalesce(p_flow_id, ''), 'sha256');
$$;

-- ---------------------------------------------------------------------------------------------------
-- The event this journey emits.
--
-- `internal.emit_security_event` refuses an event type that is not registered, deliberately, so that
-- the estate's vocabulary cannot grow by accident. Consuming an onboarding state is an IDENTITY event
-- about the person doing it: their own security page may show it, and no club has any business being
-- told about somebody's signup.
-- ---------------------------------------------------------------------------------------------------
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('auth.flow_state_consumed', 'IDENTITY', 'INFO', false, true, false)
on conflict (event_type) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- The purposes this slice owns.
--
-- The table's CHECK already allows INVITATION, CLAIM, SIGNUP, LINK_IDENTITY and SETUP -- the full set
-- the design enumerates. Slice 6 owns the signup journey and nothing else, and the authorisation is
-- explicit that later-owned journeys stay later-owned. So the create path refuses a kind nobody has
-- migrated yet: a half-wired purpose would be a second onboarding carrier living beside the first,
-- which is the outcome this whole change exists to prevent.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.auth_flow_kind_is_active(p_kind text)
returns boolean language sql immutable set search_path = '' as $$
  select p_kind = 'SIGNUP';
$$;

-- ---------------------------------------------------------------------------------------------------
-- CREATE. Pre-authentication by necessity.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.create_auth_flow_state(p_kind text, p_payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_flow_id text;
begin
  if not internal.auth_flow_kind_is_active(p_kind) then
    raise exception 'That authentication flow is not available.' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'An authentication flow needs an object payload.' using errcode = '22023';
  end if;
  -- A bound on size, because this is writable before anybody has proved who they are. The signup
  -- wizard's answers are a few hundred bytes; 16 KB is generous and still not a place to park data.
  if octet_length(p_payload::text) > 16384 then
    raise exception 'That is too much information to carry through sign-in.' using errcode = '22023';
  end if;

  v_flow_id := internal.new_auth_flow_id();
  insert into public.auth_flow_states (flow_id_sha256, kind, payload)
  values (internal.auth_flow_id_hash(v_flow_id), p_kind, p_payload);

  -- Returned once. Only the hash is stored, so this is the single moment the id exists.
  return v_flow_id;
end $$;

revoke all on function public.create_auth_flow_state(text, jsonb) from public;
grant execute on function public.create_auth_flow_state(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- CONSUME. Authenticated only, once, for the purpose it was created for.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.consume_auth_flow_state(p_flow_id text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_id uuid;
begin
  -- THE CANONICAL SESSION GATE, not just "is somebody signed in".
  --
  -- 6b.2a folded `internal.session_ok()` into every browser-callable definer
  -- mutator for a reason: `auth.uid()` is satisfied by a JWT that has not expired
  -- yet, including one belonging to a session that has since been revoked or an
  -- account that has been suspended. Consuming an onboarding state writes a row
  -- and hands back context, so it is a mutation and it belongs behind the same
  -- gate. The S6-9 closure suite caught this omission on the first full run.
  if auth.uid() is null or not internal.session_ok() then
    return null;
  end if;
  if p_flow_id is null or p_flow_id = '' or p_kind is null then
    return null;
  end if;

  -- ONE STATEMENT DOES THE WHOLE JOB, AND THAT IS THE POINT.
  --
  -- `consumed_at is null` inside the WHERE clause is what makes this single-use under concurrency:
  -- two tabs arriving together both run this UPDATE, PostgreSQL serialises them on the row, and the
  -- second one matches nothing because the first has already set the column. Reading first and
  -- updating second would let both through.
  --
  -- The kind is in the WHERE clause too, so a state created for one purpose is invisible to a
  -- consumer expecting another -- purpose confusion fails as "no such state" rather than as a
  -- different error a caller could tell apart.
  update public.auth_flow_states
     set consumed_at = now(),
         user_id = auth.uid()
   where flow_id_sha256 = internal.auth_flow_id_hash(p_flow_id)
     and kind = p_kind
     and consumed_at is null
     and expires_at > now()
  returning id, payload into v_id, v_payload;

  if v_id is null then
    -- Expired, already used, wrong purpose, or never existed. All four answer identically: a prober
    -- must not be able to distinguish "used" from "never issued".
    return null;
  end if;

  perform internal.emit_security_event(
    'auth.flow_state_consumed', auth.uid(), 'SUCCESS', 'authentication flow state consumed',
    jsonb_build_object('flow_state_id', v_id, 'kind', p_kind),
    null, null, null);

  return v_payload;
end $$;

revoke all on function public.consume_auth_flow_state(text, text) from public;
grant execute on function public.consume_auth_flow_state(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Self-checks. A migration that silently did nothing would be worse than one that failed.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_flow text; v_out jsonb; v_count int;
begin
  -- The table must still be unreachable except through these functions.
  select count(*) into v_count from pg_policy where polrelid = 'public.auth_flow_states'::regclass;
  if v_count <> 0 then
    raise exception 'auth_flow_states has % RLS policies; it is meant to be reachable only through the definer functions', v_count;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.auth_flow_states'::regclass) then
    raise exception 'auth_flow_states must have row level security enabled';
  end if;

  -- Creation works, and returns something that is not what is stored.
  v_flow := public.create_auth_flow_state('SIGNUP', '{"probe": true}'::jsonb);
  if v_flow is null or length(v_flow) < 40 then
    raise exception 'create_auth_flow_state returned an implausible flow id';
  end if;
  if exists (select 1 from public.auth_flow_states where flow_id_sha256 = v_flow::bytea) then
    raise exception 'the flow id appears to be stored in the clear';
  end if;
  if not exists (select 1 from public.auth_flow_states where flow_id_sha256 = internal.auth_flow_id_hash(v_flow)) then
    raise exception 'the flow state was not written';
  end if;

  -- A kind nobody has migrated yet is refused.
  begin
    perform public.create_auth_flow_state('CLAIM', '{}'::jsonb);
    raise exception 'create_auth_flow_state accepted a kind this slice does not own';
  exception when sqlstate '22023' then null;
  end;

  -- Consumption with no session returns nothing rather than raising.
  v_out := public.consume_auth_flow_state(v_flow, 'SIGNUP');
  if v_out is not null then
    raise exception 'consume_auth_flow_state returned a payload with no authenticated caller';
  end if;

  delete from public.auth_flow_states where flow_id_sha256 = internal.auth_flow_id_hash(v_flow);
end $$;
