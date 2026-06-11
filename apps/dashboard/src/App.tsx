import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { AgentCommMessage, AgentFlowStep } from "@halo/types";
import { AgentFlow } from "./components/AgentFlow.js";
import { AgentSwarm } from "./components/AgentSwarm.js";
import { CongestionHeatmap } from "./components/CongestionHeatmap.js";

type TransactionStatus = "SUBMITTED" | "PROCESSED" | "CONFIRMED" | "FINALIZED" | "FAILED";

interface DashboardTransaction {
  id: string;
  signature: string | null;
  bundleId: string | null;
  status: TransactionStatus;
  createdAt: string;
  processedAt: string | null;
  confirmedAt: string | null;
  finalizedAt: string | null;
  slot: string | null;
  processedSlot: string | null;
  confirmedSlot: string | null;
  finalizedSlot: string | null;
  processedViaStream: boolean;
  confirmedViaStream: boolean;
  finalizedViaStream: boolean;
  submittedToProcessedMs: number | null;
  processedToConfirmedMs: number | null;
  confirmedToFinalizedMs: number | null;
  submittedToFinalizedMs: number | null;
  tipLamports: string | null;
  tipSource: string | null;
  networkMedianFee: string | null;
  tipAccountActivity: string | null;
  failureClass: string | null;
  failureReason: string | null;
  bundleFailureCode: string | null;
  bundleFailureSource: string | null;
  attempt: number;
  maxAttempts: number;
  submittedSlot: string | null;
  targetLeaderSlot: string | null;
  targetLeaderIdentity: string | null;
  leaderSlotsAway: number | null;
}

interface AgentDecisionSummary {
  id: string;
  failureClass: string;
  reasoning: string;
  action: string;
  recommendedTipLamports: string;
  shouldRetry: boolean;
  leaderSlotsAway: number | null;
  bundleId: string | null;
  createdAt: string;
}

interface DashboardOverview {
  currentSlot: string | null;
  network: {
    currentLeader: string | null;
    nextJitoLeaderSlot: string | null;
    nextJitoLeaderIdentity: string | null;
    nextJitoLeaderSlotsAway: string | null;
    recommendedSubmitSlot: string | null;
    recommendedTip: string | null;
    networkMedianPriorityFee: string | null;
    tipAccountActivity: string | null;
    slotMeta: {
      slot?: string;
      blockhash?: string;
      parentSlot?: string;
      executedTransactionCount?: string;
      entriesCount?: string;
      observedAt?: string;
    } | null;
  };
  counts: Partial<Record<TransactionStatus, number>>;
  transactions: DashboardTransaction[];
  agents: {
    flowSteps: AgentFlowStep[];
    comms: AgentCommMessage[];
    latestDecision: AgentDecisionSummary | null;
  };
}

const EMPTY_OVERVIEW: DashboardOverview = {
  currentSlot: null,
  network: {
    currentLeader: null,
    nextJitoLeaderSlot: null,
    nextJitoLeaderIdentity: null,
    nextJitoLeaderSlotsAway: null,
    recommendedSubmitSlot: null,
    recommendedTip: null,
    networkMedianPriorityFee: null,
    tipAccountActivity: null,
    slotMeta: null,
  },
  counts: {},
  transactions: [],
  agents: {
    flowSteps: [],
    comms: [],
    latestDecision: null,
  },
};

const LIFECYCLE: TransactionStatus[] = ["SUBMITTED", "PROCESSED", "CONFIRMED", "FINALIZED"];

