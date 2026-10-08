#!/usr/bin/env python3
"""Network isolation for a DISPOSABLE local Supabase restore target -- and the fail-closed preflight that proves it.

    scripts/ops/restore/restore-target-isolation.py isolate --project-dir DIR   # rewire a running disposable stack
    scripts/ops/restore/restore-target-isolation.py verify  --project-dir DIR   # exit 0 ONLY if every check passes

A copy of production data must be reachable from nowhere but this Mac's loopback, and must reach nothing outside its
own containers. Two mechanisms, verified separately (see PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md, "Restore isolation"):

  INBOUND   the stack is STARTED through docker-loopback-proxy.py, which makes every published port bind 127.0.0.1
            (the Supabase CLI cannot; Docker Desktop ignores a network-level default but honours an explicit host IP).
  OUTBOUND  `isolate` attaches every container of the stack to an `--internal` Docker network (no route out, no
            outside DNS), keeping its service aliases, and removes every container except Kong from the CLI's own
            network. Kong stays on both: it is the one way in from the host (Docker Desktop does not publish ports of
            a container attached only to an internal network), and its routes point only at this stack's containers.

`verify` trusts no configuration file. It reads the running containers and the host itself, and FAILS -- exit 3 -- on:
  * a project id that is not a plain disposable id, or is the persistent project;
  * any container of the project with a published port not bound to 127.0.0.1/::1, PublishAllPorts, or host networking;
  * any host listener on a published or configured port of the project that is not loopback (lsof);
  * any successful TCP connection to those ports through any non-loopback address of this Mac;
  * a container mounting a Docker socket (it could undo all of this) or running privileged;
  * any container other than Kong attached to a non-internal network; Kong attached to a non-internal network other
    than the CLI's; a Kong route to anything but this stack's containers; Kong's admin API listening off loopback;
  * any container (other than Kong) that can open a TCP connection to the internet or resolve an outside name;
  * Auth configured with a non-loopback external or site URL, an SMTP server other than this stack's mail catcher,
    or an external sign-in provider enabled;
  * anything it cannot inspect (Docker unreachable, a container it cannot exec into, an unparseable answer).
It never reads a backup and changes nothing in the target; its only side effect is short-lived probe containers
(`docker run --rm --network container:<service>`). The restore script runs it before it opens the backup folder, and
again after the restore commits.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import re
import socket
import subprocess
import sys
from pathlib import Path

PERSISTENT_PROJECT_ID = "ovalball-saas-startup"
LOOPBACK_IPS = {"127.0.0.1", "::1"}
PROBE_IP, PROBE_PORT, PROBE_NAME = "1.1.1.1", 443, "exp.host"


class Fail(Exception):
    pass


def sh(*args: str, check: bool = True, input: str | None = None) -> str:
    r = subprocess.run(list(args), capture_output=True, text=True, input=input)
    if check and r.returncode != 0:
        raise Fail(f"{' '.join(args[:4])}...: exit {r.returncode}: {r.stderr.strip()[:200]}")
    return r.stdout


def project_id(project_dir: Path) -> str:
    cfg = project_dir / "supabase" / "config.toml"
    if not cfg.is_file():
        raise Fail(f"{cfg} not found")
    lines = [l for l in cfg.read_text().splitlines() if re.match(r"^\s*project_id\s*=", l)]
    if len(lines) != 1:
        raise Fail("config.toml must define project_id exactly once")
    m = re.match(r'^\s*project_id\s*=\s*"([a-z0-9][a-z0-9-]*)"\s*$', lines[0])
    if not m:
        raise Fail("project_id must be a plain double-quoted id of lowercase letters, digits and hyphens")
    if m.group(1) == PERSISTENT_PROJECT_ID:
        raise Fail("that is the persistent local project")
    return m.group(1)


def configured_ports(project_dir: Path) -> set[int]:
    """Every `port`/`*_port` value in config.toml, commented or not: a listener on any of them is checked."""
    ports = set()
    for m in re.finditer(r"^\s*#?\s*[a-z_]*port\s*=\s*(\d{2,5})\s*$", (project_dir / "supabase" / "config.toml").read_text(), re.M):
        ports.add(int(m.group(1)))
    return ports


def containers(pid: str) -> list[dict]:
    """Every container that belongs to the target by ANY sign: its name, the CLI's project label, or a mount of one of
    the target's volumes (a renamed container still holding the data is still in scope). Stopped ones included."""
    ids = set(sh("docker", "ps", "-aq", "--filter", f"label=com.supabase.cli.project={pid}").split())
    ids |= {n for n in sh("docker", "ps", "-a", "--format", "{{.Names}}").split() if n.endswith(f"_{pid}")}
    for vol in [v for v in sh("docker", "volume", "ls", "-q").split() if v.endswith(f"_{pid}")]:
        ids |= set(sh("docker", "ps", "-aq", "--filter", f"volume={vol}").split())
    if not ids:
        raise Fail(f"no containers found for project {pid}; is the disposable stack running?")
    unique = {c["Id"]: c for c in json.loads(sh("docker", "inspect", *sorted(ids)))}
    # A container of the persistent project must never be pulled into the target's scope (for example by mounting a
    # volume named like the target's): refuse outright rather than act on it or reason about it.
    for c in unique.values():
        labels = (c.get("Config") or {}).get("Labels") or {}
        if c["Name"].lstrip("/").endswith(f"_{PERSISTENT_PROJECT_ID}") or labels.get("com.supabase.cli.project") == PERSISTENT_PROJECT_ID:
            raise Fail(f"{c['Name'].lstrip('/')} belongs to the persistent project and is linked to the target; refusing")
    return list(unique.values())


