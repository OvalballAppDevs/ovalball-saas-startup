#!/usr/bin/env python3
"""The ONLY way into an isolated restore target's API: a relay on this Mac's loopback, through `docker exec`.

    scripts/ops/restore/loopback-api-relay.py --project-dir DIR --port 59341

WHY. Docker Desktop publishes no port of a container that is attached only to an `--internal` network, and an
`--internal` network is the only Docker network with no route out. So no container of the target -- Kong included --
is on any other network, and the API is reached without a published port at all: this relay listens on 127.0.0.1
(and nothing else), and pipes each accepted connection through `docker exec -i supabase_kong_<id> nc 127.0.0.1 8000`
-- Kong's own loopback, inside Kong's own (internal-only) network namespace.

WHAT IT IS NOT. Not a proxy: the destination is fixed (Kong's port 8000 on Kong's loopback) and nothing in a request
can change it. It gives no container anything: no Docker socket, no network, no mount; it runs `docker` itself, on the
host, against one container it has checked. It cannot reach the persistent project: the container is
`supabase_kong_<id>` for the target's own id, labelled with that id, and the persistent id is refused.

It re-checks the container (name, label, internal-only networks) when it starts and before every connection, and
refuses to relay if anything has changed. It logs one line per refusal, never a request or a response.
"""
from __future__ import annotations

import argparse
import json
import re
import socket
import subprocess
import sys
import threading
from pathlib import Path

PERSISTENT_PROJECT_ID = "ovalball-saas-startup"


def project_id(project_dir: Path) -> str:
    cfg = project_dir / "supabase" / "config.toml"
    lines = [l for l in cfg.read_text().splitlines() if re.match(r"^\s*project_id\s*=", l)]
    m = re.match(r'^\s*project_id\s*=\s*"([a-z0-9][a-z0-9-]*)"\s*$', lines[0]) if len(lines) == 1 else None
    if not m or m.group(1) == PERSISTENT_PROJECT_ID:
        raise SystemExit("REFUSED: not a disposable project (project_id must be plain, defined once, not the persistent one)")
    return m.group(1)


def kong_is_isolated(pid: str) -> tuple[bool, str]:
    name = f"supabase_kong_{pid}"
    r = subprocess.run(["docker", "inspect", name], capture_output=True, text=True)
    if r.returncode != 0:
        return False, f"{name} not found"
    c = json.loads(r.stdout)[0]
    if not c["State"]["Running"]:
        return False, f"{name} is not running"
    if ((c.get("Config") or {}).get("Labels") or {}).get("com.supabase.cli.project") != pid:
        return False, f"{name} does not carry the target's project label"
    nets = list((c["NetworkSettings"]["Networks"] or {}).keys())
    if nets != [f"ovb-isolated-{pid}"]:
        return False, f"{name} is attached to {nets}, not exactly the target's internal network"
    ni = subprocess.run(["docker", "network", "inspect", nets[0], "--format", "{{.Internal}}"], capture_output=True, text=True)
    if ni.returncode != 0 or ni.stdout.strip() != "true":
        return False, f"{nets[0]} is not internal"
    return True, name


def guard_is_alive(project_dir: Path) -> bool:
    """The relay serves only while the target's isolation guard is alive (fresh heartbeat): a killed or frozen guard
    means nobody is watching, so the copy is not reachable either."""
    r = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "restore-target-isolation.py"),
                        "guard-status", "--project-dir", str(project_dir)], capture_output=True, text=True)
    return r.returncode == 0


def pump(src, dst, close_dst) -> None:
    try:
        while True:
            data = src.read1(65536) if hasattr(src, "read1") else src.recv(65536)
            if not data:
                break
            if hasattr(dst, "sendall"):
                dst.sendall(data)
            else:
                dst.write(data)
                dst.flush()
    except (OSError, ValueError):
        pass
    finally:
        close_dst()


def serve(conn: socket.socket, pid: str, project_dir: Path) -> None:
    ok, why = kong_is_isolated(pid)
    if ok and not guard_is_alive(project_dir):
        ok, why = False, "the isolation guard is not alive"
    if not ok:
        sys.stderr.write(f"[loopback-api-relay] REFUSED a connection: {why}\n")
        conn.close()
        return
    proc = subprocess.Popen(["docker", "exec", "-i", f"supabase_kong_{pid}", "nc", "127.0.0.1", "8000"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def close_stdin() -> None:
        try:
            proc.stdin.close()
        except OSError:
            pass

    def close_conn() -> None:
        try:
            conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    up = threading.Thread(target=pump, args=(conn, proc.stdin, close_stdin), daemon=True)
    up.start()
    pump(proc.stdout, conn, close_conn)  # Kong's answer, until Kong closes
    proc.kill()
    proc.wait()
    conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-dir", required=True, type=Path)
    ap.add_argument("--port", required=True, type=int)
    args = ap.parse_args()
    pid = project_id(args.project_dir)
    ok, why = kong_is_isolated(pid)
    if not ok:
        print(f"REFUSED: {why}", file=sys.stderr)
        return 2
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", args.port))  # loopback ONLY, by construction
    server.listen(64)
    print(f"[loopback-api-relay] 127.0.0.1:{args.port} -> {why} 127.0.0.1:8000 (docker exec)", flush=True)
    while True:
        conn, _ = server.accept()
        threading.Thread(target=serve, args=(conn, pid, args.project_dir), daemon=True).start()


if __name__ == "__main__":
    sys.exit(main())
