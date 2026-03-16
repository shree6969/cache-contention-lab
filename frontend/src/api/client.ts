import type {
  CacheEntry,
  Metrics,
  SetPayload,
  SimulatePayload,
  SimulationStatus,
  ScenarioId,
} from "../types";

const BASE = "/api";

async function req<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Cache CRUD ───────────────────────────────────────────────────────────────

export const api = {
  listKeys(): Promise<CacheEntry[]> {
    return req("GET", "/cache");
  },

  getKey(key: string): Promise<CacheEntry> {
    return req("GET", `/cache/${encodeURIComponent(key)}`);
  },

  setKey(key: string, payload: SetPayload): Promise<CacheEntry> {
    return req("PUT", `/cache/${encodeURIComponent(key)}`, payload);
  },

  deleteKey(key: string): Promise<{ deleted: boolean }> {
    return req("DELETE", `/cache/${encodeURIComponent(key)}`);
  },

  clearAll(): Promise<{ cleared: number }> {
    return req("DELETE", "/cache");
  },

  // ─── Metrics ────────────────────────────────────────────────────────────────

  getMetrics(): Promise<Metrics> {
    return req("GET", "/metrics");
  },

  getHistory(): Promise<{ points: Metrics[] }> {
    return req("GET", "/metrics/history");
  },

  resetMetrics(): Promise<{ ok: boolean }> {
    return req("POST", "/metrics/reset");
  },

  // ─── Simulations ────────────────────────────────────────────────────────────

  runScenario(id: ScenarioId, payload?: SimulatePayload): Promise<{ accepted: boolean; scenario: ScenarioId }> {
    return req("POST", `/simulate/${id}`, payload ?? {});
  },

  stopScenario(id: ScenarioId): Promise<{ stopped: boolean }> {
    return req("DELETE", `/simulate/${id}`);
  },

  getSimStatus(id: ScenarioId): Promise<SimulationStatus> {
    return req("GET", `/simulate/${id}`);
  },

  stopAll(): Promise<{ stopped: string[] }> {
    return req("DELETE", "/simulate");
  },
};
