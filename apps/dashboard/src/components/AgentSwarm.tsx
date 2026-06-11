import { motion } from "framer-motion";
import type { AgentCommMessage, AgentNodeTone } from "@halo/types";

type Node = {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  tone: AgentNodeTone;
};

type Edge = {
  from: string;
  to: string;
  label?: string;
};

const nodes: Node[] = [
  { id: "orchestrator", label: "Orchestrator", sub: "Router", x: 6, y: 50, tone: "router" },

  { id: "stream_ext", label: "Stream Ext", sub: "Raw → Features", x: 26, y: 22, tone: "raw" },
  { id: "tip_ext", label: "Tip Ext", sub: "Raw → Features", x: 26, y: 50, tone: "raw" },
  { id: "leader_ext", label: "Leader Ext", sub: "Raw → Features", x: 26, y: 78, tone: "raw" },

  { id: "stream_int", label: "Stream Int", sub: "Signals", x: 50, y: 12, tone: "signal" },
  { id: "bundle_int", label: "Bundle Int", sub: "Signals", x: 50, y: 34, tone: "signal" },
  { id: "tip_int", label: "Tip Int", sub: "Signals", x: 50, y: 56, tone: "signal" },
  { id: "leader_int", label: "Leader Int", sub: "Signals", x: 50, y: 78, tone: "signal" },
  { id: "congest_int", label: "Congestion", sub: "Signals", x: 50, y: 96, tone: "signal" },

  { id: "failure", label: "Failure", sub: "scores", x: 72, y: 22, tone: "signal" },
  { id: "retry", label: "Retry", sub: "scores", x: 72, y: 50, tone: "signal" },
  { id: "timing", label: "Timing", sub: "scores", x: 72, y: 78, tone: "signal" },

  { id: "aggregator", label: "Aggregator", sub: "Score Engine", x: 90, y: 42, tone: "engine" },
  { id: "halo", label: "Halo", sub: "Final Inference", x: 96, y: 70, tone: "inference" },
];

const edges: Edge[] = [
  { from: "orchestrator", to: "stream_ext", label: "stream" },
  { from: "orchestrator", to: "tip_ext", label: "tip" },
  { from: "orchestrator", to: "leader_ext", label: "leader" },

  { from: "stream_ext", to: "stream_int", label: "features" },
  { from: "stream_ext", to: "bundle_int", label: "features" },
  { from: "tip_ext", to: "tip_int", label: "features" },
  { from: "leader_ext", to: "leader_int", label: "features" },
  { from: "leader_ext", to: "congest_int", label: "features" },

  { from: "bundle_int", to: "failure" },
  { from: "tip_int", to: "retry" },
  { from: "tip_int", to: "failure" },
  { from: "leader_int", to: "timing" },
  { from: "congest_int", to: "timing" },

  { from: "failure", to: "aggregator", label: "scores" },
  { from: "retry", to: "aggregator", label: "scores" },
  { from: "timing", to: "aggregator", label: "scores" },

  { from: "aggregator", to: "halo", label: "aggregate" },
];

const toneStyles: Record<AgentNodeTone, { ring: string; dot: string; label: string }> = {
  router: { ring: "stroke-success", dot: "fill-success", label: "text-success" },
  raw: { ring: "stroke-accent", dot: "fill-accent", label: "text-accent" },
  signal: { ring: "stroke-primary/70", dot: "fill-primary/80", label: "text-primary" },
  engine: { ring: "stroke-primary", dot: "fill-primary", label: "text-primary" },
  inference: { ring: "stroke-danger", dot: "fill-danger", label: "text-danger" },
};

const FALLBACK_LOGS: AgentCommMessage[] = [
  {
    id: "boot-1",
    fromAgent: "orchestrator",
    toAgent: "stream_ext",
    message: "Yellowstone slot stream connected — awaiting bundle events.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "boot-2",
    fromAgent: "tip_ext",
    toAgent: "tip_int",
    message: "Polling Jito tip accounts and recent prioritization fees.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "boot-3",
    fromAgent: "leader_ext",
    toAgent: "timing",
    message: "Subscribed to Jito leader schedule for submission windows.",
    createdAt: new Date().toISOString(),
  },
];

