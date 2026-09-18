#!/usr/bin/env bash
#
# SLICE 6b.2a MUTATION CAMPAIGN
#
# A test suite that has never failed has not been shown to work. This
# deliberately reintroduces each defect 6b.2a fixed -- and each one it could
# plausibly acquire -- and requires that a PERMANENT test notices. A mutant
# that survives means the gate is decorative.
#
# RESTORATION IS BY SNAPSHOT, NEVER BY GIT. The first version of this script
# ended with `git checkout -- app lib`, which looked safe because the script had
# only just edited those files. It was not: git checkout restores to HEAD, and
# it silently destroyed every UNCOMMITTED change made earlier in the same
# session. "Restore" here means "put back exactly what I changed", so each file
# is copied aside before it is mutated and copied back afterwards, and each
# database function is captured with pg_get_functiondef and replayed. The script
# ends by proving every file is byte-identical to its snapshot.
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_ovalball-saas-startup}"
PASS=0; SURVIVED=0; SURVIVORS=()

sql() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq -c "$1"; }

# Snapshot a function's EXACT definition before mutating it, and put that back afterwards.
# Re-running the owning migration was the first approach and it is fragile: a migration is a script
# with guards and side effects, not a definition. pg_get_functiondef is the definition.
SNAP_DIR="$(mktemp -d)"
snapshot_fn() { # snapshot_fn <schema> <name>
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq -c \
    "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='$1' and p.proname='$2' limit 1" > "$SNAP_DIR/$1.$2.sql"
  test -s "$SNAP_DIR/$1.$2.sql"
}
restore_fn() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -f - < "$SNAP_DIR/$1.$2.sql" >/dev/null; }

# Run a permanent gate. Returns 0 if it PASSES.
# Node prints "ℹ fail N" with a multibyte prefix, so anchoring on '^.' does not match and would have
# made EVERY mutant look killed -- a false green that is worse than a survivor. Match the number.
gate_js() {
  local out
  out="$(node --import ./scripts/email-test-loader.mjs --experimental-strip-types --test "$1" 2>&1)"
  grep -qE '(^|[^a-z])fail 0$' <<<"$out"
}
gate_sql() {
  local out
  out="$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -f - < "$1" 2>&1)"
  if grep -q 'FAIL' <<<"$out"; then return 1; fi
  return 0
}

# kill <name> <gate-command...>  -- the gate must FAIL while the mutant is live.
kill_check() {
  local name="$1"; shift
  if "$@"; then
    echo "  SURVIVED  $name"
    SURVIVED=$((SURVIVED+1)); SURVIVORS+=("$name")
  else
    echo "  killed    $name"
    PASS=$((PASS+1))
  fi
}

# File snapshot/restore. Keyed by a flattened path so nested files cannot collide.
snap_key() { echo "$1" | tr '/' '_'; }
snapshot() { for f in "$@"; do cp "$f" "$SNAP_DIR/$(snap_key "$f")"; done; }
restore()  { for f in "$@"; do cp "$SNAP_DIR/$(snap_key "$f")" "$f"; done; }
verify_restored() {
  local bad=0
  for f in "$@"; do
    cmp -s "$f" "$SNAP_DIR/$(snap_key "$f")" || { echo "  NOT RESTORED: $f"; bad=1; }
  done
  return $bad
}

# Everything this campaign is allowed to touch, snapshotted before anything is mutated.
MUTATED=(
  "app/(app)/layout.tsx"
  "lib/auth/require-session.ts"
  "lib/auth/session-decision.ts"
  "app/(app)/account/security/recovery-actions.ts"
  "app/api/gocardless/oauth/start/route.ts"
  "app/signup/steps/account-step.tsx"
  "lib/auth/challenge-state.ts"
)
snapshot "${MUTATED[@]}"

echo "=== Slice 6b.2a mutation campaign ==="
echo "snapshotted ${#MUTATED[@]} files into $SNAP_DIR"