def network(name: str) -> dict:
    return json.loads(sh("docker", "network", "inspect", name))[0]


def internal_net(pid: str) -> str:
    return f"ovb-isolated-{pid}"


def cli_net(pid: str) -> str:
    return f"supabase_network_{pid}"


def is_kong(c: dict, pid: str) -> bool:
    return c["Name"].lstrip("/") == f"supabase_kong_{pid}"


# ---------------------------------------------------------------------------------------------------- isolate
def isolate(project_dir: Path) -> int:
    pid = project_id(project_dir)
    net = internal_net(pid)
    existing = [n for n in sh("docker", "network", "ls", "--format", "{{.Name}}").split() if n == net]
    if existing:
        if not network(net).get("Internal"):
            raise Fail(f"network {net} exists and is NOT internal; refusing")
    else:
        sh("docker", "network", "create", "--internal", "--label", f"ovalball.isolated-restore={pid}", net)
    cs = [c for c in containers(pid) if c["State"]["Running"]]
    # Connect everything to the internal network first (with the aliases each service is known by), then leave the
    # CLI network: a container is never without its peers.
    for c in cs:
        nets = c["NetworkSettings"]["Networks"]
        if net in nets:
            continue
        aliases = (nets.get(cli_net(pid)) or {}).get("Aliases") or []
        args = ["docker", "network", "connect"]
        for a in aliases:
            args += ["--alias", a]
        sh(*args, net, c["Name"].lstrip("/"))
    for c in cs:
        if not is_kong(c, pid) and cli_net(pid) in c["NetworkSettings"]["Networks"]:
            sh("docker", "network", "disconnect", cli_net(pid), c["Name"].lstrip("/"))
    print(f"isolated: {len(cs)} containers on internal network {net}; only Kong also on {cli_net(pid)}")
    return 0


