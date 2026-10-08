#!/usr/bin/env python3
"""Network isolation for a DISPOSABLE local Supabase restore target -- and the fail-closed preflight that proves it.

    scripts/ops/restore/restore-target-isolation.py isolate --project-dir DIR   # rewire a running disposable stack
    scripts/ops/restore/restore-target-isolation.py verify  --project-dir DIR   # exit 0 ONLY if every check passes

A copy of production data must be reachable from nowhere but this Mac's loopback, and must reach nothing outside its
own containers. Two mechanisms, verified separately (see PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md, "Restore isolation"):

  INBOUND   the stack is STARTED through docker-loopback-proxy.py, which makes every published port bind 127.0.0.1
            (the Supabase CLI cannot; Docker Desktop ignores a network-level default but honours an explicit host IP).
  OUTBOUND  `isolate` attaches every container of the stack to an `--internal` Docker network (no route out, no
            outside DNS), keeping its service aliases, and removes EVERY container -- Kong included -- from every other
            network. No container has a default route. Docker Desktop then forwards no published port at all, so the
            API is reached only through `loopback-api-relay.py` (127.0.0.1 on the host, `docker exec` into Kong's own
            loopback; a fixed destination, not a proxy).
  CONTINUOUS `guard` stays running for as long as the target exists: it re-checks the structure on every Docker event
            (and every few seconds) and stops the whole target the moment anything breaks. The restore and Storage
            tools refuse to run without a live guard.

`verify` trusts no configuration file. It reads the running containers and the host itself, and FAILS -- exit 3 -- on:
  * a project id that is not a plain disposable id, or is the persistent project;
  * any container of the project with a published port not bound to 127.0.0.1/::1, PublishAllPorts, or host networking;
  * any host listener on a published or configured port of the project that is not loopback (lsof);
  * any successful TCP connection to those ports through any non-loopback address of this Mac;
  * a container mounting a Docker socket (it could undo all of this) or running privileged;
  * any container -- Kong included -- attached to a non-internal network; a Kong route to anything but this stack's
    containers; Kong's admin API listening off loopback;
  * any container that can open a TCP connection to the internet or resolve an outside name (the probe's own positive
    control runs in a throwaway container on Docker's default bridge and must see the internet);
  * with --api-port: the relay listening anywhere but loopback, or the API not answering through it;
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


DOCKER_TIMEOUT = 30  # seconds: a stalled Docker call is a failure, never a wait


def sh(*args: str, check: bool = True, input: str | None = None) -> str:
    try:
        r = subprocess.run(list(args), capture_output=True, text=True, input=input, timeout=DOCKER_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Fail(f"{' '.join(args[:4])}...: no answer within {DOCKER_TIMEOUT}s")
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


def inspect_existing(ids: list[str]) -> list[dict]:
    """`docker inspect` that tolerates a container removed between listing and inspecting it (a short-lived `--rm`
    probe) -- and nothing else: any other error is a failure."""
    if not ids:
        return []
    # --type container: a target VOLUME has the same name as its container, and a bare inspect of a removed container's
    # name would answer with the volume.
    try:
        r = subprocess.run(["docker", "inspect", "--type", "container", *ids], capture_output=True, text=True, timeout=DOCKER_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Fail(f"docker inspect: no answer within {DOCKER_TIMEOUT}s")
    gone = ("no such object", "no such container")  # removed between listing and inspecting: not an error
    errors = [l for l in r.stderr.splitlines() if l.strip() and not any(g in l.lower() for g in gone)]
    if errors or (r.returncode != 0 and not r.stderr.strip()):
        raise Fail(f"docker inspect: {(errors or [r.stderr.strip()])[0][:200]}")
    try:
        return json.loads(r.stdout or "[]")
    except json.JSONDecodeError as e:
        raise Fail(f"docker inspect: unparseable answer ({e})")


def containers(pid: str) -> list[dict]:
    """Every container that belongs to the target by ANY sign: its name, the CLI's project label, or a mount of one of
    the target's volumes (a renamed container still holding the data is still in scope). Stopped ones included."""
    ids = set(sh("docker", "ps", "-aq", "--filter", f"label=com.supabase.cli.project={pid}").split())
    ids |= {n for n in sh("docker", "ps", "-a", "--format", "{{.Names}}").split() if n.endswith(f"_{pid}")}
    for vol in [v for v in sh("docker", "volume", "ls", "-q").split() if v.endswith(f"_{pid}")]:
        ids |= set(sh("docker", "ps", "-aq", "--filter", f"volume={vol}").split())
    # ...and EVERY container attached to one of the target's networks, whatever it is called: a container that joins
    # the internal network and also another one would otherwise bridge the target to the outside unseen.
    for net in (internal_net(pid), cli_net(pid)):
        if net in sh("docker", "network", "ls", "--format", "{{.Name}}").split():
            ids |= set(json.loads(sh("docker", "network", "inspect", net))[0].get("Containers", {}).keys())
    # ...and the members of EVERY network a container of the target is on, repeated until nothing new appears: a peer
    # reached through any shared network -- even another internal one -- is in scope.
    seen_nets: set[str] = set()
    internal_seen: set[str] = set()
    while ids:
        nets = set()
        for c in inspect_existing(sorted(ids)):
            nets |= set(((c.get("NetworkSettings") or {}).get("Networks") or {}).keys())
        nets -= seen_nets | {"none"}
        if not nets:
            break
        seen_nets |= nets
        for n in nets:
            try:
                info = json.loads(sh("docker", "network", "inspect", n))[0]
            except Fail:
                continue
            # Expand only through INTERNAL networks: a target container on any other network fails on its own, and
            # following e.g. Docker's default bridge would sweep unrelated containers into scope (and into destroy).
            if info.get("Internal"):
                internal_seen.add(n)
                ids |= set((info.get("Containers") or {}).keys())
    if not ids:
        raise Fail(f"no containers found for project {pid}; is the disposable stack running?")
    unique = {c["Id"]: c for c in inspect_existing(sorted(ids))}
    # Containers that share the network namespace of one of these (`--network container:<x>`) are in scope too.
    every = sh("docker", "ps", "-aq").split()
    if every:
        keys = set(unique) | {c["Name"].lstrip("/") for c in unique.values()} | {i[:12] for i in unique}
        target_nets = {internal_net(pid), cli_net(pid)} | internal_seen
        for c in inspect_existing(every):
            mode = (c.get("HostConfig") or {}).get("NetworkMode") or ""
            if mode.startswith("container:") and mode.split(":", 1)[1] in keys | {k[:12] for k in keys}:
                unique[c["Id"]] = c
            # A container CONFIGURED on a target network is in scope even when it is not running (Docker lists only
            # running endpoints as network members): started later, it would bridge the target.
            if target_nets & set(((c.get("NetworkSettings") or {}).get("Networks") or {}).keys()) or mode in target_nets:
                unique[c["Id"]] = c
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
        for n in list(c["NetworkSettings"]["Networks"]):
            if n != net:
                sh("docker", "network", "disconnect", n, c["Name"].lstrip("/"))
    print(f"isolated: {len(cs)} containers on internal network {net} only (Kong included); reach the API through loopback-api-relay.py")
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
    "if awk '$1==\"00000000000000000000000000000000\" && $2==\"00\" && $10!=\"lo\"{f=1} END{exit !f}' /proc/net/ipv6_route 2>/dev/null; then echo V6-ROUTE; else echo V6-NONE; fi; "
    f"timeout 4 bash -c '</dev/tcp/{PROBE_IP}/{PROBE_PORT}' >/dev/null 2>&1; rc=$?; "
    "if [ $rc -eq 0 ]; then echo TCP-OPEN; elif [ $rc -eq 1 ] || [ $rc -eq 124 ]; then echo TCP-BLOCKED; else echo TCP-ERROR-$rc; fi; "
    f"getent hosts {PROBE_NAME} >/dev/null 2>&1; rc=$?; "
    "if [ $rc -eq 0 ]; then echo DNS-OPEN; elif [ $rc -eq 2 ]; then echo DNS-BLOCKED; else echo DNS-ERROR-$rc; fi"
)


