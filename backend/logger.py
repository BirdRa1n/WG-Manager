import asyncio
from datetime import datetime
from typing import AsyncGenerator
from collections import deque

_subscribers: list[asyncio.Queue] = []
_history: deque = deque(maxlen=500)
_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop: asyncio.AbstractEventLoop):
    global _loop
    _loop = loop


def _make_event(level: str, message: str, operation: str = "") -> dict:
    return {
        "ts": datetime.utcnow().isoformat(),
        "level": level,
        "message": message,
        "operation": operation,
    }


async def emit(level: str, message: str, operation: str = ""):
    event = _make_event(level, message, operation)
    _history.append(event)
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.remove(q)


def emit_sync(level: str, message: str, operation: str = ""):
    """Thread-safe emit — schedules onto the event loop."""
    event = _make_event(level, message, operation)
    _history.append(event)
    loop = _loop
    if loop and loop.is_running():
        for q in list(_subscribers):
            loop.call_soon_threadsafe(_safe_put, q, event)
    else:
        for q in list(_subscribers):
            try:
                q.put_nowait(event)
            except Exception:
                pass


def _safe_put(q: asyncio.Queue, event: dict):
    try:
        q.put_nowait(event)
    except Exception:
        pass


async def subscribe() -> AsyncGenerator[dict, None]:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers.append(q)
    for ev in list(_history)[-50:]:
        await q.put(ev)
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=25)
                yield event
            except asyncio.TimeoutError:
                # Send keepalive to keep connection alive, then continue
                yield _make_event("ping", "keepalive")
    except asyncio.CancelledError:
        pass
    finally:
        if q in _subscribers:
            _subscribers.remove(q)


def get_history() -> list:
    return list(_history)
