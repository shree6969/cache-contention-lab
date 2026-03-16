import { useState } from "react";
import clsx from "clsx";
import type { CacheEntry } from "../types";

interface Props {
  entries: CacheEntry[];
  onSet: (key: string, value: unknown, ttl?: number) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
}

function TtlBar({ entry }: { entry: CacheEntry }) {
  if (entry.expires_at == null || entry.ttl_remaining == null) return null;
  const total = entry.expires_at - entry.created_at;
  const pct = Math.max(0, Math.min(100, (entry.ttl_remaining / total) * 100));
  const color = pct > 50 ? "bg-hit" : pct > 20 ? "bg-evict" : "bg-miss";
  return (
    <div className="w-16 h-1.5 bg-surface-3 rounded-full overflow-hidden shrink-0">
      <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function AddEntryForm({ onSet }: { onSet: Props["onSet"] }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim()) return;
    setBusy(true);
    try {
      let parsed: unknown = value;
      try { parsed = JSON.parse(value); } catch { /* keep as string */ }
      await onSet(key.trim(), parsed, ttl ? Number(ttl) : undefined);
      setKey(""); setValue(""); setTtl("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex gap-2 flex-wrap">
      <input
        className="bg-surface-3 border border-surface-3 rounded px-2 py-1 text-xs text-gray-200 placeholder-stale flex-1 min-w-[100px] focus:outline-none focus:border-brand"
        placeholder="key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <input
        className="bg-surface-3 border border-surface-3 rounded px-2 py-1 text-xs text-gray-200 placeholder-stale flex-1 min-w-[140px] focus:outline-none focus:border-brand"
        placeholder='value (string or JSON)'
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <input
        className="bg-surface-3 border border-surface-3 rounded px-2 py-1 text-xs text-gray-200 placeholder-stale w-20 focus:outline-none focus:border-brand"
        placeholder="ttl (s)"
        type="number"
        min="0"
        value={ttl}
        onChange={(e) => setTtl(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy}
        className="px-3 py-1 bg-brand/20 hover:bg-brand/30 text-brand text-xs rounded border border-brand/40 transition-colors disabled:opacity-50"
      >
        {busy ? "…" : "SET"}
      </button>
    </form>
  );
}

export default function CacheViewer({ entries, onSet, onDelete, onClear }: Props) {
  const [filter, setFilter] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const visible = filter
    ? entries.filter((e) => e.key.includes(filter))
    : entries;

  const handleDelete = async (key: string) => {
    setDeletingKey(key);
    try { await onDelete(key); } finally { setDeletingKey(null); }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Cache</span>
          <span className="text-xs bg-surface-3 px-2 py-0.5 rounded-full text-stale">
            {entries.length} keys
          </span>
        </div>
        <button
          onClick={onClear}
          className="text-xs text-stale hover:text-miss transition-colors border border-surface-3 px-2 py-0.5 rounded"
        >
          clear all
        </button>
      </div>

      {/* Add form */}
      <div className="shrink-0">
        <AddEntryForm onSet={onSet} />
      </div>

      {/* Filter */}
      <input
        className="shrink-0 bg-surface-3 border border-surface-3 rounded px-2 py-1 text-xs text-gray-200 placeholder-stale focus:outline-none focus:border-brand"
        placeholder="filter keys…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-1">
        {visible.length === 0 ? (
          <p className="text-stale text-xs text-center py-8">
            {entries.length === 0 ? "Cache is empty" : "No keys match filter"}
          </p>
        ) : (
          visible.map((entry) => (
            <div
              key={entry.key}
              className="bg-surface-2 rounded px-3 py-2 flex items-start gap-2 group hover:bg-surface-3 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-brand text-xs font-mono truncate">{entry.key}</span>
                  <span className="text-xs text-stale shrink-0">{entry.hits}h</span>
                </div>
                <div className="text-gray-400 text-xs truncate mt-0.5 font-mono">
                  {JSON.stringify(entry.value).slice(0, 80)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                <TtlBar entry={entry} />
                {entry.ttl_remaining != null && (
                  <span className="text-xs text-stale tabular-nums w-8 text-right">
                    {entry.ttl_remaining.toFixed(0)}s
                  </span>
                )}
                <button
                  onClick={() => handleDelete(entry.key)}
                  disabled={deletingKey === entry.key}
                  className="text-stale hover:text-miss text-xs opacity-0 group-hover:opacity-100 transition-all"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
