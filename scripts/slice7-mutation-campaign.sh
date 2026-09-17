#!/bin/bash
# SLICE 7 MUTATION CAMPAIGN
# Each mutant breaks exactly one control. The named suite must notice.
# A survivor means that suite is decoration.
#
# THIS SCRIPT DAMAGES THE DATABASE AND ENDS BY REBUILDING IT.
#
# Each mutant is restored by re-running the migration that owns the object it
# broke, and that is NOT sufficient on its own: a migration restores what the
# migration knows about, and several of these mutants replace a function whose
# final definition comes from a LATER migration than the one named here, or
# invent objects no migration has heard of. Running the campaign and then the
# battery in the same database produced seventeen failures that were nothing to
# do with the code -- they were the campaign's own wreckage being measured.
#
# So the campaign finishes with 'npx supabase db reset': the whole chain from empty,
# which is the only restore that is actually a restore. Do not remove it, and do
# not trust a battery run between the first mutant and that reset.
cd /Users/Devs/ovalball-saas-startup
P() { docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 2>&1; }
SUITE() { docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -q -f - < "supabase/tests/$1.sql" 2>&1; }
MIG() { docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f - < "supabase/migrations/$1" >/dev/null 2>&1; }
SURV=0; N=0

mutant() { # name  suite  mutate_sql  restore_migration
  local name="$1" suite="$2" sql="$3" mig="$4"
  N=$((N+1))
  printf 'M%-2s %-46s ' "$N" "$name"
  local applied; applied=$(printf '%s' "$sql" | P)
  if echo "$applied" | grep -qi "^ERROR"; then echo "SKIP (would not apply: $(echo "$applied" | head -1))"; MIG "$mig"; return; fi
  local out; out=$(SUITE "$suite")
  MIG "$mig"
  if echo "$out" | grep -q "FAIL\|ERROR"; then echo "caught"; else echo "*** SURVIVED ***"; SURV=$((SURV+1)); fi
}

# ---- M1: the capability check leaves the preamble -------------------------------------------------
mutant "preamble stops checking the capability" site_admin_profile_matrix "
create or replace function internal.master_control_preamble(p_capability text, p_reason text, p_target_user_id uuid default null)
returns void language plpgsql stable security definer set search_path = '' as \$\$
begin
  perform internal.require_recent_aal2(interval '10 minutes');
  perform internal.require_reason(p_reason, true);
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'short' using errcode = '22023';
  end if;
  if p_target_user_id is not null then perform internal.refuse_self_target(p_target_user_id); end if;
end \$\$;" "20270417000000_master_control_preamble_and_club.sql"

# ---- M2: the recent-authenticator requirement is dropped -------------------------------------------
mutant "recent AAL2 no longer required" site_master_control "
create or replace function internal.require_recent_aal2(p_within interval default interval '10 minutes')
returns void language plpgsql stable security definer set search_path = '' as \$\$
begin
  return;
end \$\$;" "20270417000000_master_control_preamble_and_club.sql"

# ---- M3: the reason minimum is removed -------------------------------------------------------------
mutant "a one-word reason is accepted" site_master_control "
create or replace function internal.master_control_preamble(p_capability text, p_reason text, p_target_user_id uuid default null)
returns void language plpgsql stable security definer set search_path = '' as \$\$
begin
  perform internal.require_site_capability(p_capability);
  perform internal.require_recent_aal2(interval '10 minutes');
  if p_target_user_id is not null then perform internal.refuse_self_target(p_target_user_id); end if;
end \$\$;" "20270417000000_master_control_preamble_and_club.sql"

# ---- M4: self-target becomes allowed ---------------------------------------------------------------
mutant "an administrator may act on their own account" site_master_control "
create or replace function internal.master_control_preamble(p_capability text, p_reason text, p_target_user_id uuid default null)
returns void language plpgsql stable security definer set search_path = '' as \$\$
begin
  perform internal.require_site_capability(p_capability);
  perform internal.require_recent_aal2(interval '10 minutes');
  perform internal.require_reason(p_reason, true);
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'short' using errcode = '22023';
  end if;
end \$\$;" "20270417000000_master_control_preamble_and_club.sql"

