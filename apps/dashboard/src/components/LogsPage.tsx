import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

type LogLevel = "info" | "warning" | "error";

interface DashboardLogEntry {
  id: string;
  timestamp: string;
  system: string;
  level: LogLevel;
  category: string;
  message: string;
  transactionId?: string;
  details?: Record<string, string | number | boolean | null>;
}

interface LogsResponse {
  systems: string[];
  logs: DashboardLogEntry[];
}

const EMPTY_LOGS: LogsResponse = {
  systems: [],
  logs: [],
};

function formatLogTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function levelTone(level: LogLevel): string {
  if (level === "error") {
    return "border-danger/40 bg-danger/10 text-danger";
  }

  if (level === "warning") {
    return "border-warning/40 bg-warning/10 text-warning";
  }

  return "border-accent/40 bg-accent/10 text-accent";
}

function detailPairs(details: DashboardLogEntry["details"]): [string, string][] {
  if (!details) {
    return [];
  }

  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => [key, String(value)]);
}

export function LogsPage() {
  const [selectedSystem, setSelectedSystem] = useState("all");
  const [logsResponse, setLogsResponse] = useState<LogsResponse>(EMPTY_LOGS);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLogs() {
      try {
        const params = new URLSearchParams({
          limit: "200",
          system: selectedSystem,
        });
        const response = await fetch(`/api/logs?${params.toString()}`);

        if (!response.ok) {
          throw new Error(`Logs API returned ${response.status}`);
        }

        const nextLogs = (await response.json()) as LogsResponse;

        if (!cancelled) {
          setLogsResponse(nextLogs);
          setUpdatedAt(new Date());
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load logs");
        }
      }
    }

    void loadLogs();
    const interval = setInterval(() => void loadLogs(), 2_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedSystem]);

  const counts = useMemo(() => {
    return logsResponse.logs.reduce<Record<LogLevel, number>>(
      (accumulator, log) => {
        accumulator[log.level] += 1;
        return accumulator;
      },
      { info: 0, warning: 0, error: 0 },
    );
  }, [logsResponse.logs]);

  const systems = ["all", ...logsResponse.systems];

  return (
    <section id="logs" className="space-y-6">
      <div className="panel p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">System Logs</h2>
            <p className="mono mt-2 text-xs text-muted-foreground">
              Prisma records and Redis stream events normalized by source system.
            </p>
          </div>
          <div className="mono flex flex-wrap gap-2 text-[10px] uppercase tracking-widest">
            <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-accent">
              info {counts.info}
            </span>
            <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-warning">
              warning {counts.warning}
            </span>
            <span className="rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-danger">
              error {counts.error}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {systems.map((system) => (
              <button
                key={system}
                type="button"
                onClick={() => setSelectedSystem(system)}
                className={`mono rounded-full border px-3 py-2 text-[10px] uppercase tracking-widest transition ${
                  selectedSystem === system
                    ? "border-primary bg-primary text-primary-foreground shadow-glow"
                    : "border-border/60 bg-surface-elevated/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {system}
              </button>
            ))}
          </div>
          <div className={`mono text-xs ${error ? "text-danger" : "text-success"}`}>
            {error ? error : `live${updatedAt ? ` · ${formatLogTime(updatedAt.toISOString())}` : ""}`}
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-border/60 px-6 py-4">
          <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Recent Events</h3>
        </div>
        <div className="divide-y divide-border/40">
          {logsResponse.logs.length === 0 ? (
            <div className="px-6 py-10 text-sm text-muted-foreground">
              No logs for this system yet.
            </div>
          ) : (
            logsResponse.logs.map((log) => {
              const details = detailPairs(log.details);

              return (
                <motion.article
                  key={log.id}
                  layout
                  className="grid gap-4 px-6 py-5 lg:grid-cols-[160px_1fr]"
                >
                  <div className="mono space-y-2 text-xs">
                    <div className="text-foreground">{formatLogTime(log.timestamp)}</div>
                    <div className="text-muted-foreground">{log.system}</div>
                    <span className={`inline-flex rounded-full border px-2 py-1 ${levelTone(log.level)}`}>
                      {log.level}
                    </span>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="mono text-[10px] uppercase tracking-widest text-accent">
                        {log.category}
                      </span>
                      {log.transactionId && (
                        <span className="mono text-[10px] text-muted-foreground">
                          tx {log.transactionId.slice(0, 12)}...
                        </span>
                      )}
                    </div>
                    <p className="mono mt-2 break-words text-sm text-foreground">{log.message}</p>
                    {details.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {details.slice(0, 8).map(([key, value]) => (
                          <span
                            key={`${log.id}:${key}`}
                            className="mono rounded-md border border-border/50 bg-surface-elevated/50 px-2 py-1 text-[10px] text-muted-foreground"
                          >
                            {key}: {value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
