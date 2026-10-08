#!/usr/bin/env python3
"""One ENCRYPTED, VERIFIED export of every production Storage object -- separate from the database backup.

  PLAN (default; connects to nothing):
    scripts/ops/backup/take-production-storage-export.py --operator NAME --out-dir DIR \\
        --recipient-cert CERT.pem --verify-key KEY.pem --db-root-cert SUPABASE_CA.crt \\
        --connection direct|session-pooler [--pooler-host HOST]
  EXECUTE (only with the owner's explicit approval for this one export):        ... --execute
  REHEARSAL against a DISPOSABLE local stack (fictional data):                  ... --test-local-project-dir DIR

WHAT IT DOES -- and it stops, deleting every plaintext byte it wrote, at the first thing that is not right:
 1. Preconditions as the database backup: FileVault on; a new --out-dir outside the repository and every synced
    folder, mode 700; a dedicated, unexpired RSA-4096 Ovalball backup certificate; the verify key present.
 2. Credentials are read from the terminal, never from arguments, never logged: the database password (used only as
    PGPASSWORD of a local Postgres container) and the service-role key (used only in request headers).
 3. IDENTITY: a read-only database session must report itself read-only and production's system_identifier; the
    Storage API base is PINNED to https://<production ref>.supabase.co; the service-role key must decode to that
    project ref and the service_role role (checked locally, never printed). Anything else -> stop, nothing read.
 4. INVENTORY, read-only: every bucket and every object row from storage.buckets / storage.objects (name, size,
    MIME type, cache-control, ETag, user metadata), in that same read-only session; then the Storage API's own
    listing (paginated, walked through every folder) must name exactly the same objects. Any difference -> stop.
 5. EXPORT, GET only: each object's bytes, with no proxy and no redirect followed; each must have HTTP 200, exactly
    the inventory's size, and (where the ETag is a plain MD5) that MD5; its SHA-256 is recorded. Any failure -> stop.
 6. Manifest (inside the archive): buckets with their settings, and per object bucket, path, size, MIME type,
    cache-control, ETag, user metadata and SHA-256 -- for a later restore to verify against.
 7. Encrypted with `openssl cms -aes256` to the dedicated certificate (NOT authenticated encryption: integrity is the
    archive SHA-256, which the operator escrows independently of this Mac, and the round trip below).
 8. ROUND TRIP: decrypt with the dedicated key, unpack, re-hash every object against the manifest. Only then:
    plaintext deleted and EXPORT VERIFIED printed, with the digest to escrow.
It changes nothing in production: SELECTs in read-only sessions, and HTTP GETs (plus the Storage list endpoint,
which is a read). Its log holds counts only -- no object path, no URL, no key, no password.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROD_REF = "ywwdizmaanbujcfitpcj"
PROD_SYSTEM_IDENTIFIER = "7678069749886157684"
PROD_API = f"https://{PROD_REF}.supabase.co"
PERSISTENT_PROJECT_ID = "ovalball-saas-startup"
REPO = Path(__file__).resolve().parents[3]
PAGE = 100


class Stop(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def sh(*args, timeout=120):
    return subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)


def main() -> int:
    pp = os.environ.pop("OVB_BACKUP_KEY_PASSPHRASE", "")   # before any child process exists: none inherits it
    ap = argparse.ArgumentParser()
    ap.add_argument("--operator", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--recipient-cert", required=True)
    ap.add_argument("--verify-key", required=True)
    ap.add_argument("--db-root-cert")
    ap.add_argument("--connection", choices=["direct", "session-pooler"])
    ap.add_argument("--pooler-host")
    ap.add_argument("--test-local-project-dir")
    ap.add_argument("--execute", action="store_true")
    a = ap.parse_args()
    test = a.test_local_project_dir
    fault = os.environ.get("OVB_EXPORT_TEST_FAULT", "") if test else ""   # failure injection: rehearsal only

    def refuse(msg):
        print(f"REFUSED: {msg}", file=sys.stderr)
        sys.exit(2)

    # ------------------------------------------------------------------------------------------ 1. preconditions
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,60}", a.operator):
        refuse("--operator must name the person running this")
    out = Path(a.out_dir)
    if not out.is_absolute():
        refuse("--out-dir must be an absolute path")
    if out.exists():
        refuse("--out-dir must not exist yet (one export, one new folder)")
    try:
        out = out.parent.resolve(strict=True) / out.name
    except FileNotFoundError:
        refuse("the parent of --out-dir does not exist")
    home = Path.home()
    synced = [home / "Library/Mobile Documents", home / "Library/CloudStorage", home / "Dropbox", home / "Google Drive", home / "OneDrive", home / "iCloud Drive"]
    if str(out).startswith(str(REPO) + "/"):
        refuse("--out-dir is inside the repository")
    if any(str(out).startswith(str(p)) for p in synced):
        refuse("--out-dir is inside a synced folder")
    if "FileVault is On" not in sh("fdesetup", "status").stdout:
        refuse("FileVault is not on")
    cert, vkey = Path(a.recipient_cert), Path(a.verify_key)
    if not cert.is_file():
        refuse("--recipient-cert not found")
    if not vkey.is_file():
        refuse("--verify-key not found (the round-trip check is mandatory)")
    subj = sh("openssl", "x509", "-in", str(cert), "-noout", "-subject")
    if subj.returncode != 0:
        refuse("--recipient-cert is not a certificate")
    if "ovalball-backup" not in subj.stdout:
        refuse("the recipient certificate is not a dedicated Ovalball backup certificate (CN must contain ovalball-backup)")
    if sh("openssl", "x509", "-in", str(cert), "-noout", "-checkend", "0").returncode != 0:
        refuse("the recipient certificate has expired")
    if "Public-Key: (4096 bit)" not in sh("openssl", "x509", "-in", str(cert), "-noout", "-text").stdout:
        refuse("the recipient key must be RSA 4096")
    cert_fp = sh("openssl", "x509", "-in", str(cert), "-noout", "-fingerprint", "-sha256").stdout.strip().split("=")[-1]
    images = [l for l in sh("docker", "images", "--format", "{{.Repository}}:{{.Tag}}").stdout.split() if l.startswith("public.ecr.aws/supabase/postgres:17.")]
    if not images:
        refuse("no local supabase/postgres:17 image (psql is needed)")
    pgimage = images[0]

    if test:
        cfg = Path(test) / "supabase" / "config.toml"
        if not cfg.is_file():
            refuse("--test-local-project-dir must hold supabase/config.toml")
        m = re.search(r'^\s*project_id\s*=\s*"([a-z0-9][a-z0-9-]*)"\s*$', cfg.read_text(), re.M)
        if not m or m.group(1) == PERSISTENT_PROJECT_ID:
            refuse("not a disposable project")
        tpid = m.group(1)
        st = {k: v.strip().strip('"') for k, v in (l.split("=", 1) for l in subprocess.run(
            ["npx", "supabase", "status", "-o", "env"], cwd=test, capture_output=True, text=True, timeout=120).stdout.splitlines() if "=" in l)}
        api = st.get("API_URL", "")
        mport = re.search(r":(\d+)/", st.get("DB_URL", ""))
        if not re.fullmatch(r"http://127\.0\.0\.1:\d+", api) or not mport:
            refuse("the rehearsal stack is not running on loopback")
        dbport = mport.group(1)
        db = dict(host="host.docker.internal", port=dbport, user="postgres", sslmode="disable")
        expected_id = sh("docker", "exec", f"supabase_db_{tpid}", "psql", "-U", "postgres", "-tAc", "select system_identifier from pg_control_system()").stdout.strip()
        source = f"disposable local project {tpid} (rehearsal)"
    else:
        if a.connection == "direct":
            db = dict(host=f"db.{PROD_REF}.supabase.co", port="5432", user="postgres", sslmode="verify-full")
        elif a.connection == "session-pooler":
            if not a.pooler_host or not re.fullmatch(r"aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com", a.pooler_host):
                refuse("--pooler-host must be the project's Supabase session pooler host")
            db = dict(host=a.pooler_host, port="5432", user=f"postgres.{PROD_REF}", sslmode="verify-full")
        else:
            refuse("--connection must be direct or session-pooler")
        # TLS must AUTHENTICATE the database server (sslmode=require does not): libpq checks the chain against the
        # project's Supabase root CA (Dashboard -> Database -> Settings -> SSL configuration) and the host name BEFORE
        # any credential is sent. (The Storage API is HTTPS, verified against the system trust store.)
        if not a.db_root_cert or not Path(a.db_root_cert).is_file():
            refuse("--db-root-cert (the project's Supabase root CA) is required for production")
        if sh("openssl", "x509", "-in", a.db_root_cert, "-noout").returncode != 0:
            refuse("--db-root-cert is not a PEM certificate")
        api, expected_id = PROD_API, PROD_SYSTEM_IDENTIFIER
        source = f"PRODUCTION project {PROD_REF} (Storage API {PROD_API}; database {db['host']}:{db['port']} as {db['user']})"

    print("Storage export plan")
    print(f"  source       : {source}")
    print(f"  identity     : system_identifier must be {expected_id}; read-only session; key must be this project's service_role")
    print(f"  operator     : {a.operator}")
    print(f"  destination  : {out} (new, mode 700, FileVault)")
    print(f"  encryption   : openssl cms -aes256 to {cert.name} (RSA-4096, SHA-256 fingerprint {cert_fp})")
    print(f"  round trip   : decrypt with {vkey.name}, re-hash every object against the manifest")
    print(f"  database TLS : {db['sslmode']}" + (f" against {Path(a.db_root_cert).name}" if not test else " (local rehearsal)"))
    if not a.execute:
        print("PLAN ONLY. Nothing was connected to, read or written. Re-run with --execute.")
        return 0

    # ------------------------------------------------------------------------------------------ 2. key match, secrets, workspace
    os.umask(0o077)
    # The key's passphrase is typed at openssl's own prompt. Rehearsals may set OVB_BACKUP_KEY_PASSPHRASE: openssl
    # gets `-passin env:NAME` (the name, never the value, in an argument) and no other child process inherits it.
    if pp and not test:
        refuse("OVB_BACKUP_KEY_PASSPHRASE is for rehearsals only; production types the passphrase at openssl's prompt")
    passin = ["-passin", "env:OVB_BACKUP_KEY_PASSPHRASE"] if pp else []
    ossl_env = {**os.environ, "OVB_BACKUP_KEY_PASSPHRASE": pp} if pp else dict(os.environ)   # openssl decrypt/pkey only
    child_env = dict(os.environ)

    def on_signal(signum, _frame):
        raise KeyboardInterrupt(f"signal {signum}")
    for sig in (signal.SIGTERM, signal.SIGHUP):   # SIGINT already raises KeyboardInterrupt; SIGKILL cannot be caught
        signal.signal(sig, on_signal)
    cert_pub = sh("openssl", "x509", "-in", str(cert), "-noout", "-pubkey").stdout
    key_pub = subprocess.run(["openssl", "pkey", "-in", str(vkey), "-pubout", *passin], capture_output=True, text=True,
                             stdin=None if not passin else subprocess.DEVNULL, env=ossl_env).stdout
    if not cert_pub or cert_pub != key_pub:
        refuse("the verify key is not the private key of the recipient certificate (or its passphrase is wrong)")
    print("  key match    : the verify key is the recipient certificate's private key")
    if test:
        pgpassword = os.environ.get("OVB_EXPORT_TEST_DB_PASSWORD", "postgres")
        key = os.environ.get("OVB_EXPORT_TEST_SERVICE_KEY") or st.get("SERVICE_ROLE_KEY", "")
    else:
        pgpassword = getpass.getpass(f"Database password for {db['user']} (not echoed): ")
        key = getpass.getpass("Service-role key for the production project (not echoed): ")
    if not pgpassword or not key:
        refuse("credentials not given")
    out.mkdir(mode=0o700)
    work, verify = out / ".plain", out / ".verify"
    work.mkdir(mode=0o700)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    archive = out / f"ovalball-storage-export-{stamp}.tar.cms"
    logf = (out / "export.log").open("a")
    secrets = [s for s in (pgpassword, key) if s]

    def log(msg: str) -> None:
        for s_ in secrets:
            msg = msg.replace(s_, "***")
        line = f"[{time.strftime('%H:%M:%S', time.gmtime())}] {msg}"
        print(line)
        logf.write(line + "\n")
        logf.flush()

    ok = False
    try:
        # -------------------------------------------------------------------------------------- 3. identity
        try:
            payload = json.loads(base64.urlsafe_b64decode(key.split(".")[1] + "=="))
        except Exception:
            raise Stop("the service-role key is not a Supabase JWT key; cannot confirm which project it belongs to")
        if payload.get("role") != "service_role":
            raise Stop("the key is not a service_role key")
        if not test and payload.get("ref") != PROD_REF:
            raise Stop("the key does not belong to the production project")

        def psql(sql: str) -> str:
            tls = [] if test else ["-v", f"{Path(a.db_root_cert).resolve()}:/ovb-root.crt:ro"]
            root = "" if test else " sslrootcert=/ovb-root.crt"
            r = subprocess.run(["docker", "run", "--rm", "-i", "-e", "PGPASSWORD", "-e", "PGOPTIONS=-c default_transaction_read_only=on", *tls,
                                pgimage, "psql", f"host={db['host']} port={db['port']} user={db['user']} dbname=postgres sslmode={db['sslmode']}{root} connect_timeout=15",
                                "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
                               capture_output=True, text=True, env={**child_env, "PGPASSWORD": pgpassword}, timeout=300, stdin=subprocess.DEVNULL)
            if r.returncode != 0:
                raise Stop("a read-only database query failed (connection or permission); see nothing further was read")
            return r.stdout.strip()

        ro, sysid = psql("select current_setting('transaction_read_only') || '|' || (select system_identifier from pg_control_system())").split("|")
        if fault == "wrong-identity":
            sysid = "0"
        if ro != "on":
            raise Stop("the database session is not read-only")
        if sysid != expected_id:
            raise Stop(f"system_identifier {sysid} is not the expected {expected_id}: nothing read")
        log("identity: read-only session, system_identifier matches, key is this project's service_role")

        # -------------------------------------------------------------------------------------- 4. inventory
        inv = json.loads(psql("""select json_build_object(
            'buckets', (select coalesce(json_agg(json_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit,
                         'allowed_mime_types', allowed_mime_types) order by id), '[]') from storage.buckets),
            'objects', (select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name, 'metadata', metadata,
                         'user_metadata', user_metadata) order by bucket_id, name), '[]') from storage.objects))"""))
        objects = inv["objects"]
        rows = {(o["bucket"], o["name"]) for o in objects}
        log(f"inventory (database): {len(inv['buckets'])} buckets, {len(objects)} objects, "
            f"{sum(int((o['metadata'] or {}).get('size') or 0) for o in objects)} bytes")

        def call(method: str, path: str, data: bytes | None = None, ctype: str | None = None):
            h = {"apikey": key, "Authorization": "Bearer " + key}
            if ctype:
                h["Content-Type"] = ctype
            req = urllib.request.Request(api + path, data=data, method=method, headers=h)
            return OPENER.open(req, timeout=120)

        listed = set()
        for b in inv["buckets"]:
            stack = [""]
            while stack:
                prefix = stack.pop()
                offset = 0
                while True:
                    body = json.dumps({"prefix": prefix, "limit": PAGE, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}).encode()
                    with call("POST", f"/storage/v1/object/list/{urllib.parse.quote(b['id'])}", body, "application/json") as resp:
                        items = json.loads(resp.read())
                    for it in items:
                        p = (prefix + "/" if prefix else "") + it["name"]
                        (stack.append(p) if it.get("id") is None else listed.add((b["id"], p)))
                    if len(items) < PAGE:
                        break
                    offset += PAGE
        if fault == "missing-object":
            listed.discard(sorted(listed)[0])
        if listed != rows:
            raise Stop(f"the Storage API lists {len(listed)} objects, the database {len(rows)}; "
                       f"{len(rows - listed)} not listed, {len(listed - rows)} not in the database")
        log(f"inventory (Storage API, paginated): {len(listed)} objects -- identical to the database")

        # -------------------------------------------------------------------------------------- 5. export
        objdir = work / "objects"
        objdir.mkdir(mode=0o700)   # present even when there are no objects, so the verifier recognises the archive
        manifest_objects = []
        md5_checked = 0
        for i, o in enumerate(objects):
            meta = o["metadata"] or {}
            name = o["name"]
            if name.startswith("/") or ".." in name.split("/"):
                raise Stop("an object name is not a safe relative path")
            fetch_name = name + ".absent" if fault == "fetch-missing" and i == 0 else name
            with call("GET", f"/storage/v1/object/{urllib.parse.quote(o['bucket'])}/{urllib.parse.quote(fetch_name)}") as resp:
                if resp.status != 200:
                    raise Stop(f"object {i}: HTTP {resp.status}")
                data = resp.read()
            if fault == "truncate-object" and i == 0:
                data = data[:-1]
            if fault == "corrupt-object" and i == 0:
                data = bytes([data[0] ^ 1]) + data[1:]
            size = meta.get("size") if meta.get("size") is not None else meta.get("contentLength")
            size = int(size) if size is not None else -1   # 0 is a valid size
            if len(data) != size:
                raise Stop(f"object {i}: {len(data)} bytes, the inventory says {size}")
            etag = (meta.get("eTag") or "").strip('"')
            if re.fullmatch(r"[0-9a-f]{32}", etag):
                if hashlib.md5(data).hexdigest() != etag:
                    raise Stop(f"object {i}: content does not match its ETag")
                md5_checked += 1
            dest = objdir / o["bucket"] / name
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            dest.write_bytes(data)
            manifest_objects.append({"bucket": o["bucket"], "name": name, "size": size, "mimetype": meta.get("mimetype"),
                                     "cacheControl": meta.get("cacheControl"), "eTag": meta.get("eTag"),
                                     "user_metadata": o.get("user_metadata"), "sha256": hashlib.sha256(data).hexdigest()})
        log(f"exported {len(manifest_objects)} objects; every size matched; {md5_checked} MD5 ETags matched, "
            f"{len(manifest_objects) - md5_checked} objects have no plain-MD5 ETag (size and SHA-256 only)")
        manifest = {"created_utc": stamp, "operator": a.operator, "source": source, "system_identifier": sysid,
                    "buckets": inv["buckets"], "objects": manifest_objects}
        (work / "manifest.json").write_text(json.dumps(manifest, indent=1))
        manifest_sha = hashlib.sha256((work / "manifest.json").read_bytes()).hexdigest()

        # -------------------------------------------------------------------------------------- 6. encrypt
        tar_path = out / ".plain.tar"
        with tarfile.open(tar_path, "w") as t:
            t.add(work, arcname=".")
        r = subprocess.run(["openssl", "cms", "-encrypt", "-aes256", "-binary", "-outform", "DER", "-in", str(tar_path),
                            "-out", str(archive), str(cert)], capture_output=True, env=child_env)
        tar_path.unlink()
        if r.returncode != 0:
            raise Stop("encryption failed")
        if fault == "corrupt-cipher":
            with archive.open("r+b") as f:
                f.seek(4096); f.write(b"\x00")
        archive_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
        log(f"encrypted: {archive.name} ({archive.stat().st_size} bytes), SHA-256 {archive_sha}")

        # -------------------------------------------------------------------------------------- 7. round trip
        verify.mkdir(mode=0o700)
        with (verify / "x.tar").open("wb") as xt:
            dec = subprocess.run(["openssl", "cms", "-decrypt", "-binary", "-inform", "DER", "-in", str(archive), "-inkey", str(vkey), *passin],
                                 stdout=xt, stderr=subprocess.DEVNULL, env=ossl_env)
        if dec.returncode != 0:
            raise Stop("the archive does not decrypt with the verify key")
        try:
            with tarfile.open(verify / "x.tar") as t:
                for mem in t.getmembers():   # only plain files and folders, never outside the folder (any Python)
                    if mem.name.startswith("/") or ".." in Path(mem.name).parts or not (mem.isfile() or mem.isdir()):
                        raise ValueError("unsafe member")
                t.extractall(verify / "x")
        except Exception:
            raise Stop("the decrypted archive does not unpack")
        mpath = verify / "x" / "manifest.json"
        if not mpath.is_file() or hashlib.sha256(mpath.read_bytes()).hexdigest() != manifest_sha:
            raise Stop("the decrypted manifest differs from the one written")
        m2 = json.loads(mpath.read_bytes())
        for o in m2["objects"]:
            p = verify / "x" / "objects" / o["bucket"] / o["name"]
            if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != o["sha256"]:
                raise Stop("a decrypted object does not match the manifest")
        custody = {"archive": archive.name, "archive_sha256": archive_sha, "manifest_sha256": manifest_sha,
                   "recipient_cert_sha256": cert_fp, "operator": a.operator, "created_utc": stamp, "source": source,
                   "system_identifier": sysid, "buckets": len(inv["buckets"]), "objects": len(manifest_objects),
                   "bytes": sum(o["size"] for o in manifest_objects),
                   "verified": "decrypted; every object re-hashed against the manifest"}
        (out / "custody.json").write_text(json.dumps(custody, indent=1))
        ok = True
    except Stop as e:
        log(f"STOPPED: {e}")
    except urllib.error.HTTPError as e:
        log(f"STOPPED: the Storage API answered HTTP {e.code}")
    except KeyboardInterrupt:
        log("STOPPED: interrupted")
    except Exception as e:
        log(f"STOPPED: {type(e).__name__}")
    finally:
        # Plaintext never survives, success or failure -- and that is checked, not assumed. No signal interrupts this.
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        for d in (work, verify):
            shutil.rmtree(d, ignore_errors=True)
        try:
            (out / ".plain.tar").unlink(missing_ok=True)
        except OSError:
            pass   # judged by the existence check below
        left = [p.name for p in (work, verify, out / ".plain.tar") if p.exists()]
        if left:
            ok = False
            log(f"PLAINTEXT NOT DELETED: {', '.join(left)} in the out-dir -- delete them by hand NOW; this run has failed")
        if not ok:
            for f in (archive, out / "custody.json"):
                try:
                    f.unlink(missing_ok=True)
                except OSError:
                    log(f"could not delete {f.name}: it is NOT a verified export -- delete it")
        logf_ok = ok
    if not logf_ok:
        print("EXPORT FAILED -- nothing usable was produced. See export.log", file=sys.stderr)
        logf.close()
        return 8 if left else 3
    log(f"EXPORT VERIFIED: {archive.name} SHA-256 {archive_sha} -- escrow this digest independently of this Mac; "
        "plaintext deleted")
    logf.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