# ---------------------------------------------------------------- M1
echo "M1 remove the (app) layout's requireSession"
perl -0pi -e 's/const decision = await requireSession\(\{\}, supabase\)/const decision = { ok: true, user: (await supabase.auth.getUser()).data.user } as never/' "app/(app)/layout.tsx"
kill_check "M1 layout boundary removed" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore "app/(app)/layout.tsx"

# ---------------------------------------------------------------- M2
echo "M2 make session liveness always true"
snapshot_fn internal session_live_only || { echo "  ABORT: could not snapshot session_live_only"; exit 1; }
sql "create or replace function internal.session_live_only() returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;" >/dev/null
kill_check "M2 session liveness disabled" gate_sql supabase/tests/session_boundary.sql
restore_fn internal session_live_only

# ---------------------------------------------------------------- M3
echo "M3 ignore suspended/disabled account state"
snapshot_fn internal is_account_active || { echo "  ABORT: could not snapshot is_account_active"; exit 1; }
# The parameter is p_user_id. Naming it anything else makes CREATE OR REPLACE fail, the mutant never
# goes live, and the run reports a survivor that was never alive -- which is how this line was found.
sql "create or replace function internal.is_account_active(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;" >/dev/null
kill_check "M3 account state ignored" gate_sql supabase/tests/session_boundary.sql
restore_fn internal is_account_active

# ---------------------------------------------------------------- M4
echo "M4 make allowAalElevation globally true"
perl -0pi -e 's/if \(!options\.allowAalElevation &&/if (true \|\| !options.allowAalElevation \&\&/' lib/auth/session-decision.ts
# Deliberately NOT the structural coverage guard. That one asserts which FILES may pass the option,
# and it survived this mutant on the first run because the option was still only passed by the two
# legitimate surfaces -- it had simply stopped meaning anything. The decision table is what notices.
kill_check "M4 assurance gate globally stood down" gate_js supabase/tests/js/session_decision.test.mts
restore lib/auth/session-decision.ts

# ---------------------------------------------------------------- M5
echo "M5 remove one protected Server Action guard"
perl -0pi -e 's/const gate = await guardAction\(\{\}, supabase\)\n\s*if \(!gate\.ok\) return \{ ok: false, error: gate\.error \}\n//' "app/(app)/account/security/recovery-actions.ts"
kill_check "M5 Server Action guard removed" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore "app/(app)/account/security/recovery-actions.ts"

# ---------------------------------------------------------------- M6
echo "M6 remove one protected route-handler guard"
perl -0pi -e 's/const decision = await requireSession\(\{\}, supabase\)/const decision = { ok: true } as never/' app/api/gocardless/oauth/start/route.ts
kill_check "M6 route handler guard removed" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore app/api/gocardless/oauth/start/route.ts

# ---------------------------------------------------------------- M7
echo "M7 treat a valid session as capability authority"
snapshot_fn internal has_site_capability || { echo "  ABORT: could not snapshot has_site_capability"; exit 1; }
sql "create or replace function internal.has_site_capability(p_key text) returns boolean language sql stable security definer set search_path='' as \$\$ select auth.uid() is not null \$\$;" >/dev/null
kill_check "M7 session treated as capability" gate_sql supabase/tests/session_boundary.sql
restore_fn internal has_site_capability

# ---------------------------------------------------------------- M8
echo "M8 restore the social-signup hardcoded null token"
perl -0pi -e 's/turnstileToken=\{turnstileToken\}/turnstileToken={null}/' app/signup/steps/account-step.tsx
kill_check "M8 social signup null token" gate_js supabase/tests/js/turnstile_challenge_state.test.mts
restore app/signup/steps/account-step.tsx

