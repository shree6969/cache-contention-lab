import { useState } from "react";
import clsx from "clsx";
import { useCacheState } from "./hooks/useCacheApi";
import { useWebSocket } from "./hooks/useWebSocket";
import CacheViewer from "./components/CacheViewer";
import MetricsPanel from "./components/MetricsPanel";
import ScenarioPanel from "./components/ScenarioPanel";
import EventLog from "./components/EventLog";

type Tab = "cache" | "metrics" | "scenarios";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "cache",     label: "Cache",     icon: "🗄️" },
  { id: "metrics",   label: "Metrics",   icon: "📊" },
  { id: "scenarios", label: "Scenarios", icon: "⚡" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("scenarios");
  const { events, connected, clearEvents } = useWebSocket();
  const {
    entries, metrics, history, loading, error,
    setKey, deleteKey, clearAll, resetMetrics,
  } = useCacheState();

  return (
    <div className="h-screen bg-surface flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="border-b border-surface-3 bg-surface-1 px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🗄️</span>
          <span className="font-bold text-gray-100 text-sm">Cache Contention Lab</span>
        </div>
        <div className="flex-1" />
        {/* Metrics quick view */}
        {metrics && (
          <div className="hidden sm:flex items-center gap-4 text-xs text-stale">
            <span>
              <span className="text-hit font-bold">{metrics.hits}</span> hits ·{" "}
              <span className="text-miss font-bold">{metrics.misses}</span> misses ·{" "}
              <span className={clsx("font-bold", metrics.hit_rate > 70 ? "text-hit" : "text-evict")}>
                {metrics.hit_rate}%
              </span>
            </span>
            <span className="text-surface-3">|</span>
            <span>
              <span className="text-evict font-bold">{metrics.evictions}</span> evictions
            </span>
            <span className="text-surface-3">|</span>
            <span>
              {entries.length} / {metrics.max_size ?? "?"} keys
            </span>
          </div>
        )}
        {/* WS status */}
        <div className="flex items-center gap-1.5">
          <span className={clsx("w-2 h-2 rounded-full", connected ? "bg-hit" : "bg-miss animate-pulse")} />
          <span className="text-xs text-stale">{connected ? "live" : "reconnecting"}</span>
        </div>
      </header>

      {/* Body: left panel + event log */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: tabbed panel */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-surface-3 bg-surface-1 shrink-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  "px-5 py-2.5 text-xs flex items-center gap-1.5 border-b-2 transition-colors",
                  tab === t.id
                    ? "border-brand text-brand bg-surface"
                    : "border-transparent text-stale hover:text-gray-200"
                )}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden p-4">
            {loading && (
              <p className="text-stale text-sm text-center py-8">Connecting to backend…</p>
            )}
            {error && !loading && (
              <div className="bg-miss/10 border border-miss/30 rounded p-4 text-miss text-sm">
                Backend error: {error}
                <p className="text-xs mt-1 text-stale">Is the backend running on :8000?</p>
              </div>
            )}
            {!loading && !error && (
              <>
                {tab === "cache" && (
                  <div className="h-full">
                    <CacheViewer
                      entries={entries}
                      onSet={setKey}
                      onDelete={deleteKey}
                      onClear={clearAll}
                    />
                  </div>
                )}
                {tab === "metrics" && (
                  <div className="h-full overflow-y-auto">
                    <MetricsPanel
                      metrics={metrics}
                      history={history}
                      onReset={resetMetrics}
                    />
                  </div>
                )}
                {tab === "scenarios" && (
                  <div className="h-full">
                    <ScenarioPanel events={events} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: event log (fixed width) */}
        <div className="w-80 xl:w-96 border-l border-surface-3 flex flex-col overflow-hidden shrink-0">
          <EventLog events={events} onClear={clearEvents} />
        </div>
      </div>
    </div>
  );
}