function nodeById(id: string) {
  return nodes.find((node) => node.id === id)!;
}

export function AgentSwarm({ comms }: { comms: AgentCommMessage[] }) {
  const visibleLogs = (comms.length > 0 ? [...comms].reverse() : FALLBACK_LOGS).slice(-12);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-block h-2 w-2 rounded-full bg-success">
            <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
          </span>
          <h3 className="mono text-xs uppercase tracking-[0.25em] text-foreground">halo_swarm.graph</h3>
          <span className="mono text-[10px] text-muted-foreground">v1.0</span>
        </div>
        <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {nodes.length} agents · {edges.length} channels
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px]">
        <div className="relative h-[560px] bg-[radial-gradient(circle_at_50%_50%,oklch(0.22_0.04_240/0.4),transparent_70%)]">
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {edges.map((edge, index) => {
              const a = nodeById(edge.from);
              const b = nodeById(edge.to);
              return (
                <g key={index}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="stroke-border/60"
                    strokeWidth={0.15}
                    strokeDasharray="0.6 0.6"
                    vectorEffect="non-scaling-stroke"
                  />
                  <motion.line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="stroke-primary/80"
                    strokeWidth={0.25}
                    strokeDasharray="1 4"
                    animate={{ opacity: [0.1, 1, 0.1] }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      delay: index * 0.18,
                      ease: "easeInOut",
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>

          {edges
            .filter((edge) => edge.label)
            .map((edge, index) => {
              const a = nodeById(edge.from);
              const b = nodeById(edge.to);
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <span
                  key={index}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/60 px-1 mono text-[9px] uppercase tracking-wider text-muted-foreground/70"
                  style={{ left: `${mx}%`, top: `${my}%` }}
                >
                  {edge.label}
                </span>
              );
            })}

          {nodes.map((node, index) => {
            const style = toneStyles[node.tone];
            return (
              <div
                key={node.id}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 animate-fade-in flex-col items-center"
                style={{ left: `${node.x}%`, top: `${node.y}%`, animationDelay: `${index * 40}ms`, animationFillMode: "both" }}
              >
                <div className="relative">
                  <svg width="44" height="44" viewBox="0 0 44 44" className="overflow-visible">
                    <circle cx="22" cy="22" r="14" className={style.ring} strokeWidth="1.5" fill="none" opacity="0.7" />
                    <motion.circle
                      cx="22"
                      cy="22"
                      r="14"
                      className={style.ring}
                      strokeWidth="1"
                      fill="none"
                      animate={{ scale: [1, 1.5, 1.5], opacity: [0.6, 0, 0] }}
                      transition={{ duration: 2.2, repeat: Infinity, delay: index * 0.15 }}
                      style={{ transformOrigin: "22px 22px" }}
                    />
                    <circle cx="22" cy="22" r="4" className={style.dot} />
                  </svg>
                </div>
                <div className={`mono mt-1 whitespace-nowrap text-[10px] font-semibold ${style.label}`}>
                  {node.label}
                </div>
                <div className="mono whitespace-nowrap text-[9px] text-muted-foreground/70">{node.sub}</div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col border-l border-border/50 bg-surface-elevated/30 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="mono text-xs text-foreground">agent_comms.log</span>
            </div>
            <span className="mono text-[10px] text-muted-foreground">{visibleLogs.length} msgs</span>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {visibleLogs.map((message) => (
              <div key={message.id} className="animate-fade-in space-y-1" style={{ animationFillMode: "both" }}>
                <div className="flex items-center gap-1.5 mono text-[10px]">
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  <span className="text-primary">{message.fromAgent}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-muted-foreground">{message.toAgent}</span>
                </div>
                <p className="mono pl-3 text-xs leading-relaxed text-foreground/80">{message.message}</p>
              </div>
            ))}
            <div className="flex items-center gap-1 pl-3 mono text-[10px] text-muted-foreground/60">
              <span>orchestrator</span>
              <motion.span
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              >
                ●●●
              </motion.span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
