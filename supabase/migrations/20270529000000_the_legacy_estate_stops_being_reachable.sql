-- =====================================================================================================
-- CONVERGENCE STEP 17 -- IDENTITY/AUTH SLICE 10, THE PART THAT IS DUE
--
-- Slice 10 is LEGACY RETIREMENT, and its own acceptance is "zero references in CI; full runner, clean
-- boot and all browser suites green; production usage telemetry zero for 30 days before each drop".
--
-- MEASURED AGAINST THAT, NO DROP IS DUE. Every compatibility column, view, adapter and legacy invitation
-- function still has live references -- 61 database functions still read `club_memberships.role`, 61 still
-- call the `has_capability` adapter, 23 still read `team_permissions` -- and two of the preconditions
-- cannot be met at all in this step: the full gate is deliberately deferred, and telemetry cannot begin
-- because nothing is deployed. `accept_invitation` and `get_invitation_preview` are themselves Slice 10
-- drop targets that the deployed compatibility bridge still requires.
--
-- Even `public.invite_player_account` -- a plaintext-token issuer with ZERO application callers -- is not
-- dropped here, because `supabase/tests/parent_add_child_regression.sql` exercises it. A permanent suite
-- is a CI reference, so its precondition is unmet too, and removing the function would remove coverage of
-- a journey whose redemption half is still live behind /player-invite.
--
-- WHAT IS DUE is narrower and entirely non-destructive: the legacy estate stops being REACHABLE from a
-- browser. Nothing is dropped, no row is touched, and every compatibility bridge keeps working.
--
--   1. `public.invitations` -- 0 rows, no application writer, no RPC inserts -- stops being writable by
--      `authenticated`. It has a plaintext `token` column that a client could write into.
--   2. `public.club_ovalball_invitations.token` -- the LAST client-readable plaintext legacy token --
--      leaves the browser's reach, by column grant, so its two live readers keep working.
--
-- WHAT IS DELIBERATELY NOT TOUCHED, and why it is a decision rather than an oversight:
--
--   * `guardian_invitations` keeps its one live pending row and that row keeps its plaintext token. This
--     is the ESTABLISHED, TESTED policy, not caution: `internal.null_legacy_invitation_tokens()` clears
--     the secret the moment a row becomes terminal and deliberately leaves a live one alone, because a
--     real person is still holding that link (Phase 2 O.5; asserted as IN-M4/IN-M5 in
--     invitation_authority_matrix). That table has NO grant to anon or authenticated at all, so no API
--     role can read the token -- only SECURITY DEFINER functions can.
--   * `public.send_replacement_guardian_invitation` still issues into that table. It cannot move to the
--     canonical issuer yet, and the blocker is measured: the journey completes through
--     `link_guardian_to_existing_player` and `create_player_for_guardian`, both of which take a
--     `p_guardian_invitation_id` -- a LEGACY row id -- while the canonical GUARDIAN redemption returns
--     ACCEPTED and links nobody. Re-pointing the issuer would break the replacement-guardian journey.
--     Porting those two functions is family-architecture work, not retirement. Recorded for the owner.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. THE LEGACY `invitations` TABLE STOPS BEING WRITABLE FROM A BROWSER
--
-- Slice 5 moved the application's read off it -- app/(app)/people/page.tsx records that -- and no RPC
-- inserts into it. What remained was `INSERT` and `UPDATE` granted to `authenticated`, including on the
-- plaintext `token` column, so a live session holding `people.invitation.create` at any club could still
-- write a legacy invitation with a secret of its own choosing.
--
-- THE POLICIES ARE LEFT IN PLACE ON PURPOSE. A grant is checked before RLS, so they are now unreachable;
-- dropping them would throw away the club-scoping rule that would have to be rewritten if this table were
-- ever made writable again for a migration. An unreachable policy is inert; a lost one is a hole waiting
-- to be reopened badly.
-- -----------------------------------------------------------------------------------------------------
revoke insert, update on public.invitations from authenticated;

comment on table public.invitations is
  'LEGACY, RETIRING (Identity/Auth Slice 10). Superseded by public.access_invitations, which stores only a '
  'hash. No RPC inserts into it and the application read moved at Slice 5. As of Convergence Step 17 it is '
  'not writable by any browser role; its club-scoped INSERT/UPDATE policies are retained but unreachable, '
  'because a grant is checked before RLS. Redemption through accept_invitation survives while the deployed '
  'compatibility bridge needs it. Drops when Slice 10''s telemetry precondition can be met.';

