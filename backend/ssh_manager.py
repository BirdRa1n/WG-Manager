import asyncio
import paramiko
import threading
from typing import Generator, Callable
from contextlib import contextmanager


class SSHClient:
    def __init__(self, host: str, port: int = 22, username: str = "root", key_path: str = None, password: str = None):
        self.host = host
        self.port = port
        self.username = username
        self.key_path = key_path
        self.password = password
        self._client = None

    def connect(self):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = dict(hostname=self.host, port=self.port, username=self.username, timeout=15)
        if self.key_path:
            kwargs["key_filename"] = self.key_path
        elif self.password:
            kwargs["password"] = self.password
        client.connect(**kwargs)
        self._client = client
        return self

    def run(self, command: str, log_cb: Callable = None) -> tuple[int, str, str]:
        if not self._client:
            self.connect()
        stdin, stdout, stderr = self._client.exec_command(command, get_pty=True)
        out_lines = []
        err_lines = []
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

    def run_stream(self, command: str) -> Generator[str, None, None]:
        if not self._client:
            self.connect()
        transport = self._client.get_transport()
        chan = transport.open_session()
        chan.get_pty()
        chan.exec_command(command)
        while True:
            if chan.recv_ready():
                data = chan.recv(1024).decode("utf-8", errors="replace")
                for line in data.splitlines():
                    if line.strip():
                        yield line
            if chan.exit_status_ready():
                break

    def put_file_content(self, content: str, remote_path: str):
        sftp = self._client.open_sftp()
        with sftp.open(remote_path, "w") as f:
            f.write(content)
        sftp.close()

    def close(self):
        if self._client:
            self._client.close()
            self._client = None

    def __enter__(self):
        return self.connect()

    def __exit__(self, *_):
        self.close()


def test_ssh_connection(host: str, port: int, username: str, key_path: str) -> bool:
    try:
        with SSHClient(host, port, username, key_path) as c:
            code, out, _ = c.run("echo ok")
            return code == 0 and "ok" in out
    except Exception:
        return False
