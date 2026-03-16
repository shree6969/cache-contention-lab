"""
Read-Write Lock implemented from scratch using threading primitives.

Semantics:
- Multiple concurrent readers allowed when no writer holds the lock.
- A single writer gets exclusive access; all readers and other writers block.
- Writers are preferred over new readers to prevent writer starvation.
"""

import threading
from contextlib import contextmanager


class ReadWriteLock:
    """
    Fair read-write lock.

    - Allows N concurrent readers.
    - Gives writers priority: once a writer is waiting, new readers queue behind it.
    - Reentrant within the same thread for reads (not writes).
    """

    def __init__(self) -> None:
        self._condition = threading.Condition(threading.Lock())
        self._readers: int = 0
        self._writer_active: bool = False
        self._writers_waiting: int = 0

        # Observability counters (monotonically increasing)
        self.total_read_acquisitions: int = 0
        self.total_write_acquisitions: int = 0
        self.read_waits: int = 0   # times a reader had to wait
        self.write_waits: int = 0  # times a writer had to wait

    # ------------------------------------------------------------------
    # Public context managers
    # ------------------------------------------------------------------

    @contextmanager
    def read_lock(self):
        """Acquire for reading.  Multiple readers may hold this simultaneously."""
        waited = False
        with self._condition:
            # Block if a writer is active OR a writer is waiting (priority).
            while self._writer_active or self._writers_waiting > 0:
                waited = True
                self._condition.wait()
            self._readers += 1
            self.total_read_acquisitions += 1
            if waited:
                self.read_waits += 1
        try:
            yield
        finally:
            with self._condition:
                self._readers -= 1
                if self._readers == 0:
                    self._condition.notify_all()

    @contextmanager
    def write_lock(self):
        """Acquire for writing.  Exclusive — blocks all readers and writers."""
        waited = False
        with self._condition:
            self._writers_waiting += 1
            while self._writer_active or self._readers > 0:
                waited = True
                self._condition.wait()
            self._writers_waiting -= 1
            self._writer_active = True
            self.total_write_acquisitions += 1
            if waited:
                self.write_waits += 1
        try:
            yield
        finally:
            with self._condition:
                self._writer_active = False
                self._condition.notify_all()

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def state(self) -> dict:
        with self._condition:
            return {
                "active_readers": self._readers,
                "writer_active": self._writer_active,
                "writers_waiting": self._writers_waiting,
                "total_read_acquisitions": self.total_read_acquisitions,
                "total_write_acquisitions": self.total_write_acquisitions,
                "read_waits": self.read_waits,
                "write_waits": self.write_waits,
            }