-- -----------------------------------------------------------------------------------------------------
-- 2. THE LAST CLIENT-READABLE PLAINTEXT LEGACY TOKEN LEAVES THE BROWSER'S REACH
--
-- `club_ovalball_invitations` is the one legacy table whose `token` a browser could still SELECT -- for a
-- session holding `club.partners.manage`, or `site.clubs.view`.
--
-- Its two live readers ask for `id`, `contact_email` and `inviting_club_id`
-- (lib/email/recipients.ts, lib/app-context/commercial-intelligence-data.ts), and the authority suites
-- count rows by id. So the fix is a COLUMN grant rather than a revocation: every column except the secret.
-- Listing them explicitly is the point -- a future column is then absent by default rather than exposed by
-- default, which is the same reasoning as the anon column restriction on club_directory.
-- -----------------------------------------------------------------------------------------------------
revoke select on public.club_ovalball_invitations from authenticated;
grant select (
  id, inviting_club_id, club_directory_id, contact_name, contact_email, invited_by,
  status, expires_at, accepted_at, accepted_by, resulting_partnership_id, created_at, updated_at
) on public.club_ovalball_invitations to authenticated;

comment on column public.club_ovalball_invitations.token is
  'LEGACY plaintext invitation secret (Identity/Auth Slice 10). As of Convergence Step 17 no browser role '
  'holds SELECT on this column -- the table grant is column-scoped and omits it. internal.null_legacy_'
  'invitation_tokens() clears it once the row is terminal; a live row keeps it, because somebody is still '
  'holding that link (Phase 2 O.5).';

-- -----------------------------------------------------------------------------------------------------
-- 3. AND THE CANONICAL TABLE STOPS HANDING OUT ITS HASH MATERIAL
--
-- Found by this step's own suite while asserting the claim in section 2. `access_invitations` stores only
-- a hash, which is the whole point of it -- but a browser role held SELECT on the WHOLE ROW, so
-- `token_sha256` and `code_hmac` came along with every read.
--
-- A hash is not a token: redemption hashes what it is given, so a stolen digest redeems nothing. But
-- `code_hmac` is the HMAC of a SHORT human code, and handing an attacker the digest turns "guess the code
-- against a throttled server" into "grind it offline against a captured one". The pepper still stands in
-- the way; there is no reason to make it the only thing that does.
--
-- Its two readers ask for explicit column lists and neither wants either column
-- (app/(app)/admin/users/[userId]/page.tsx, lib/email/recipients.ts); everything else goes through the
-- RPCs. `code_hint` stays readable because it is designed to be shown -- it is the last two characters,
-- printed so somebody can tell two codes apart.
-- -----------------------------------------------------------------------------------------------------
revoke select on public.access_invitations from authenticated;
grant select (
  id, kind, club_id, team_id, player_id, club_directory_id, target_user_id, invited_email_normalised,
  intended_outcome, issuer_capability, issued_by, issued_level, code_hint, state, max_uses, use_count,
  expires_at, redeemed_by, redeemed_at, revoked_by, revoked_at, revocation_reason, resend_count,
  last_sent_at, delivery_id, created_at, updated_at, constituent_body_id, scope_key
) on public.access_invitations to authenticated;

