import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { api } from "../api/client";
import type { ScenarioId, ScenarioConfig, WsEvent } from "../types";

const SCENARIOS: ScenarioConfig[] = [
  {
    id: "stampede",
    label: "Cache Stampede",
    icon: "💥",
    tagline: "Hot key expires → N threads all miss → wasted recomputations",
    description:
      "A popular key expires. 40 threads simultaneously request it, all miss, and all attempt to regenerate it — paying the full cost N times. Toggle 'protected' to see how a per-key lock reduces recomputations to 1.",
    what_to_watch: "recomputation count in result; contention events in the stream",
    danger: "medium",
    params: [
      { name: "n_threads",    label: "Threads",        type: "number",  default: 40,  min: 5,    max: 100 },
      { name: "protected",    label: "Use regen lock", type: "boolean", default: false },
      { name: "regen_delay",  label: "Regen delay (s)",type: "number",  default: 0.3, min: 0.05, max: 2 },
    ],
  },
  {
    id: "lost_update",
    label: "Lost Update",
    icon: "🏁",
    tagline: "Unsynchronised read-modify-write loses increments",
    description:
      "50 threads each read a counter, increment it, and write back — without atomic protection. Due to race windows, the final value is far below 50. Enable 'use_lock' to see correct results.",
    what_to_watch: "expected vs actual counter in result; lost_updates metric",
    danger: "medium",
    params: [
      { name: "n_threads", label: "Threads",         type: "number",  default: 50,   min: 10, max: 200 },
      { name: "use_lock",  label: "Use per-key lock", type: "boolean", default: false },
    ],
  },
  {
    id: "deadlock",
    label: "Deadlock",
    icon: "🔒",
    tagline: "Opposite lock order → circular wait → timeout",
    description:
      "Thread A locks key1 then sleeps, then tries key2. Thread B locks key2 then sleeps, then tries key1. They wait for each other indefinitely until the timeout fires.",
    what_to_watch: "CONTEND events in the stream; thread A/B timed_out in result",
    danger: "high",
    params: [
      { name: "timeout", label: "Lock timeout (s)", type: "number", default: 3.0, min: 1, max: 10 },
    ],
  },
  {
    id: "rw_contention",
    label: "Reader-Writer Contention",
    icon: "📖",
    tagline: "Writers block all readers; concurrent reads are free",
    description:
      "30 readers and 3 writers compete on a shared key via the RWLock. Readers proceed in parallel; a writer blocks everything. Watch active_readers spike while writer_active = false.",
    what_to_watch: "RWLock state in Metrics tab; read_waits vs write_waits",
    danger: "low",
    params: [
      { name: "n_readers", label: "Readers",    type: "number", default: 30, min: 5,  max: 80 },
      { name: "n_writers", label: "Writers",    type: "number", default: 3,  min: 1,  max: 10 },
      { name: "duration",  label: "Duration (s)",type: "number", default: 5,  min: 2, max: 15 },
    ],
  },
  {
    id: "expiration_storm",
    label: "Expiration Storm",
    icon: "⏱️",
    tagline: "All keys expire at once → hit rate collapses to 0%",
    description:
      "100 keys are written with identical TTLs. Hit rate stays near 100% while warm — then all expire simultaneously and hit rate drops to 0%. Fix: jitter TTLs by ±20%.",
    what_to_watch: "hit rate chart in Metrics tab — the cliff when TTL fires",
    danger: "medium",
    params: [
      { name: "n_keys", label: "Keys",    type: "number", default: 100, min: 20, max: 300 },
      { name: "ttl",    label: "TTL (s)", type: "number", default: 4,   min: 2,  max: 15 },
    ],
  },
  {
    id: "eviction_pressure",
    label: "Eviction Pressure",
    icon: "🗑️",
    tagline: "Fill cache past capacity → LRU evictions cascade",
    description:
      "600 keys are written into a cache capped at 200. LRU evicts the least-recently-used entry on every insert once full. Hot keys survive; cold keys are silently dropped.",
    what_to_watch: "evictions counter; cache size holding at max_size",
    danger: "low",
    params: [
      { name: "n_keys",    label: "Keys to write", type: "number", default: 600, min: 100, max: 2000 },
      { name: "max_size",  label: "Cache cap",     type: "number", default: 200, min: 50,  max: 500 },
    ],
  },
];

const DANGER_COLOR = {
  low:    "text-hit  border-hit/30  bg-hit/5",
  medium: "text-evict border-evict/30 bg-evict/5",
  high:   "text-miss border-miss/30 bg-miss/5",
};

interface Props {
  events: WsEvent[];
}