# ---------------------------------------------------------------- M9
echo "M9 permit humanPassed=true beside a null token"
perl -0pi -e 's/  if \(!required\) return true\n  return state\.passed && state\.token !== null/  if (!required) return true\n  return state.passed/' lib/auth/challenge-state.ts
kill_check "M9 passed-without-token permitted" gate_js supabase/tests/js/turnstile_challenge_state.test.mts
restore lib/auth/challenge-state.ts

# ---------------------------------------------------------------- M10
echo "M10 return the raw database error from cancelRecovery"
perl -0pi -e 's/    console\.error\("cancelRecovery refused:", error\.code \?\? error\.message\)\n    return \{ ok: false, error: toPublicSubmissionError\(\) \}/    return { ok: false, error: error.message }/' "app/(app)/account/security/recovery-actions.ts"
kill_check "M10 raw DB error to the browser" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore "app/(app)/account/security/recovery-actions.ts"

# =====================================================================================================
# M11-M16 -- the Slice 6b.2a CONTRACT MIGRATION.
#
# These mutants live in the database, not in the repository, so they are snapshotted with
# pg_get_functiondef and replayed from that exact definition. Re-running the migration would be the
# wrong restore: a migration is a script with guards and side effects, not a definition.
# =====================================================================================================
DB_MUTANTS=(
  "public.touch_last_active"
  "public.mark_announcement_read"
  "public.accept_guardian_invitation"
  "internal.require_live_session"
  "internal.is_account_active"
)
for q in "${DB_MUTANTS[@]}"; do
  snapshot_fn "${q%%.*}" "${q##*.}" || echo "  WARNING: could not snapshot $q"
done

CONTRACT_SUITE=supabase/tests/definer_rpc_session_contract.sql

# ---------------------------------------------------------------- M11
echo "M11 drop the session gate from a self-service RPC"
sql "create or replace function public.touch_last_active() returns void language sql security definer set search_path to 'public' as \$\$
  update public.profiles set last_active_at = now() where id = auth.uid();
\$\$;" >/dev/null
kill_check "M11 self-service RPC ungated" gate_sql "$CONTRACT_SUITE"
restore_fn public touch_last_active

# ---------------------------------------------------------------- M12
echo "M12 drop the session gate from a messaging/notification RPC"
sql "create or replace function public.mark_announcement_read(p_announcement_id uuid) returns void language plpgsql security definer set search_path to 'public','internal','pg_temp' as \$\$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  update public.messenger_announcement_deliveries
  set read_at = coalesce(read_at, now())
  where announcement_id = p_announcement_id and recipient_user_id = auth.uid() and status = 'delivered';
  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid() and type = 'announcement_received'
    and (data ->> 'announcement_id') = p_announcement_id::text;
end \$\$;" >/dev/null
kill_check "M12 notification RPC ungated" gate_sql "$CONTRACT_SUITE"
restore_fn public mark_announcement_read

# ---------------------------------------------------------------- M13
echo "M13 drop the session gate from invitation acceptance"
sql "create or replace function public.accept_guardian_invitation(p_token text) returns table(invitation_id uuid, club_id uuid, team_id uuid) language plpgsql security definer set search_path to 'public' as \$\$
declare inv public.guardian_invitations; v_email text;
begin
  select * into inv from public.guardian_invitations where token = p_token for update;
  if not found then raise exception 'Invitation not found.'; end if;
  if inv.status <> 'pending' then raise exception 'This invitation is no longer available.'; end if;
  if inv.expires_at < now() then
    update public.guardian_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired.';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null or lower(v_email) <> lower(inv.invited_email) then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;
  update public.guardian_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
  return query select inv.id, inv.club_id, inv.team_id;
end \$\$;" >/dev/null
kill_check "M13 invitation acceptance ungated" gate_sql "$CONTRACT_SUITE"
restore_fn public accept_guardian_invitation

# ---------------------------------------------------------------- M14
echo "M14 make the session gate always pass"
sql "create or replace function internal.require_live_session(p_allow_aal_elevation boolean default false) returns void language plpgsql stable security definer set search_path = '' as \$\$
begin
  return;