comment on column public.access_invitations.token_sha256 is
  'SHA-256 of the invitation token. The secret itself is returned once by public.issue_invitation and '
  'never stored. As of Convergence Step 17 no browser role holds SELECT on this column either: a digest '
  'redeems nothing, but there is no reason to publish hash material.';

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_n int; v_bad text;
begin
  -- ---------------------------------------------------------------------------------------------
  -- NO BROWSER ROLE CAN REACH A PLAINTEXT LEGACY INVITATION TOKEN, BY READ OR BY WRITE.
  -- ---------------------------------------------------------------------------------------------
  select string_agg(table_name || '.' || column_name || ' -> ' || grantee || ' ' || privilege_type, ', ')
    into v_bad
    from information_schema.column_privileges
   where table_schema = 'public' and column_name = 'token'
     and grantee in ('anon', 'authenticated')
     and table_name in ('invitations', 'guardian_invitations', 'player_account_invitations',
                        'site_admin_invitations', 'club_safeguarding_officer_invitations',
                        'club_ovalball_invitations');
  if v_bad is not null then
    raise exception 'Step 17: a browser role still reaches a plaintext legacy invitation token: %', v_bad;
  end if;

  -- AND THE READERS THAT LEGITIMATELY NEED THE REST OF THE ROW KEEP IT.
  select count(*) into v_n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'club_ovalball_invitations'
     and grantee = 'authenticated' and privilege_type = 'SELECT'
     and column_name in ('id', 'contact_email', 'inviting_club_id');
  if v_n <> 3 then
    raise exception 'Step 17: the partner-invitation readers lost the columns they need (% of 3)', v_n;
  end if;

  -- NOR DOES THE CANONICAL TABLE PUBLISH ITS HASH MATERIAL.
  select count(*) into v_n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'access_invitations'
     and column_name in ('token_sha256', 'code_hmac') and grantee in ('anon', 'authenticated');
  if v_n > 0 then
    raise exception 'Step 17: a browser role still reads the canonical invitation hash material';
  end if;
  -- And its readers keep what they legitimately ask for.
  select count(*) into v_n from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'access_invitations' and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name in ('id', 'kind', 'state', 'expires_at', 'intended_outcome', 'invited_email_normalised', 'club_id', 'code_hint');
  if v_n <> 8 then
    raise exception 'Step 17: the canonical invitation readers lost a column they use (% of 8)', v_n;
  end if;

  -- THE LEGACY TABLE IS NOT WRITABLE FROM A BROWSER.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'invitations'
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_n > 0 then
    raise exception 'Step 17: the legacy invitations table is still writable by a browser role';
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- NOTHING WAS DROPPED, AND EVERY COMPATIBILITY BRIDGE STILL STANDS.
  --
  -- Slice 10's acceptance is unmet for every drop target, and §20 of the authorisation requires the
  -- release bridge to survive. This migration must therefore be provably non-destructive.
  -- ---------------------------------------------------------------------------------------------
  foreach v_bad in array array['accept_invitation', 'get_invitation_preview', 'accept_guardian_invitation',
                               'get_guardian_invitation_preview', 'accept_player_account_invitation',
                               'get_player_account_invitation_preview', 'accept_site_admin_invitation',
                               'invite_player_account', 'send_replacement_guardian_invitation',
                               'link_guardian_to_existing_player', 'create_player_for_guardian',
                               'issue_invitation', 'redeem_invitation', 'preview_invitation'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_bad) then
      raise exception 'Step 17: % was dropped -- Slice 10 has no authority to drop it yet', v_bad;
    end if;
  end loop;

  foreach v_bad in array array['invitations', 'guardian_invitations', 'player_account_invitations',
                               'site_admin_invitations', 'club_ovalball_invitations',
                               'access_invitations'] loop
    if not exists (select 1 from information_schema.tables
                    where table_schema = 'public' and table_name = v_bad) then
      raise exception 'Step 17: the % table was dropped -- no drop is due', v_bad;
    end if;
  end loop;

  -- THE ONE LIVE LEGACY ROW IS UNTOUCHED, INCLUDING ITS TOKEN. Phase 2 O.5 honours it until it expires,
  -- and it belongs to a real person who is holding the link.
  select count(*) into v_n from public.guardian_invitations
   where status = 'pending' and expires_at > now() and token is not null;
  if v_n < 1 then
    raise exception 'Step 17: a live pending legacy guardian invitation lost its token';
  end if;

  -- AND NO SECOND ANYTHING WAS CREATED. This is a retirement slice, so the invitation estate may only
  -- shrink. Named explicitly rather than pattern-matched: the first version of this guard used a regex
  -- and failed on the platform's own existing tables, which is precisely the kind of cleverness a
  -- retirement guard should not contain.
  select string_agg(table_name, ', ' order by table_name) into v_bad
    from information_schema.tables
   where table_schema = 'public' and table_name ~ 'invitation'
     and table_name not in (
       'access_invitations',                     -- the canonical system
       'invitation_redemptions',                 -- its redemption ledger
       'invitation_redemption_attempts',         -- its throttle ledger
       'invitations',                            -- legacy, retiring
       'invitation_teams',                       -- legacy, retiring
       'invitations_admin_view',                 -- legacy view, retiring
       'guardian_invitations',                   -- legacy, retiring
       'player_account_invitations',             -- legacy, retiring
       'site_admin_invitations',                 -- legacy, retiring
       'club_ovalball_invitations',              -- legacy, retiring
       'club_safeguarding_officer_invitations',  -- legacy, retiring
       'fixture_attendance_invitations'          -- NOT an identity invitation: availability requests
     );
  if v_bad is not null then
    raise exception 'Step 17: a new invitation table appeared in a retirement slice: %', v_bad;
  end if;

  -- THE CAPABILITY ENGINE AND THE CONTEXT MODEL ARE UNTOUCHED (§6, §7 of the authorisation).
  if (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'capability_decision') ~ 'p_organisation|p_body' then
    raise exception 'Step 17: capability_decision grew an organisation parameter -- Slice 10 does not own that';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'capability_decision') !~ 'SCOPE_NOT_IMPLEMENTED' then
    raise exception 'Step 17: the organisation scope refusal was removed';
  end if;
end;
$guard$;
