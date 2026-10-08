#!/usr/bin/env python3
"""Copy Storage FILES between two DISPOSABLE local Supabase stacks and byte-verify each one (restore rehearsal).

A database dump holds storage.objects ROWS, not the files. This copies the files for every object row the TARGET
already has (the restored rows), from the source stack, through the Storage API with the service role, and
compares SHA-256 of what was sent with what the target serves back. Objects with no row in the target are
reported, not copied, so the copy cannot add files the restored database does not know about.

  copy-storage-objects.py --source-project-dir DIR --target-project-dir DIR [--execute]

SAFETY: dry run unless --execute. Both stacks must be local (loopback API) and neither may be the persistent
local project. It has no input for a remote URL or key; keys are read from `supabase status` and never printed.
"""
import argparse, hashlib, json, re, subprocess, sys, urllib.error, urllib.request, urllib.parse

PERSISTENT_PROJECT_ID = "ovalball-saas-startup"
PAGE = 100


def die(msg):
    print(f"REFUSED: {msg}", file=sys.stderr); sys.exit(2)


def stack(d):
    try:
        cfg = open(f"{d}/supabase/config.toml").read()
    except OSError:
        die(f"no supabase/config.toml under {d}")
    lines = [l for l in cfg.splitlines() if re.match(r"\s*project_id\s*=", l)]
    m = re.fullmatch(r'\s*project_id\s*=\s*"([a-z0-9][a-z0-9-]*)"\s*', lines[0]) if len(lines) == 1 else None
    if not m or m.group(1) == PERSISTENT_PROJECT_ID:
        die(f"{d} is not a disposable project (project_id must be defined once, plainly, and not the persistent one)")
    out = subprocess.run(["npx", "supabase", "status", "-o", "env"], cwd=d, capture_output=True, text=True).stdout
    e = {k: v.strip().strip('"') for k, v in (l.split("=", 1) for l in out.splitlines() if "=" in l)}
    if not re.match(r"^http://(127\.0\.0\.1|localhost):\d+$", e.get("API_URL", "")):
        die(f"{d}: API URL is not loopback (is the stack running?)")
    return m.group(1), e["API_URL"], e["SERVICE_ROLE_KEY"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, f"redirect to {newurl} refused", headers, fp)


# Straight to the loopback API and nowhere else: no proxy from the environment (HTTP_PROXY and friends are ignored),
# and no redirect followed -- a service answering with a redirect could otherwise send the host, and the data it
# carries, anywhere.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def call(api, key, method, path, data=None, ctype="application/json", upsert=False, cache_control=None, want_headers=False):
    if not re.match(r"^http://(127\.0\.0\.1|localhost):\d+$", api):
        die(f"refusing a non-loopback API URL: {api}")
    h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": ctype}
    if upsert:
        h["x-upsert"] = "true"
    if cache_control:
        h["cache-control"] = cache_control
    r = urllib.request.Request(api + path, data=data, method=method, headers=h)
    with OPENER.open(r, timeout=60) as resp:
        if want_headers:
            return resp.read(), resp.headers.get("Content-Type"), resp.headers.get("Cache-Control")
        return resp.read(), resp.headers.get("Content-Type")


