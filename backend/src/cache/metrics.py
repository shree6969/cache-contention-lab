"""
Cache metrics: counters, rates, and rolling time-series for charting.
Thread-safe via a single lock (metrics writes are cheap).
"""

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List


HISTORY_SECONDS = 120   # keep 2 min of second-resolution history
HISTORY_POINTS = HISTORY_SECONDS


@dataclass
class MetricPoint:
    ts: float
    hits: int
    misses: int
    sets: int
    deletes: int
    evictions: int
    read_waits: int
    write_waits: int
    active_readers: int
    writer_active: bool


class Metrics:
    """Accumulates cache counters and maintains a rolling history."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

        # Monotonic counters
        self.hits: int = 0
        self.misses: int = 0
        self.sets: int = 0
        self.deletes: int = 0
        self.evictions: int = 0
        self.expirations: int = 0

        # Lock contention from the RWLock
        self.read_waits: int = 0
        self.write_waits: int = 0

        # Simulation events
        self.contention_events: int = 0
        self.stampede_threads: int = 0
        self.lost_updates: int = 0

        # Rolling 1-second snapshots
        self._history: Deque[dict] = deque(maxlen=HISTORY_POINTS)
        self._last_snapshot_ts: float = time.time()

    # ------------------------------------------------------------------
    # Increment helpers (all thread-safe)
    # ------------------------------------------------------------------

    def record_hit(self) -> None:
        with self._lock:
            self.hits += 1

    def record_miss(self) -> None:
        with self._lock:
            self.misses += 1

    def record_set(self) -> None:
        with self._lock:
            self.sets += 1

    def record_delete(self) -> None:
        with self._lock:
            self.deletes += 1

    def record_eviction(self) -> None:
        with self._lock:
            self.evictions += 1

    def record_expiration(self) -> None:
        with self._lock:
            self.expirations += 1

    def record_contention(self) -> None:
        with self._lock:
            self.contention_events += 1

    def record_lost_update(self) -> None:
        with self._lock:
            self.lost_updates += 1

    def sync_rwlock(self, rwlock_state: dict) -> None:
        """Pull current RWLock stats into metrics."""
        with self._lock:
            self.read_waits = rwlock_state["read_waits"]
            self.write_waits = rwlock_state["write_waits"]

    # ------------------------------------------------------------------
    # Snapshot
    # ------------------------------------------------------------------

    def snapshot(self, rwlock_state: dict | None = None) -> dict:
        with self._lock:
            total = self.hits + self.misses
            hit_rate = round(self.hits / total * 100, 1) if total else 0.0

            snap = {
                "ts": time.time(),
                "hits": self.hits,
                "misses": self.misses,
                "sets": self.sets,
                "deletes": self.deletes,
                "evictions": self.evictions,
                "expirations": self.expirations,
                "hit_rate": hit_rate,
                "total_ops": total,
                "contention_events": self.contention_events,
                "lost_updates": self.lost_updates,
            }
            if rwlock_state:
                snap.update(rwlock_state)
            return snap

    def push_history_point(self, point: dict) -> None:
        with self._lock:
            self._history.append(point)

    def history(self) -> List[dict]:
        with self._lock:
            return list(self._history)

    def reset(self) -> None:
        with self._lock:
            self.hits = 0
            self.misses = 0
            self.sets = 0
            self.deletes = 0
            self.evictions = 0
            self.expirations = 0
            self.contention_events = 0
            self.lost_updates = 0
            self.read_waits = 0
            self.write_waits = 0
            self._history.clear()