# ---- M5: the Site Admin label comes back into one policy --------------------------------------------
# NOTE: this mutant CREATES a policy under a new name. Re-running the owning migration restores the
# original policy but knows nothing about the invented one, so the mutant drops its own. The first
# run of this campaign did not, and left club_aliases carrying an extra write policy that
# site_master_control's SMC-11b counted and failed on -- after the campaign had reported success.
mutant "one policy asks is_site_admin() again" authority_helper_retirement "
create or replace function internal.is_site_admin() returns boolean language sql stable security definer set search_path='' as \$\$ select false \$\$;
drop policy if exists club_aliases_insert on public.club_aliases;
create policy club_aliases_insert on public.club_aliases for insert to authenticated
  with check (internal.is_site_admin() or internal.has_site_capability('site.directory.manage'));" \
"20270418000000_retire_site_admin_from_policies.sql"

# ---- M6: an approval can be replayed ----------------------------------------------------------------
mutant "the grant approval is not consumed" site_admin_grant_and_lockout "
create or replace function internal.apply_site_admin_grant(p_user_id uuid, p_profile_key text)
returns void language plpgsql security definer set search_path = '' as \$\$
declare v_req public.site_admin_grant_requests;
begin
  select * into v_req from public.site_admin_grant_requests
   where target_user_id = p_user_id and profile_key = p_profile_key and state = 'APPROVED' and expires_at > now()
   order by decided_at desc for update skip locked limit 1;
  if v_req.id is null then
    raise exception 'needs a second Full Site Admin' using errcode = '42501';
  end if;
  insert into public.site_admins (user_id, profile_key, status, granted_by)
  values (p_user_id, p_profile_key, 'active', v_req.decided_by)
  on conflict (user_id) do update set profile_key = excluded.profile_key, status='active',
    granted_by = excluded.granted_by, granted_at = now(), revoked_by = null, revoked_at = null;
end \$\$;" "20270423000000_two_admin_site_admin_grant.sql"