# ---------------------------------------------------------------------------------------------------- verify
def host_addresses() -> list[str]:
    """Every non-loopback IPv4/IPv6 address on this Mac (link-local IPv6 with its zone)."""
    out = sh("ifconfig")
    addrs, iface = [], None
    for line in out.splitlines():
        m = re.match(r"^([a-z0-9]+): flags", line)
        if m:
            iface = m.group(1)
            continue
        m = re.match(r"^\s+inet6? (\S+)", line)
        if not m:
            continue
        a = m.group(1).split("%")[0]
        try:
            ip = ipaddress.ip_address(a)
        except ValueError:
            continue
        if ip.is_loopback:
            continue
        addrs.append(f"{a}%{iface}" if ip.version == 6 and ip.is_link_local else a)
    if not addrs:
        raise Fail("found no non-loopback address to probe from; cannot prove LAN refusal")
    return addrs


def listeners(port: int) -> list[str]:
    r = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True)
    if r.returncode not in (0, 1):
        raise Fail(f"lsof failed for port {port}")
    return [l.split()[8] for l in r.stdout.splitlines()[1:] if len(l.split()) >= 9]


def connects(addr: str, port: int) -> bool:
    try:
        info = socket.getaddrinfo(addr, port, type=socket.SOCK_STREAM)[0]
        s = socket.socket(info[0], socket.SOCK_STREAM)
        s.settimeout(2)
        try:
            s.connect(info[4])
            return True
        finally:
            s.close()
    except OSError:
        return False


# Run in a throwaway container that JOINS the target container's network namespace (`--network container:<name>`), so
# the probe sees exactly that container's interfaces and routes -- including distroless images with no shell -- and
# depends on no tool inside the service. The image is the stack's own Postgres image (already local; has bash).
EGRESS_PROBE = (
    "command -v timeout >/dev/null && command -v getent >/dev/null || { echo NO-TOOL; exit 0; }; "
    f"timeout 4 bash -c '</dev/tcp/{PROBE_IP}/{PROBE_PORT}' >/dev/null 2>&1; rc=$?; "
    "if [ $rc -eq 0 ]; then echo TCP-OPEN; elif [ $rc -eq 1 ] || [ $rc -eq 124 ]; then echo TCP-BLOCKED; else echo TCP-ERROR-$rc; fi; "
    f"getent hosts {PROBE_NAME} >/dev/null 2>&1; rc=$?; "
    "if [ $rc -eq 0 ]; then echo DNS-OPEN; elif [ $rc -eq 2 ]; then echo DNS-BLOCKED; else echo DNS-ERROR-$rc; fi"
)


def egress(name: str, image: str) -> list[str]:
    r = subprocess.run(["docker", "run", "--rm", "--network", f"container:{name}", "--entrypoint", "bash", image, "-c", EGRESS_PROBE],
                       capture_output=True, text=True)
    out = r.stdout.split()
    # Anything but exactly the two expected answers from a probe that ran is "could not verify", never "blocked".
    if r.returncode != 0 or len(out) != 2 or out[0] not in ("TCP-OPEN", "TCP-BLOCKED") or out[1] not in ("DNS-OPEN", "DNS-BLOCKED"):
        return [f"PROBE-FAILED(rc={r.returncode}:{' '.join(out)[:40]})"]
    return out