def egress(name: str, image: str) -> list[str]:
    try:
        r = subprocess.run(["docker", "run", "--rm", "--network", f"container:{name}", "--entrypoint", "bash", image, "-c", EGRESS_PROBE],
                           capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return ["PROBE-FAILED(timeout)"]
    out = r.stdout.split()
    # Anything but exactly the three expected answers from a probe that ran is "could not verify", never "blocked".
    if (r.returncode != 0 or len(out) != 3 or out[0] not in ("V6-ROUTE", "V6-NONE")
            or out[1] not in ("TCP-OPEN", "TCP-BLOCKED") or out[2] not in ("DNS-OPEN", "DNS-BLOCKED")):
        return [f"PROBE-FAILED(rc={r.returncode}:{' '.join(out)[:40]})"]
    return out[1:] + out[:1]  # TCP, DNS, IPv6 route


def relay_owner(project_dir: Path, port: int) -> str | None:
    """None when the only listener on `port` is the relay recorded for this target; otherwise why not."""
    try:
        recorded = int((project_dir.resolve() / ".api-relay.pid").read_text().strip())
    except (OSError, ValueError):
        return "no relay recorded for this target"
    r = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True)
    pids = {int(x) for x in r.stdout.split() if x.isdigit()}
    if pids != {recorded}:
        return f"listening processes {sorted(pids)} are not the recorded relay {recorded}"
    cmd = subprocess.run(["ps", "-p", str(recorded), "-o", "command="], capture_output=True, text=True).stdout
    if "loopback-api-relay.py" not in cmd or str(project_dir.resolve()) not in cmd or f"--port {port}" not in cmd:
        return "the recorded relay is not loopback-api-relay.py for this target and port"
    return None