end \$\$;" >/dev/null
kill_check "M14 session gate stood down globally" gate_sql "$CONTRACT_SUITE"
restore_fn internal require_live_session

# ---------------------------------------------------------------- M15
echo "M15 make every account read as active"
sql "create or replace function internal.is_account_active(p_user_id uuid) returns boolean language sql stable security definer set search_path = '' as \$\$
  select p_user_id is not null;
\$\$;" >/dev/null
kill_check "M15 account state ignored" gate_sql "$CONTRACT_SUITE"
restore_fn internal is_account_active

# ---------------------------------------------------------------- M16
# The one the structural tests cannot see: the session gate is kept, and the ORIGINAL authority --
# the exact-email match on a real invitation -- is dropped. A suite that only proved "refused when
# revoked" would call this a pass.
echo "M16 keep the session gate, drop the invitation's email boundary"
sql "create or replace function public.accept_guardian_invitation(p_token text) returns table(invitation_id uuid, club_id uuid, team_id uuid) language plpgsql security definer set search_path to 'public' as \$\$
declare inv public.guardian_invitations;
begin
  perform internal.require_live_session();
  select * into inv from public.guardian_invitations where token = p_token for update;
  if not found then raise exception 'Invitation not found.'; end if;
  if inv.status <> 'pending' then raise exception 'This invitation is no longer available.'; end if;
  if inv.expires_at < now() then
    update public.guardian_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired.';
  end if;
  update public.guardian_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
  return query select inv.id, inv.club_id, inv.team_id;
end \$\$;" >/dev/null
kill_check "M16 invitation email boundary removed while the gate stays" gate_sql "$CONTRACT_SUITE"
restore_fn public accept_guardian_invitation

# =====================================================================================================
# M17-M21 -- the email delivery-result AUTHORISATION fix (20270502000000).
#
# A different question from M11-M16. Those ask whether a dead session is refused; these ask whether a
# perfectly LIVE one is kept to its own deliveries.
# =====================================================================================================
EMAIL_MUTANTS=(
  "public.record_email_delivery_result"
  "public.claim_email_delivery"
)
for q in "${EMAIL_MUTANTS[@]}"; do
  snapshot_fn "${q%%.*}" "${q##*.}" || echo "  WARNING: could not snapshot $q"
done
DB_MUTANTS+=("${EMAIL_MUTANTS[@]}")

EMAIL_SUITE=supabase/tests/email_delivery_result_authority.sql

record_result_body() { # record_result_body <authority-clause> <where-clause>
  sql "create or replace function public.record_email_delivery_result(p_delivery_id uuid, p_status text, p_provider text default null, p_provider_reference text default null, p_error_code text default null, p_error_message text default null, p_suppression_reason text default null) returns void language plpgsql security definer set search_path to 'public' as \$\$
begin
  if auth.uid() is null then
    raise exception 'Email delivery results may only be recorded by an authenticated session.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  $1
  update public.email_deliveries
  set status = p_status,
      provider = coalesce(p_provider, provider),
      provider_reference = coalesce(p_provider_reference, provider_reference),
      error_code = p_error_code,
      error_message = p_error_message,
      suppression_reason = p_suppression_reason,
      attempts = attempts + case when p_status in ('sent','failed') then 1 else 0 end,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end
  where id = p_delivery_id $2;
end \$\$;" >/dev/null
}

# ---------------------------------------------------------------- M17
echo "M17 remove the delivery-result authority boundary entirely"
record_result_body "" ""
kill_check "M17 delivery-result authority removed" gate_sql "$EMAIL_SUITE"
restore_fn public record_email_delivery_result

# ---------------------------------------------------------------- M18
# The subtle one: the check is still there and still mentions initiated_by, but it accepts anybody
# who is signed in. A structural grep for "initiated_by" would call this fixed.
echo "M18 treat any live authenticated caller as the claimant"
record_result_body "if not exists (select 1 from public.email_deliveries d where d.id = p_delivery_id and (d.initiated_by is not null or auth.uid() is not null)) then
    raise exception 'That delivery is not yours to record a result for.' using errcode = '42501';
  end if;" ""