def verify(project_dir: Path, results: list[tuple[bool, str]]) -> None:
    def check(ok: bool, what: str) -> None:
        results.append((ok, what))

    pid = project_id(project_dir)
    check(True, f"project {pid} is a disposable id (not {PERSISTENT_PROJECT_ID})")
    cs = containers(pid)
    running = [c for c in cs if c["State"]["Running"]]
    check(bool(running), f"{len(running)} running containers of {pid}")
    for needed in ("db", "kong"):
        check(any(c["Name"].lstrip("/") == f"supabase_{needed}_{pid}" for c in running), f"supabase_{needed}_{pid} is running")

    # INBOUND 1: what Docker was asked for and what it mapped.
    published: set[int] = set()
    for c in cs:
        name = c["Name"].lstrip("/")
        hc = c["HostConfig"]
        check(hc.get("NetworkMode") != "host", f"{name}: not host networking")
        check(not hc.get("Privileged"), f"{name}: not privileged")
        # Mounts: only this target's own named volumes. No bind mount at all -- a Docker socket (or a directory holding
        # one, such as ~/.docker) would let the container undo everything here, and a host path could be anything --
        # and never a volume of another project, the persistent one above all.
        for m in c.get("Mounts") or []:
            if m.get("Type") == "volume":
                vol = m.get("Name", "")
                check(vol.endswith(f"_{pid}") and not vol.endswith(f"_{PERSISTENT_PROJECT_ID}"), f"{name}: volume {vol} belongs to the target")
                # A name proves nothing about what a volume is: it must be a plain local volume, not a bind in disguise.
                info = json.loads(sh("docker", "volume", "inspect", vol))[0]
                plain = info.get("Driver") == "local" and not (info.get("Options") or {})
                check(plain, f"{name}: volume {vol} is a plain local volume (driver {info.get('Driver')}, options {info.get('Options') or 'none'})")
            else:
                check(False, f"{name}: {m.get('Type')} mount {m.get('Source')} -> {m.get('Destination')} (only the target's volumes are allowed)")
        check(not hc.get("PublishAllPorts"), f"{name}: PublishAllPorts off")
        for port, bindings in (hc.get("PortBindings") or {}).items():
            for b in bindings or []:
                ok = b.get("HostIp") in LOOPBACK_IPS
                check(ok, f"{name}: binding {port} -> {b.get('HostIp') or '*'}:{b.get('HostPort')}")
                if b.get("HostPort"):
                    published.add(int(b["HostPort"]))
        for port, maps in ((c.get("NetworkSettings") or {}).get("Ports") or {}).items():
            for m in maps or []:
                check(m.get("HostIp") in LOOPBACK_IPS, f"{name}: mapped {port} -> {m.get('HostIp')}:{m.get('HostPort')}")
                published.add(int(m["HostPort"]))

    # INBOUND 2: what the host is actually listening on.
    ports = sorted(published | configured_ports(project_dir))
    for port in ports:
        for addr in listeners(port):
            ok = addr.startswith("127.0.0.1:") or addr.startswith("[::1]:")
            check(ok, f"host listener on {port}: {addr}")

    # INBOUND 3: try it, through every non-loopback address this Mac has.
    addrs = host_addresses()
    from concurrent.futures import ThreadPoolExecutor
    pairs = [(addr, port) for port in ports for addr in addrs]
    with ThreadPoolExecutor(max_workers=32) as pool:
        for (addr, port), reached in zip(pairs, pool.map(lambda ap: connects(*ap), pairs)):
            check(not reached, f"no connection to {addr} port {port}")
    # Only the API (Kong) has to be reachable, and only on loopback: Docker Desktop stops forwarding the published ports
    # of containers left on internal networks, which is stricter still. The database is reached with `docker exec`.
    kong_ports = {int(m["HostPort"]) for c in running if is_kong(c, pid)
                  for maps in ((c.get("NetworkSettings") or {}).get("Ports") or {}).values() for m in (maps or [])}
    check(bool(kong_ports), f"Kong publishes the API on loopback ({', '.join(map(str, sorted(kong_ports))) or 'nothing'})")
    for port in sorted(kong_ports):
        check(connects("127.0.0.1", port), f"loopback reaches the API on {port}")

    # OUTBOUND 1: networks.
    net = internal_net(pid)
    try:
        check(bool(network(net).get("Internal")), f"network {net} exists and is internal")
    except Fail:
        check(False, f"network {net} exists and is internal")
    internal_of: dict[str, bool] = {}
    for c in cs:  # stopped containers too: starting one must not bring a route out with it
        name = c["Name"].lstrip("/")
        for n in c["NetworkSettings"]["Networks"]:
            if n not in internal_of:
                try:
                    internal_of[n] = bool(network(n).get("Internal"))
                except Fail:
                    internal_of[n] = False  # a network that cannot be inspected is not trusted
            if is_kong(c, pid):
                check(internal_of[n] or n == cli_net(pid), f"{name}: attached to {n}")
            else:
                check(internal_of[n], f"{name}: attached only to internal networks ({n})")
        check(net in c["NetworkSettings"]["Networks"], f"{name}: on {net}")

    # OUTBOUND 2: Kong, the one container with a route out, routes only to this stack, and its admin API is local.
    kong = f"supabase_kong_{pid}"
    peers = {c["Name"].lstrip("/") for c in cs}
    for c in cs:
        for n in (c["NetworkSettings"]["Networks"] or {}).values():
            peers.update(a for a in (n.get("Aliases") or []) if "." not in a or a.endswith(".supabase.internal"))
    # Every upstream, in every form Kong's declarative config accepts it (`url:` or `host:`, quoted or not), must be
    # the exact name or alias of one of this target's containers, or the exact name the CLI gives a service of this
    # project -- not merely something ending in the project id.
    from urllib.parse import urlsplit
    names = {c["Name"].lstrip("/") for c in cs}
    allowed = set(peers) | names | {f"supabase_{svc}_{pid}" for svc in (
        "db", "kong", "auth", "rest", "realtime", "storage", "imgproxy", "inbucket", "studio", "pg_meta", "edge_runtime",
        "analytics", "vector", "pooler")}
    kong_raw = sh("docker", "exec", kong, "cat", "/home/kong/kong.yml")
    # Comments and `_comment:` metadata are ignored by Kong, so they are dropped first (they name upstreams in prose).
    kong_yml = "\n".join(re.sub(r"(^|\s)#.*$", "", l) for l in kong_raw.splitlines()
                         if not re.match(r"^\s*(-\s*)?_comment\s*:", l))
    # Read the whole file, not its layout: every URL anywhere (services, flow-style entries, plugin settings such as a
    # log endpoint) and every host/target/hosts value, quoted or not. Anything that is not exactly one of this stack's
    # containers or service names fails -- a false alarm is acceptable, a missed route is not.
    hosts = [urlsplit(u).hostname or u for u in re.findall(r"""[a-zA-Z][a-zA-Z0-9+.-]*://[^\s"',}\]]+""", kong_yml)]
    hosts += re.findall(r"""(?:^|[\s{,\[-])(?:host|target|upstream)s?\s*:\s*["']?([A-Za-z0-9_.:\[\]-]+)""", kong_yml, re.M)
    hosts = [h.rsplit(":", 1)[0] if h.count(":") == 1 else h for h in hosts]
    check(bool(hosts), "Kong declarative routes read")
    for host in sorted(set(hosts)):
        check(host in allowed, f"Kong upstream -> {host}")
    tcp = sh("docker", "exec", kong, "sh", "-c", "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null")
    for line in tcp.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4 or parts[3] != "0A":  # LISTEN
            continue
        local_hex, port_hex = parts[1].split(":")
        port = int(port_hex, 16)
        if port in (8001, 8444):
            loop = local_hex in ("0100007F", "00000000000000000000000001000000")
            check(loop, f"Kong admin API listener on {port}: {'loopback' if loop else 'NOT loopback'}")

    # OUTBOUND 3: try it, from inside the network namespace of every running container except Kong -- and from Kong's,
    # as a positive control that the probe can see an open route (Kong is on the CLI network by design).
    db_image = next((c["Config"]["Image"] for c in running if c["Name"].lstrip("/") == f"supabase_db_{pid}"), None)
    if not db_image:
        raise Fail(f"supabase_db_{pid} is not running; the egress probe has no image to run")
    with ThreadPoolExecutor(max_workers=8) as pool:
        probes = dict(zip([c["Name"] for c in running], pool.map(lambda c: egress(c["Name"].lstrip("/"), db_image), running)))
    for c in running:
        name = c["Name"].lstrip("/")
        out = probes[c["Name"]]
        if is_kong(c, pid):
            check(out == ["TCP-OPEN", "DNS-OPEN"], f"{name}: probe control -- the probe sees Kong's route out, by TCP and DNS ({' '.join(out)})")
            continue
        check(out[:1] == ["TCP-BLOCKED"], f"{name}: TCP to {PROBE_IP}:{PROBE_PORT} {'blocked' if out[:1] == ['TCP-BLOCKED'] else ' '.join(out) or 'probe gave no answer'}")
        check(out[1:2] == ["DNS-BLOCKED"], f"{name}: outside name {PROBE_NAME} {'not resolvable' if out[1:2] == ['DNS-BLOCKED'] else ' '.join(out) or 'probe gave no answer'}")

    # OUTBOUND 4: Auth sends mail only to this stack's catcher, and its links point at loopback.
    auth = f"supabase_auth_{pid}"
    if any(c["Name"].lstrip("/") == auth for c in running):
        env = dict(l.split("=", 1) for l in sh("docker", "exec", auth, "env").splitlines() if "=" in l)
        check(env.get("GOTRUE_SMTP_HOST", "") in ("", f"supabase_inbucket_{pid}", "inbucket"), f"Auth SMTP host: {env.get('GOTRUE_SMTP_HOST') or '(none)'}")
        for key in ("API_EXTERNAL_URL", "GOTRUE_SITE_URL"):
            host = re.sub(r"^[a-z]+://", "", env.get(key, "")).split("/")[0].rsplit(":", 1)[0].strip("[]")
            check(host in ("127.0.0.1", "localhost", "::1"), f"Auth {key} host: {host or '(none)'}")
        for k, v in env.items():
            m = re.match(r"^GOTRUE_EXTERNAL_([A-Z_]+)_ENABLED$", k)
            if m and m.group(1) not in ("EMAIL", "PHONE", "ANONYMOUS_USERS") and v.lower() == "true":
                check(False, f"Auth external provider enabled: {m.group(1)}")


