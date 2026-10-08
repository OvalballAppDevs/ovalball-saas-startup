#!/usr/bin/env python3
"""A Docker API proxy that makes every published port of a container it creates bind to 127.0.0.1 ONLY.

WHY. A production-derived restore target must not be reachable from the network. The Supabase CLI publishes every
service of a local stack -- Postgres (with the default local password), Kong, Studio, the mail catcher -- on all
interfaces (0.0.0.0 and [::]), and it has no setting for the bind address. Docker Desktop (29.x, macOS) honours an
explicit host IP on a port binding, but ignores the bridge network's `host_binding_ipv4` default (proved: a container
on such a network still listened on `*`). So the host IP is set where Docker receives it: in the container-create
request.

WHAT IT DOES. Listens on a Unix socket of its own and forwards everything to the real Docker socket. On
`POST /containers/create` it rewrites `HostConfig.PortBindings` so every binding's HostIp is 127.0.0.1 (whatever was
asked), and REFUSES (HTTP 403, nothing created) a request for host networking or `PublishAllPorts`. Every other request
passes through untouched; each is forwarded with `Connection: close` (an upgrade -- exec/attach -- keeps its own
header), so no later request on a kept-alive connection can slip past the rewrite.

    scripts/ops/restore/docker-loopback-proxy.py --listen <scratch>/docker-loopback.sock
    DOCKER_HOST=unix://<scratch>/docker-loopback.sock npx supabase start ...

It changes no Docker setting and touches no existing container: only containers created THROUGH it are affected, so
the persistent local stack (started without it) keeps its own bindings. It is a guard on creation, not a check: the
restore preflight (`restore-target-preflight.py`) verifies the result from the running containers and the host's own
sockets, and refuses to restore if anything is exposed -- including a stack started without this proxy.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import threading

CREATE = re.compile(r"^(/v[0-9.]+)?/+containers/+create/*$")
# The only requests that legitimately switch protocol (exec/attach streams, BuildKit sessions); any other request
# asking to keep its connection open is forwarded with `Connection: close` regardless.
UPGRADABLE = re.compile(r"^(/v[0-9.]+)?/+(exec/[^/]+/start|containers/[^/]+/attach|session|grpc)/*$")
LOOPBACK = "127.0.0.1"


def log(message: str) -> None:
    sys.stderr.write(f"[docker-loopback-proxy] {message}\n")
    sys.stderr.flush()


def read_head(conn: socket.socket) -> tuple[bytes, bytes]:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(65536)
        if not chunk:
            return b"", data
        data += chunk
        if len(data) > 1 << 20:
            raise ValueError("request head too large")
    head, rest = data.split(b"\r\n\r\n", 1)
    return head, rest


def read_body(conn: socket.socket, headers: dict[bytes, bytes], rest: bytes) -> bytes:
    if headers.get(b"transfer-encoding", b"").lower() == b"chunked":
        buf = rest
        body = b""
        while True:
            while b"\r\n" not in buf:
                more = conn.recv(65536)
                if not more:
                    raise ValueError("truncated chunked body")
                buf += more
            size_line, buf = buf.split(b"\r\n", 1)
            size = int(size_line.split(b";")[0], 16)
            while len(buf) < size + 2:
                more = conn.recv(65536)
                if not more:
                    raise ValueError("truncated chunk")
                buf += more
            if size == 0:
                return body
            body += buf[:size]
            buf = buf[size + 2:]
    length = int(headers.get(b"content-length", b"0"))
    body = rest
    while len(body) < length:
        more = conn.recv(65536)
        if not more:
            raise ValueError("truncated body")
        body += more
    return body[:length]


def ikey(obj: dict, name: str) -> list[str]:
    """Docker decodes JSON keys case-insensitively, so every spelling of a key counts."""
    return [k for k in obj if isinstance(k, str) and k.lower() == name.lower()]


def rewrite_create(body: bytes, query: str) -> tuple[bytes | None, str]:
    """Returns (new body, note) or (None, reason) when the request must be refused."""
    spec = json.loads(body or b"{}")
    if not isinstance(spec, dict):
        return None, "unexpected create body"
    hosts = [spec[k] for k in ikey(spec, "HostConfig")]
    if len(hosts) > 1:
        return None, "ambiguous HostConfig keys"
    host = hosts[0] if hosts and isinstance(hosts[0], dict) else {}
    if ikey(spec, "HostConfig") and not isinstance(hosts[0], dict):
        return None, "unexpected HostConfig"
    if any(str(host[k]).lower() == "host" for k in ikey(host, "NetworkMode")):
        return None, "host networking refused"
    if any(host[k] for k in ikey(host, "PublishAllPorts")):
        return None, "PublishAllPorts refused"
    pb_keys = ikey(host, "PortBindings")
    if len(pb_keys) > 1:
        return None, "ambiguous PortBindings keys"
    changed = []
    for port, bindings in ((host[pb_keys[0]] if pb_keys else None) or {}).items():
        for binding in bindings or []:
            if not isinstance(binding, dict):
                return None, "unexpected port binding"
            ips = [binding.pop(k) for k in ikey(binding, "HostIp")]
            if ips != [LOOPBACK]:
                changed.append(f"{port} {(ips[-1] if ips else '') or '*'}->{LOOPBACK}:{binding.get('HostPort')}")
            binding["HostIp"] = LOOPBACK
    return json.dumps(spec).encode(), f"{query or '(unnamed)'}: " + (", ".join(changed) if changed else "no published ports")


def pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle(client: socket.socket, upstream_path: str) -> None:
    upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        head, rest = read_head(client)
        if not head:
            return
        lines = head.split(b"\r\n")
        request_line = lines[0]
        headers = {}
        for line in lines[1:]:
            if b":" in line:
                k, v = line.split(b":", 1)
                headers[k.strip().lower()] = v.strip()
        method, raw_path = request_line.split(b" ")[0].decode(errors="replace"), request_line.split(b" ")[1].decode(errors="replace")
        from urllib.parse import unquote, urlsplit
        path = unquote(urlsplit(raw_path).path)  # Docker routes on the DECODED path: %63reate is create
        upgrade = b"upgrade" in headers.get(b"connection", b"").lower() and bool(UPGRADABLE.match(path))
        kept = [l for l in lines[1:] if not l.lower().startswith(b"connection:")]
        if not upgrade:
            kept.append(b"Connection: close")
        else:
            kept.append(b"Connection: " + headers[b"connection"])

        if method.upper() == "POST" and CREATE.match(path):
            body = read_body(client, headers, rest)
            query = urlsplit(raw_path).query
            new_body, note = rewrite_create(body, query)
            if new_body is None:
                log(f"REFUSED container create ({note}): {query}")
                msg = json.dumps({"message": f"docker-loopback-proxy: {note}"}).encode()
                client.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: "
                               + str(len(msg)).encode() + b"\r\nConnection: close\r\n\r\n" + msg)
                return
            log(f"create {note}")
            kept = [l for l in kept if not l.lower().startswith((b"content-length:", b"transfer-encoding:"))]
            kept.append(b"Content-Length: " + str(len(new_body)).encode())
            upstream.connect(upstream_path)
            upstream.sendall(request_line + b"\r\n" + b"\r\n".join(kept) + b"\r\n\r\n" + new_body)
        else:
            upstream.connect(upstream_path)
            upstream.sendall(request_line + b"\r\n" + b"\r\n".join(kept) + b"\r\n\r\n" + rest)
            if upgrade:
                # Relay raw bytes ONLY once Docker has actually switched protocols. Otherwise answer this one request
                # and close: nothing the client pipelined after it is ever forwarded uninspected.
                head_up, rest_up = read_head(upstream)
                status = head_up.split(b"\r\n", 1)[0].split(b" ")
                if len(status) < 2 or status[1] != b"101":
                    up_headers = {}
                    for line in head_up.split(b"\r\n")[1:]:
                        if b":" in line:
                            k, v = line.split(b":", 1)
                            up_headers[k.strip().lower()] = v.strip()
                    try:
                        body_up = read_body(upstream, up_headers, rest_up)
                    except ValueError:
                        body_up = rest_up
                    out = [l for l in head_up.split(b"\r\n") if not l.lower().startswith((b"content-length:", b"transfer-encoding:", b"connection:"))]
                    client.sendall(b"\r\n".join(out) + b"\r\nContent-Length: " + str(len(body_up)).encode() + b"\r\nConnection: close\r\n\r\n" + body_up)
                    return
                client.sendall(head_up + b"\r\n\r\n" + rest_up)

        t = threading.Thread(target=pipe, args=(client, upstream), daemon=True)
        t.start()
        pipe(upstream, client)
        t.join(timeout=1)
    except Exception as exc:  # never crash the listener
        log(f"connection error: {exc}")
    finally:
        for s in (client, upstream):
            try:
                s.close()
            except OSError:
                pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", required=True, help="Unix socket path this proxy listens on")
    ap.add_argument("--upstream", default=os.path.expanduser("~/.docker/run/docker.sock"))
    args = ap.parse_args()
    if os.path.realpath(args.listen) == os.path.realpath(args.upstream):
        log("refusing to listen on the real Docker socket")
        return 2
    if os.path.exists(args.listen):
        os.unlink(args.listen)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old = os.umask(0o177)
    server.bind(args.listen)
    os.umask(old)
    server.listen(64)
    log(f"listening on {args.listen} -> {args.upstream}; every published port is bound to {LOOPBACK}")
    while True:
        client, _ = server.accept()
        threading.Thread(target=handle, args=(client, args.upstream), daemon=True).start()


if __name__ == "__main__":
    sys.exit(main())