def rows(api, key):
    """Every object the stack's Storage API lists (it lists the database's object rows), walked bucket by bucket."""
    out = []
    for b in json.loads(call(api, key, "GET", "/storage/v1/bucket")[0]):
        stack_ = [""]
        while stack_:
            prefix, offset = stack_.pop(), 0
            while True:  # every page of every prefix: a listing is capped at PAGE entries
                items = json.loads(call(api, key, "POST", f"/storage/v1/object/list/{b['id']}",
                                        json.dumps({"prefix": prefix, "limit": PAGE, "offset": offset,
                                                    "sortBy": {"column": "name", "order": "asc"}}).encode())[0])
                for it in items:
                    p = (prefix + "/" if prefix else "") + it["name"]
                    (stack_.append(p) if it.get("id") is None else out.append((b["id"], p)))
                if len(items) < PAGE:
                    break
                offset += PAGE
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-project-dir", required=True)
    ap.add_argument("--target-project-dir", required=True)
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--target-relay-port", type=int, help="an isolated target's loopback API relay port (start-isolated-restore-target.sh prints it)")
    a = ap.parse_args()
    # The target receives the files, so it must be network-isolated before anything is read from the source or
    # written to it (restore-target-isolation.py; the same preflight the database restore runs). No flag skips it.
    here = __import__("pathlib").Path(__file__).resolve().parent
    print("Isolation preflight of the target (nothing has been read from the source)...")
    if a.target_relay_port is None:
        die("--target-relay-port is required: an isolated target is reached only through its loopback API relay")
    if subprocess.run([sys.executable, str(here / "restore-target-isolation.py"), "guard-status",
                       "--project-dir", a.target_project_dir]).returncode != 0:
        die("no live isolation guard for the target; start it with start-isolated-restore-target.sh. Nothing was read or copied")
    if subprocess.run([sys.executable, str(here / "restore-target-isolation.py"), "verify",
                       "--project-dir", a.target_project_dir, "--quiet", "--api-port", str(a.target_relay_port)]).returncode != 0:
        die("the target is not network-isolated (see the failures above); nothing was read or copied")
    sp, sapi, skey = stack(a.source_project_dir)
    tp, _, tkey = stack(a.target_project_dir)
    tapi = f"http://127.0.0.1:{a.target_relay_port}"  # the relay: the target publishes nothing that forwards
    if sp == tp:
        die("source and target are the same project")
    want = rows(tapi, tkey)
    have = set(rows(sapi, skey))
    print(f"target holds {len(want)} object row(s); source has {len(have)} file(s)")
    if not a.execute:
        print("DRY RUN. Re-run with --execute. Nothing was copied."); return
    isolation = [sys.executable, str(here / "restore-target-isolation.py")]

    def still_isolated() -> None:
        if (subprocess.run(isolation + ["guard-status", "--project-dir", a.target_project_dir]).returncode != 0 or
                subprocess.run(isolation + ["verify", "--project-dir", a.target_project_dir, "--quiet",
                                            "--api-port", str(a.target_relay_port)]).returncode != 0):
            raise SystemExit("isolation lost")

    try:
        copied = missing = 0
        digest = hashlib.sha256()
        for bucket, path in sorted(want):
            if (bucket, path) not in have:
                missing += 1; print(f"  MISSING in source: {bucket}/{path}"); continue
            q = urllib.parse.quote(path)
            body, ct, cc = call(sapi, skey, "GET", f"/storage/v1/object/{bucket}/{q}", want_headers=True)
            # Content type AND cache-control travel with the file: an upload without them would reset the restored
            # object's stored metadata (proved: cacheControl fell back to "no-cache" for every object).
            call(tapi, tkey, "POST", f"/storage/v1/object/{bucket}/{q}", body, ct or "application/octet-stream", upsert=True, cache_control=cc)
            back, _ = call(tapi, tkey, "GET", f"/storage/v1/object/{bucket}/{q}")
            if hashlib.sha256(back).digest() != hashlib.sha256(body).digest():
                die(f"byte mismatch after copy: {bucket}/{path}")
            copied += 1; digest.update(hashlib.sha256(body).digest())
            # The guard must still be alive before EVERY next object (cheap); the full verify runs every 100.
            if subprocess.run(isolation + ["guard-status", "--project-dir", a.target_project_dir], capture_output=True).returncode != 0:
                raise SystemExit("the isolation guard is no longer alive")
            if copied % 100 == 0:
                still_isolated()  # the preflight is a snapshot: re-checked during a long copy
        still_isolated()  # and once more now the files are in
    except BaseException as exc:
        # ANY way out of the copy -- a lost isolation, a timeout, a byte mismatch, an interrupt -- stops the target.
        print(f"EMERGENCY STOP ({type(exc).__name__}: {exc}); stopping the target...", file=sys.stderr)
        subprocess.run(isolation + ["emergency-stop", "--project-dir", a.target_project_dir])
        die("the copy did not finish with the target isolated; the target was stopped -- destroy it and tell the owner")
    # Reconcile: after the copy the target must serve a file for every object it lists.
    unserved = 0
    for bucket, path in sorted(want):
        try:
            call(tapi, tkey, "GET", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}")
        except urllib.error.HTTPError:
            unserved += 1; print(f"  NOT SERVED by target: {bucket}/{path}")
    print(f"copied and byte-verified {copied}; missing in source {missing}; not served after copy {unserved}; digest {digest.hexdigest()[:16]}")
    missing += unserved
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