def emergency_stop(project_dir: Path) -> int:
    """Stop every container in the target's scope (name, label or volume). Exit non-zero if any could not be stopped."""
    pid = project_id(project_dir)
    failed = []
    for c in containers(pid):
        if c["State"]["Running"]:
            name = c["Name"].lstrip("/")
            if subprocess.run(["docker", "stop", name], capture_output=True).returncode != 0:
                failed.append(name)
    still = [c["Name"].lstrip("/") for c in containers(pid) if c["State"]["Running"]]
    if failed or still:
        print(f"EMERGENCY STOP INCOMPLETE: still running: {', '.join(sorted(set(failed + still)))} -- stop Docker Desktop now", file=sys.stderr)
        return 4
    print("emergency stop: every container of the target is stopped")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["isolate", "verify", "emergency-stop"])
    ap.add_argument("--project-dir", required=True, type=Path)
    ap.add_argument("--quiet", action="store_true", help="verify: print failures and the verdict only")
    args = ap.parse_args()
    try:
        if args.command == "isolate":
            return isolate(args.project_dir)
        if args.command == "emergency-stop":
            return emergency_stop(args.project_dir)
        results: list[tuple[bool, str]] = []
        try:
            verify(args.project_dir, results)
        except Fail as e:
            results.append((False, f"could not verify: {e}"))
        except Exception as e:  # anything unexpected is a failure, never a pass
            results.append((False, f"could not verify: {type(e).__name__}: {e}"))
        failed = [w for ok, w in results if not ok]
        for ok, what in results:
            if not ok or not args.quiet:
                print(f"{'ok  ' if ok else 'FAIL'}  {what}")
        print(f"ISOLATION {'VERIFIED' if not failed else 'NOT VERIFIED'}: {len(results) - len(failed)} passed, {len(failed)} failed")
        return 0 if not failed and results else 3
    except Fail as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