function truncate(value: string | null, size = 8): string {
  if (!value) {
    return "pending";
  }

  if (value.length <= size * 2 + 3) {
    return value;
  }

  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatMs(value: number | null): string {
  if (value === null) {
    return "-";
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  return `${(value / 1000).toFixed(2)}s`;
}

function statusTone(status: TransactionStatus): string {
  if (status === "FAILED") {
    return "text-danger";
  }

  if (status === "FINALIZED") {
    return "text-success";
  }

  if (status === "CONFIRMED") {
    return "text-accent";
  }

  return "text-primary";
}

function StatusDot({ tone = "success" }: { tone?: "success" | "warning" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success";

  return (
    <span className={`relative inline-block h-2 w-2 rounded-full ${color}`}>
      <span className="pulse-dot" />
      <span className="absolute inset-0 rounded-full bg-current" />
    </span>
  );
}

function MetricCard({
  label,
  value,
  delta,
  tone = "primary",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "primary" | "accent" | "success";
}) {
  const toneClass =
    tone === "accent" ? "text-accent" : tone === "success" ? "text-success" : "text-gradient-solar";

  return (
    <motion.div whileHover={{ y: -2 }} className="panel relative overflow-hidden p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mono mt-2 text-3xl font-semibold ${toneClass}`}>{value}</div>
      {delta && <div className="mono mt-1 text-xs text-success">{delta}</div>}
    </motion.div>
  );
}

function NetworkPanel({ overview, updatedAt }: { overview: DashboardOverview; updatedAt: Date | null }) {
  const stats = [
    { label: "Current Slot", value: overview.currentSlot ?? "waiting", accent: true },
    { label: "Current Leader", value: truncate(overview.network.currentLeader, 6) },
    { label: "Next Jito Leader", value: overview.network.nextJitoLeaderSlot ?? "waiting", accent: true },
    { label: "Leader Distance", value: overview.network.nextJitoLeaderSlotsAway ? `${overview.network.nextJitoLeaderSlotsAway} slots` : "waiting" },
    { label: "Submit Slot", value: overview.network.recommendedSubmitSlot ?? "waiting" },
    { label: "Recommended Tip", value: overview.network.recommendedTip ?? "waiting", accent: true },
    { label: "Median Fee", value: overview.network.networkMedianPriorityFee ?? "waiting" },
    {
      label: "Block Txs",
      value: overview.network.slotMeta?.executedTransactionCount ?? "waiting",
    },
    {
      label: "Block Hash",
      value: truncate(overview.network.slotMeta?.blockhash ?? null, 6),
    },
    { label: "Submitted", value: String(overview.counts.SUBMITTED ?? 0) },
    { label: "Processed", value: String(overview.counts.PROCESSED ?? 0), dot: "warning" as const },
    { label: "Confirmed", value: String(overview.counts.CONFIRMED ?? 0), dot: "success" as const },
    { label: "Finalized", value: String(overview.counts.FINALIZED ?? 0), dot: "success" as const },
    { label: "Failed", value: String(overview.counts.FAILED ?? 0), dot: "danger" as const },
  ];

  return (
    <div className="panel p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Network Activity</h3>
          <p className="mono mt-1 text-xs text-muted-foreground/70">yellowstone://mainnet-beta</p>
        </div>
        <div className="mono flex items-center gap-2 text-xs text-success">
          <StatusDot tone="success" />
          LIVE {updatedAt ? `· ${formatDate(updatedAt.toISOString())}` : ""}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <motion.div
            key={stat.label}
            layout
            className="rounded-lg border border-border/50 bg-surface-elevated/60 p-4"
          >
            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              {stat.label}
            </div>
            <div className="flex items-center gap-2">
              {stat.dot && <StatusDot tone={stat.dot} />}
              <span
                className={`mono text-lg ${
                  stat.accent ? "text-gradient-solar font-semibold" : "text-foreground"
                }`}
              >
                {stat.value}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function BundleTimeline({ transaction }: { transaction?: DashboardTransaction }) {
  const activeIndex = transaction ? LIFECYCLE.indexOf(transaction.status) : -1;
  const safeIndex = transaction?.status === "FAILED" ? 1 : activeIndex;
  const stages = [
    {
      label: "Submitted",
      time: transaction?.createdAt ?? null,
      slot: transaction?.submittedSlot ?? null,
      stream: true,
      delta: null,
    },
    {
      label: "Processed",
      time: transaction?.processedAt ?? null,
      slot: transaction?.processedSlot ?? null,
      stream: transaction?.processedViaStream ?? false,
      delta: transaction?.submittedToProcessedMs ?? null,
    },
    {
      label: "Confirmed",
      time: transaction?.confirmedAt ?? null,
      slot: transaction?.confirmedSlot ?? null,
      stream: transaction?.confirmedViaStream ?? false,
      delta: transaction?.processedToConfirmedMs ?? null,
    },
    {
      label: "Finalized",
      time: transaction?.finalizedAt ?? null,
      slot: transaction?.finalizedSlot ?? null,
      stream: transaction?.finalizedViaStream ?? false,
      delta: transaction?.confirmedToFinalizedMs ?? null,
    },
  ];

  return (
    <div className="panel p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Bundle Lifecycle</h3>
          <p className="mono mt-1 text-xs text-muted-foreground/70">
            bundle_id: <span className="text-accent">{truncate(transaction?.bundleId ?? null)}</span>
          </p>
        </div>
        <span className={`mono text-xs ${transaction ? statusTone(transaction.status) : "text-muted-foreground"}`}>
          {transaction?.status ?? "waiting"}
        </span>
      </div>
      <div className="relative">
        <div className="absolute left-0 right-0 top-3 h-px bg-border" />
        <motion.div
          className="absolute left-0 top-3 h-px bg-gradient-solar"
          animate={{ width: `${Math.max(0, safeIndex) / (LIFECYCLE.length - 1) * 100}%` }}
          transition={{ duration: 0.4 }}
        />
        <div className="relative grid grid-cols-4 gap-2">
          {LIFECYCLE.map((stage, index) => {
            const reached = index <= safeIndex;
            return (
              <div key={stage} className="flex flex-col items-center text-center">
                <motion.div
                  animate={{ scale: index === safeIndex ? 1.2 : 1 }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                    reached ? "border-primary bg-primary shadow-glow" : "border-border bg-surface"
                  }`}
                >
                  {reached && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </motion.div>
                <div
                  className={`mono mt-2 text-[10px] uppercase tracking-wider ${
                    reached ? "text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {stage}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {stages.map((stage) => (
          <div key={stage.label} className="rounded-lg border border-border/50 bg-surface-elevated/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {stage.label}
              </span>
              <span className={`mono text-[10px] ${stage.stream ? "text-success" : "text-warning"}`}>
                {stage.stream ? "stream" : "rpc/fallback"}
              </span>
            </div>
            <div className="mono mt-2 text-xs text-foreground">{formatDate(stage.time)}</div>
            <div className="mono mt-1 text-[10px] text-muted-foreground">
              slot {stage.slot ?? "-"} | delta {formatMs(stage.delta)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentFailures({ transactions }: { transactions: DashboardTransaction[] }) {
  const failures = transactions.filter((transaction) => transaction.status === "FAILED");

  return (
    <div className="panel p-6">
      <div className="mb-4">
        <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Recent Failures · classified</h3>
        <p className="mono mt-1 text-xs text-muted-foreground/70">agent-classified bundle failures</p>
      </div>
      {failures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No classified failures yet.</p>
      ) : (
        <div className="space-y-3">
          {failures.slice(0, 5).map((failure) => (
            <div
              key={failure.id}
              className="rounded-lg border border-border/50 bg-surface-elevated/40 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="mono text-xs text-danger">{failure.failureClass ?? "UNKNOWN"}</span>
                <span className="mono text-[10px] text-muted-foreground">attempt {failure.attempt}</span>
              </div>
              <p className="mono mt-2 text-xs text-muted-foreground">
                {failure.failureReason ?? "Awaiting agent classification"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TransactionTable({ transactions }: { transactions: DashboardTransaction[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border/60 p-6">
        <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Recent Transactions</h3>
        <p className="mono mt-1 text-xs text-muted-foreground/70">Postgres lifecycle records</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left">
          <thead className="mono border-b border-border/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Signature</th>
              <th className="px-6 py-3">Bundle</th>
              <th className="px-6 py-3">Slot</th>
              <th className="px-6 py-3">Leader</th>
              <th className="px-6 py-3">Tip</th>
              <th className="px-6 py-3">Attempt</th>
              <th className="px-6 py-3">Stream</th>
              <th className="px-6 py-3">Latency</th>
              <th className="px-6 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td className="px-6 py-8 text-sm text-muted-foreground" colSpan={10}>
                  No lifecycle rows yet. Run `pnpm dev:executor` to submit a bundle.
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <tr key={transaction.id} className="border-b border-border/40 last:border-0">
                  <td className={`mono px-6 py-4 text-xs ${statusTone(transaction.status)}`}>
                    {transaction.status}
                  </td>
                  <td className="mono px-6 py-4 text-xs text-foreground">
                    {truncate(transaction.signature)}
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    {truncate(transaction.bundleId)}
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    {transaction.slot ?? "-"}
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    <div>{transaction.targetLeaderSlot ?? "-"}</div>
                    <div className="text-[10px]">{truncate(transaction.targetLeaderIdentity, 5)}</div>
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    <div>{transaction.tipLamports ?? "-"}</div>
                    <div className="text-[10px]">{transaction.tipSource ?? "-"}</div>
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    {transaction.attempt}/{transaction.maxAttempts}
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    P:{transaction.processedViaStream ? "Y" : "N"} C:{transaction.confirmedViaStream ? "Y" : "N"} F:
                    {transaction.finalizedViaStream ? "Y" : "N"}
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    <div>S-&gt;P {formatMs(transaction.submittedToProcessedMs)}</div>
                    <div>P-&gt;C {formatMs(transaction.processedToConfirmedMs)}</div>
                  </td>
                  <td className="mono px-6 py-4 text-xs text-muted-foreground">
                    {formatDate(transaction.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function App() {
  const [overview, setOverview] = useState<DashboardOverview>(EMPTY_OVERVIEW);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const response = await fetch("/api/overview");
        if (!response.ok) {
          throw new Error(`Dashboard API returned ${response.status}`);
        }

        const nextOverview = (await response.json()) as DashboardOverview;

        if (!cancelled) {
          setOverview(nextOverview);
          setUpdatedAt(new Date());
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load overview");
        }
      }
    }

    void loadOverview();
    const interval = setInterval(() => void loadOverview(), 2_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const latestTransaction = overview.transactions[0];
  const finalizedCount = overview.counts.FINALIZED ?? 0;
  const submittedCount = overview.transactions.length;
  const landedRate = useMemo(() => {
    if (submittedCount === 0) {
      return "0%";
    }

    return `${Math.round(finalizedCount / submittedCount * 100)}%`;
  }, [finalizedCount, submittedCount]);

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-9 rounded-full bg-gradient-solar shadow-glow">
              <div className="absolute inset-1 rounded-full bg-background/70 backdrop-blur" />
              <div className="absolute inset-0 rounded-full border border-primary/40" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">HALO</h1>
              <p className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Mission Control
              </p>
            </div>
          </div>
          <nav className="mono hidden items-center gap-6 text-xs uppercase tracking-widest text-muted-foreground md:flex">
            <a className="transition hover:text-foreground" href="#network">Network</a>
            <a className="transition hover:text-foreground" href="#agents">Agents</a>
            <a className="transition hover:text-foreground" href="#bundles">Bundles</a>
            <a className="transition hover:text-foreground" href="#transactions">Transactions</a>
          </nav>
          <div className="mono flex items-center gap-2 text-xs text-success">
            <StatusDot tone={error ? "danger" : "success"} />
            {error ? "api degraded" : "mainnet-beta"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-12 px-6 py-12">
        <section className="grid items-center gap-10 lg:grid-cols-12">
          <div className="animate-fade-in lg:col-span-7" style={{ animationFillMode: "both" }}>
            <div className="mono mb-6 inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface/60 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              v0.1 · live observability
            </div>
            <h2 className="text-5xl font-semibold leading-[0.95] tracking-tight md:text-6xl xl:text-7xl">
              Solana bundle <br />
              <span className="text-gradient-solar">lifecycle cockpit</span>
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              HALO streams Yellowstone slots, submits Jito bundles, and records each lifecycle
              transition so the executor can learn why bundles land, lag, or fail.
            </p>
            {error && (
              <div className="mono mt-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-xs text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="space-y-4 lg:col-span-5">
            <div className="panel relative flex h-48 items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,oklch(0.78_0.18_65/0.25),transparent_60%)]" />
              <div
                className="absolute inset-0 opacity-[0.08]"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />
              <div className="relative h-28 w-28 rounded-full bg-gradient-solar shadow-glow">
                <div className="absolute inset-2 rounded-full bg-background/40 backdrop-blur-sm" />
                <div className="absolute inset-0 animate-ping rounded-full border border-primary/40" />
                <div className="absolute -inset-4 rounded-full border border-primary/20" />
                <div className="absolute -inset-8 rounded-full border border-primary/10" />
              </div>
              <div className="mono absolute bottom-3 left-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                halo.core · day 6
              </div>
              <div className="mono absolute right-4 top-3 flex items-center gap-1.5 text-[10px] text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                online
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Current slot" value={overview.currentSlot ?? "waiting"} tone="primary" />
              <MetricCard label="Tracked rows" value={String(overview.transactions.length)} tone="accent" />
              <MetricCard label="Finalized" value={String(finalizedCount)} tone="success" />
              <MetricCard label="Land rate" value={landedRate} delta="local DB sample" tone="accent" />
            </div>
          </div>
        </section>

        <section id="network">
          <NetworkPanel overview={overview} updatedAt={updatedAt} />
        </section>

        <section id="heatmap">
          <CongestionHeatmap slotMeta={overview.network.slotMeta} />
        </section>

        <section id="agents" className="space-y-6">
          <AgentSwarm comms={overview.agents.comms} />
          <div className="grid gap-6 lg:grid-cols-2">
            <AgentFlow steps={overview.agents.flowSteps} />
            <div className="space-y-6">
              <BundleTimeline transaction={latestTransaction} />
              <RecentFailures transactions={overview.transactions} />
              {overview.agents.latestDecision && (
                <div className="panel p-6">
                  <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Latest Agent Decision</h3>
                  <p className="mono mt-3 text-xs text-accent">{overview.agents.latestDecision.action}</p>
                  <p className="mono mt-2 text-sm text-muted-foreground">
                    {overview.agents.latestDecision.reasoning}
                  </p>
                  <div className="mono mt-4 flex flex-wrap gap-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                    <span>tip {overview.agents.latestDecision.recommendedTipLamports}</span>
                    <span>leader {overview.agents.latestDecision.leaderSlotsAway ?? "-"} slots</span>
                    <span>retry {overview.agents.latestDecision.shouldRetry ? "yes" : "no"}</span>
                    <span>bundle {truncate(overview.agents.latestDecision.bundleId)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="bundles" className="hidden">
          <BundleTimeline transaction={latestTransaction} />
        </section>

        <section id="transactions">
          <TransactionTable transactions={overview.transactions} />
        </section>

        <footer className="mono flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pb-12 pt-6 text-xs text-muted-foreground">
          <div>HALO · Solana execution observability</div>
          <div className="flex gap-4">
            <span>yellowstone · jito · prisma · redis</span>
            <span className={error ? "text-danger" : "text-success"}>
              {error ? "● dashboard api degraded" : "● all systems nominal"}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
