import { useEffect, useMemo, useState } from "react";

const ROWS = 8;
const COLS = 32;
const MAX_CELLS = ROWS * COLS;

type SlotMeta = {
  slot?: string;
  executedTransactionCount?: string;
  entriesCount?: string;
  observedAt?: string;
} | null;

type CongestionSample = {
  slot: string;
  txCount: number;
  entriesCount: number | null;
  observedAt: string;
};

function parseCount(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function cellColor(intensity: number): string {
  const hue = (1 - intensity) * 140;
  return `oklch(${0.45 + intensity * 0.25} ${0.12 + intensity * 0.1} ${hue})`;
}

export function CongestionHeatmap({ slotMeta }: { slotMeta: SlotMeta }) {
  const [samples, setSamples] = useState<CongestionSample[]>([]);

  useEffect(() => {
    const txCount = parseCount(slotMeta?.executedTransactionCount);
    if (!slotMeta?.slot || txCount === null) {
      return;
    }

    const nextSample: CongestionSample = {
      slot: slotMeta.slot,
      txCount,
      entriesCount: parseCount(slotMeta.entriesCount),
      observedAt: slotMeta.observedAt ?? new Date().toISOString(),
    };

    setSamples((current) => {
      if (current.at(-1)?.slot === nextSample.slot) {
        return current;
      }

      return [...current.filter((sample) => sample.slot !== nextSample.slot), nextSample].slice(-MAX_CELLS);
    });
  }, [slotMeta?.entriesCount, slotMeta?.executedTransactionCount, slotMeta?.observedAt, slotMeta?.slot]);

  const stats = useMemo(() => {
    const txCounts = samples.map((sample) => sample.txCount);
    const peak = txCounts.length > 0 ? Math.max(...txCounts) : 0;
    const average =
      txCounts.length > 0
        ? Math.round(txCounts.reduce((sum, value) => sum + value, 0) / txCounts.length)
        : 0;
    const scale = Math.max(peak, 2_000);

    return { average, peak, scale };
  }, [samples]);

  const cells = useMemo(
    () => [...Array<CongestionSample | null>(Math.max(0, MAX_CELLS - samples.length)).fill(null), ...samples],
    [samples],
  );
  const latest = samples.at(-1);

  return (
    <div className="panel p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Congestion Heatmap</h3>
          <p className="mono mt-1 text-xs text-muted-foreground/70">
            last {MAX_CELLS} observed blocks · executed transaction count
          </p>
        </div>
        <div className="mono flex items-center gap-2 text-[10px] text-muted-foreground">
          low
          <div className="h-2 w-20 rounded-full bg-gradient-to-r from-success via-warning to-danger" />
          high
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border/50 bg-surface-elevated/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Latest Slot</div>
          <div className="mono mt-1 text-sm text-foreground">{latest?.slot ?? "waiting"}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-surface-elevated/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Latest Txs</div>
          <div className="mono mt-1 text-sm text-gradient-solar">
            {latest ? formatNumber(latest.txCount) : "waiting"}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-surface-elevated/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg Txs</div>
          <div className="mono mt-1 text-sm text-foreground">
            {samples.length > 0 ? formatNumber(stats.average) : "waiting"}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-surface-elevated/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Peak Txs</div>
          <div className="mono mt-1 text-sm text-danger">
            {samples.length > 0 ? formatNumber(stats.peak) : "waiting"}
          </div>
        </div>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {cells.map((sample, index) => {
          const intensity = sample ? Math.min(1, sample.txCount / stats.scale) : 0;
          return (
            <div
              key={sample?.slot ?? `empty-${index}`}
              className="aspect-square rounded-sm border border-background/20 transition-colors duration-500"
              style={{
                background: sample ? cellColor(intensity) : "oklch(0.2 0.02 250 / 0.35)",
                opacity: sample ? 0.45 + intensity * 0.55 : 0.25,
              }}
              title={
                sample
                  ? `Slot ${sample.slot}: ${formatNumber(sample.txCount)} txs${
                      sample.entriesCount !== null ? `, ${formatNumber(sample.entriesCount)} entries` : ""
                    }`
                  : "waiting for block metadata"
              }
            />
          );
        })}
      </div>
    </div>
  );
}
