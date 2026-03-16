import clsx from "clsx";
import type { WsEvent, EventKind } from "../types";

interface Props {
  events: WsEvent[];
  onClear: () => void;
}

const KIND_META: Record<EventKind, { label: string; color: string; bg: string }> = {
  hit:            { label: "HIT",     color: "text-hit",      bg: "bg-hit/10" },
  miss:           { label: "MISS",    color: "text-miss",     bg: "bg-miss/10" },
  set:            { label: "SET",     color: "text-brand",    bg: "bg-brand/10" },
  delete:         { label: "DEL",     color: "text-gray-400", bg: "bg-surface-3" },
  eviction:       { label: "EVICT",   color: "text-evict",    bg: "bg-evict/10" },
  expiration:     { label: "EXPIRE",  color: "text-evict",    bg: "bg-evict/10" },
  contention:     { label: "CONTEND", color: "text-contend",  bg: "bg-contend/10" },
  lost_update:    { label: "RACE",    color: "text-miss",     bg: "bg-miss/10" },
  sim_start:      { label: "SIM▶",   color: "text-brand",    bg: "bg-brand/10" },
  sim_end:        { label: "SIM■",   color: "text-gray-300", bg: "bg-surface-3" },
  sim_progress:   { label: "SIM…",   color: "text-stale",    bg: "bg-surface-3" },
  error:          { label: "ERR",     color: "text-miss",     bg: "bg-miss/10" },
  metrics:        { label: "TICK",    color: "text-surface-3",bg: "bg-surface-1" },
};

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return (
    d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function EventRow({ ev }: { ev: WsEvent }) {
  if (ev.kind === "metrics") return null;

  const meta = KIND_META[ev.kind] ?? { label: ev.kind.toUpperCase(), color: "text-gray-400", bg: "" };
  const detail = ev.message ?? (ev.scenario && !ev.key ? `[${ev.scenario}]` : undefined);

  return (
    <div className={clsx("flex gap-2 items-start px-3 py-1 text-xs border-b border-surface-3/40", meta.bg)}>
      <span className="text-stale shrink-0 tabular-nums">{formatTs(ev.ts)}</span>
      <span className={clsx("shrink-0 w-16 font-bold", meta.color)}>{meta.label}</span>
      {ev.key && (
        <span className="text-brand shrink-0 max-w-[130px] truncate">{ev.key}</span>
      )}
      {detail && (
        <span className="text-gray-400 truncate">{detail}</span>
      )}
    </div>
  );
}

export default function EventLog({ events, onClear }: Props) {
  // events is already newest-first from useWebSocket — render directly, no reverse needed.
  const visible = events.filter((e) => e.kind !== "metrics").slice(0, 150);

  return (
    <div className="flex flex-col h-full bg-surface-1 border-surface-3 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-3 shrink-0">
        <span className="text-sm font-semibold text-gray-200">Event Stream</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-stale">{visible.length} events</span>
          <button
            onClick={onClear}
            className="text-xs text-stale hover:text-gray-200 transition-colors"
          >
            clear
          </button>
        </div>
      </div>
      {/* Newest events are at the top — no scroll needed to see latest */}
      <div className="flex-1 overflow-y-auto font-mono">
        {visible.length === 0 ? (
          <p className="text-stale text-xs px-4 py-6 text-center">
            Waiting for events… run a scenario or modify the cache.
          </p>
        ) : (
          visible.map((ev, i) => <EventRow key={i} ev={ev} />)
        )}
      </div>
    </div>
  );
}
