#!/usr/bin/env python3
"""Rehearse Ovalball's database write quiescence against a DISPOSABLE local Supabase stack.

What it proves, on a stack you can throw away:
  * before the window, every write path writes (negative controls -- otherwise a "blocked" result means nothing);
  * that changing the database default alone is NOT enough while pooled sessions survive;
  * that the full procedure (pause cron, database default read-only, terminate sessions) blocks every
    reproducible write path: anon, member, club admin, mobile-equivalent, service role, SECURITY DEFINER RPC,
    a hostile definer that tries to switch the transaction back to read-write, Auth, Storage, pg_cron, pg_net,
    a webhook delivery, and an in-flight transaction;
  * that the migration operator still writes, by an explicit per-session opt-out (psql and `supabase db push`);
  * that reopening restores every path, and a webhook refused during the window is processed exactly once
    when it is delivered again.

SAFETY. It refuses to run unless:
  * --project-dir names a local Supabase project whose project_id is not the persistent one;
  * the stack's API URL is loopback and its database container is that project's own;
  * --execute is given (without it, it prints the plan and stops: a dry run).
It never reads production configuration, never prints keys, and creates only fictional identities on the
disposable stack. Teardown removes its probes; the fictional club admin's Auth user can remain, because the immutable
audit log references it -- one more reason the stack is destroyed afterwards. It contains no production connection string and cannot be pointed at one: every database
statement goes through `docker exec` into the disposable project's own container.
"""
import argparse, json, os, re, secrets, subprocess, sys, time, urllib.error, urllib.request, uuid

PERSISTENT_PROJECT_ID = "ovalball-saas-startup"
RESULTS = []


def die(msg):
    print(f"REFUSED: {msg}", file=sys.stderr)
    sys.exit(2)


def load_stack(project_dir):
    cfg = os.path.join(project_dir, "supabase", "config.toml")
    if not os.path.isfile(cfg):
        die(f"no supabase/config.toml under {project_dir}")
    lines = [l for l in open(cfg).read().splitlines() if re.match(r"\s*project_id\s*=", l)]
    m = re.fullmatch(r'\s*project_id\s*=\s*"([a-z0-9][a-z0-9-]*)"\s*', lines[0]) if len(lines) == 1 else None
    if not m:
        die("config.toml must define project_id exactly once, as a plain double-quoted lowercase id")
    pid = m.group(1)
    if pid == PERSISTENT_PROJECT_ID:
        die("that is the persistent local project; this rehearsal only runs on a disposable one")
    out = subprocess.run(["npx", "supabase", "status", "-o", "env"], cwd=project_dir, capture_output=True, text=True).stdout
    env = {k: v.strip().strip('"') for k, v in (l.split("=", 1) for l in out.splitlines() if "=" in l)}
    api = env.get("API_URL", "")
    if not re.match(r"^http://(127\.0\.0\.1|localhost):\d+$", api):
        die("the stack's API URL is not loopback")
    for k in ("ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"):
        if k not in env:
            die(f"stack status lacks {k}; is it running?")
    if not re.match(r"^postgresql://[^@]+@(127\.0\.0\.1|localhost):\d+/postgres$", env["DB_URL"]):
        die("the stack's database URL is not loopback")
    container = f"supabase_db_{pid}"
    names = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True).stdout.split()
    if container not in names:
        die(f"container {container} is not running")
    return pid, container, api, env["ANON_KEY"], env["SERVICE_ROLE_KEY"], env["DB_URL"]


