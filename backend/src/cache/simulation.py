"""
Simulation engine for cache contention scenarios.

Each scenario runs in background threads and emits events via the store's
callback system.  Scenarios expose realistic failure modes:

1. stampede        - Cache miss → N threads all regenerate simultaneously.
2. lost_update     - Unsynchronised read-modify-write loses increments.
3. deadlock        - Opposite lock order → timeout + detection.
4. rw_contention   - One writer blocks many concurrent readers.
5. expiration_storm- Many keys with identical TTL expire together.
6. eviction_pressure - Fill cache beyond capacity, watch LRU evictions.
"""

import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait, ALL_COMPLETED
from typing import Any, Callable, Dict, Optional

from .store import CacheStore


EventEmit = Callable[[str, dict], None]


class SimulationEngine:

    def __init__(self, store: CacheStore, emit: EventEmit) -> None:
        self._store = store
        self._emit = emit
        self._running: Dict[str, bool] = {}
        self._executor = ThreadPoolExecutor(max_workers=128, thread_name_prefix="sim")
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def is_running(self, scenario: str) -> bool:
        with self._lock:
            return self._running.get(scenario, False)

    def stop(self, scenario: str) -> None:
        with self._lock:
            self._running[scenario] = False

    def stop_all(self) -> list[str]:
        with self._lock:
            running = [k for k, v in self._running.items() if v]
            for k in running:
                self._running[k] = False
            return running

    # ------------------------------------------------------------------
    # Scenario 1: Cache Stampede
    # ------------------------------------------------------------------

    def run_stampede(
        self,
        n_threads: int = 40,
        protected: bool = False,
        regen_delay: float = 0.3,
    ) -> None:
        """
        Hot key expires → N threads simultaneously miss → all regenerate.

        Without protection: N expensive recomputations.
        With protection (key-level lock): 1 recomputation, rest wait.
        """
        scenario = "stampede"
        self._start(scenario)

        HOT_KEY = "hot_product:featured"

        # Seed the hot key.
        self._store.set(HOT_KEY, {"name": "Fancy Widget", "price": 9.99}, ttl=0.5)
        self._emit_progress(scenario, 5, f"Hot key '{HOT_KEY}' set, expires in 0.5s")

        time.sleep(0.6)   # let it expire naturally

        self._emit_progress(scenario, 10, f"Key expired — unleashing {n_threads} threads")

        regen_lock = self._store.key_lock(HOT_KEY) if protected else None
        results = {"recomputations": 0, "cache_hits": 0, "total_time": 0.0}
        start = time.time()

        def worker(tid: int) -> None:
            if not self.is_running(scenario):
                return
            value = self._store.get(HOT_KEY)
            if value is not None:
                results["cache_hits"] += 1
                self._emit("hit", {"key": HOT_KEY, "scenario": scenario, "thread": tid})
                return

            # Miss — try to regenerate.
            if protected and regen_lock is not None:
                acquired = regen_lock.acquire(blocking=True, timeout=2.0)
                if not acquired:
                    self._emit("contention", {
                        "key": HOT_KEY, "scenario": scenario, "thread": tid,
                        "message": "Timed out waiting for regen lock",
                    })
                    self._store.metrics.record_contention()
                    return
                try:
                    # Double-check after acquiring.
                    value = self._store.get(HOT_KEY)
                    if value is not None:
                        results["cache_hits"] += 1
                        return
                    time.sleep(regen_delay)   # simulate expensive DB call
                    results["recomputations"] += 1
                    self._store.set(HOT_KEY, {"name": "Fancy Widget", "price": 9.99}, ttl=10)
                    self._emit("set", {"key": HOT_KEY, "scenario": scenario, "thread": tid,
                                       "message": "Regenerated (protected)"})
                finally:
                    regen_lock.release()
            else:
                time.sleep(regen_delay)   # unprotected: everyone pays the cost
                results["recomputations"] += 1
                self._store.set(HOT_KEY, {"name": "Fancy Widget", "price": 9.99}, ttl=10)
                self._emit("set", {"key": HOT_KEY, "scenario": scenario, "thread": tid,
                                   "message": "Regenerated (unprotected)"})

        futures = [self._executor.submit(worker, i) for i in range(n_threads)]
        wait(futures, return_when=ALL_COMPLETED)

        results["total_time"] = round(time.time() - start, 3)
        self._emit_end(scenario, {
            **results,
            "n_threads": n_threads,
            "protected": protected,
            "wasted_recomputations": max(0, results["recomputations"] - 1),
        })
        self._stop(scenario)

    # ------------------------------------------------------------------
    # Scenario 2: Lost Update (Race Condition)
    # ------------------------------------------------------------------

    def run_lost_update(
        self,
        n_threads: int = 50,
        use_lock: bool = False,
    ) -> None:
        """
        N threads each do: val = get(counter); set(counter, val+1).
        Without an atomic lock, the final value is far below N.
        """
        scenario = "lost_update"
        self._start(scenario)

        COUNTER_KEY = "global:counter"
        self._store.set(COUNTER_KEY, 0)
        self._emit_progress(scenario, 5, f"Counter reset to 0, launching {n_threads} threads")

        key_lock = self._store.key_lock(COUNTER_KEY) if use_lock else None
        barrier = threading.Barrier(n_threads)

        def increment(tid: int) -> None:
            barrier.wait()   # all threads start simultaneously
            if not self.is_running(scenario):
                return
            if key_lock:
                with key_lock:
                    val = self._store.get(COUNTER_KEY) or 0
                    time.sleep(0.001)   # simulate processing
                    self._store.set(COUNTER_KEY, val + 1)
            else:
                val = self._store.get(COUNTER_KEY) or 0
                time.sleep(0.001)   # time window for races
                self._store.set(COUNTER_KEY, val + 1)
                if random.random() < 0.3:
                    self._store.metrics.record_lost_update()

        futures = [self._executor.submit(increment, i) for i in range(n_threads)]
        wait(futures, return_when=ALL_COMPLETED)

        final = self._store.get(COUNTER_KEY) or 0
        expected = n_threads
        lost = expected - final
        self._emit_end(scenario, {
            "expected": expected,
            "actual": final,
            "lost_updates": lost,
            "use_lock": use_lock,
            "message": (
                f"Got {final}/{expected} — {lost} updates lost to race condition"
                if not use_lock
                else f"Got {final}/{expected} — no updates lost (lock protected)"
            ),
        })
        self._stop(scenario)

    # ------------------------------------------------------------------
    # Scenario 3: Deadlock
    # ------------------------------------------------------------------

    def run_deadlock(self, timeout: float = 3.0) -> None:
        """
        Thread A: lock key1 → sleep → lock key2
        Thread B: lock key2 → sleep → lock key1
        Without consistent lock ordering, one thread times out.
        """
        scenario = "deadlock"
        self._start(scenario)

        KEY_A = "resource:alpha"
        KEY_B = "resource:beta"
        self._store.set(KEY_A, "alpha_data")
        self._store.set(KEY_B, "beta_data")

        lock_a = self._store.key_lock(KEY_A)
        lock_b = self._store.key_lock(KEY_B)

        results = {"thread_a": "pending", "thread_b": "pending", "deadlock_detected": False}

        def thread_a() -> None:
            self._emit("contention", {"scenario": scenario, "thread": "A",
                                       "message": "Thread A: acquiring lock on key1 (alpha)"})
            with lock_a:
                self._emit("set", {"key": KEY_A, "scenario": scenario, "thread": "A",
                                   "message": "Thread A: holds key1, sleeping 0.5s before key2"})
                time.sleep(0.5)
                self._emit("contention", {"scenario": scenario, "thread": "A",
                                           "message": "Thread A: trying to acquire key2 (beta) — may block"})
                acquired = lock_b.acquire(blocking=True, timeout=timeout)
                if acquired:
                    try:
                        results["thread_a"] = "completed"
                        self._emit("hit", {"scenario": scenario, "thread": "A",
                                          "message": "Thread A: acquired both locks, completed"})
                    finally:
                        lock_b.release()
                else:
                    results["thread_a"] = "timed_out"
                    results["deadlock_detected"] = True
                    self._store.metrics.record_contention()
                    self._emit("contention", {"scenario": scenario, "thread": "A",
                                               "message": "Thread A: TIMED OUT — deadlock detected!"})

        def thread_b() -> None:
            time.sleep(0.1)   # small delay so A gets lock_a first
            self._emit("contention", {"scenario": scenario, "thread": "B",
                                       "message": "Thread B: acquiring lock on key2 (beta)"})
            with lock_b:
                self._emit("set", {"key": KEY_B, "scenario": scenario, "thread": "B",
                                   "message": "Thread B: holds key2, sleeping 0.3s before key1"})
                time.sleep(0.3)
                self._emit("contention", {"scenario": scenario, "thread": "B",
                                           "message": "Thread B: trying to acquire key1 (alpha) — deadlock!"})
                acquired = lock_a.acquire(blocking=True, timeout=timeout)
                if acquired:
                    try:
                        results["thread_b"] = "completed"
                        self._emit("hit", {"scenario": scenario, "thread": "B",
                                          "message": "Thread B: acquired both locks, completed"})
                    finally:
                        lock_a.release()
                else:
                    results["thread_b"] = "timed_out"
                    results["deadlock_detected"] = True
                    self._store.metrics.record_contention()
                    self._emit("contention", {"scenario": scenario, "thread": "B",
                                               "message": "Thread B: TIMED OUT — deadlock detected!"})

        fa = self._executor.submit(thread_a)
        fb = self._executor.submit(thread_b)
        wait([fa, fb], return_when=ALL_COMPLETED)

        self._emit_end(scenario, {
            **results,
            "fix": "Always acquire locks in a consistent global order (e.g., sorted by key name).",
        })
        self._stop(scenario)

    # ------------------------------------------------------------------
    # Scenario 4: Reader-Writer Contention
    # ------------------------------------------------------------------

    def run_rw_contention(
        self,
        n_readers: int = 30,
        n_writers: int = 3,
        duration: float = 5.0,
    ) -> None:
        """
        Many concurrent readers vs. occasional writers using the store's RWLock.
        Demonstrates: readers can proceed in parallel; a writer blocks all readers.
        """
        scenario = "rw_contention"
        self._start(scenario)

        HOT_KEY = "shared:config"
        self._store.set(HOT_KEY, {"version": 0, "payload": "x" * 512})

        end_time = time.time() + duration
        counters = {"reads": 0, "writes": 0, "read_waits": 0}

        def reader(tid: int) -> None:
            while time.time() < end_time and self.is_running(scenario):
                self._store.get(HOT_KEY)
                counters["reads"] += 1
                time.sleep(random.uniform(0.01, 0.05))

        def writer(tid: int) -> None:
            write_count = 0
            while time.time() < end_time and self.is_running(scenario):
                time.sleep(random.uniform(0.5, 1.0))
                version = write_count + 1
                self._store.set(HOT_KEY, {"version": version, "payload": "x" * 512})
                counters["writes"] += 1
                write_count += 1
                self._emit("set", {"key": HOT_KEY, "scenario": scenario,
                                   "message": f"Writer {tid}: updated to version {version}"})

        futures = (
            [self._executor.submit(reader, i) for i in range(n_readers)]
            + [self._executor.submit(writer, i) for i in range(n_writers)]
        )
        wait(futures, return_when=ALL_COMPLETED)

        rw_state = self._store._rwlock.state
        self._emit_end(scenario, {
            **counters,
            "rwlock_read_waits": rw_state["read_waits"],
            "rwlock_write_waits": rw_state["write_waits"],
            "duration_s": duration,
        })
        self._stop(scenario)

    # ------------------------------------------------------------------
    # Scenario 5: Expiration Storm
    # ------------------------------------------------------------------

    def run_expiration_storm(
        self,
        n_keys: int = 100,
        ttl: float = 4.0,
    ) -> None:
        """
        All N keys written with identical TTL → all expire simultaneously.
        Hit rate collapses from ~100% to 0% in one sweep.
        Fix: jitter TTLs across a window.
        """
        scenario = "expiration_storm"
        self._start(scenario)

        self._emit_progress(scenario, 5, f"Writing {n_keys} keys with identical TTL={ttl}s")
        keys = [f"product:{i:04d}" for i in range(n_keys)]
        for k in keys:
            self._store.set(k, {"data": f"value_for_{k}", "score": random.random()}, ttl=ttl)

        self._emit_progress(scenario, 30, "All keys written — serving reads for a while")

        # Serve reads to build up hit-rate history.
        reader_end = time.time() + ttl - 0.5
        while time.time() < reader_end and self.is_running(scenario):
            for k in random.sample(keys, min(10, len(keys))):
                self._store.get(k)
            time.sleep(0.1)

        self._emit_progress(scenario, 70, "Keys about to expire — watch hit rate drop")
        time.sleep(ttl + 0.5)   # wait for expiration storm

        # Continue reads after expiration — all misses.
        miss_count = 0
        for k in keys:
            if self._store.get(k) is None:
                miss_count += 1

        self._emit_end(scenario, {
            "n_keys": n_keys,
            "ttl": ttl,
            "misses_after_expiry": miss_count,
            "hit_rate_after": 0,
            "fix": "Jitter TTLs: ttl + random.uniform(0, ttl * 0.2) spreads expiry over time.",
        })
        self._stop(scenario)

    # ------------------------------------------------------------------
    # Scenario 6: Eviction Pressure
    # ------------------------------------------------------------------

    def run_eviction_pressure(
        self,
        n_keys: int = 600,
        max_size: int = 200,
    ) -> None:
        """
        Fill cache well past max_size. LRU eviction fires continuously.
        Demonstrates: access patterns drive which keys survive.
        """
        scenario = "eviction_pressure"
        self._start(scenario)

        original_max = self._store.max_size
        self._store.max_size = max_size
        self._emit_progress(scenario, 5, f"Cache cap set to {max_size} — writing {n_keys} keys")

        evictions_before = self._store.metrics.evictions

        # Write keys in order; LRU will evict the earliest ones.
        for i in range(n_keys):
            if not self.is_running(scenario):
                break
            key = f"cache:item:{i:05d}"
            self._store.set(key, {"index": i, "payload": "data" * 20})
            if i % 50 == 0:
                pct = int(i / n_keys * 80) + 5
                self._emit_progress(scenario, pct, f"Written {i}/{n_keys} keys, size={self._store.size()}")

        evictions_after = self._store.metrics.evictions
        new_evictions = evictions_after - evictions_before

        # Re-access a range of "hot" keys to show they survive.
        hot_keys = [f"cache:item:{i:05d}" for i in range(n_keys - 50, n_keys)]
        for k in hot_keys:
            self._store.get(k)

        self._emit_end(scenario, {
            "n_keys_written": n_keys,
            "max_size": max_size,
            "evictions_triggered": new_evictions,
            "final_size": self._store.size(),
            "message": f"{new_evictions} LRU evictions across {n_keys} inserts",
        })
        self._store.max_size = original_max
        self._stop(scenario)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _start(self, scenario: str) -> None:
        with self._lock:
            self._running[scenario] = True
        self._emit("sim_start", {"scenario": scenario, "ts": time.time()})

    def _stop(self, scenario: str) -> None:
        with self._lock:
            self._running[scenario] = False

    def _emit_progress(self, scenario: str, pct: int, message: str) -> None:
        self._emit("sim_progress", {"scenario": scenario, "progress": pct, "message": message})

    def _emit_end(self, scenario: str, result: dict) -> None:
        self._emit("sim_end", {"scenario": scenario, "result": result, "ts": time.time()})