kill_check "M18 any live caller treated as claimant" gate_sql "$EMAIL_SUITE"
restore_fn public record_email_delivery_result

# ---------------------------------------------------------------- M19
echo "M19 stop the claim recording who claimed it"
sql "create or replace function public.claim_email_delivery(p_event_key text, p_idempotency_key text, p_occurrence_key text, p_recipient_kind text, p_recipient_ref uuid default null, p_recipient_email text default null, p_club_id uuid default null, p_subject text default null) returns uuid language plpgsql security definer set search_path to 'public' as \$\$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Email delivery may only be claimed by an authenticated session.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  insert into public.email_deliveries (event_key, idempotency_key, occurrence_key, recipient_kind, recipient_ref, recipient_email, club_id, subject)
  values (p_event_key, p_idempotency_key, p_occurrence_key, p_recipient_kind, p_recipient_ref, p_recipient_email, p_club_id, p_subject)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end \$\$;" >/dev/null
kill_check "M19 claim ownership binding removed" gate_sql "$EMAIL_SUITE"
restore_fn public claim_email_delivery

# ---------------------------------------------------------------- M20
# Authority kept at the guard, dropped from the UPDATE's own WHERE. A TOCTOU-shaped mutant: the check
# and the write must agree, or a terminal row is writable in the gap between them.
echo "M20 keep the guard, drop the binding from the write itself"
record_result_body "if not exists (select 1 from public.email_deliveries d where d.id = p_delivery_id) then
    raise exception 'That delivery is not yours to record a result for.' using errcode = '42501';
  end if;" ""
kill_check "M20 terminal result overwritable by a non-claimant" gate_sql "$EMAIL_SUITE"
restore_fn public record_email_delivery_result

# ---------------------------------------------------------------- M21
# There is no caller-supplied ownership argument, and there must never be one. This mutant introduces
# the shape anyway -- authority derived from what the caller says rather than from the row.
echo "M21 trust a caller-supplied provider value as authority"
record_result_body "if not exists (select 1 from public.email_deliveries d where d.id = p_delivery_id
      and (d.initiated_by = auth.uid() or p_provider = 'zeptomail')) then
    raise exception 'That delivery is not yours to record a result for.' using errcode = '42501';
  end if;" ""
kill_check "M21 caller-supplied value accepted as authority" gate_sql "$EMAIL_SUITE"
restore_fn public record_email_delivery_result

echo
echo "=== proving every mutated database function is byte-identical to its snapshot ==="
DB_DIRTY=0
for q in "${DB_MUTANTS[@]}"; do
  live="$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq -c \
    "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='${q%%.*}' and p.proname='${q##*.}' limit 1")"
  if [ "$live" != "$(cat "$SNAP_DIR/${q%%.*}.${q##*.}.sql")" ]; then
    echo "  NOT RESTORED: $q"; DB_DIRTY=1
  fi
done
[ "$DB_DIRTY" -eq 0 ] && echo "all ${#DB_MUTANTS[@]} mutated database functions restored exactly"

echo
echo "=== proving every mutated file is byte-identical to its snapshot ==="
if verify_restored "${MUTATED[@]}"; then
  echo "all ${#MUTATED[@]} mutated files restored exactly"
  DIRTY=0
else
  DIRTY=1
fi
rm -rf "$SNAP_DIR"

echo
echo "killed: $PASS    survived: $SURVIVED"
if [ "$SURVIVED" -gt 0 ]; then printf '  SURVIVOR: %s\n' "${SURVIVORS[@]}"; fi
[ "$SURVIVED" -eq 0 ] && [ "$DIRTY" -eq 0 ] && [ "$DB_DIRTY" -eq 0 ]