def api_answers(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=10) as s:
            s.sendall(b"GET /auth/v1/health HTTP/1.0\r\nHost: localhost\r\n\r\n")
            return s.recv(64).startswith(b"HTTP/1.")
    except OSError:
        return False


def verify(project_dir: Path, results: list[tuple[bool, str]], api_port: int | None = None) -> None:
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
    ports = sorted(published | configured_ports(project_dir) | ({api_port} if api_port else set()))
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
    # The API is reached only through the loopback relay (no container has a published port that forwards anywhere).
    if api_port:
        relay = listeners(api_port)
        check(bool(relay) and all(a.startswith("127.0.0.1:") for a in relay), f"API relay listens on loopback only ({', '.join(relay) or 'not listening'})")
        # ...and it IS this target's relay: the process listening on the port is the one recorded for this target,
        # running loopback-api-relay.py for this project directory -- not some other local service.
        owner = relay_owner(project_dir, api_port)
        check(owner is None, f"the listener on {api_port} is this target's loopback-api-relay.py" + (f" ({owner})" if owner else ""))
        check(api_answers(api_port), f"the API answers through the relay on 127.0.0.1:{api_port}")

    # OUTBOUND 1: networks.
    net = internal_net(pid)
    try:
        check(bool(network(net).get("Internal")), f"network {net} exists and is internal")
    except Fail:
        check(False, f"network {net} exists and is internal")
    internal_of: dict[str, bool] = {}
    scope_keys = {c["Id"] for c in cs if not ((c.get("HostConfig") or {}).get("NetworkMode") or "").startswith("container:")}
    scope_keys |= {k[:12] for k in scope_keys} | {c["Name"].lstrip("/") for c in cs if c["Id"] in scope_keys}
    for c in cs:  # stopped containers too: starting one must not bring a route out with it
        name = c["Name"].lstrip("/")
        mode = (c.get("HostConfig") or {}).get("NetworkMode") or ""
        joiner = mode.startswith("container:")
        if joiner:
            parent = mode.split(":", 1)[1]
            check(parent in scope_keys, f"{name}: shares the network namespace of a target container ({parent[:12]})")
        for n in (c["NetworkSettings"]["Networks"] or {}):
            if n not in internal_of:
                try:
                    internal_of[n] = bool(network(n).get("Internal"))
                except Fail:
                    internal_of[n] = False  # a network that cannot be inspected is not trusted
            check(internal_of[n], f"{name}: attached only to internal networks ({n})")
            check(n == net, f"{name}: attached to no network but {net} ({n})")
        if not joiner:
            check(net in (c["NetworkSettings"]["Networks"] or {}), f"{name}: on {net}")

    # OUTBOUND 2: Kong routes only to this stack, and its admin API is local (defence in depth: Kong has no route out).
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

    # OUTBOUND 3: try it, from inside the network namespace of EVERY running container, Kong included. The probe's
    # positive control runs in a throwaway container on Docker's default bridge: it must see the internet, or the
    # probe proves nothing (and verify fails).
    db_image = next((c["Config"]["Image"] for c in running if c["Name"].lstrip("/") == f"supabase_db_{pid}"), None)
    if not db_image:
        raise Fail(f"supabase_db_{pid} is not running; the egress probe has no image to run")
    control = subprocess.run(["docker", "run", "--rm", "--network", "bridge", "--entrypoint", "bash", db_image, "-c", EGRESS_PROBE],
                             capture_output=True, text=True).stdout.split()
    check(control[1:3] == ["TCP-OPEN", "DNS-OPEN"], f"probe control on Docker's default bridge sees the internet by TCP and DNS ({' '.join(control) or 'no answer'})")
    probed = [c for c in running if not ((c.get("HostConfig") or {}).get("NetworkMode") or "").startswith("container:")]
    with ThreadPoolExecutor(max_workers=8) as pool:
        probes = dict(zip([c["Name"] for c in probed], pool.map(lambda c: egress(c["Name"].lstrip("/"), db_image), probed)))
    for c in probed:
        name = c["Name"].lstrip("/")
        out = probes[c["Name"]]
        check(out[:1] == ["TCP-BLOCKED"], f"{name}: TCP to {PROBE_IP}:{PROBE_PORT} {'blocked' if out[:1] == ['TCP-BLOCKED'] else ' '.join(out) or 'probe gave no answer'}")
        check(out[1:2] == ["DNS-BLOCKED"], f"{name}: outside name {PROBE_NAME} {'not resolvable' if out[1:2] == ['DNS-BLOCKED'] else ' '.join(out) or 'probe gave no answer'}")
        check(out[2:3] == ["V6-NONE"], f"{name}: no IPv6 default route ({' '.join(out[2:3]) or 'probe gave no answer'})")

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


