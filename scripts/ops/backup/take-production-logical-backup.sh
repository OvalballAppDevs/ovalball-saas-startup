#!/usr/bin/env bash
# One ENCRYPTED, VERIFIED logical backup of the Ovalball production database -- and nothing else.
#
#   PLAN (default; connects to nothing):
#     scripts/ops/backup/take-production-logical-backup.sh --operator NAME --out-dir DIR \
#         --recipient-cert CERT.pem --verify-key KEY.pem --connection direct|session-pooler [--pooler-host HOST]
#   EXECUTE (only with the owner's explicit approval for this one backup):
#     ... the same ... --execute
#   REHEARSAL against a DISPOSABLE local stack (fictional data; same procedure end to end):
#     ... --test-local-project-dir DIR [--execute]
#
# WHAT IT DOES, IN ORDER -- and it stops, deleting every plaintext byte it wrote, at the first thing that is not right:
#  1. Preconditions: FileVault on; --out-dir is new, absolute, outside the repository and outside any synced folder
#     (iCloud, Dropbox, Google Drive, OneDrive, ~/Library/CloudStorage), created mode 700; the recipient certificate
#     is a dedicated RSA-4096 Ovalball backup certificate that has not expired; docker, npx, openssl, shasum present.
#  2. The database password is read from the terminal (never an argument, never echoed, never logged) and handed to
#     the tools only as the PGPASSWORD environment variable of a local Postgres container.
#  3. IDENTITY, read-only: the session runs with default_transaction_read_only=on and must report itself read-only;
#     the cluster's system_identifier must equal production's (7678069749886157684); the ledger count/last version and
#     the public table count are recorded. Anything else -> stop, nothing dumped.
#  4. The dump: the Supabase CLI's own pg_dump scripts (--dry-run, so the rehearsed format), with a placeholder in
#     place of the password that is then removed, run inside the local Postgres image with PGPASSWORD and
#     PGOPTIONS=-c default_transaction_read_only=on; pg_dump also runs its own READ ONLY transaction. Plus the
#     capture-supplement.sql parts (managed, defer, recheck, cron, ledger, vaultnames) in the same read-only way.
#  5. INTEGRITY before anything is called a backup: every file non-empty; schema.sql and data.sql end with pg_dump's
#     completion marker; one data COPY per public table; the ledger part holds exactly the recorded number of
#     versions and the recorded last one; the cron part one schedule per job; the Vault part the two pepper names.
#  6. SHA256SUMS + a manifest (no secret, no personal data), tar, encrypted with `openssl cms -aes256` to the
#     dedicated recipient certificate. CMS here is not authenticated, so integrity is the SHA-256 of the ciphertext,
#     recorded in custody.json OUTSIDE the archive, and the round trip below.
#  7. ROUND TRIP: the archive is decrypted with the dedicated private key (its passphrase is asked for by openssl),
#     unpacked into a scratch folder and every file checked against SHA256SUMS. Only then: plaintext and scratch are
#     deleted and BACKUP VERIFIED is printed with the ciphertext digest. Any failure: everything plaintext is deleted
#     and the partial archive too.
# It changes nothing in production: no SQL other than SELECT, in sessions that cannot write. Its log holds no password,
# no connection string with a password, no data.
set -euo pipefail
umask 077

PROD_REF="ywwdizmaanbujcfitpcj"
PROD_SYSTEM_IDENTIFIER="7678069749886157684"
PERSISTENT_PROJECT_ID="ovalball-saas-startup"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
CAPTURE="$REPO/scripts/ops/restore/capture-supplement.sql"

OPERATOR=""; OUT=""; CERT=""; VKEY=""; CONN=""; POOLER_HOST=""; TEST_DIR=""; EXECUTE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --operator) OPERATOR="$2"; shift 2 ;;
    --out-dir) OUT="$2"; shift 2 ;;
    --recipient-cert) CERT="$2"; shift 2 ;;
    --verify-key) VKEY="$2"; shift 2 ;;
    --connection) CONN="$2"; shift 2 ;;
    --pooler-host) POOLER_HOST="$2"; shift 2 ;;
    --test-local-project-dir) TEST_DIR="$2"; shift 2 ;;
    --execute) EXECUTE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 2; }