# ---- M7: the requester may approve their own request ------------------------------------------------
mutant "the requester may approve their own request" site_admin_grant_and_lockout "
create or replace function public.site_approve_site_admin_grant(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as \$\$
declare v_req public.site_admin_grant_requests;
begin
  perform internal.master_control_caller_gate(array['site.admins.manage'], p_reason);
  select * into v_req from public.site_admin_grant_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'no such request' using errcode = 'P0002'; end if;
  perform internal.master_control_preamble('site.admins.manage', p_reason, v_req.target_user_id);
  if v_req.state <> 'PENDING' then raise exception 'already decided' using errcode = '23514'; end if;
  update public.site_admin_grant_requests set state='APPROVED', decided_by=auth.uid(), decided_at=now(),
         decision_reason=btrim(p_reason) where id = p_request_id;
  perform internal.apply_site_admin_grant(v_req.target_user_id, v_req.profile_key);
end \$\$;" "20270423000000_two_admin_site_admin_grant.sql"

# ---- M8: the browser can write site_admins again -----------------------------------------------------
mutant "authenticated regains UPDATE on site_admins" site_admin_grant_and_lockout "
grant update on public.site_admins to authenticated;
create policy site_admins_update_full_admin on public.site_admins for update to authenticated
  using (internal.has_site_capability('site.admins.manage'));" \
"20270423000000_two_admin_site_admin_grant.sql"

# ---- M9: an RPC looks the record up before authorising ------------------------------------------------
mutant "an RPC answers before it authorises" site_admin_profile_matrix "
create or replace function public.site_transition_club_membership(p_membership_id uuid, p_to_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as \$\$
declare v_m public.club_memberships;
begin
  select * into v_m from public.club_memberships where id = p_membership_id;
  if v_m.id is null then raise exception 'That membership does not exist.' using errcode = 'P0002'; end if;
  perform internal.master_control_preamble('site.memberships.manage', p_reason, v_m.user_id);
  perform internal.master_control_club(v_m.club_id, p_to_state in ('SUSPENDED','REVOKED'));
  perform internal.lock_club_people(v_m.club_id);
  perform public.transition_club_membership(p_membership_id, p_to_state, btrim(p_reason), false);
end \$\$;" "20270425000000_authorise_before_lookup.sql"

# ---- M10: suspending and disabling share one capability ------------------------------------------------
mutant "disabling needs only the suspend capability" site_master_control "
create or replace function public.site_set_account_state(p_user_id uuid, p_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as \$\$
begin
  perform internal.master_control_preamble('site.users.security.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);
  if p_state not in ('ACTIVE','SUSPENDED','DISABLED') then
    raise exception 'bad state' using errcode = '22023';
  end if;
  update public.profiles set account_state = p_state, state_reason = btrim(p_reason),
         state_changed_by = auth.uid(), state_changed_at = now() where id = p_user_id;
end \$\$;" "20270420000000_master_control_team_family_identity.sql"

# ---- M11: resending a setup link stops rotating -----------------------------------------------------------
mutant "resending adds a second live setup link" site_master_control "
create or replace function public.site_resend_account_setup(p_user_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as \$\$
declare v_inv record;
begin
  perform internal.master_control_preamble('site.invitations.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);
  select * into v_inv from public.issue_invitation('ACCOUNT_SETUP', null, null, null, null, p_user_id,
    (select email from public.profiles where id = p_user_id), '{}'::jsonb, 1, null, null);
  return v_inv.invitation_id;
end \$\$;" "20270424000000_create_user_and_remaining_master_control.sql"

# ---- M12: a person may be their own guardian ----------------------------------------------------------------
mutant "a person may be their own guardian" site_master_control "
create or replace function public.site_link_guardian(p_guardian_user_id uuid, p_player_id uuid, p_relationship_type text, p_reason text, p_verification_state text default 'SITE_VERIFIED')
returns uuid language plpgsql security definer set search_path = '' as \$\$
declare v_id uuid;
begin
  perform internal.master_control_preamble('site.family.manage', p_reason, p_guardian_user_id);
  perform internal.master_control_target(p_guardian_user_id);
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'no player' using errcode = 'P0002';
  end if;
  insert into public.guardians (player_id, guardian_user_id, relationship_type, status, state, source, created_by, verification_state, reason)
  values (p_player_id, p_guardian_user_id, coalesce(p_relationship_type,'parent'), 'active', 'ACTIVE',
          'SITE_ADMIN_ASSIGNMENT', auth.uid(), 'SITE_VERIFIED', btrim(p_reason))
  returning id into v_id;
  return v_id;
end \$\$;" "20270420000000_master_control_team_family_identity.sql"

# ---- M13: Create User may attach Site Admin ---------------------------------------------------------------------
mutant "Create User may grant Site Admin" site_master_control "
create or replace function public.site_register_created_identity(p_user_id uuid, p_first_name text, p_surname text,
  p_dob date default null, p_reason text default null, p_intended jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as \$\$
declare v_profile public.profiles; v_inv record;
begin
  perform internal.master_control_preamble('site.users.create', p_reason, null);
  select * into v_profile from public.profiles where id = p_user_id;
  if v_profile.id is null then raise exception 'no identity' using errcode = 'P0002'; end if;
  if v_profile.setup_state = 'COMPLETE' or v_profile.account_state = 'ACTIVE' then
    raise exception 'already set up' using errcode = '23505';
  end if;
  update public.profiles set first_name = btrim(p_first_name), surname = btrim(p_surname),
    account_state='PENDING_SETUP', setup_state='PENDING_DETAILS', created_source='SITE_ADMIN_CREATE'
   where id = p_user_id;
  select * into v_inv from public.issue_invitation('ACCOUNT_SETUP', null, null, null, null, p_user_id,
    v_profile.email, '{}'::jsonb, 1, null, null);
  return jsonb_build_object('user_id', p_user_id, 'invitation_id', v_inv.invitation_id);
end \$\$;" "20270424000000_create_user_and_remaining_master_control.sql"

# ---- M14: the lockout guard stops guarding ------------------------------------------------------------------------
mutant "the last Full Site Admin can be removed" site_admin_grant_and_lockout "
create or replace function internal.prevent_last_full_admin_lockout() returns trigger language plpgsql as \$\$
begin
  if tg_op = 'DELETE' then return old; end if;
  return new;
end \$\$;" "20270350000000_capability_resolver_and_site_profiles.sql"

echo
echo "=== $N mutants, $SURV survivors ==="

echo
echo "Rebuilding the database from empty -- the mutants' restores are not trustworthy on their own."
npx supabase db reset >/dev/null 2>&1 && echo "database rebuilt from empty" || echo "*** REBUILD FAILED -- do not trust this database ***"