def structure_failures(pid: str) -> list[str]:
    """The fast, structural part of verify (no probes): what the guard re-checks on every Docker event."""
    bad = []
    cs = containers(pid)
    keys = {c["Id"] for c in cs if not ((c.get("HostConfig") or {}).get("NetworkMode") or "").startswith("container:")}
    keys |= {k[:12] for k in keys} | {c["Name"].lstrip("/") for c in cs if c["Id"] in keys}
    for c in cs:
        name = c["Name"].lstrip("/")
        hc = c.get("HostConfig") or {}
        mode = hc.get("NetworkMode") or ""
        if mode.startswith("container:") and mode.split(":", 1)[1] not in keys:
            bad.append(f"{name}: shares the network namespace of a container outside the target")
        if hc.get("NetworkMode") == "host" or hc.get("Privileged") or hc.get("PublishAllPorts"):
            bad.append(f"{name}: host networking, privileged or publish-all")
        for m in c.get("Mounts") or []:
            if m.get("Type") != "volume" or not m.get("Name", "").endswith(f"_{pid}"):
                bad.append(f"{name}: mount {m.get('Type')} {m.get('Name') or m.get('Source')}")
            else:
                info = json.loads(sh("docker", "volume", "inspect", m["Name"]))[0]
                if info.get("Driver") != "local" or (info.get("Options") or {}):
                    bad.append(f"{name}: volume {m['Name']} is not a plain local volume")
        for bindings in (hc.get("PortBindings") or {}).values():
            for b in bindings or []:
                if b.get("HostIp") not in LOOPBACK_IPS:
                    bad.append(f"{name}: port {b.get('HostPort')} on {b.get('HostIp') or '*'}")
        for maps in ((c.get("NetworkSettings") or {}).get("Ports") or {}).values():
            for m in maps or []:
                if m.get("HostIp") not in LOOPBACK_IPS:
                    bad.append(f"{name}: mapped port {m.get('HostPort')} on {m.get('HostIp')}")
        for n in (c["NetworkSettings"]["Networks"] or {}):
            try:
                internal = bool(network(n).get("Internal"))
            except Fail:
                internal = False
            if not internal:
                bad.append(f"{name}: attached to {n}, which has a route out")
            elif n != internal_net(pid):
                bad.append(f"{name}: attached to another network, {n}")
    return bad


