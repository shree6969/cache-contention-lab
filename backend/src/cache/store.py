"""
Thread-safe in-memory cache built from scratch.

Design:
  - OrderedDict for O(1) LRU eviction (move_to_end on access).
  - ReadWriteLock for the key-space: concurrent reads are allowed;
    writes are exclusive.
  - Per-key reentrant lock for atomic read-modify-write operations
    (used by simulations to demonstrate races when intentionally bypassed).
  - Background daemon thread for TTL cleanup.
  - Event callbacks for WebSocket broadcasting.
"""

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .rwlock import ReadWriteLock
from .metrics import Metrics


# ─── Cache entry ──────────────────────────────────────────────────────────────

@dataclass
class CacheEntry:
    key: str
    value: Any
    created_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None
    hits: int = 0
    last_accessed: float = field(default_factory=time.time)

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and time.time() > self.expires_at

    @property
    def ttl_remaining(self) -> Optional[float]:
        if self.expires_at is None:
            return None
        return max(0.0, self.expires_at - time.time())

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "value": self.value,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "ttl_remaining": self.ttl_remaining,
            "hits": self.hits,
            "last_accessed": self.last_accessed,
            "is_expired": self.is_expired,
        }


# ─── Cache store ──────────────────────────────────────────────────────────────

EventCallback = Callable[[str, dict], None]   # (event_kind, payload)


class CacheStore:
    """
    Thread-safe LRU cache with TTL support.

    Parameters
    ----------
    max_size:
        Maximum number of entries before LRU eviction kicks in.
    cleanup_interval:
        Seconds between background TTL sweeps.
    """

    def __init__(
        self,
        max_size: int = 500,
        cleanup_interval: float = 2.0,
    ) -> None:
        self._data: OrderedDict[str, CacheEntry] = OrderedDict()
        self._rwlock = ReadWriteLock()
        # Per-key locks for atomic RMW ops (simulations use these explicitly).
        self._key_locks: Dict[str, threading.RLock] = {}
        self._key_locks_lock = threading.Lock()

        self.max_size = max_size
        self.metrics = Metrics()
        self._callbacks: List[EventCallback] = []

        self._running = True
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop,
            args=(cleanup_interval,),
            daemon=True,
            name="cache-cleanup",
        )
        self._cleanup_thread.start()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[Any]:
        """Return the value for *key*, or None on miss/expiry."""
        with self._rwlock.read_lock():
            entry = self._data.get(key)
            if entry is None:
                self.metrics.record_miss()
                self._emit("miss", {"key": key})
                return None
            if entry.is_expired:
                # Lazy expiry: promote to write and delete.
                pass
            else:
                entry.hits += 1
                entry.last_accessed = time.time()
                # Move to end = most recently used.
                self._data.move_to_end(key)
                self.metrics.record_hit()
                self._emit("hit", {"key": key, "value": entry.value})
                return entry.value

        # Entry was expired — delete under write lock.
        with self._rwlock.write_lock():
            entry = self._data.get(key)
            if entry and entry.is_expired:
                del self._data[key]
                self._remove_key_lock(key)
                self.metrics.record_expiration()
                self._emit("expiration", {"key": key})
        self.metrics.record_miss()
        self._emit("miss", {"key": key})
        return None

    def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[float] = None,
    ) -> CacheEntry:
        """Insert or update *key*."""
        expires_at = time.time() + ttl if ttl is not None else None
        with self._rwlock.write_lock():
            if key in self._data:
                entry = self._data[key]
                entry.value = value
                entry.expires_at = expires_at
                self._data.move_to_end(key)
            else:
                if len(self._data) >= self.max_size:
                    self._evict_lru()
                entry = CacheEntry(key=key, value=value, expires_at=expires_at)
                self._data[key] = entry
            self.metrics.record_set()
            self._emit("set", {"key": key, "value": value, "ttl": ttl})
            return entry

    def delete(self, key: str) -> bool:
        """Remove *key*. Returns True if it existed."""
        with self._rwlock.write_lock():
            if key in self._data:
                del self._data[key]
                self._remove_key_lock(key)
                self.metrics.record_delete()
                self._emit("delete", {"key": key})
                return True
            return False

    def clear(self) -> int:
        """Remove all entries. Returns count cleared."""
        with self._rwlock.write_lock():
            count = len(self._data)
            self._data.clear()
            with self._key_locks_lock:
                self._key_locks.clear()
            self._emit("clear", {"count": count})
            return count

    def get_all(self) -> List[dict]:
        """Snapshot of all non-expired entries (for UI listing)."""
        with self._rwlock.read_lock():
            return [
                e.to_dict()
                for e in self._data.values()
                if not e.is_expired
            ]

    def size(self) -> int:
        with self._rwlock.read_lock():
            return len(self._data)

    # ------------------------------------------------------------------
    # Per-key lock (for simulation race demonstrations)
    # ------------------------------------------------------------------

    def key_lock(self, key: str) -> threading.RLock:
        """Return (or create) the per-key RLock."""
        with self._key_locks_lock:
            if key not in self._key_locks:
                self._key_locks[key] = threading.RLock()
            return self._key_locks[key]

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------

    def stats(self) -> dict:
        rw = self._rwlock.state
        self.metrics.sync_rwlock(rw)
        snap = self.metrics.snapshot(rw)
        snap["size"] = self.size()
        snap["max_size"] = self.max_size
        return snap

    def history(self) -> list:
        return self.metrics.history()

    def add_callback(self, cb: EventCallback) -> None:
        self._callbacks.append(cb)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _evict_lru(self) -> None:
        """Evict the least-recently-used entry. Caller must hold write lock."""
        key, _ = self._data.popitem(last=False)
        self._remove_key_lock(key)
        self.metrics.record_eviction()
        self._emit("eviction", {"key": key})

    def _remove_key_lock(self, key: str) -> None:
        with self._key_locks_lock:
            self._key_locks.pop(key, None)

    def _emit(self, kind: str, payload: dict) -> None:
        for cb in self._callbacks:
            try:
                cb(kind, payload)
            except Exception:
                pass

    def _cleanup_loop(self, interval: float) -> None:
        """Background thread: sweep for expired entries."""
        while self._running:
            time.sleep(interval)
            self._cleanup_expired()
            # Push a metrics snapshot to history.
            snap = self.stats()
            self.metrics.push_history_point(snap)
            self._emit("metrics", snap)

    def _cleanup_expired(self) -> None:
        now = time.time()
        expired_keys = []
        with self._rwlock.read_lock():
            for key, entry in self._data.items():
                if entry.expires_at is not None and now > entry.expires_at:
                    expired_keys.append(key)
        if expired_keys:
            with self._rwlock.write_lock():
                for key in expired_keys:
                    entry = self._data.get(key)
                    if entry and entry.is_expired:
                        del self._data[key]
                        self._remove_key_lock(key)
                        self.metrics.record_expiration()
                        self._emit("expiration", {"key": key})

    def shutdown(self) -> None:
        self._running = False
