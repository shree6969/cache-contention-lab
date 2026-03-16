// ─── Cache entry ──────────────────────────────────────────────────────────────

export interface CacheEntry {
  key: string;
  value: unknown;
  created_at: number;       // unix timestamp
  expires_at: number | null;
  ttl_remaining: number | null; // seconds
  hits: number;
  last_accessed: number;
  is_expired: boolean;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface Metrics {
  ts: number;
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  expirations: number;
  hit_rate: number;         // 0-100
  total_ops: number;
  contention_events: number;
  lost_updates: number;
  // RWLock fields (may be absent when RWLock not used)
  active_readers?: number;
  writer_active?: boolean;
  writers_waiting?: number;
  read_waits?: number;
  write_waits?: number;
}

export interface MetricsHistory {
  points: Metrics[];
}

// ─── WebSocket events ─────────────────────────────────────────────────────────

export type EventKind =
  | "hit"
  | "miss"
  | "set"
  | "delete"
  | "eviction"
  | "expiration"
  | "contention"
  | "lost_update"
  | "sim_start"
  | "sim_end"
  | "sim_progress"
  | "error"
  | "metrics";

export interface WsEvent {
  kind: EventKind;
  ts: number;
  key?: string;
  value?: unknown;
  message?: string;
  scenario?: ScenarioId;
  // sim_progress fields
  progress?: number;
  // sim_end fields
  result?: Record<string, unknown>;
  // catch-all for other backend fields
  [key: string]: unknown;
}

// ─── Simulations ──────────────────────────────────────────────────────────────

export type ScenarioId =
  | "stampede"
  | "lost_update"
  | "deadlock"
  | "rw_contention"
  | "expiration_storm"
  | "eviction_pressure";

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  icon: string;
  tagline: string;
  description: string;
  what_to_watch: string;
  danger: "low" | "medium" | "high";
  params?: ScenarioParam[];
}

export interface ScenarioParam {
  name: string;
  label: string;
  type: "number" | "boolean";
  default: number | boolean;
  min?: number;
  max?: number;
}

export interface SimulationStatus {
  scenario: ScenarioId;
  running: boolean;
  progress?: number;   // 0-100
  result?: Record<string, unknown>;
}

// ─── API payloads ─────────────────────────────────────────────────────────────

export interface SetPayload {
  value: unknown;
  ttl?: number | null;
}

export interface SimulatePayload {
  params?: Record<string, unknown>;
}