def guard_pidfile(project_dir: Path) -> Path:
    return project_dir.resolve() / ".isolation-guard.pid"


def stop_relay(project_dir: Path | None, log) -> bool:
    """Stop this target's loopback relay -- only if the recorded process is loopback-api-relay.py for THIS target."""
    if project_dir is None:
        return True
    pf = project_dir.resolve() / ".api-relay.pid"
    try:
        rpid = int(pf.read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return True
    cmd = subprocess.run(["ps", "-p", str(rpid), "-o", "command="], capture_output=True, text=True).stdout
    if "loopback-api-relay.py" in cmd and str(project_dir.resolve()) in cmd:
        subprocess.run(["kill", str(rpid)], capture_output=True)
        log(f"relay stopped (pid {rpid})")
    pf.unlink(missing_ok=True)
    return "loopback-api-relay.py" not in subprocess.run(["ps", "-p", str(rpid), "-o", "command="], capture_output=True, text=True).stdout


def destroy_target_data(pid: str, log, project_dir: Path | None = None) -> bool:
    """Remove the target's containers -- the whole scope, plus label and name -- its data volumes and its internal
    network, never anything of the persistent project. True only when Docker CONFIRMS every one of them is gone."""
    ids: set[str] = set()
    try:
        scope = containers(pid)
        own = {c["Id"] for c in scope if owned(c, pid)} | {c["Name"].lstrip("/") for c in scope if owned(c, pid)}
        ids |= {c["Id"] for c in scope if owned(c, pid, own)}
        for c in scope:
            if not owned(c, pid, own):
                log(f"not removing {c['Name'].lstrip('/')}: reachable from the target but not owned by it")
    except Exception as e:
        log(f"scope could not be computed ({e}); falling back to label and name")
    ids |= set(sh("docker", "ps", "-aq", "--filter", f"label=com.supabase.cli.project={pid}").split())
    ids |= {n for n in sh("docker", "ps", "-a", "--format", "{{.Names}}").split() if n.endswith(f"_{pid}")}
    states = {i: persistence(i) for i in ids}
    skipped = {i for i, st in states.items() if st == "persistent"}
    unknown = {i for i, st in states.items() if st == "unknown"}
    for i in sorted(skipped):
        log(f"not removing {i}: it belongs to the persistent project")
    for i in sorted(unknown):
        log(f"not removing {i}: Docker could not show whose it is")
    targets = {i for i, st in states.items() if st == "not"}
    for i in sorted(targets):
        try:
            subprocess.run(["docker", "rm", "-f", i], capture_output=True, timeout=DOCKER_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass
    vols = [v for v in sh("docker", "volume", "ls", "-q").split()
            if v.endswith(f"_{pid}") and not v.endswith(f"_{PERSISTENT_PROJECT_ID}")]
    for v in vols:
        try:
            subprocess.run(["docker", "volume", "rm", "-f", v], capture_output=True, timeout=DOCKER_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass
    relay_gone = stop_relay(project_dir, log)
    for n in (internal_net(pid), cli_net(pid)):
        subprocess.run(["docker", "network", "rm", n], capture_output=True, timeout=DOCKER_TIMEOUT)
    # Confirm, object by object: every discovered container, every target volume, the label, the network.
    left_ctrs = sorted(i for i in targets if subprocess.run(["docker", "inspect", "--type", "container", i],
                                                            capture_output=True, timeout=DOCKER_TIMEOUT).returncode == 0)
    left_ctrs += sorted(set(sh("docker", "ps", "-aq", "--filter", f"label=com.supabase.cli.project={pid}").split()))
    left_vols = [v for v in sh("docker", "volume", "ls", "-q").split() if v in vols]
    nets_now = sh("docker", "network", "ls", "--format", "{{.Name}}").split()
    left_net = internal_net(pid) in nets_now or cli_net(pid) in nets_now
    ok = not left_ctrs and not left_vols and not left_net and not unknown and relay_gone
    log(f"destroyed: {len(targets)} containers, {len(vols) - len(left_vols)} of {len(vols)} volumes, networks "
        f"{'kept' if left_net else 'removed'}, relay {'stopped' if relay_gone else 'STILL RUNNING'}" + ("" if ok else f" -- STILL PRESENT: containers {left_ctrs}, volumes {left_vols}"))
    return ok


def guard(project_dir: Path, interval: float, on_trip: str = "destroy") -> int:
    """Stay running for the target's whole life. On every Docker container/network/volume event, and every `interval`
    seconds, re-check the structure and write a heartbeat; on any failure -- an error, a Docker call that does not
    answer, Docker's event stream ending, SIGTERM/SIGHUP -- kill the whole target and (default) destroy its containers
    and data volumes so it can never come back up. A guard that is killed outright or stopped stops writing its
    heartbeat, and the restore tools then refuse the target (`guard-status`)."""
    import os, secrets, selectors, signal, time
    pid = project_id(project_dir)

    def log(msg: str) -> None:
        print(f"[isolation-guard {time.strftime('%H:%M:%S')}] {msg}", flush=True)

    def trip(why: str) -> int:
        log(f"TRIPPED: {why}")
        try:
            rc = emergency_stop(project_dir)
        except Exception as e:
            log(f"emergency stop raised {type(e).__name__}: {e}")
            rc = 4
        log("target stopped" if rc == 0 else "EMERGENCY STOP INCOMPLETE -- quit Docker Desktop now")
        if on_trip == "destroy":
            try:
                if not destroy_target_data(pid, log, project_dir):
                    log("DESTROY INCOMPLETE -- quit Docker Desktop and remove the target's volumes by hand")
            except Exception as e:
                log(f"DESTROY FAILED ({type(e).__name__}: {e}) -- quit Docker Desktop and remove the target's volumes by hand")
        return 5

    class Stopped(Exception):
        pass

    def on_signal(signum, _frame):
        raise Stopped(f"signal {signum}")

    pidfile = guard_pidfile(project_dir)
    beat = heartbeat_file(project_dir)
    nonce = secrets.token_hex(16)
    events = None
    try:
        # Everything from here on -- start-up included -- trips on failure: the guard never fails open.
        for sig in (signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, on_signal)
        bad = structure_failures(pid)
        if bad:
            return trip("; ".join(bad[:5]))
        pidfile.write_text(f"{os.getpid()} {pid} {nonce}\n")
        events = subprocess.Popen(["docker", "events", "--format", "{{.Type}} {{.Action}}",
                                   "--filter", "type=container", "--filter", "type=network", "--filter", "type=volume"],
                                  stdout=subprocess.PIPE)
        sel = selectors.DefaultSelector()
        sel.register(events.stdout, selectors.EVENT_READ)
        fd = events.stdout.fileno()
        log(f"guarding {pid}: structure re-checked on every Docker event and every {interval:g}s")
        while True:
            beat.write_text(f"{nonce} {time.time():.3f}\n")
            for _key, _mask in sel.select(timeout=interval):
                if not os.read(fd, 65536):  # never blocks on a partial line; empty means the stream ended
                    return trip("Docker's event stream ended; the target can no longer be watched")
            bad = structure_failures(pid)
            if bad:
                return trip("; ".join(bad[:5]))
    except BaseException as e:  # an error, a timeout, a signal, an interrupt: the target goes down with the guard
        return trip(f"{type(e).__name__}: {e}")
    finally:
        if events:
            events.kill()
        for f in (pidfile, beat):
            try:
                if nonce in f.read_text():
                    f.unlink()
            except OSError:
                pass


def heartbeat_file(project_dir: Path) -> Path:
    return project_dir.resolve() / ".isolation-guard.heartbeat"


def guard_alive(project_dir: Path, max_age: float = 15.0) -> int:
    """0 only if the recorded guard process is alive, is `restore-target-isolation.py guard` for THIS project
    directory, and has written its heartbeat (with the run's own secret) within `max_age` seconds -- so a guard that was
    killed, stopped (SIGSTOP) or is hung does not count."""
    import time
    try:
        gpid, gproject, nonce = guard_pidfile(project_dir).read_text().split()
        beat_nonce, beat_time = heartbeat_file(project_dir).read_text().split()
    except (OSError, ValueError):
        print("no isolation guard is running for this target", file=sys.stderr)
        return 1
    cmd = subprocess.run(["ps", "-p", gpid, "-o", "command="], capture_output=True, text=True).stdout
    if (gproject != project_id(project_dir) or "restore-target-isolation.py" not in cmd or " guard" not in cmd
            or str(project_dir.resolve()) not in cmd):
        print("the isolation guard recorded for this target is not running", file=sys.stderr)
        return 1
    age = time.time() - float(beat_time)
    if beat_nonce != nonce or age > max_age:
        print(f"the isolation guard is not alive (last heartbeat {age:.0f}s ago)", file=sys.stderr)
        return 1
    print(f"isolation guard running (pid {gpid}, heartbeat {age:.1f}s ago)")
    return 0


def persistence(ref: str) -> str:
    """'persistent', 'not', 'gone' or 'unknown'. Only Docker's own "no such container/object" answer counts as gone;
    a timeout, a transport error or anything unexpected is 'unknown' -- never treated as safe to act on."""
    try:
        r = subprocess.run(["docker", "inspect", "--type", "container", "--format",
                            "{{.Name}}|{{index .Config.Labels \"com.supabase.cli.project\"}}", ref],
                           capture_output=True, text=True, timeout=DOCKER_TIMEOUT)
    except subprocess.TimeoutExpired:
        return "unknown"
    if r.returncode != 0:
        err = r.stderr.strip().lower()
        if re.search(r"(^|daemon: )(error: )?no such (container|object): ", err) and "connect" not in err and "docker.sock" not in err:
            return "gone"
        return "unknown"
    name, label = (r.stdout.strip().split("|", 1) + [""])[:2]
    return "persistent" if name.lstrip("/").endswith(f"_{PERSISTENT_PROJECT_ID}") or label == PERSISTENT_PROJECT_ID else "not"


def is_persistent(ref: str) -> bool:
    """True unless Docker positively shows `ref` is not (or no longer) a container of the persistent project."""
    return persistence(ref) not in ("not", "gone")


def owned(c: dict, pid: str, owned_ids: set[str] | None = None) -> bool:
    """Containers the target OWNS -- the only ones emergency-stop and destroy act on: its project label, its name
    suffix, a mount of one of its volumes, its own internal network, or the network namespace of an owned container.
    A peer merely reachable through some other (possibly another application's) network is never owned."""
    labels = (c.get("Config") or {}).get("Labels") or {}
    name = c["Name"].lstrip("/")
    if labels.get("com.supabase.cli.project") == pid or name.endswith(f"_{pid}"):
        return True
    if any(m.get("Type") == "volume" and m.get("Name", "").endswith(f"_{pid}") for m in c.get("Mounts") or []):
        return True
    if internal_net(pid) in ((c.get("NetworkSettings") or {}).get("Networks") or {}):
        return True
    mode = (c.get("HostConfig") or {}).get("NetworkMode") or ""
    return bool(owned_ids) and mode.startswith("container:") and mode.split(":", 1)[1] in owned_ids


def emergency_stop(project_dir: Path) -> int:
    """Stop every container in the target's scope. Never gives up on an error: it stops by the full scope when it can,
    and by the project label and name in any case, then confirms nothing of the target is running."""
    pid = project_id(project_dir)
    names: set[str] = set()
    try:
        scope = containers(pid)
        own = {c["Id"] for c in scope if owned(c, pid)} | {c["Name"].lstrip("/") for c in scope if owned(c, pid)}
        names |= {c["Name"].lstrip("/") for c in scope if c["State"]["Running"] and owned(c, pid, own)}
    except Exception:
        pass  # the scope could not be computed: fall back to label and name below
    try:
        names |= set(sh("docker", "ps", "-q", "--filter", f"label=com.supabase.cli.project={pid}").split())
        names |= {n for n in sh("docker", "ps", "--format", "{{.Names}}").split() if n.endswith(f"_{pid}")}
    except Fail as e:
        print(f"EMERGENCY STOP INCOMPLETE: Docker did not answer ({e}) -- quit Docker Desktop now", file=sys.stderr)
        return 4
    for n in sorted(names):
        if is_persistent(n):
            print(f"emergency stop: skipping {n}: it belongs to (or cannot be shown not to belong to) the persistent project", file=sys.stderr)
            continue
        # No restart policy may bring it back, then down at once (the copy is destroyed afterwards anyway).
        try:
            subprocess.run(["docker", "update", "--restart", "no", n], capture_output=True, timeout=DOCKER_TIMEOUT)
            killed = subprocess.run(["docker", "kill", n], capture_output=True, timeout=DOCKER_TIMEOUT).returncode == 0
        except subprocess.TimeoutExpired:
            killed = False
        if not killed:  # immediate: the copy is destroyed after
            try:
                subprocess.run(["docker", "stop", "-t", "1", n], capture_output=True, timeout=DOCKER_TIMEOUT)
            except subprocess.TimeoutExpired:
                pass  # the confirmation below reports it
    try:
        still = set(sh("docker", "ps", "-q", "--filter", f"label=com.supabase.cli.project={pid}").split())
        still |= {n for n in sh("docker", "ps", "--format", "{{.Names}}").split() if n.endswith(f"_{pid}")}
    except Fail as e:
        print(f"EMERGENCY STOP INCOMPLETE: Docker did not answer the confirmation ({e}) -- quit Docker Desktop now", file=sys.stderr)
        return 4
    try:
        scope = containers(pid)
        own = {c["Id"] for c in scope if owned(c, pid)} | {c["Name"].lstrip("/") for c in scope if owned(c, pid)}
        still |= {c["Name"].lstrip("/") for c in scope if c["State"]["Running"] and owned(c, pid, own)}
    except Exception:
        pass
    if still:
        print(f"EMERGENCY STOP INCOMPLETE: still running: {', '.join(sorted(still))} -- quit Docker Desktop now", file=sys.stderr)
        return 4
    print("emergency stop: every container of the target is stopped")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["isolate", "verify", "emergency-stop", "guard", "guard-status", "destroy"])
    ap.add_argument("--project-dir", required=True, type=Path)
    ap.add_argument("--quiet", action="store_true", help="verify: print failures and the verdict only")
    ap.add_argument("--api-port", type=int, help="verify: also check the loopback API relay on this port")
    ap.add_argument("--interval", type=float, default=3.0, help="guard: seconds between checks without events")
    ap.add_argument("--on-trip", choices=["destroy", "stop"], default="destroy", help="guard: destroy (default) or only stop the target when it trips")
    args = ap.parse_args()
    try:
        if args.command == "isolate":
            return isolate(args.project_dir)
        if args.command == "emergency-stop":
            return emergency_stop(args.project_dir)
        if args.command == "guard":
            return guard(args.project_dir.resolve(), args.interval, args.on_trip)
        if args.command == "guard-status":
            return guard_alive(args.project_dir)
        if args.command == "destroy":
            pid = project_id(args.project_dir)
            stopped = emergency_stop(args.project_dir) == 0
            destroyed = destroy_target_data(pid, lambda m: print(m), args.project_dir)
            return 0 if stopped and destroyed else 6
        results: list[tuple[bool, str]] = []
        try:
            verify(args.project_dir, results, args.api_port)
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