fault() { [ -n "$TEST_DIR" ] && [ "${OVB_BACKUP_TEST_FAULT:-}" = "$1" ]; }   # failure injection: rehearsal mode only

# ---------------------------------------------------------------------------------------------- 1. preconditions
[[ "$OPERATOR" =~ ^[A-Za-z][A-Za-z\ .\'-]{1,60}$ ]] || refuse "--operator must name the person running this"
[ -n "$OUT" ] && [[ "$OUT" = /* ]] || refuse "--out-dir must be an absolute path"
[ ! -e "$OUT" ] || refuse "--out-dir must not exist yet (one backup, one new folder)"
OUT_PARENT="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd -P)" || refuse "the parent of --out-dir does not exist"
OUT="$OUT_PARENT/$(basename "$OUT")"
case "$OUT/" in
  "$REPO"/*) refuse "--out-dir is inside the repository" ;;
  "$HOME/Library/Mobile Documents/"*|"$HOME/Library/CloudStorage/"*|"$HOME/Dropbox/"*|"$HOME/Google Drive/"*|"$HOME/OneDrive"*|"$HOME/iCloud Drive"*)
    refuse "--out-dir is inside a synced folder" ;;
esac
fdesetup status 2>/dev/null | grep -q "FileVault is On" || refuse "FileVault is not on"
for t in docker npx openssl shasum tar python3; do command -v "$t" >/dev/null || refuse "$t is not installed"; done
[ -f "$CERT" ] || refuse "--recipient-cert not found"
[ -f "$VKEY" ] || refuse "--verify-key not found (the round-trip check is mandatory)"
subject="$(openssl x509 -in "$CERT" -noout -subject 2>/dev/null)" || refuse "--recipient-cert is not a certificate"
[[ "$subject" == *ovalball-backup* ]] || refuse "the recipient certificate is not a dedicated Ovalball backup certificate (CN must contain ovalball-backup)"
openssl x509 -in "$CERT" -noout -checkend 0 >/dev/null || refuse "the recipient certificate has expired"
openssl x509 -in "$CERT" -noout -text | grep -q "Public-Key: (4096 bit)" || refuse "the recipient key must be RSA 4096"
CERT_FP="$(openssl x509 -in "$CERT" -noout -fingerprint -sha256 | sed 's/.*=//')"
PGIMAGE="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 '^public.ecr.aws/supabase/postgres:17\.')" || refuse "no local supabase/postgres:17 image (pg_dump 17 is needed)"

if [ -n "$TEST_DIR" ]; then
  # Rehearsal: a DISPOSABLE local stack, never the persistent one, never production.
  [ -f "$TEST_DIR/supabase/config.toml" ] || refuse "--test-local-project-dir must hold supabase/config.toml"
  TPID="$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([a-z0-9-]*\)"[[:space:]]*$/\1/p' "$TEST_DIR/supabase/config.toml")"
  [[ "$TPID" =~ ^[a-z0-9][a-z0-9-]*$ ]] && [ "$TPID" != "$PERSISTENT_PROJECT_ID" ] || refuse "not a disposable project"
  DBPORT="$(awk '/^\[db\]/{f=1;next} /^\[/{f=0} f && /^port[[:space:]]*=/{gsub(/[^0-9]/,"");print;exit}' "$TEST_DIR/supabase/config.toml")"
  HOST_FOR_CLI="127.0.0.1"; HOST_FOR_CONTAINER="host.docker.internal"; PORT="$DBPORT"; DBUSER="postgres"
  EXPECTED_ID="$(docker exec "supabase_db_$TPID" psql -U postgres -tAc "select system_identifier from pg_control_system()")"
  TARGET_DESC="disposable local project $TPID (rehearsal)"
else
  case "$CONN" in
    direct) HOST_FOR_CLI="db.$PROD_REF.supabase.co"; PORT=5432; DBUSER="postgres" ;;
    session-pooler)
      [[ "$POOLER_HOST" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ ]] || refuse "--pooler-host must be the project's Supabase session pooler host (aws-N-<region>.pooler.supabase.com)"
      HOST_FOR_CLI="$POOLER_HOST"; PORT=5432; DBUSER="postgres.$PROD_REF" ;;   # 5432 on the pooler = SESSION mode
    *) refuse "--connection must be direct or session-pooler" ;;
  esac
  HOST_FOR_CONTAINER="$HOST_FOR_CLI"; EXPECTED_ID="$PROD_SYSTEM_IDENTIFIER"
  TARGET_DESC="PRODUCTION project $PROD_REF via $CONN ($HOST_FOR_CLI:$PORT, user $DBUSER)"
fi

cat <<PLAN
Backup plan
  source       : $TARGET_DESC
  identity     : system_identifier must be $EXPECTED_ID; session must be read-only
  operator     : $OPERATOR
  destination  : $OUT (new, mode 700, FileVault)
  encryption   : openssl cms -aes256 to $(basename "$CERT") (RSA-4096, SHA-256 fingerprint $CERT_FP)
  round trip   : decrypt with $(basename "$VKEY"), check every file against SHA256SUMS
  dump image   : $PGIMAGE
PLAN
if [ "$EXECUTE" -ne 1 ]; then echo "PLAN ONLY. Nothing was connected to, read or written. Re-run with --execute."; exit 0; fi

# ---------------------------------------------------------------------------------------------- 2. secret + workspace
if [ -n "$TEST_DIR" ]; then PGPASSWORD="${OVB_BACKUP_TEST_PASSWORD:-postgres}"; else
  printf "Database password for %s (not echoed): " "$DBUSER" >&2; IFS= read -rs PGPASSWORD; echo >&2
fi
[ -n "$PGPASSWORD" ] || refuse "no password given"
export PGPASSWORD
mkdir -m 700 "$OUT"
WORK="$OUT/.plain"; VERIFY="$OUT/.verify"; mkdir -m 700 "$WORK"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; ARCHIVE="$OUT/ovalball-db-backup-$STAMP.tar.cms"; LOG="$OUT/backup.log"
OK=0
finish() {
  rm -rf "$WORK" "$VERIFY"                      # plaintext never survives, success or failure
  if [ "$OK" -ne 1 ]; then rm -f "$ARCHIVE" "$OUT/custody.json"; echo "BACKUP FAILED -- nothing usable was produced; plaintext deleted. See $LOG" >&2; fi
  unset PGPASSWORD
}
trap finish EXIT
scrub() { python3 -c 'import os,sys; p=os.environ.get("PGPASSWORD",""); d=sys.stdin.read(); sys.stdout.write(d.replace(p,"***") if p else d)'; }
log() { echo "[$(date -u +%H:%M:%S)] $*" | scrub | tee -a "$LOG"; }
pg() {  # read-only psql in the local Postgres image; credentials only in the environment
  docker run --rm -i -e PGPASSWORD -e PGOPTIONS='-c default_transaction_read_only=on' "$PGIMAGE" \
    psql "host=$HOST_FOR_CONTAINER port=$PORT user=$DBUSER dbname=postgres sslmode=${SSLMODE:-require} connect_timeout=15" -X -v ON_ERROR_STOP=1 "$@"
}
[ -n "$TEST_DIR" ] && SSLMODE=disable

# ---------------------------------------------------------------------------------------------- 3. identity
log "identity check against $TARGET_DESC"
ident="$(pg -tA -F'|' -c "select current_setting('transaction_read_only'), (select system_identifier from pg_control_system()), (select count(*) from supabase_migrations.schema_migrations), (select max(version) from supabase_migrations.schema_migrations), (select count(*) from pg_tables where schemaname = 'public'), (select count(*) from cron.job)" 2>>"$LOG" </dev/null)" || { log "could not connect (see the log)"; exit 3; }
IFS='|' read -r RO SYSID LEDGER_N LEDGER_MAX PUB_TABLES CRON_N <<<"$ident"
fault wrong-identity && SYSID="0"
[ "$RO" = "on" ] || { log "the session is NOT read-only ($RO): stopping"; exit 3; }
[ "$SYSID" = "$EXPECTED_ID" ] || { log "system_identifier $SYSID is not the expected $EXPECTED_ID: stopping, nothing dumped"; exit 3; }
log "read-only session; system_identifier matches; ledger $LEDGER_N / $LEDGER_MAX; $PUB_TABLES public tables; $CRON_N cron jobs"

# ---------------------------------------------------------------------------------------------- 4. dump
cli_script() {  # the CLI's own pg_dump script, with a placeholder instead of the password, which is then removed
  local url="postgresql://$DBUSER:OVBPLACEHOLDER@$HOST_FOR_CLI:$PORT/postgres"
  (cd "$REPO" && npx supabase db dump --db-url "$url" --dry-run "$@" 2>/dev/null) \
    | sed -n '/^#!\/usr\/bin\/env bash/,$p' | grep -v '^export PGPASSWORD=' \
    | sed -e "s/^export PGHOST=.*/export PGHOST=\"$HOST_FOR_CONTAINER\"/" -e "s/^export PGUSER=.*/export PGUSER=\"$DBUSER\"/" || true
}
dump() {  # $1 file, rest: CLI flags
  local f="$1"; shift
  local script; script="$(cli_script "$@")" || script=""
  grep -q 'OVBPLACEHOLDER' <<<"$script" && { log "the dump script still carries a credential placeholder: stopping"; exit 4; }
  grep -qE '^(pg_dump|pg_dumpall) ' <<<"$script" || { log "could not obtain the CLI's dump script for $f"; exit 4; }
  docker run --rm -i -e PGPASSWORD -e PGSSLMODE="${SSLMODE:-require}" -e PGOPTIONS='-c default_transaction_read_only=on' \
    "$PGIMAGE" bash -s <<<"$script" > "$WORK/$f" 2>>"$LOG" || { log "dump of $f failed"; exit 4; }
  log "dumped $f ($(wc -c < "$WORK/$f" | tr -d ' ') bytes)"
}
dump roles.sql --role-only
dump schema.sql --keep-comments
dump data.sql --data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes   # keeps pg_dump's comments already
for part in managed defer recheck cron ledger vaultnames; do
  pg -tA -v part="$part" -f - < "$CAPTURE" > "$WORK/$part.sql" 2>>"$LOG" || { log "capture of $part failed"; exit 4; }
done
log "supplement captured (managed, defer, recheck, cron, ledger, vaultnames)"
fault truncate-data && head -c $(( $(wc -c < "$WORK/data.sql") / 2 )) "$WORK/data.sql" > "$WORK/x" && mv "$WORK/x" "$WORK/data.sql"
fault drop-cron && : > "$WORK/cron.sql"

# ---------------------------------------------------------------------------------------------- 5. integrity
bad() { log "INTEGRITY: $*"; exit 5; }
for f in roles.sql schema.sql data.sql managed.sql ledger.sql cron.sql vaultnames.sql; do [ -s "$WORK/$f" ] || bad "$f is empty"; done
tail -c 400 "$WORK/schema.sql" | grep -q "PostgreSQL database dump complete" || bad "schema.sql is incomplete (no completion marker)"
tail -c 400 "$WORK/data.sql" | grep -q "PostgreSQL database dump complete" || bad "data.sql is incomplete (no completion marker)"
copies="$(grep -cE '^COPY "public"\.' "$WORK/data.sql" || true)"
[ "$copies" = "$PUB_TABLES" ] || bad "data.sql has $copies public COPY blocks, the database has $PUB_TABLES public tables"
ledger_rows="$(grep -oE "'[0-9]{14}'" "$WORK/ledger.sql" | sort -u | wc -l | tr -d ' ')"
[ "$ledger_rows" = "$LEDGER_N" ] || bad "ledger part holds $ledger_rows versions, the database $LEDGER_N"
grep -q "'$LEDGER_MAX'" "$WORK/ledger.sql" || bad "ledger part lacks the last version $LEDGER_MAX"
cron_rows="$(grep -c "^select cron.schedule(" "$WORK/cron.sql" || true)"
[ "$cron_rows" = "$CRON_N" ] || bad "cron part holds $cron_rows jobs, the database $CRON_N"
for v in invitation_code_pepper recovery_code_pepper; do grep -q "$v" "$WORK/vaultnames.sql" || bad "Vault names lack $v"; done
log "integrity: completion markers present; $copies public tables; $ledger_rows ledger versions to $LEDGER_MAX; $cron_rows cron jobs; both pepper names"

# ---------------------------------------------------------------------------------------------- 6. checksums, manifest, encryption
(cd "$WORK" && shasum -a 256 *.sql > SHA256SUMS)
python3 - "$WORK/manifest.json" <<PY
import json, sys, os
w = os.path.dirname(sys.argv[1])
files = {f: os.path.getsize(os.path.join(w, f)) for f in sorted(os.listdir(w)) if f.endswith(".sql")}
json.dump({"created_utc": "$STAMP", "operator": "$OPERATOR", "source": "$TARGET_DESC", "system_identifier": "$SYSID",
           "ledger": {"count": int("$LEDGER_N"), "last": "$LEDGER_MAX"}, "public_tables": int("$PUB_TABLES"),
           "cron_jobs": int("$CRON_N"), "file_bytes": files, "pg_image": "$PGIMAGE"}, open(sys.argv[1], "w"), indent=1)
PY
tar -C "$WORK" -cf - . | openssl cms -encrypt -aes256 -binary -stream -outform DER -out "$ARCHIVE" "$CERT" \
  || { log "encryption failed"; exit 6; }
fault corrupt-cipher && printf '\x00' | dd of="$ARCHIVE" bs=1 seek=4096 conv=notrunc 2>/dev/null
CIPHER_SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
log "encrypted: $(basename "$ARCHIVE") ($(wc -c < "$ARCHIVE" | tr -d ' ') bytes), SHA-256 $CIPHER_SHA"

# ---------------------------------------------------------------------------------------------- 7. round trip
mkdir -m 700 "$VERIFY"
log "round trip: decrypting with the dedicated private key (openssl may ask for its passphrase)"
openssl cms -decrypt -binary -inform DER -in "$ARCHIVE" -inkey "$VKEY" ${OVB_BACKUP_KEY_PASSIN:+-passin "$OVB_BACKUP_KEY_PASSIN"} \
  | tar -C "$VERIFY" -xf - 2>>"$LOG" || { log "the archive does not decrypt and unpack with the verify key"; exit 7; }
(cd "$VERIFY" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1) || { log "the decrypted files do not match SHA256SUMS"; exit 7; }
(cd "$VERIFY" && shasum -a 256 *.sql) | diff -q - "$WORK/SHA256SUMS" >/dev/null || { log "decrypted digests differ from the plaintext digests"; exit 7; }
cp "$WORK/manifest.json" "$OUT/manifest.json"
python3 - "$OUT/custody.json" <<PY
import json, sys
json.dump({"archive": "$(basename "$ARCHIVE")", "archive_sha256": "$CIPHER_SHA", "recipient_cert_sha256": "$CERT_FP",
           "operator": "$OPERATOR", "created_utc": "$STAMP", "source": "$TARGET_DESC", "system_identifier": "$SYSID",
           "ledger_last": "$LEDGER_MAX", "verified": "decrypted and every file matched SHA256SUMS"}, open(sys.argv[1], "w"), indent=1)
PY
OK=1
log "BACKUP VERIFIED: $(basename "$ARCHIVE") SHA-256 $CIPHER_SHA (custody record: $OUT/custody.json)"
