import base64
import hashlib
from typing import Callable, Optional

import paramiko


class HostKeyMismatch(Exception):
    pass


class _PinnedKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Trust-on-first-use: accept and remember the first key, refuse anything else afterwards."""

    def __init__(self, pinned: Optional[str]):
        self.pinned = pinned
        self.seen: Optional[str] = None

    def missing_host_key(self, client, hostname, key):
        fingerprint = f"{key.get_name()} {key.get_base64()}"
        self.seen = fingerprint
        if self.pinned and self.pinned != fingerprint:
            raise HostKeyMismatch(
                f"A chave SSH de {hostname} mudou (esperado {fingerprint_sha256(self.pinned)}, "
                f"recebido {fingerprint_sha256(fingerprint)}). Possível MITM — conexão recusada."
            )


def fingerprint_sha256(entry: Optional[str]) -> str:
    if not entry:
        return ""
    try:
        raw = base64.b64decode(entry.split(" ", 1)[1])
    except Exception:
        return ""
    return "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")


class SSHClient:
    def __init__(self, host: str, port: int = 22, username: str = "root", key_path: str = None,
                 password: str = None, host_key: Optional[str] = None, timeout: int = 15):
        self.host = host
        self.port = port
        self.username = username
        self.key_path = key_path
        self.password = password
        self.timeout = timeout
        self._policy = _PinnedKeyPolicy(host_key)
        self._client = None

    @property
    def host_key(self) -> Optional[str]:
        """Key presented by the server on this connection (to pin it after the first use)."""
        return self._policy.seen or self._policy.pinned

    def connect(self):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(self._policy)
        kwargs = dict(hostname=self.host, port=self.port, username=self.username,
                      timeout=self.timeout, banner_timeout=self.timeout, auth_timeout=self.timeout,
                      allow_agent=False, look_for_keys=False)
        if self.key_path:
            kwargs["key_filename"] = self.key_path
        elif self.password:
            kwargs["password"] = self.password
        client.connect(**kwargs)
        self._client = client
        return self

    def run(self, command: str, log_cb: Callable = None, sudo: bool = False, timeout: int = 300) -> tuple[int, str, str]:
        """Run a bash script. With sudo=True it runs as root when the SSH user is not root."""
        if not self._client:
            self.connect()
        # The script goes through stdin: no quoting problems and secrets never show up in `ps`.
        shell = "sudo -n bash -s" if sudo and self.username != "root" else "bash -s"
        stdin, stdout, stderr = self._client.exec_command(shell, timeout=timeout)
        stdin.write(command)
        stdin.channel.shutdown_write()
        out_lines, err_lines = [], []
        for line in stdout:
            line = line.rstrip("\n")
            out_lines.append(line)
            if log_cb:
                log_cb("info", line)
        for line in stderr:
            line = line.rstrip("\n")
            err_lines.append(line)
            if log_cb:
                log_cb("warn", line)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, "\n".join(out_lines), "\n".join(err_lines)

    def close(self):
        if self._client:
            self._client.close()
            self._client = None

    def __enter__(self):
        return self.connect()

    def __exit__(self, *_):
        self.close()
