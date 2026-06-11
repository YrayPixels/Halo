import type { AgentFlowStep } from "@halo/types";

const toneClass: Record<string, string> = {
  danger: "text-danger border-danger/40 bg-danger/10",
  info: "text-info border-info/40 bg-info/10",
  warning: "text-warning border-warning/40 bg-warning/10",
  success: "text-success border-success/40 bg-success/10",
};

const FALLBACK_STEPS: AgentFlowStep[] = [
  {
    id: "idle-failure",
    agentName: "failure",
    label: "Failure Agent",
    note: "Waiting for bundle failures to analyze…",
    tone: "warning",
    stepOrder: 1,
    createdAt: new Date().toISOString(),
  },
  {
    id: "idle-tip",
    agentName: "tip",
    label: "Tip Agent",
    note: "Monitoring tip accounts and prioritization fees",
    tone: "info",
    stepOrder: 2,
    createdAt: new Date().toISOString(),
  },
  {
    id: "idle-timing",
    agentName: "timing",
    label: "Timing Agent",
    note: "Tracking Jito leader schedule",
    tone: "info",
    stepOrder: 3,
    createdAt: new Date().toISOString(),
  },
  {
    id: "idle-retry",
    agentName: "retry",
    label: "Retry Executor",
    note: "Standing by for agent retry decisions",
    tone: "success",
    stepOrder: 4,
    createdAt: new Date().toISOString(),
  },
];

export function AgentFlow({ steps }: { steps: AgentFlowStep[] }) {
  const nodes = steps.length > 0 ? steps : FALLBACK_STEPS;

  return (
    <div className="panel p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">AI Agent Reasoning</h3>
          <p className="mono mt-1 text-xs text-muted-foreground/70">live decision flow</p>
        </div>
        <span className="mono text-xs text-accent">{nodes.length} agents active</span>
      </div>
      <div className="space-y-3">
        {nodes.map((node, index) => (
          <div
            key={node.id}
            className="flex animate-fade-in items-stretch gap-4"
            style={{ animationDelay: `${index * 120}ms`, animationFillMode: "both" }}
          >
            <div className="flex flex-col items-center">
              <div
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 mono text-xs ${toneClass[node.tone] ?? toneClass.info}`}
              >
                {index + 1}
              </div>
              {index < nodes.length - 1 && (
                <div className="my-1 min-h-6 w-px flex-1 bg-gradient-to-b from-border to-transparent" />
              )}
            </div>
            <div className="flex-1 rounded-lg border border-border/50 bg-surface-elevated/40 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{node.label}</span>
                <span
                  className={`mono text-[10px] uppercase tracking-wider ${(toneClass[node.tone] ?? toneClass.info).split(" ")[0]}`}
                >
                  {node.tone}
                </span>
              </div>
              <p className="mono mt-1 text-sm text-muted-foreground">"{node.note}"</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
