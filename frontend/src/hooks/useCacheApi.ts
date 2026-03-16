import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import type { CacheEntry, Metrics } from "../types";

const POLL_INTERVAL_MS = 1000;

export function useCacheState() {
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, m, h] = await Promise.all([
        api.listKeys(),
        api.getMetrics(),
        api.getHistory(),
      ]);
      setEntries(e);
      setMetrics(m);
      setHistory(h.points);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    intervalRef.current = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  const setKey = useCallback(async (key: string, value: unknown, ttl?: number) => {
    await api.setKey(key, { value, ttl: ttl ?? null });
    await refresh();
  }, [refresh]);

  const deleteKey = useCallback(async (key: string) => {
    await api.deleteKey(key);
    await refresh();
  }, [refresh]);

  const clearAll = useCallback(async () => {
    await api.clearAll();
    await refresh();
  }, [refresh]);

  const resetMetrics = useCallback(async () => {
    await api.resetMetrics();
    await refresh();
  }, [refresh]);

  return {
    entries,
    metrics,
    history,
    loading,
    error,
    refresh,
    setKey,
    deleteKey,
    clearAll,
    resetMetrics,
  };
}