class Stack:
    def __init__(self, project_dir):
        self.project_dir = project_dir
        self.pid, self.container, self.api, self.anon, self.svc, self.db_url = load_stack(project_dir)

    # --- database, always inside the disposable container -------------------------------------------------
    def sql(self, statement, operator=False, check=False):
        """Run SQL as postgres in a NEW session. operator=True opts that one session out of read-only."""
        env = ["-e", "PGOPTIONS=-c default_transaction_read_only=off"] if operator else []
        p = subprocess.run(["docker", "exec", *env, "-i", self.container, "psql", "-U", "postgres", "-d", "postgres",
                            "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement], capture_output=True, text=True)
        if check and p.returncode != 0:
            raise RuntimeError(p.stderr.strip())
        return p.returncode, (p.stdout.strip() if p.returncode == 0 else p.stderr.strip())

    def db_log_since(self, since, pattern):
        """Lines of this disposable database's own log since `since` (docker --since) matching pattern."""
        p = subprocess.run(["docker", "logs", "--since", since, self.container], capture_output=True, text=True)
        return [l for l in (p.stdout + p.stderr).splitlines() if re.search(pattern, l)]

    def refusals_by_backend(self, since, statement_pattern):
        """Backends (by pid in the log prefix) whose OWN log lines include both a read-only refusal and a statement or
        context matching statement_pattern -- so the evidence belongs to that job or worker, not to another session."""
        by_pid = {}
        for l in self.db_log_since(since, r"\[\d+\]"):
            m = re.search(r"\[(\d+)\]", l)
            by_pid.setdefault(m.group(1), []).append(l)
        return [pid for pid, ls in by_pid.items()
                if any(re.search(r"ERROR:\s+cannot execute [A-Z][A-Z ]* in a read-only transaction", l) for l in ls)
                and any(re.search(statement_pattern, l) for l in ls)]

    def auth_refusal(self, since, actor, grant=None):
        """Auth's own log shows THIS user's request failing, and in the same moment the database refused a write by
        Auth's role as read-only. Probes run one at a time, so the two belong together."""
        p = subprocess.run(["docker", "logs", "--since", since, "supabase_auth_" + self.pid], capture_output=True, text=True)
        mine = [l for l in (p.stdout + p.stderr).splitlines() if '"error"' in l
                and (actor in l or (grant and f'"grant_type":"{grant}"' in l))]
        db = self.db_log_since(since, r"supabase_auth_admin@\S+ ERROR:\s+cannot execute [A-Z][A-Z ]* in a read-only transaction")
        return bool(mine and db)

    # --- HTTP, loopback only --------------------------------------------------------------------------------
    def http(self, method, path, body=None, key=None, token=None, raw=None, ctype="application/json", headers=None):
        key = key or self.anon
        h = {"apikey": key, "Authorization": "Bearer " + (token or key), "Content-Type": ctype}
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.api + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode(errors="replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(errors="replace")
        except Exception as e:  # connection refused / reset
            return 0, str(e)


# A refusal counts as BLOCKED only with evidence that READ-ONLY enforcement refused it: the SQLSTATE or message in
# the response, or (for Auth and pg_cron, whose responses do not say why) the database log. Anything else -- a 401,
# a 503, a refused connection, a missing function -- is ERROR, and an ERROR never passes.
READ_ONLY_MARKERS = ("25006", "25001", "read-only transaction", "read_only_sql_transaction", "DatabaseReadOnly",
                     "read-write mode must be set", "terminating connection due to administrator command")


def record(phase, path, expect, ok, detail):
    got = "WRITES" if ok else ("BLOCKED" if any(m in detail for m in READ_ONLY_MARKERS) else "ERROR")
    verdict = "PASS" if got == expect else "FAIL"
    RESULTS.append((phase, path, expect, got, verdict, detail))
    print(f"[{verdict}] {phase:<9} {path:<44} expected {expect:<7} got {got:<7} {detail[:90]}")


def short(body):
    try:
        j = json.loads(body)
        return (j.get("code") or j.get("error_code") or j.get("error") or "") + " " + (j.get("message") or j.get("msg") or "")
    except Exception:
        return body[:120]


# =========================================================================================================
# THE PROCEDURE UNDER TEST. The production runbook carries the same statements as TEXT for a human operator;
# this file is the only place they are executable, and only against the disposable container above.
# =========================================================================================================
GATE_INSTALL = """
  create schema if not exists ops_maintenance;
  create or replace function ops_maintenance.read_only_request() returns void language plpgsql as $$
  begin
    perform set_config('transaction_read_only', 'on', true);
  end $$;
  revoke all on function ops_maintenance.read_only_request() from public;
  grant usage on schema ops_maintenance to anon, authenticated, service_role;
  grant execute on function ops_maintenance.read_only_request() to anon, authenticated, service_role;
  alter role authenticator set pgrst.db_pre_request = 'ops_maintenance.read_only_request';
  notify pgrst, 'reload config';
"""

GATE_REMOVE = """
  alter role authenticator reset pgrst.db_pre_request;
  notify pgrst, 'reload config';
"""


def enter_maintenance(st, terminate=True, drain_seconds=3, gate=True):
    # 1. Record and pause every active cron job (the operator's evidence of what to resume).
    _, active = st.sql("select coalesce(string_agg(jobname, ',' order by jobname), '') from cron.job where active", operator=True, check=True)
    st.sql("select cron.alter_job(jobid, active := false) from cron.job where active", operator=True, check=True)
    # 2. Every NEW session in this database starts read-only.
    st.sql("alter database postgres set default_transaction_read_only = on", operator=True, check=True)
    if gate:
        # 3. PostgREST opens its write transactions explicitly READ WRITE, which overrides any default, so it is
        #    gated per request: a pre-request function switches every request's own transaction to read-only.
        #    (Switching TO read-only is allowed at any point; switching back is refused once a query has run.)
        st.sql(GATE_INSTALL, operator=True, check=True)
    if terminate:
        # 4. Let in-flight requests finish, then end every remaining client session that is not a superuser's,
        #    and the pg_net worker, so the pools reconnect under the new default.
        time.sleep(drain_seconds)
        _, n = st.sql("select count(*) from (select pg_terminate_backend(pid) from pg_stat_activity "
                      "where datname = 'postgres' and pid <> pg_backend_pid() "
                      "and (backend_type = 'client backend' or backend_type like 'pg_net%') "
                      "and usename is distinct from 'supabase_admin') t", operator=True, check=True)
        print(f"   terminated {n} session(s); paused cron jobs: {active or '(none)'}")
        time.sleep(2)
    return [j for j in active.split(",") if j]


def exit_maintenance(st, paused_jobs):
    st.sql(GATE_REMOVE, operator=True, check=True)
    st.sql("alter database postgres reset default_transaction_read_only", operator=True, check=True)
    st.sql("select count(*) from (select pg_terminate_backend(pid) from pg_stat_activity "
           "where datname = 'postgres' and pid <> pg_backend_pid() "
           "and (backend_type = 'client backend' or backend_type like 'pg_net%') "
           "and usename is distinct from 'supabase_admin') t", operator=True, check=True)
    if paused_jobs:
        names = ",".join("'" + j.replace("'", "''") + "'" for j in paused_jobs)
        st.sql(f"select cron.alter_job(jobid, active := true) from cron.job where jobname in ({names})", operator=True, check=True)
    # PostgREST reconnects and reloads its schema cache; it answers 503 until it has.
    t0 = time.time()
    while time.time() - t0 < 60:
        if st.http("GET", "/rest/v1/clubs?select=id&limit=1")[0] == 200:
            break
        time.sleep(0.5)
    return time.time() - t0


# =========================================================================================================
# FIXTURES -- fictional identities and probe objects on the disposable stack only
# =========================================================================================================
def make_user(st, label):
    email = f"ops.quiesce.{label}.{uuid.uuid4().hex[:6]}@ovalball.test"
    pw = secrets.token_urlsafe(18)
    s, b = st.http("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True,
                   "user_metadata": {"first_name": "Ops", "surname": label.title()}}, key=st.svc)
    if s != 200:
        raise RuntimeError(f"could not create {label}: {s} {short(b)}")
    return {"id": json.loads(b)["id"], "email": email, "pw": pw}


def sign_in(st, u):
    s, b = st.http("POST", "/auth/v1/token?grant_type=password", {"email": u["email"], "password": u["pw"]})
    if s == 200:
        j = json.loads(b)
        u["token"], u["refresh"] = j["access_token"], j["refresh_token"]
    return s, b


def setup(st):
    st.sql("""
      create schema if not exists ops_probe;
      create table if not exists ops_probe.cron_ticks (at timestamptz default now());
      create table if not exists ops_probe.inflight (id int);
      create or replace function public.ops_probe_escape_read_only() returns text language plpgsql security definer
        set search_path = pg_catalog as $$
      begin
        perform set_config('transaction_read_only', 'off', true);
        insert into ops_probe.inflight values (-1);
        return 'escaped';
      end $$;
      revoke all on function public.ops_probe_escape_read_only() from public;
      grant execute on function public.ops_probe_escape_read_only() to authenticated;
      grant usage on schema ops_probe to postgres;
      select cron.schedule('ops-probe-tick', '2 seconds', 'insert into ops_probe.cron_ticks default values');
    """, operator=True, check=True)
    st.sql("notify pgrst, 'reload schema'", operator=True)
    member, admin = make_user(st, "member"), make_user(st, "admin")
    # The club admin: an active CLUB_ADMIN place in an existing (fictional, seeded) club.
    _, club = st.sql("select id from public.clubs order by created_at limit 1", check=True)
    st.sql(f"insert into public.club_memberships (club_id, user_id, role, status, state, source) values ('{club}', '{admin['id']}', 'CLUB_ADMIN', 'active', 'ACTIVE', 'SITE_ADMIN_ASSIGNMENT') "
           f"on conflict do nothing", operator=True, check=True)
    time.sleep(1)
    for u in (member, admin):
        s, b = sign_in(st, u)
        if s != 200:
            raise RuntimeError(f"sign-in failed during setup: {s} {short(b)}")
    return {"member": member, "admin": admin, "club": club}


def teardown(st, fx):
    st.sql("select cron.unschedule('ops-probe-tick')", operator=True)
    st.sql("drop function if exists public.ops_probe_escape_read_only(); drop schema if exists ops_probe cascade", operator=True)
    st.sql(f"delete from public.club_memberships where user_id = '{fx['admin']['id']}'", operator=True)
    st.sql("delete from public.gocardless_events where gc_event_id like 'OPS-PROBE-%'", operator=True)
    for u in (fx["member"], fx["admin"]):
        st.http("DELETE", f"/auth/v1/admin/users/{u['id']}", key=st.svc)
    st.sql("notify pgrst, 'reload schema'", operator=True)


# =========================================================================================================
# THE PROBES -- each returns (wrote: bool, detail)
# =========================================================================================================
def probes(st, fx, tag):
    m, a = fx["member"], fx["admin"]
    out = {}

    s, b = st.http("GET", "/rest/v1/clubs?select=id&limit=1")
    out["anon REST read (must stay available)"] = (s == 200, f"{s}")

    s, b = st.http("POST", "/rest/v1/rpc/record_session_version", {"p_version": 1}, token=m.get("token"))
    out["member: definer RPC write"] = (s in (200, 204), f"{s} {short(b)}")

    s, b = st.http("POST", "/rest/v1/rpc/record_session_version", {"p_version": 1}, token=m.get("token"),
                   headers={"x-client-info": "supabase-js-react-native/2"})
    out["mobile-equivalent: definer RPC write"] = (s in (200, 204), f"{s} {short(b)}")

    s, b = st.http("PATCH", f"/rest/v1/clubs?id=eq.{fx['club']}", {"bio": f"ops probe {tag}"}, token=a.get("token"),
                   headers={"Prefer": "return=representation"})
    out["club admin: REST table update (RLS)"] = (s == 200 and fx["club"] in b, f"{s} {short(b)}")

    s, b = st.http("PATCH", f"/rest/v1/clubs?id=eq.{fx['club']}", {"bio": f"ops probe service {tag}"}, key=st.svc,
                   headers={"Prefer": "return=representation"})
    out["service role: REST update (bypasses RLS)"] = (s == 200 and fx["club"] in b, f"{s} {short(b)}")

    # The PRODUCTION canary: an update that matches no row. Under the gate it is refused as read-only before it
    # looks for rows; without the gate it succeeds and changes nothing. Safe to run against a live database.
    s, b = st.http("PATCH", "/rest/v1/clubs?id=eq.00000000-0000-0000-0000-000000000000", {"bio": "canary"}, key=st.svc)
    out["canary: zero-row service-role update"] = (s in (200, 204), f"{s} {short(b)}")

    s, b = st.http("POST", "/rest/v1/rpc/ops_probe_escape_read_only", {}, token=m.get("token"))
    out["hostile definer: set transaction read-write"] = (s == 200 and "escaped" in b, f"{s} {short(b)}")

    ev = f"OPS-PROBE-{tag}"
    s, b = st.http("POST", "/rest/v1/rpc/record_gocardless_event",
                   {"p_gc_event_id": ev, "p_resource_type": "payments", "p_action": "ops_probe", "p_payload": {"id": ev}}, key=st.svc)
    out["webhook: GoCardless inbox claim (service role)"] = (s == 200 and b.strip() not in ("", "null"), f"{s} {short(b)}")

    t_auth = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 1))
    s, b = st.http("POST", "/auth/v1/token?grant_type=password", {"email": m["email"], "password": m["pw"]})
    ev = st.auth_refusal(t_auth, m["email"])
    out["Auth: password sign-in"] = (s == 200, f"{s} {short(b)}" + (" | db log: supabase_auth_admin write refused, read-only transaction" if (s != 200 and ev) else ""))

    t_auth = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 1))
    s, b = st.http("POST", "/auth/v1/token?grant_type=refresh_token", {"refresh_token": a.get("refresh", "")})
    if s == 200:
        j = json.loads(b); a["token"], a["refresh"] = j["access_token"], j["refresh_token"]
    ev = st.auth_refusal(t_auth, a["id"], grant="refresh_token")
    out["Auth: token refresh"] = (s == 200, f"{s} {short(b)}" + (" | db log: supabase_auth_admin write refused, read-only transaction" if (s != 200 and ev) else ""))

    s, b = st.http("POST", f"/storage/v1/object/club-documents/ops-quiesce/{tag}-{uuid.uuid4().hex[:6]}.pdf",
                   raw=b"%PDF-1.4\n% ops probe\n", ctype="application/pdf", key=st.svc)
    out["Storage: upload (service role)"] = (s == 200, f"{s} {short(b)}")

    # A stray privileged script: a plain postgres session with no opt-out (e.g. a forgotten import script).
    rc, msg = st.sql(f"insert into ops_probe.inflight values (1)")
    out["stray postgres session: direct insert"] = (rc == 0, msg[:90])

    rc, msg = st.sql("select net.http_post(url := 'http://127.0.0.1:9/ops-probe', body := '{}'::jsonb)")
    out["pg_net: queue an outbound request"] = (rc == 0, msg[:90])
    # The worker itself: its dequeue and cleanup are writes. Under read-only it fails and restarts, so nothing queued
    # is sent until reopening. Evidence is the database log over a few seconds.
    t_net = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time()))
    time.sleep(4)
    net_err = st.refusals_by_backend(t_net, r"net\._http_response|net\.http_request_queue|_http_response|http_request_queue")
    refused = bool(net_err)
    _, wpid = st.sql("select coalesce(max(pid)::text, '') from pg_stat_activity where backend_type like 'pg_net%'", operator=True)
    out["pg_net worker: its own writes"] = (not refused and wpid != "",
                                            (f"db log: worker backend(s) {','.join(net_err)} refused, read-only transaction" if refused else f"worker pid {wpid or 'none'}, no refusals"))

    # pg_cron: ticks recorded in a short interval, measured by the operator session.
    t_cron = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 1))
    _, before = st.sql("select count(*) from ops_probe.cron_ticks", operator=True)
    time.sleep(5)
    _, after = st.sql("select count(*) from ops_probe.cron_ticks", operator=True)
    refused = st.refusals_by_backend(t_cron, r"insert into ops_probe\.cron_ticks")
    out["pg_cron: job writes"] = (int(after) > int(before),
                                  f"ticks {before}->{after}" + (f" | db log: job backend(s) {','.join(refused[:3])} refused, read-only transaction" if (refused and after == before) else ""))
    return out


