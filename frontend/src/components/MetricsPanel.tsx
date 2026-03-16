import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, ResponsiveContainer, Legend,
} from "recharts";
import type { Metrics } from "../types";

interface Props {
  metrics: Metrics | null;
  history: Metrics[];
  onReset: () => void;
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-surface-2 rounded-lg p-3 flex flex-col gap-1">
      <span className="text-xs text-stale uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${color ?? "text-gray-100"}`}>{value}</span>
      {sub && <span className="text-xs text-stale">{sub}</span>}
    </div>
  );
}

export default function MetricsPanel({ metrics, history, onReset }: Props) {
  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full text-stale text-sm">
        Loading metrics…
      </div>
    );
  }

  // Format history for charts — keep last 60 points, use index as X.
  const chartData = history.slice(-60).map((m, i) => ({
    i,
    hit_rate: m.hit_rate,
    hits: m.hits,
    misses: m.misses,
    evictions: m.evictions,
    contention: m.contention_events,
    sets: m.sets,
    read_waits: m.read_waits ?? 0,
    write_waits: m.write_waits ?? 0,
  }));

  return (
    <div className="flex flex-col gap-4 overflow-y-auto pr-1">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Hit Rate"
          value={`${metrics.hit_rate}%`}
          sub={`${metrics.hits} hits / ${metrics.misses} misses`}
          color={metrics.hit_rate > 70 ? "text-hit" : metrics.hit_rate > 40 ? "text-evict" : "text-miss"}
        />
        <StatCard
          label="Total Ops"
          value={metrics.total_ops.toLocaleString()}
          sub={`${metrics.sets} sets · ${metrics.deletes} deletes`}
        />
        <StatCard
          label="Evictions"
          value={metrics.evictions.toLocaleString()}
          sub={`${metrics.expirations} expirations`}
          color={metrics.evictions > 0 ? "text-evict" : "text-gray-100"}
        />
        <StatCard
          label="Contention"
          value={metrics.contention_events.toLocaleString()}
          sub={`${metrics.lost_updates ?? 0} lost updates`}
          color={metrics.contention_events > 0 ? "text-contend" : "text-gray-100"}
        />
      </div>

      {/* RWLock state */}
      {metrics.active_readers !== undefined && (
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-stale uppercase tracking-wide mb-2">RW Lock State</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-brand tabular-nums">{metrics.active_readers}</div>
              <div className="text-xs text-stale">readers</div>
            </div>
            <div>
              <div className={`text-lg font-bold tabular-nums ${metrics.writer_active ? "text-miss" : "text-hit"}`}>
                {metrics.writer_active ? "1" : "0"}
              </div>
              <div className="text-xs text-stale">writer</div>
            </div>
            <div>
              <div className="text-lg font-bold text-evict tabular-nums">{metrics.read_waits ?? 0}</div>
              <div className="text-xs text-stale">rd waits</div>
            </div>
            <div>
              <div className="text-lg font-bold text-contend tabular-nums">{metrics.write_waits ?? 0}</div>
              <div className="text-xs text-stale">wr waits</div>
            </div>
          </div>
        </div>
      )}

      {/* Hit rate chart */}
      <div className="bg-surface-2 rounded-lg p-3">
        <p className="text-xs text-stale uppercase tracking-wide mb-3">Hit Rate Over Time</p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#22272e" />
            <XAxis dataKey="i" tick={false} />
            <YAxis domain={[0, 100]} tick={{ fill: "#8b949e", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#1c2128", border: "1px solid #22272e", borderRadius: 6 }}
              labelStyle={{ color: "#8b949e" }}
              formatter={(v: number) => [`${v}%`, "Hit Rate"]}
            />
            <Line type="monotone" dataKey="hit_rate" stroke="#3fb950" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Ops chart */}
      <div className="bg-surface-2 rounded-lg p-3">
        <p className="text-xs text-stale uppercase tracking-wide mb-3">Operations / Tick</p>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#22272e" />
            <XAxis dataKey="i" tick={false} />
            <YAxis tick={{ fill: "#8b949e", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#1c2128", border: "1px solid #22272e", borderRadius: 6 }}
            />
            <Legend wrapperStyle={{ fontSize: 10, color: "#8b949e" }} />
            <Bar dataKey="hits"      fill="#3fb950" stackId="a" />
            <Bar dataKey="misses"    fill="#f85149" stackId="a" />
            <Bar dataKey="evictions" fill="#d29922" stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onReset}
          className="text-xs text-stale hover:text-gray-200 border border-surface-3 px-3 py-1 rounded transition-colors"
        >
          Reset Metrics
        </button>
      </div>
    </div>
  );
}