export default function ScenarioPanel({ events }: Props) {
  const [running,  setRunning]  = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, { pct: number; msg: string }>>({});
  const [results,  setResults]  = useState<Record<string, Record<string, unknown>>>({});
  const [params,   setParams]   = useState<Record<string, Record<string, unknown>>>({});
  const [expanded, setExpanded] = useState<ScenarioId | null>("stampede");
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Consume WS events for live progress and results.
  useEffect(() => {
    const last = events[0];
    if (!last) return;

    if (last.kind === "sim_progress" && last.scenario) {
      setProgress((prev) => ({
        ...prev,
        [last.scenario!]: {
          pct: (last.progress as number) ?? prev[last.scenario!]?.pct ?? 0,
          msg: (last.message as string) ?? "",
        },
      }));
    }

    if (last.kind === "sim_end" && last.scenario) {
      const result = (last.result ?? {}) as Record<string, unknown>;
      setResults((prev) => ({ ...prev, [last.scenario!]: result }));
      setRunning((prev) => ({ ...prev, [last.scenario!]: false }));
      setProgress((prev) => ({ ...prev, [last.scenario!]: { pct: 100, msg: "Completed" } }));
    }
  }, [events]);

  const getParam = (id: ScenarioId, name: string, def: unknown) =>
    params[id]?.[name] ?? def;

  const setParam = (id: ScenarioId, name: string, value: unknown) =>
    setParams((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [name]: value } }));

  const run = async (sc: ScenarioConfig) => {
    setRunning((r) => ({ ...r, [sc.id]: true }));
    setResults((r) => ({ ...r, [sc.id]: undefined as unknown as Record<string, unknown> }));
    setProgress((p) => ({ ...p, [sc.id]: { pct: 0, msg: "Starting…" } }));

    // Scroll the card into view.
    setTimeout(() => {
      cardRefs.current[sc.id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);

    const p: Record<string, unknown> = {};
    sc.params?.forEach((param) => { p[param.name] = getParam(sc.id, param.name, param.default); });

    try {
      await api.runScenario(sc.id, { params: p });
      // Fallback poll in case sim_end WS event is missed.
      const poll = setInterval(async () => {
        const status = await api.getSimStatus(sc.id);
        if (!status.running) {
          clearInterval(poll);
          setRunning((r) => ({ ...r, [sc.id]: false }));
        }
      }, 1000);
    } catch {
      setRunning((r) => ({ ...r, [sc.id]: false }));
    }
  };

  const stop = async (id: ScenarioId) => {
    await api.stopScenario(id);
    setRunning((r) => ({ ...r, [id]: false }));
    setProgress((p) => ({ ...p, [id]: { pct: 0, msg: "Stopped" } }));
  };

  const toggleExpand = (id: ScenarioId) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full pr-1">
      {SCENARIOS.map((sc) => {
        const isRunning  = running[sc.id]  ?? false;
        const isExpanded = expanded === sc.id;
        const prog       = progress[sc.id];
        const result     = results[sc.id];

        return (
          <div
            key={sc.id}
            ref={(el) => { cardRefs.current[sc.id] = el; }}
            className={clsx(
              "rounded-lg border bg-surface-2 transition-colors shrink-0",
              isRunning ? "border-brand/60" : "border-surface-3"
            )}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
              onClick={() => toggleExpand(sc.id)}
            >
              <span className="text-xl shrink-0">{sc.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-100">{sc.label}</span>
                  <span className={clsx("text-xs border px-1.5 rounded-full", DANGER_COLOR[sc.danger])}>
                    {sc.danger}
                  </span>
                  {isRunning && (
                    <span className="text-xs text-brand animate-pulse">● running</span>
                  )}
                  {!isRunning && result && (
                    <span className="text-xs text-hit">✓ done</span>
                  )}
                </div>
                <p className="text-xs text-stale truncate mt-0.5">{sc.tagline}</p>
              </div>
              <span className="text-stale text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
            </div>

            {/* Progress bar (visible even when collapsed) */}
            {isRunning && prog && (
              <div className="px-4 pb-2">
                <div className="flex justify-between text-xs text-stale mb-1">
                  <span className="truncate">{prog.msg}</span>
                  <span className="shrink-0 ml-2">{prog.pct}%</span>
                </div>
                <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all duration-300"
                    style={{ width: `${prog.pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Expanded body */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-surface-3 pt-3 flex flex-col gap-3">
                <p className="text-xs text-gray-400 leading-relaxed">{sc.description}</p>

                <div className="text-xs text-stale bg-surface-1 rounded px-3 py-2">
                  <span className="text-brand font-semibold">Watch: </span>
                  {sc.what_to_watch}
                </div>

                {/* Params */}
                {sc.params && sc.params.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {sc.params.map((param) => (
                      <label key={param.name} className="flex flex-col gap-1">
                        <span className="text-xs text-stale">{param.label}</span>
                        {param.type === "boolean" ? (
                          <button
                            disabled={isRunning}
                            className={clsx(
                              "text-xs rounded px-2 py-1 border transition-colors text-left disabled:opacity-50",
                              getParam(sc.id, param.name, param.default)
                                ? "bg-hit/20 border-hit/40 text-hit"
                                : "bg-surface-3 border-surface-3 text-stale"
                            )}
                            onClick={() =>
                              setParam(sc.id, param.name, !getParam(sc.id, param.name, param.default))
                            }
                          >
                            {getParam(sc.id, param.name, param.default) ? "✓ enabled" : "✗ disabled"}
                          </button>
                        ) : (
                          <input
                            type="number"
                            min={param.min}
                            max={param.max}
                            disabled={isRunning}
                            value={String(getParam(sc.id, param.name, param.default))}
                            onChange={(e) => setParam(sc.id, param.name, Number(e.target.value))}
                            className="bg-surface-3 border border-surface-3 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-brand disabled:opacity-50"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}

                {/* Run / Stop */}
                <div className="flex gap-2">
                  {isRunning ? (
                    <button
                      onClick={() => stop(sc.id)}
                      className="px-4 py-1.5 bg-miss/20 hover:bg-miss/30 text-miss text-xs rounded border border-miss/40 transition-colors"
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => run(sc)}
                      className="px-4 py-1.5 bg-brand/20 hover:bg-brand/30 text-brand text-xs rounded border border-brand/40 transition-colors"
                    >
                      ▶ Run Scenario
                    </button>
                  )}
                </div>

                {/* Result summary */}
                {result && !isRunning && (
                  <div className="bg-surface-1 rounded p-3 flex flex-col gap-1">
                    <span className="text-xs text-hit font-semibold mb-1">Result</span>
                    {Object.entries(result).map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-xs">
                        <span className="text-stale shrink-0 w-36 truncate">{k}</span>
                        <span className="text-gray-300 truncate font-mono">{JSON.stringify(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