def run(st):
    fx = setup(st)
    print(f"disposable stack {st.pid}: fictional member, club admin created; probes armed\n")
    try:
        expect_open = lambda k: "WRITES"
        for k, (ok, d) in probes(st, fx, "open").items():
            record("OPEN", k, "WRITES", ok, d)

        # Negative control on the procedure itself: the default alone, with pooled sessions left alive.
        print("\n-- default read-only WITHOUT terminating sessions (pooled connections survive)")
        paused = enter_maintenance(st, terminate=False, gate=False)
        s, b = st.http("POST", "/rest/v1/rpc/record_session_version", {"p_version": 1}, token=fx["member"].get("token"))
        record("NO-TERM", "member RPC through a surviving pool session", "WRITES", s in (200, 204), f"{s} {short(b)}")
        exit_maintenance(st, paused)

        # In-flight: a transaction opened before the window, still open when sessions are terminated.
        print("\n-- full procedure: pause cron, default read-only, drain, terminate")
        inflight = subprocess.Popen(["docker", "exec", "-i", st.container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
                                     "-c", "begin; insert into ops_probe.inflight values (42); select pg_sleep(30); commit;"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        time.sleep(1)
        t0 = time.time()
        paused = enter_maintenance(st, terminate=True)
        entered = time.time() - t0
        _, inflight_err = inflight.communicate(timeout=40)
        _, n42 = st.sql("select count(*) from ops_probe.inflight where id = 42", operator=True)
        record("WINDOW", "in-flight transaction at termination", "BLOCKED", n42 != "0",
               f"rows={n42}; client saw: {(inflight_err or '').strip().splitlines()[0][:70] if (inflight_err or '').strip() else 'nothing'}")
        if "ops-probe-tick" not in paused:
            record("WINDOW", "probe cron job was among those paused", "WRITES", False, "not paused")

        # Defence in depth: a cron job somebody forgot to pause (or re-enabled) still cannot write.
        st.sql("select cron.alter_job((select jobid from cron.job where jobname='ops-probe-tick'), active := true)", operator=True, check=True)
        for k, (ok, d) in probes(st, fx, "window").items():
            expect = "WRITES" if k.startswith("anon REST read") else "BLOCKED"
            if k.startswith("pg_cron"):
                k = "pg_cron: job left ACTIVE in window"
            record("WINDOW", k, expect, ok, d)
        st.sql("select cron.alter_job((select jobid from cron.job where jobname='ops-probe-tick'), active := false)", operator=True, check=True)

        # A signed-in user's existing access token still reads.
        s, b = st.http("GET", f"/rest/v1/profiles?id=eq.{fx['member']['id']}&select=id", token=fx["member"].get("token"))
        record("WINDOW", "member read with existing access token", "WRITES", s == 200 and fx["member"]["id"] in b, f"{s} (a read, expected available)")

        # The migration operator writes: psql with the opt-out, and the CLI with the opt-out in the URL.
        rc, msg = st.sql("begin; create table ops_probe.migration_probe (id int); insert into ops_probe.migration_probe values (1); commit;", operator=True)
        record("WINDOW", "operator psql (PGOPTIONS opt-out): DDL+DML", "WRITES", rc == 0, msg[:80] or "ok")
        rc, msg = st.sql("create table ops_probe.migration_probe_2 (id int)")
        record("WINDOW", "operator psql WITHOUT the opt-out", "BLOCKED", rc == 0, msg[:80])
        mig_dir = os.path.join(st.project_dir, "supabase", "migrations")
        probe_file = os.path.join(mig_dir, "29991231000000_ops_quiescence_probe.sql")
        with open(probe_file, "w") as f:
            f.write("create table ops_probe.cli_probe (id int);\ninsert into ops_probe.cli_probe values (1);\n")
        try:
            url = st.db_url + "?options=-c%20default_transaction_read_only%3Doff"
            p = subprocess.run(["npx", "supabase", "db", "push", "--db-url", url, "--yes"], cwd=st.project_dir,
                               capture_output=True, text=True, timeout=300)
            _, n = st.sql("select count(*) from ops_probe.cli_probe", operator=True)
            record("WINDOW", "operator `supabase db push` (options opt-out)", "WRITES", p.returncode == 0 and n == "1",
                   f"rc={p.returncode} rows={n} {(p.stderr or '').strip().splitlines()[-1][:60] if p.stderr.strip() else ''}")
        finally:
            os.remove(probe_file)
            st.sql("delete from supabase_migrations.schema_migrations where version = '29991231000000'", operator=True)

        print(f"\n   entered maintenance in {entered:.1f}s (includes a {3}s drain)")
        t1 = time.time()
        ready = exit_maintenance(st, paused)
        print(f"   reopened in {time.time() - t1:.1f}s (PostgREST answering again after {ready:.1f}s); resumed {len(paused)} cron job(s)\n")

        for k, (ok, d) in probes(st, fx, "reopen").items():
            record("REOPEN", k, "WRITES", ok, d)

        # The webhook refused in the window, delivered again: claimed and processed exactly once.
        ev = "OPS-PROBE-window"
        s1, b1 = st.http("POST", "/rest/v1/rpc/record_gocardless_event",
                         {"p_gc_event_id": ev, "p_resource_type": "payments", "p_action": "ops_probe", "p_payload": {"id": ev}}, key=st.svc)
        claimed = b1.strip().strip('"')
        if s1 == 200 and claimed not in ("", "null"):
            st.http("POST", "/rest/v1/rpc/mark_gocardless_event_processed", {"p_event_id": claimed, "p_error": None}, key=st.svc)
        s2, b2 = st.http("POST", "/rest/v1/rpc/record_gocardless_event",
                         {"p_gc_event_id": ev, "p_resource_type": "payments", "p_action": "ops_probe", "p_payload": {"id": ev}}, key=st.svc)
        _, rows = st.sql(f"select count(*) from public.gocardless_events where gc_event_id = '{ev}'", operator=True)
        record("REOPEN", "webhook redelivery: claimed once, then skipped", "WRITES",
               s1 == 200 and claimed not in ("", "null") and b2.strip() in ("null", "") and rows == "1",
               f"first={s1} claimed={'yes' if claimed not in ('', 'null') else 'no'} second={b2.strip()[:8]} rows={rows}")

        _, dtro = st.sql("select setting from pg_settings where name = 'default_transaction_read_only'")
        _, cron_active = st.sql("select count(*) filter (where active) || '/' || count(*) from cron.job where jobname <> 'ops-probe-tick'")
        record("REOPEN", "database default restored (new session not read-only)", "WRITES", dtro == "off", f"default_transaction_read_only={dtro}; cron active {cron_active}")
    finally:
        # Whatever happened, the disposable database is left writable and the probes removed.
        st.sql(GATE_REMOVE, operator=True)
        st.sql("alter database postgres reset default_transaction_read_only", operator=True)
        teardown(st, fx)
        st.sql("drop schema if exists ops_maintenance cascade", operator=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project-dir", required=True, help="a DISPOSABLE local Supabase project directory")
    ap.add_argument("--execute", action="store_true", help="actually run; without it this is a dry run")
    args = ap.parse_args()
    st = Stack(os.path.abspath(args.project_dir))
    if not args.execute:
        print(f"DRY RUN. Would rehearse write quiescence on disposable project {st.pid} (container {st.container}).")
        print("Re-run with --execute to perform it. Nothing was changed.")
        return
    run(st)
    fails = [r for r in RESULTS if r[4] == "FAIL"]
    print(f"\n{len(RESULTS)} checks, {len(RESULTS) - len(fails)} as expected, {len(fails)} unexpected")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
